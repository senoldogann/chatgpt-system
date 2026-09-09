import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import { LimitError } from "./errors.js";
import { resolveExecutablePath } from "./executable-resolution.js";
import { sanitizedChildEnvironment } from "./process-policy.js";

export type ManagedProcessState = "running" | "exited" | "stopped";

export interface ManagedProcessSummary {
  processId: string;
  command: string;
  argCount: number;
  cwd: string;
  state: ManagedProcessState;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
}

export interface ManagedProcessLogs {
  processId: string;
  stdout: { content: string; bytes: number; truncated: boolean };
  stderr: { content: string; bytes: number; truncated: boolean };
}

export interface ManagedProcessDescriptor {
  processId: string;
  command: string;
  cwd: string;
}

export interface ManagedSpawnOptions {
  cwd: string;
  shell: false;
  env: NodeJS.ProcessEnv;
  stdio: ["ignore", "pipe", "pipe"];
  detached: boolean;
}

export type ManagedSpawn = (
  command: string,
  args: readonly string[],
  options: ManagedSpawnOptions,
) => ChildProcess;

export type ManagedSignal = (target: number, signal: NodeJS.Signals) => void;

export interface ProcessSupervisorOptions {
  limits: Pick<
    LimitsConfig,
    "maxManagedProcesses" | "maxProcessLogBytesPerStream" | "processStopGraceMs"
  >;
  audit: AuditLogger;
  platform?: NodeJS.Platform;
  now?: () => number;
  newProcessId?: () => string;
  spawnProcess?: ManagedSpawn;
  signalProcess?: ManagedSignal;
}

class TailBuffer {
  private value = Buffer.alloc(0);
  private wasTruncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;
    const combined = Buffer.concat([this.value, chunk]);
    if (combined.byteLength <= this.maxBytes) {
      this.value = combined;
      return;
    }

    this.wasTruncated = true;
    this.value = Buffer.from(combined.subarray(combined.byteLength - this.maxBytes));
  }

  snapshot(): { content: string; bytes: number; truncated: boolean } {
    return {
      content: this.value.toString("utf8"),
      bytes: this.value.byteLength,
      truncated: this.wasTruncated,
    };
  }
}

interface ManagedRecord {
  processId: string;
  command: string;
  argCount: number;
  cwd: string;
  state: ManagedProcessState;
  startedAt: string;
  startedAtMs: number;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  child: ChildProcess;
  stdout: TailBuffer;
  stderr: TailBuffer;
  terminationRequested: boolean;
  closed: Promise<void>;
  resolveClosed: () => void;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: ManagedSpawnOptions,
): ChildProcess {
  return spawn(command, [...args], options);
}

function defaultSignal(target: number, signal: NodeJS.Signals): void {
  process.kill(target, signal);
}

function newOpaqueProcessId(): string {
  return randomBytes(32).toString("base64url");
}

function summary(record: ManagedRecord): ManagedProcessSummary {
  return {
    processId: record.processId,
    command: record.command,
    argCount: record.argCount,
    cwd: record.cwd,
    state: record.state,
    startedAt: record.startedAt,
    ...(record.exitedAt !== undefined ? { exitedAt: record.exitedAt } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.signal !== undefined ? { signal: record.signal } : {}),
  };
}

export class ProcessSupervisor {
  private readonly records = new Map<string, ManagedRecord>();
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly newProcessId: () => string;
  private readonly spawnProcess: ManagedSpawn;
  private readonly signalProcess: ManagedSignal;
  private pendingStarts = 0;

  constructor(private readonly options: ProcessSupervisorOptions) {
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
    this.newProcessId = options.newProcessId ?? newOpaqueProcessId;
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.signalProcess = options.signalProcess ?? defaultSignal;
  }

