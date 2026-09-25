import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { AuditLogger } from "../core/audit.js";
import { PolicyError, WorkerRetiredError } from "../core/errors.js";

// Worker/subagent deposu: prime + worker ailesi, yönlü inbox kuyruğu,
// slot kabulü, park edilmiş geçmiş ve bitmiş worker çiti. Tarayıcı sekmesi
// yoktur; worker kimliği alias + worktree ile kurulur, süreklilik
// project_register akışıyla birleşir.

export type WorkerState = "active" | "sleeping" | "finished" | "failed";
export type MessageSender = "prime" | "worker";

export interface AgentMessage {
  id: string;
  from: MessageSender;
  text: string;
  sentAt: string;
  readAt: string | null;
}

export interface WorkerRecord {
  id: string;
  label: string;
  task: string;
  state: WorkerState;
  alias: string | null;
  worktreePath: string | null;
  inbox: AgentMessage[];
  createdAt: string;
  lastSeenAt: string;
  result: string | null;
}

export interface WorkerRun {
  runId: string;
  primeAlias: string;
  sharedContext: string;
  createdAt: string;
  parked: boolean;
  workers: WorkerRecord[];
}

export interface RetiredAlias {
  alias: string;
  runId: string;
  workerId: string;
  retiredAt: string;
}

export interface WorkerSpawnSpec {
  task: string;
  label?: string;
  alias?: string;
  worktreePath?: string;
}

const MAX_LABEL_CHARS = 60;
const MAX_TASK_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_QUEUE = 200;
const MAX_RETIRED = 200;
const MAX_ALIAS_CHARS = 128;
const STORE_FILENAME = "workers.json";
const STORE_VERSION = 1;

// Bir worker'a verilen açılış brifi: herkesin ortak bağlamı + kendi işi.
export function briefFor(sharedContext: string, task: string): string {
  if (sharedContext.trim() === "") return task;
  return `Bu çalışmadaki tüm worker'lar için ortak bağlam:\n${sharedContext}\n\nSenin işin:\n${task}`;
}

function isTerminal(state: WorkerState): boolean {
  return state === "finished" || state === "failed";
}

function activeWorkers(run: WorkerRun): WorkerRecord[] {
  return run.workers.filter((worker) => !isTerminal(worker.state) && worker.state === "active");
}

function validMessage(candidate: unknown): AgentMessage | null {
  if (candidate === null || typeof candidate !== "object") return null;
  const message = candidate as Partial<AgentMessage>;
  if (typeof message.id !== "string" || message.id === "") return null;
  if (message.from !== "prime" && message.from !== "worker") return null;
  if (typeof message.text !== "string" || message.text === "") return null;
  if (typeof message.sentAt !== "string") return null;
  if (message.readAt !== null && typeof message.readAt !== "string") return null;
  return {
    id: message.id,
    from: message.from,
    text: message.text.slice(0, MAX_MESSAGE_CHARS),
    sentAt: message.sentAt,
    readAt: message.readAt,
  };
}

function validWorker(candidate: unknown): WorkerRecord | null {
  if (candidate === null || typeof candidate !== "object") return null;
  const worker = candidate as Partial<WorkerRecord> & { notes?: unknown };
  if (typeof worker.id !== "string" || typeof worker.task !== "string") return null;
  // Eski notes[] biçimi prime'dan gelmiş okunmamış mesajlara çevrilir.
  const legacyNotes = Array.isArray(worker.notes)
    ? worker.notes.filter((note): note is string => typeof note === "string" && note !== "")
    : [];
  const inbox = Array.isArray(worker.inbox)
    ? worker.inbox.map(validMessage).filter((message): message is AgentMessage => message !== null)
    : legacyNotes.map((text) => ({
        id: `m-${randomUUID().slice(0, 8)}`,
        from: "prime" as const,
        text: text.slice(0, MAX_MESSAGE_CHARS),
        sentAt: new Date(0).toISOString(),
        readAt: null,
      }));
  const state = worker.state;
  return {
    id: worker.id,
    label: typeof worker.label === "string" ? worker.label : worker.id,
    task: worker.task,
    state: state === "sleeping" || state === "finished" || state === "failed" ? state : "active",
    alias: typeof worker.alias === "string" ? worker.alias : null,
    worktreePath: typeof worker.worktreePath === "string" ? worker.worktreePath : null,
    inbox: inbox.slice(-MAX_QUEUE),
    createdAt: typeof worker.createdAt === "string" ? worker.createdAt : new Date(0).toISOString(),
    lastSeenAt: typeof worker.lastSeenAt === "string" ? worker.lastSeenAt : new Date(0).toISOString(),
    result: typeof worker.result === "string" ? worker.result : null,
  };
}

