// Terminal oturum çıktısının sınırlı disk aynası. MCP süreci ile köprü
// süreci ayrı çalıştığı için canlı terminal akışı yalnızca bellekte
// tutulamaz; bu ayna oturum başına son çıktıyı diske yazar, köprü de
// buradan okur. Yazma hataları terminal oturumunu asla düşürmez; ayna
// yalnızca gözlem kopyasıdır. Dosyalar oturum başına sınırlıdır ve en eski
// oturumlar budanır.

import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const TERMINAL_MIRROR_DIRECTORY_NAME = "terminal-streams";
export const DEFAULT_MAX_MIRROR_FILE_BYTES = 65_536;
export const DEFAULT_MAX_MIRROR_SESSIONS = 16;
export const MAX_TERMINAL_TAIL_CHARS = 2_000;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface TerminalMirrorOptions {
  maxFileBytes: number;
  maxSessions: number;
}

export interface TerminalMirrorSession {
  sessionId: string;
  cwd: string;
  state: string;
  updatedAt: string;
  tail: string;
}

interface TerminalMirrorMeta {
  version: 1;
  sessionId: string;
  cwd: string;
  state: string;
  startedAt: string;
  updatedAt: string;
  exitCode: number | null;
  // Oturum sırası: oturumlar ayrı kuyruklarda eşzamanlı yazıldığı için
  // dosya zaman damgası sıralamayı belirleyemez; monoton sayaç kullanılır.
  sequence: number;
}

function normalizeSessionId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return SESSION_ID_PATTERN.test(trimmed) ? trimmed : "";
}

function isMeta(value: unknown): value is TerminalMirrorMeta {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string"
    && typeof record.cwd === "string"
    && typeof record.state === "string"
    && typeof record.startedAt === "string"
    && typeof record.updatedAt === "string"
  );
}

export class TerminalMirror {
  private readonly directory: string;
  private readonly options: TerminalMirrorOptions;
  private readonly chains = new Map<string, Promise<void>>();
  private lastSequence = 0;

  constructor(directory: string, options: TerminalMirrorOptions) {
    this.directory = directory;
    this.options = options;
  }

