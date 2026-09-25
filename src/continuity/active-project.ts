// Aktif proje izleyicisi: sohbette en son hangi alias'a dokunulduğunu tutar.
// MCP proje araçları (register/resume/checkpoint) başarıyla tamamlandığında
// yazılır; tarayıcı uzantısı alias seçmediğinde köprü bu değeri kullanır.
// Yazım başarısız olsa bile süreklilik işlemi düşmez; köprü en güncel kayda
// düşerek çalışmaya devam eder.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const ACTIVE_PROJECT_FILE_NAME = "active-project.json";
export const MAX_ACTIVE_ALIAS_CHARS = 128;

export interface ActiveProjectRecord {
  alias: string;
  recordedAt: string;
}

export class ActiveProjectTracker {
  private readonly filePath: string;

  constructor(stateDirectory: string) {
    this.filePath = path.join(stateDirectory, ACTIVE_PROJECT_FILE_NAME);
  }

  async record(alias: string): Promise<void> {
    const trimmed = alias.trim().slice(0, MAX_ACTIVE_ALIAS_CHARS);
    if (trimmed === "") throw new Error("Active project alias must not be empty.");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    const payload: ActiveProjectRecord = { alias: trimmed, recordedAt: new Date().toISOString() };
    await writeFile(temporary, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async read(): Promise<string | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") return null;
      const alias = (parsed as { alias?: unknown }).alias;
      if (typeof alias !== "string" || alias.trim() === "") return null;
      return alias.trim().slice(0, MAX_ACTIVE_ALIAS_CHARS);
    } catch {
      // Bozuk izleyici dosyası bir ipucudur, kayıt değildir; yok sayılır.
      return null;
    }
  }
}