function validRetired(candidate: unknown): RetiredAlias | null {
  if (candidate === null || typeof candidate !== "object") return null;
  const entry = candidate as Partial<RetiredAlias>;
  if (typeof entry.alias !== "string" || entry.alias === "") return null;
  if (typeof entry.runId !== "string" || typeof entry.workerId !== "string") return null;
  return {
    alias: entry.alias,
    runId: entry.runId,
    workerId: entry.workerId,
    retiredAt: typeof entry.retiredAt === "string" ? entry.retiredAt : new Date(0).toISOString(),
  };
}

interface WorkerStoreFile {
  runs: WorkerRun[];
  retired: RetiredAlias[];
}

export class WorkerStore {
  private constructor(
    private readonly filePath: string,
    private readonly audit: AuditLogger,
    private readonly maxWorkers: number,
    private readonly maxParkedRuns: number,
  ) {}

  static filePathFor(stateRoot: string): string {
    return path.join(stateRoot, STORE_FILENAME);
  }

  static async open(stateRoot: string, audit: AuditLogger, maxWorkers: number, maxParkedRuns: number): Promise<WorkerStore> {
    await mkdir(stateRoot, { recursive: true });
    return new WorkerStore(WorkerStore.filePathFor(stateRoot), audit, maxWorkers, maxParkedRuns);
  }