  start(sessionId: string, cwd: string): void {
    const normalized = normalizeSessionId(sessionId);
    if (normalized === "") return;
    // Sıra numarası kuyruğa girmeden ayrılır: kuyruklar eşzamanlı işlense de
    // oturum sırası çağrı sırasına göre deterministik kalır.
    const sequence = this.nextSequence();
    this.enqueue(normalized, async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const now = new Date().toISOString();
      const meta: TerminalMirrorMeta = {
        version: 1,
        sessionId: normalized,
        cwd,
        state: "running",
        startedAt: now,
        updatedAt: now,
        exitCode: null,
        sequence,
      };
      await this.writeMeta(normalized, meta);
      await appendFile(this.logPath(normalized), "", { encoding: "utf8", mode: 0o600 });
      await this.prune(normalized);
    });
  }

  append(sessionId: string, data: string): void {
    const normalized = normalizeSessionId(sessionId);
    if (normalized === "" || data === "") return;
    this.enqueue(normalized, async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const logPath = this.logPath(normalized);
      await appendFile(logPath, data, { encoding: "utf8", mode: 0o600 });
      const info = await stat(logPath);
      if (info.size <= this.options.maxFileBytes) return;
      // Tavan aşıldığında dosya yarıdan kırpılır; kuyruk korunur.
      const raw = await readFile(logPath, "utf8");
      const keep = Math.max(1, Math.floor(this.options.maxFileBytes / 2));
      await writeFile(logPath, raw.slice(-keep), { encoding: "utf8", mode: 0o600 });
    });
  }

  finish(sessionId: string, state: string, exitCode: number | null): void {
    const normalized = normalizeSessionId(sessionId);
    if (normalized === "") return;
    const sequence = this.nextSequence();
    this.enqueue(normalized, async () => {
      const meta = await this.readMeta(normalized);
      const now = new Date().toISOString();
      if (meta === null) {
        await this.writeMeta(normalized, {
          version: 1,
          sessionId: normalized,
          cwd: "",
          state,
          startedAt: now,
          updatedAt: now,
          exitCode,
          sequence,
        });
        return;
      }
      await this.writeMeta(normalized, { ...meta, state, updatedAt: now, exitCode });
    });
  }

  // Süreç içi monoton sayaç: duvar saati geriye dönse bile sıra bozulmaz.
  private nextSequence(): number {
    const now = Date.now();
    this.lastSequence = now > this.lastSequence ? now : this.lastSequence + 1;
    return this.lastSequence;
  }

  // Bekleyen tüm ayna yazımlarını boşaltır; çağıran akışı bloklamaz,
  // yalnızca test ve kapanış için senkron nokta sağlar.
  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  async list(): Promise<TerminalMirrorSession[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw error;
    }
    const collected: { session: TerminalMirrorSession; sequence: number; updatedAtMs: number }[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const sessionId = normalizeSessionId(name.slice(0, -".json".length));
      if (sessionId === "") continue;
      const meta = await this.readMeta(sessionId);
      if (meta === null) continue;
      const tail = await this.readTail(sessionId);
      let updatedAt = meta.updatedAt;
      let updatedAtMs = Date.parse(meta.updatedAt);
      if (!Number.isFinite(updatedAtMs)) updatedAtMs = 0;
      try {
        const info = await stat(this.logPath(sessionId));
        updatedAt = info.mtime.toISOString();
        updatedAtMs = info.mtimeMs;
      } catch {
        // Günlük dosyası yoksa meta zamanı yeterlidir.
      }
      collected.push({
        session: {
          sessionId: meta.sessionId,
          cwd: meta.cwd,
          state: meta.state,
          updatedAt,
          tail,
        },
        sequence: meta.sequence,
        updatedAtMs,
      });
    }
    collected.sort((left, right) => (
      right.sequence - left.sequence || right.updatedAtMs - left.updatedAtMs
    ));
    return collected.slice(0, this.options.maxSessions).map((entry) => entry.session);
  }

  private async readTail(sessionId: string): Promise<string> {
    try {
      const raw = await readFile(this.logPath(sessionId), "utf8");
      return raw.slice(-MAX_TERMINAL_TAIL_CHARS).trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return "";
      throw error;
    }
  }

  private async prune(protectedSessionId: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return;
    }
    const metas: { sessionId: string; sequence: number; updatedAtMs: number }[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const sessionId = normalizeSessionId(name.slice(0, -".json".length));
      if (sessionId === "") continue;
      const meta = await this.readMeta(sessionId);
      let updatedAtMs = 0;
      try {
        const info = await stat(this.logPath(sessionId));
        updatedAtMs = info.mtimeMs;
      } catch {
        updatedAtMs = 0;
      }
      metas.push({ sessionId, sequence: meta?.sequence ?? 0, updatedAtMs });
    }
    if (metas.length <= this.options.maxSessions) return;
    metas.sort((left, right) => left.sequence - right.sequence || left.updatedAtMs - right.updatedAtMs);
    for (const entry of metas.slice(0, metas.length - this.options.maxSessions)) {
      if (entry.sessionId === protectedSessionId) continue;
      await rm(this.logPath(entry.sessionId), { force: true });
      await rm(this.metaPath(entry.sessionId), { force: true });
    }
  }

  private async readMeta(sessionId: string): Promise<TerminalMirrorMeta | null> {
    let raw: string;
    try {
      raw = await readFile(this.metaPath(sessionId), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isMeta(parsed)) return null;
      // Eski kayıtlarda sıra alanı yoktur; 0 verilir ve zaman damgasına düşülür.
      const sequence = (parsed as { sequence?: unknown }).sequence;
      return {
        ...parsed,
        sequence: typeof sequence === "number" && Number.isFinite(sequence) ? sequence : 0,
      };
    } catch {
      // Bozuk meta gözlem kaydı değildir; yok sayılır.
      return null;
    }
  }

  private async writeMeta(sessionId: string, meta: TerminalMirrorMeta): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.metaPath(sessionId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(meta, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  // Oturum başına sıralı kuyruk: aynı dosyaya eşzamanlı yazım olmaz.
  private enqueue(sessionId: string, work: () => Promise<void>): void {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(work).catch(() => {
      // Ayna hatası terminal oturumunu düşürmez; köprü canlı veriyi gösteremez.
    });
    this.chains.set(sessionId, next);
    void next.then(() => {
      if (this.chains.get(sessionId) === next) this.chains.delete(sessionId);
    });
  }

  private metaPath(sessionId: string): string {
    return path.join(this.directory, `${sessionId}.json`);
  }

  private logPath(sessionId: string): string {
    return path.join(this.directory, `${sessionId}.log`);
  }
}