  async start(input: { command: string; args: string[]; cwd: string }): Promise<ManagedProcessSummary> {
    this.reserveCapacity();

    const stdout = new TailBuffer(this.options.limits.maxProcessLogBytesPerStream);
    const stderr = new TailBuffer(this.options.limits.maxProcessLogBytesPerStream);
    let child: ChildProcess;

    // Kayıt ve eşleşme basename ile kalır; yalnızca spawn çözümlenmiş yolu kullanır.
    const executablePath = (await resolveExecutablePath(input.command, {
      pathValue: process.env.PATH,
      homeDir: homedir(),
    })) ?? input.command;
    try {
      child = this.spawnProcess(executablePath, input.args, {
        cwd: input.cwd,
        shell: false,
        env: sanitizedChildEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: this.platform !== "win32",
      });
    } catch (error) {
      this.pendingStarts -= 1;
      throw error;
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    return new Promise<ManagedProcessSummary>((resolve, reject) => {
      let spawned = false;
      let record: ManagedRecord | undefined;

      const onError = (error: Error) => {
        if (spawned) return;
        this.pendingStarts -= 1;
        reject(error);
      };

      child.once("error", onError);
      child.once("spawn", () => {
        spawned = true;
        this.pendingStarts -= 1;
        child.off("error", onError);
        child.on("error", () => {
          // A post-spawn process error must not become an unhandled EventEmitter error.
          // Lifecycle remains driven by the close event.
        });

        const startedAtMs = this.now();
        let resolveClosed!: () => void;
        const closed = new Promise<void>((closedResolve) => {
          resolveClosed = closedResolve;
        });
        record = {
          processId: this.newProcessId(),
          command: input.command,
          argCount: input.args.length,
          cwd: input.cwd,
          state: "running",
          startedAt: new Date(startedAtMs).toISOString(),
          startedAtMs,
          child,
          stdout,
          stderr,
          terminationRequested: false,
          closed,
          resolveClosed,
        };
        this.records.set(record.processId, record);
        void this.recordAudit("process.start", record).then(() => resolve(summary(record!)));
      });

      child.once("close", (exitCode, signal) => {
        if (!record) return;
        record.state = record.terminationRequested ? "stopped" : "exited";
        record.exitedAt = new Date(this.now()).toISOString();
        record.exitCode = exitCode;
        record.signal = signal;
        record.resolveClosed();
      });
    });
  }

  descriptors(): ManagedProcessDescriptor[] {
    return [...this.records.values()].map((record) => ({
      processId: record.processId,
      command: record.command,
      cwd: record.cwd,
    }));
  }

  status(processId: string): ManagedProcessSummary | undefined {
    const record = this.records.get(processId);
    return record ? summary(record) : undefined;
  }

  logs(processId: string): ManagedProcessLogs | undefined {
    const record = this.records.get(processId);
    if (!record) return undefined;
    return {
      processId,
      stdout: record.stdout.snapshot(),
      stderr: record.stderr.snapshot(),
    };
  }

  async stop(processId: string): Promise<ManagedProcessSummary | undefined> {
    const record = this.records.get(processId);
    if (!record) return undefined;
    if (record.state !== "running") return summary(record);

    await this.terminate(record);
    await this.recordAudit("process.stop", record);
    return summary(record);
  }

  async close(): Promise<void> {
    const running = [...this.records.values()].filter((record) => record.state === "running");
    await Promise.all(running.map(async (record) => {
      await this.terminate(record);
      await this.recordAudit("process.stop", record);
    }));
  }

  private async terminate(record: ManagedRecord): Promise<void> {
    if (record.state !== "running") return;
    record.terminationRequested = true;
    this.sendSignal(record, "SIGTERM");

    const closedGracefully = await this.waitForClose(record, this.options.limits.processStopGraceMs);
    if (!closedGracefully && record.state === "running") {
      this.sendSignal(record, "SIGKILL");
      await record.closed;
    }
  }

  private sendSignal(record: ManagedRecord, signal: NodeJS.Signals): void {
    const pid = record.child.pid;
    if (pid === undefined) {
      record.child.kill(signal);
      return;
    }

    const target = this.platform === "win32" ? pid : -pid;
    try {
      this.signalProcess(target, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  private async waitForClose(record: ManagedRecord, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref();

      void record.closed.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private async recordAudit(action: "process.start" | "process.stop", record: ManagedRecord): Promise<void> {
    try {
      await this.options.audit.record({
        action,
        outcome: "ok",
        durationMs: 0,
        metadata: {
          command: record.command,
          argCount: record.argCount,
          state: record.state,
        },
      });
    } catch {
      // Process ownership and cleanup must remain available even if audit storage fails.
    }
  }

  private reserveCapacity(): void {
    while (this.records.size + this.pendingStarts >= this.options.limits.maxManagedProcesses) {
      const completed = [...this.records.values()]
        .filter((record) => record.state !== "running")
        .sort((left, right) => left.startedAtMs - right.startedAtMs)[0];
      if (!completed) {
        throw new LimitError("Managed process registry is full.", {
          limit: this.options.limits.maxManagedProcesses,
        });
      }
      this.records.delete(completed.processId);
    }
    this.pendingStarts += 1;
  }
}
