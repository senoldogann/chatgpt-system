import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { AuditLogger } from "./audit.js";
import { PolicyError } from "./errors.js";

// Basit worker/subagent deposu: prime + worker ailesi, slot kabulü, park edilmiş
// geçmiş ve bitmiş worker çiti. Tarayıcı sekmesi yoktur; worker kimliği
// alias + worktree ile kurulur, süreklilik project_register akışıyla birleşir.

export type WorkerState = "active" | "sleeping" | "finished" | "failed";

export interface WorkerRecord {
  id: string;
  label: string;
  task: string;
  state: WorkerState;
  alias: string | null;
  worktreePath: string | null;
  notes: string[];
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

export interface WorkerSpawnSpec {
  task: string;
  label?: string;
  alias?: string;
  worktreePath?: string;
}

const MAX_LABEL_CHARS = 60;
const MAX_TASK_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_NOTE_CHARS = 4_000;
const MAX_NOTES_PER_WORKER = 50;
const MAX_ALIAS_CHARS = 128;
const STORE_FILENAME = "workers.json";

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

  private async load(): Promise<WorkerRun[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const runs: WorkerRun[] = [];
      for (const entry of parsed) {
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
          workers: (candidate.workers as WorkerRecord[]).filter((worker) => typeof worker.id === "string"),
        });
      }
      return runs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new PolicyError("Worker deposu okunamadı.");
    }
  }

  private async save(runs: WorkerRun[]): Promise<void> {
    const bounded = runs.slice(-(this.maxParkedRuns + 8));
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(bounded, null, 2), { encoding: "utf8", mode: 0o600 });
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
    const runs = await this.load();
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
        notes: [],
        createdAt: now,
        lastSeenAt: now,
        result: null,
      });
    }
    if (activeWorkers(run).length > this.maxWorkers) {
      throw new PolicyError("Worker slot sınırı aşıldı.");
    }
    runs.push(run);
    await this.save(runs);
    await this.audit.run("workers.spawn", prime, async () => ({ runId: run.runId, count: run.workers.length }), { runId: run.runId });
    return run;
  }

  async status(runId: string): Promise<WorkerRun> {
    const runs = await this.load();
    return this.findRun(runs, runId);
  }

  async listForPrime(primeAlias: string): Promise<WorkerRun[]> {
    const runs = await this.load();
    return runs.filter((run) => run.primeAlias === primeAlias);
  }

  async message(runId: string, workerId: string, message: string): Promise<WorkerRun> {
    const text = message.trim();
    if (text === "" || text.length > MAX_NOTE_CHARS) throw new PolicyError("Mesaj 1-4000 karakter olmalı.");
    const runs = await this.load();
    const run = this.findRun(runs, runId);
    const worker = this.findWorker(run, workerId);
    if (isTerminal(worker.state)) throw new PolicyError("Bitmiş worker'a mesaj yazılamaz.");
    worker.notes.push(text);
    if (worker.notes.length > MAX_NOTES_PER_WORKER) worker.notes.splice(0, worker.notes.length - MAX_NOTES_PER_WORKER);
    worker.lastSeenAt = new Date().toISOString();
    if (worker.state === "sleeping") worker.state = "active";
    await this.save(runs);
    return run;
  }

  async sleep(runId: string, workerId: string): Promise<WorkerRun> {
    const runs = await this.load();
    const run = this.findRun(runs, runId);
    const worker = this.findWorker(run, workerId);
    if (isTerminal(worker.state)) throw new PolicyError("Bitmiş worker uyutulamaz.");
    worker.state = "sleeping";
    worker.lastSeenAt = new Date().toISOString();
    await this.save(runs);
    return run;
  }

  async finish(runId: string, workerId: string, report: string, failed: boolean): Promise<WorkerRun> {
    const text = report.trim();
    if (text === "" || text.length > MAX_NOTE_CHARS) throw new PolicyError("Rapor 1-4000 karakter olmalı.");
    const runs = await this.load();
    const run = this.findRun(runs, runId);
    const worker = this.findWorker(run, workerId);
    if (isTerminal(worker.state)) throw new PolicyError("Worker zaten bitmiş.");
    worker.state = failed ? "failed" : "finished";
    worker.result = text;
    worker.lastSeenAt = new Date().toISOString();
    if (run.workers.every((candidate) => isTerminal(candidate.state))) run.parked = true;
    await this.save(runs);
    await this.audit.run("workers.finish", run.primeAlias, async () => ({ runId, workerId, failed }), { runId });
    return run;
  }

  freeSlots(run: WorkerRun): number {
    return Math.max(0, this.maxWorkers - activeWorkers(run).length);
  }
}