  private async load(): Promise<WorkerStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      // Eski biçim: çıplak run dizisi, retired listesi yok.
      if (Array.isArray(parsed)) {
        return { runs: this.runsFromLegacy(parsed), retired: [] };
      }
      if (parsed === null || typeof parsed !== "object") return { runs: [], retired: [] };
      const file = parsed as { runs?: unknown; retired?: unknown };
      return {
        runs: Array.isArray(file.runs) ? this.runsFromLegacy(file.runs) : [],
        retired: Array.isArray(file.retired)
          ? file.retired.map(validRetired).filter((entry): entry is RetiredAlias => entry !== null).slice(-MAX_RETIRED)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: [], retired: [] };
      throw new PolicyError("Worker deposu okunamadı.");
    }
  }

  private runsFromLegacy(entries: unknown[]): WorkerRun[] {
    const runs: WorkerRun[] = [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") continue;
      const candidate = entry as Partial<WorkerRun>;
      if (typeof candidate.runId !== "string" || typeof candidate.primeAlias !== "string") continue;
      if (!Array.isArray(candidate.workers)) continue;
      runs.push({
        runId: candidate.runId,
        primeAlias: candidate.primeAlias,
        sharedContext: typeof candidate.sharedContext === "string" ? candidate.sharedContext : "",
        createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
        parked: candidate.parked === true,
        workers: candidate.workers.map(validWorker).filter((worker): worker is WorkerRecord => worker !== null),
      });
    }
    return runs;
  }

  private async save(file: WorkerStoreFile): Promise<void> {
    const bounded: WorkerStoreFile = {
      runs: file.runs.slice(-(this.maxParkedRuns + 8)),
      retired: file.retired.slice(-MAX_RETIRED),
    };
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: STORE_VERSION, ...bounded }, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private findRun(runs: WorkerRun[], runId: string): WorkerRun {
    const run = runs.find((candidate) => candidate.runId === runId);
    if (run === undefined) throw new PolicyError("Worker run bulunamadı.");
    return run;
  }

  private findWorker(run: WorkerRun, workerId: string): WorkerRecord {
    const worker = run.workers.find((candidate) => candidate.id === workerId);
    if (worker === undefined) throw new PolicyError("Worker bulunamadı.");
    return worker;
  }

  async spawn(primeAlias: string, sharedContext: string, specs: WorkerSpawnSpec[]): Promise<WorkerRun> {
    const prime = primeAlias.trim();
    if (prime === "" || prime.length > MAX_ALIAS_CHARS) throw new PolicyError("Geçerli bir prime alias ver.");
    if (sharedContext.length > MAX_CONTEXT_CHARS) throw new PolicyError("Ortak bağlam 4.000 karakteri aşamaz.");
    if (specs.length === 0 || specs.length > 8) throw new PolicyError("Bir spawn 1-8 worker içerir.");
    const now = new Date().toISOString();
    const file = await this.load();
    const run: WorkerRun = {
      runId: randomUUID(),
      primeAlias: prime,
      sharedContext,
      createdAt: now,
      parked: false,
      workers: [],
    };
    for (const spec of specs) {
      const task = spec.task.trim();
      if (task === "" || task.length > MAX_TASK_CHARS) throw new PolicyError("Her worker'a 1-4000 karakterlik iş yaz.");
      const label = (spec.label ?? `worker-${run.workers.length + 1}`).slice(0, MAX_LABEL_CHARS);
      run.workers.push({
        id: `w-${randomUUID().slice(0, 8)}`,
        label,
        task: briefFor(sharedContext, task),
        state: "active",
        alias: spec.alias ?? null,
        worktreePath: spec.worktreePath ?? null,
        inbox: [],
        createdAt: now,
        lastSeenAt: now,
        result: null,
      });
    }
    if (activeWorkers(run).length > this.maxWorkers) {
      throw new PolicyError("Worker slot sınırı aşıldı.");
    }
    file.runs.push(run);
    await this.save(file);
    await this.audit.run("workers.spawn", prime, async () => ({ runId: run.runId, count: run.workers.length }), { runId: run.runId });
    return run;
  }

  // Okuma tüketimdir: okunmamış mesajlar bu çağrıda okundu sayılır.
  async status(runId: string): Promise<WorkerRun> {
    const file = await this.load();
    const run = this.findRun(file.runs, runId);
    const now = new Date().toISOString();
    for (const worker of run.workers) {
      for (const message of worker.inbox) {
        if (message.readAt === null) message.readAt = now;
      }
    }
    await this.save(file);
    return run;
  }

  async listForPrime(primeAlias: string): Promise<WorkerRun[]> {
    const file = await this.load();
    return file.runs.filter((run) => run.primeAlias === primeAlias);
  }

  async message(runId: string, workerId: string, message: string, from: MessageSender = "prime"): Promise<WorkerRun> {
    const text = message.trim();
    if (text === "" || text.length > MAX_MESSAGE_CHARS) throw new PolicyError("Mesaj 1-4000 karakter olmalı.");
    if (from !== "prime" && from !== "worker") throw new PolicyError("Mesaj yönü prime ya da worker olmalı.");
    const file = await this.load();
    const run = this.findRun(file.runs, runId);
    const worker = this.findWorker(run, workerId);
    if (isTerminal(worker.state)) throw new PolicyError("Bitmiş worker'a mesaj yazılamaz.");
    if (worker.inbox.length >= MAX_QUEUE) {
      const oldestRead = worker.inbox.find((candidate) => candidate.readAt !== null);
      if (oldestRead === undefined) {
        throw new PolicyError("Kuyruk dolu: önce worker_status ile okunmamışları tüket.");
      }
      worker.inbox.splice(worker.inbox.indexOf(oldestRead), 1);
    }
    worker.inbox.push({
      id: `m-${randomUUID().slice(0, 8)}`,
      from,
      text,
      sentAt: new Date().toISOString(),
      readAt: null,
    });
    worker.lastSeenAt = new Date().toISOString();
    if (worker.state === "sleeping") worker.state = "active";
    await this.save(file);
    return run;
  }

  async sleep(runId: string, workerId: string): Promise<WorkerRun> {
    const file = await this.load();
    const run = this.findRun(file.runs, runId);
    const worker = this.findWorker(run, workerId);
    if (isTerminal(worker.state)) throw new PolicyError("Bitmiş worker uyutulamaz.");
    worker.state = "sleeping";
    worker.lastSeenAt = new Date().toISOString();
    await this.save(file);
    return run;
  }

  async finish(runId: string, workerId: string, report: string, failed: boolean): Promise<WorkerRun> {
    const text = report.trim();
    if (text === "" || text.length > MAX_MESSAGE_CHARS) throw new PolicyError("Rapor 1-4000 karakter olmalı.");
    const file = await this.load();
    const run = this.findRun(file.runs, runId);
    const worker = this.findWorker(run, workerId);
    if (isTerminal(worker.state)) throw new PolicyError("Worker zaten bitmiş.");
    worker.state = failed ? "failed" : "finished";
    worker.result = text;
    worker.lastSeenAt = new Date().toISOString();
    if (worker.alias !== null) {
      file.retired.push({ alias: worker.alias, runId, workerId, retiredAt: worker.lastSeenAt });
    }
    if (run.workers.every((candidate) => isTerminal(candidate.state))) run.parked = true;
    await this.save(file);
    await this.audit.run("workers.finish", run.primeAlias, async () => ({ runId, workerId, failed }), { runId });
    return run;
  }

  async isRetired(alias: string): Promise<boolean> {
    const file = await this.load();
    return file.retired.some((entry) => entry.alias === alias);
  }

  async assertAliasLive(alias: string): Promise<void> {
    if (await this.isRetired(alias)) throw new WorkerRetiredError(alias);
  }

  freeSlots(run: WorkerRun): number {
    return Math.max(0, this.maxWorkers - activeWorkers(run).length);
  }
}

export interface WorkerScope {
  taskStateRoot: string;
  audit: AuditLogger;
  maxWorkers: number;
  maxParkedRuns: number;
}

// Bitmiş worker alias'ından gelen checkpoint/push yazımını kapatır.
export async function assertWorkerAliasLive(scope: WorkerScope, alias: string): Promise<void> {
  const store = await WorkerStore.open(scope.taskStateRoot, scope.audit, scope.maxWorkers, scope.maxParkedRuns);
  await store.assertAliasLive(alias);
}
