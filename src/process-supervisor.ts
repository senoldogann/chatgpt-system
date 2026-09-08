import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import { LimitError } from "./errors.js";
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
  private pendingStarts = 0;

  constructor(private readonly options: ProcessSupervisorOptions) {
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
    this.newProcessId = options.newProcessId ?? newOpaqueProcessId;
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    void options.audit;
    void options.signalProcess;
  }

  async start(input: { command: string; args: string[]; cwd: string }): Promise<ManagedProcessSummary> {
    this.reserveCapacity();

    const stdout = new TailBuffer(this.options.limits.maxProcessLogBytesPerStream);
    const stderr = new TailBuffer(this.options.limits.maxProcessLogBytesPerStream);
    let child: ChildProcess;

    try {
      child = this.spawnProcess(input.command, input.args, {
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
        resolve(summary(record));
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

    record.terminationRequested = true;
    record.child.kill("SIGKILL");
    await record.closed;
    return summary(record);
  }

  async close(): Promise<void> {
    const running = [...this.records.values()].filter((record) => record.state === "running");
    await Promise.all(running.map(async (record) => {
      record.terminationRequested = true;
      record.child.kill("SIGKILL");
      await record.closed;
    }));
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
