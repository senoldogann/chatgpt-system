import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir, tmpdir } from "node:os";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import { ConflictError, LimitError, ProcessControlUnavailableError, ProcessIdentityUnverifiedError, ProcessTerminationTimeoutError } from "./errors.js";
import { resolveExecutablePath } from "./executable-resolution.js";
import { sanitizedChildEnvironment } from "./process-policy.js";

export type ManagedProcessState = "running" | "stopping" | "exited" | "stopped" | "unknown";
export type ManagedJobStatus = "running" | "stopping" | "completed" | "failed" | "cancelled" | "unknown";

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
  jobId: string;
  status: ManagedJobStatus;
}

export interface ManagedProcessLogs {
  processId: string;
  stdout: { content: string; bytes: number; truncated: boolean; nextCursor?: number };
  stderr: { content: string; bytes: number; truncated: boolean; nextCursor?: number };
  cursor?: number;
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
  stdio: ["ignore", "pipe" | "ignore" | number, "pipe" | "ignore" | number];
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
  persistencePath?: string;
}

class TailBuffer {
  private value = Buffer.alloc(0);
  private wasTruncated = false;
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;
    this.totalBytes += chunk.byteLength;
    const combined = Buffer.concat([this.value, chunk]);
    if (combined.byteLength <= this.maxBytes) {
      this.value = combined;
      return;
    }

    this.wasTruncated = true;
    this.value = Buffer.from(combined.subarray(combined.byteLength - this.maxBytes));
  }

  snapshot(cursor?: number): { content: string; bytes: number; truncated: boolean; nextCursor?: number } {
    if (cursor === undefined) {
      return {
        content: this.value.toString("utf8"),
        bytes: this.value.byteLength,
        truncated: this.wasTruncated,
      };
    }
    const firstAvailable = Math.max(0, this.totalBytes - this.value.byteLength);
    const start = Math.max(cursor, firstAvailable);
    const offset = Math.max(0, start - firstAvailable);
    const content = this.value.subarray(offset);
    return {
      content: content.toString("utf8"),
      bytes: content.byteLength,
      truncated: cursor < firstAvailable || this.wasTruncated,
      nextCursor: this.totalBytes,
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
  child?: ChildProcess;
  pid?: number;
  argsDigest: string;
  idempotencyKey?: string;
  stdout: TailBuffer;
  stderr: TailBuffer;
  stdoutPath?: string;
  stderrPath?: string;
  resultPath?: string;
  manifestPath?: string;
  controlPath?: string;
  controlToken?: string;
  cursorPath?: string;
  fingerprint?: ProcessFingerprint;
  resultErrorCode?: string;
  persistent: boolean;
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

function digestArgs(args: string[]): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

interface ProcessFingerprint {
  source: "ps";
  value: string;
}

interface ProcessResultRecord {
  version: 1;
  started: boolean;
  finishedAt: string;
  exitCode?: number | null;
  signal?: string | null;
  errorCode?: string;
}

function processFingerprint(pid: number): ProcessFingerprint | undefined {
  try {
    const value = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!value) return undefined;
    return { source: "ps", value: createHash("sha256").update(value).digest("hex") };
  } catch {
    return undefined;
  }
}

function sameProcessFingerprint(pid: number, expected: ProcessFingerprint): boolean {
  const current = processFingerprint(pid);
  return current !== undefined && current.source === expected.source && current.value === expected.value;
}

function existsFile(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

interface PersistedProcessRecord {
  version: 2;
  processId: string;
  command: string;
  argCount: number;
  argsDigest: string;
  cwd: string;
  state: ManagedProcessState;
  startedAt: string;
  startedAtMs: number;
  pid: number;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  idempotencyKey?: string;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
  manifestPath: string;
  controlPath: string;
  controlToken: string;
  cursorPath: string;
  fingerprint?: ProcessFingerprint;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function jobStatus(state: ManagedProcessState, exitCode: number | null | undefined): ManagedJobStatus {
  if (state === "running") return "running";
  if (state === "stopping") return "stopping";
  if (state === "stopped") return "cancelled";
  if (state === "unknown") return "unknown";
  return exitCode === 0 ? "completed" : "failed";
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
    jobId: record.processId,
    status: jobStatus(record.state, record.exitCode),
  };
}

export class ProcessSupervisor {
  private readonly records = new Map<string, ManagedRecord>();
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly newProcessId: () => string;
  private readonly spawnProcess: ManagedSpawn;
  private readonly signalProcess: ManagedSignal;
  private readonly persistencePath: string | undefined;
  private readonly idempotencyInFlight = new Map<string, { promise: Promise<ManagedProcessSummary>; command: string; cwd: string; argsDigest: string }>();
  private pendingStarts = 0;

  constructor(private readonly options: ProcessSupervisorOptions) {
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
    this.newProcessId = options.newProcessId ?? newOpaqueProcessId;
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.signalProcess = options.signalProcess ?? defaultSignal;
    this.persistencePath = options.persistencePath;
    this.restorePersistedRecords();
  }

  async start(input: { command: string; args: string[]; cwd: string; idempotencyKey?: string }): Promise<ManagedProcessSummary> {
    if (input.idempotencyKey) {
      const argsDigest = digestArgs(input.args);
      const existingInFlight = this.idempotencyInFlight.get(input.idempotencyKey);
      if (existingInFlight) {
        if (existingInFlight.command !== input.command || existingInFlight.cwd !== input.cwd || existingInFlight.argsDigest !== argsDigest) {
          throw new ConflictError("The idempotency key is already bound to a different process request.");
        }
        return existingInFlight.promise;
      }
      const operation = this.startInternal(input);
      const entry = { promise: operation, command: input.command, cwd: input.cwd, argsDigest };
      this.idempotencyInFlight.set(input.idempotencyKey, entry);
      try {
        return await operation;
      } finally {
        if (this.idempotencyInFlight.get(input.idempotencyKey)?.promise === operation) this.idempotencyInFlight.delete(input.idempotencyKey);
      }
    }
    return this.startInternal(input);
  }

  private async startInternal(input: { command: string; args: string[]; cwd: string; idempotencyKey?: string }): Promise<ManagedProcessSummary> {
    const argsDigest = digestArgs(input.args);
    if (input.idempotencyKey) {
      const existing = [...this.records.values()].find((record) => record.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.command !== input.command || existing.cwd !== input.cwd || existing.argsDigest !== argsDigest) {
          throw new ConflictError("The idempotency key is already bound to a different process request.");
        }
        return summary(existing);
      }
    }
    this.reserveCapacity();

    const stdout = new TailBuffer(this.options.limits.maxProcessLogBytesPerStream);
    const stderr = new TailBuffer(this.options.limits.maxProcessLogBytesPerStream);
    const persistent = this.persistencePath !== undefined;
    const processId = this.newProcessId();
    const stdoutPath = persistent ? path.join(this.persistencePath!, `${processId}.stdout.log`) : undefined;
    const stderrPath = persistent ? path.join(this.persistencePath!, `${processId}.stderr.log`) : undefined;
    const resultPath = persistent ? path.join(this.persistencePath!, `${processId}.result.json`) : undefined;
    const manifestPath = persistent ? path.join(this.persistencePath!, `${processId}.manifest.json`) : undefined;
    const controlPath = persistent ? path.join(tmpdir(), `chatgpt-system-${createHash("sha256").update(processId).digest("hex").slice(0, 24)}.sock`) : undefined;
    const controlToken = persistent ? randomBytes(32).toString("base64url") : undefined;
    const cursorPath = persistent ? path.join(this.persistencePath!, `${processId}.cursor.json`) : undefined;
    let child: ChildProcess;

    // Kayıt ve eşleşme basename ile kalır; yalnızca spawn çözümlenmiş yolu kullanır.
    try {
      // Every fallible preparation between reserveCapacity() and spawn lives inside
      // this try block so a failure releases the reserved capacity slot again.
      if (persistent) mkdirSync(this.persistencePath!, { recursive: true, mode: 0o700 });
      const executablePath = (await resolveExecutablePath(input.command, {
        pathValue: process.env.PATH,
        homeDir: homedir(),
      })) ?? input.command;

      if (persistent) {
        const manifest = {
          version: 1,
          command: executablePath,
          args: input.args,
          cwd: input.cwd,
          stdoutPath: stdoutPath!,
          stderrPath: stderrPath!,
          resultPath: resultPath!,
          controlPath: controlPath!,
          controlToken: controlToken!,
          cursorPath: cursorPath!,
          maxLogBytes: this.options.limits.maxProcessLogBytesPerStream,
        };
        const temporary = `${manifestPath!}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
        renameSync(temporary, manifestPath!);
        const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
        const localWrapperPath = path.resolve(moduleDirectory, "process-wrapper.js");
        const wrapperPath = existsFile(localWrapperPath)
          ? localWrapperPath
          : path.resolve(moduleDirectory, "../dist/process-wrapper.js");
        child = this.spawnProcess(process.execPath, [wrapperPath, manifestPath!], {
          cwd: input.cwd,
          shell: false,
          env: sanitizedChildEnvironment(),
          stdio: ["ignore", "ignore", "ignore"],
          detached: this.platform !== "win32",
        });
      } else {
        child = this.spawnProcess(executablePath, input.args, {
          cwd: input.cwd,
          shell: false,
          env: sanitizedChildEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
          detached: this.platform !== "win32",
        });
      }
    } catch (error) {
      this.pendingStarts -= 1;
      throw error;
    }

    if (!persistent) {
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    }

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
        if (child.pid === undefined) {
          reject(new Error("Managed child did not report a process identifier after spawn."));
          return;
        }
        let resolveClosed!: () => void;
        const closed = new Promise<void>((closedResolve) => {
          resolveClosed = closedResolve;
        });
        const fingerprint = processFingerprint(child.pid);
        const createdRecord: ManagedRecord = {
          processId,
          command: input.command,
          argCount: input.args.length,
          cwd: input.cwd,
          state: "running",
          startedAt: new Date(startedAtMs).toISOString(),
          startedAtMs,
          child,
          pid: child.pid,
          ...(fingerprint !== undefined ? { fingerprint } : {}),
          argsDigest,
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          stdout,
          stderr,
          ...(stdoutPath !== undefined ? { stdoutPath } : {}),
          ...(stderrPath !== undefined ? { stderrPath } : {}),
          ...(resultPath !== undefined ? { resultPath } : {}),
          ...(manifestPath !== undefined ? { manifestPath } : {}),
          ...(controlPath !== undefined ? { controlPath } : {}),
          ...(controlToken !== undefined ? { controlToken } : {}),
          ...(cursorPath !== undefined ? { cursorPath } : {}),
          persistent,
          terminationRequested: false,
          closed,
          resolveClosed,
        };
        record = createdRecord;
        this.records.set(createdRecord.processId, createdRecord);
        try {
          this.persistRecord(createdRecord);
        } catch {
          // Persistence stays best-effort: a storage failure inside the spawn listener
          // must never break process ownership or leave the start promise pending.
        }
        void this.recordAudit("process.start", createdRecord).then(() => resolve(summary(createdRecord)));
      });

      child.once("close", (exitCode, signal) => {
        if (!record) return;
        if (record.persistent) {
          this.applyIndependentResult(record);
          if (record.state === "running") {
            record.state = "unknown";
            record.exitedAt = new Date(this.now()).toISOString();
          }
        } else {
          record.state = record.terminationRequested ? "stopped" : "exited";
          record.exitedAt = new Date(this.now()).toISOString();
          record.exitCode = exitCode;
          record.signal = signal;
        }
        this.persistRecord(record);
        record.resolveClosed();
      });
    });
  }

  private persistRecord(record: ManagedRecord): void {
    if (!record.persistent || !this.persistencePath || record.pid === undefined || !record.stdoutPath || !record.stderrPath || !record.resultPath || !record.manifestPath) return;
    const persisted: PersistedProcessRecord = {
      version: 2,
      processId: record.processId,
      command: record.command,
      argCount: record.argCount,
      argsDigest: record.argsDigest,
      cwd: record.cwd,
      state: record.state,
      startedAt: record.startedAt,
      startedAtMs: record.startedAtMs,
      pid: record.pid,
      ...(record.exitedAt !== undefined ? { exitedAt: record.exitedAt } : {}),
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      ...(record.signal !== undefined ? { signal: record.signal } : {}),
      ...(record.idempotencyKey !== undefined ? { idempotencyKey: record.idempotencyKey } : {}),
      stdoutPath: record.stdoutPath,
      stderrPath: record.stderrPath,
      resultPath: record.resultPath!,
      manifestPath: record.manifestPath!,
      controlPath: record.controlPath!,
      controlToken: record.controlToken!,
      cursorPath: record.cursorPath!,
      ...(record.fingerprint !== undefined ? { fingerprint: record.fingerprint } : {}),
    };
    if (!existsFile(this.persistencePath)) return;
    const destination = path.join(this.persistencePath, `${record.processId}.json`);
    const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(persisted)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, destination);
    } catch {
      // Persistence is best-effort telemetry. It must never break process ownership
      // or the pending start promise: a failed post-spawn write leaves the managed
      // record running in memory and the wrapper result still arrives through close.
      try { unlinkSync(temporary); } catch { /* best-effort cleanup */ }
    }
  }

  private applyIndependentResult(record: ManagedRecord): boolean {
    if (!record.resultPath) return false;
    let result: Partial<ProcessResultRecord>;
    try {
      result = JSON.parse(readFileSync(record.resultPath, "utf8")) as Partial<ProcessResultRecord>;
    } catch {
      return false;
    }
    if (result.version !== 1 || typeof result.started !== "boolean" || typeof result.finishedAt !== "string") return false;
    record.exitedAt = result.finishedAt;
    if (result.started && (typeof result.exitCode === "number" || result.exitCode === null)
      && (typeof result.signal === "string" || result.signal === null || result.signal === undefined)) {
      record.state = record.terminationRequested && result.signal !== null ? "stopped" : "exited";
      record.exitCode = result.exitCode;
      if (result.signal !== undefined) record.signal = result.signal;
      return true;
    }
    if (!result.started && typeof result.errorCode === "string") record.resultErrorCode = result.errorCode;
    record.state = "unknown";
    return false;
  }

  private restorePersistedRecords(): void {
    if (!this.persistencePath) return;
    mkdirSync(this.persistencePath, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.persistencePath)) {
      if (!name.endsWith(".json")) continue;
      try {
        const record = JSON.parse(readFileSync(path.join(this.persistencePath, name), "utf8")) as Partial<PersistedProcessRecord>;
        if (record.version !== 2 || typeof record.processId !== "string" || typeof record.command !== "string"
          || typeof record.argCount !== "number" || typeof record.cwd !== "string" || typeof record.pid !== "number" || typeof record.startedAt !== "string"
          || typeof record.startedAtMs !== "number" || typeof record.argsDigest !== "string"
          || typeof record.stdoutPath !== "string" || typeof record.stderrPath !== "string"
          || typeof record.resultPath !== "string" || typeof record.manifestPath !== "string"
          || typeof record.controlPath !== "string" || typeof record.controlToken !== "string"
          || typeof record.cursorPath !== "string"
          || !["running", "stopping", "exited", "stopped", "unknown"].includes(record.state ?? "")) continue;
        const persistedState = record.state as ManagedProcessState;
        const resultPath = record.resultPath!;
        const manifestPath = record.manifestPath!;
        const controlPath = record.controlPath!;
        const controlToken = record.controlToken!;
        const cursorPath = record.cursorPath!;
        const resultExists = existsFile(resultPath);
        const alive = persistedState === "running" && processAlive(record.pid!) && record.fingerprint !== undefined
          && sameProcessFingerprint(record.pid!, record.fingerprint);
        const state: ManagedProcessState = resultExists ? "unknown" : (alive ? "running" : (persistedState === "running" ? "unknown" : persistedState));
        const closed = Promise.resolve();
        const restored: ManagedRecord = {
          processId: record.processId,
          command: record.command,
          argCount: record.argCount!,
          cwd: record.cwd,
          state,
          startedAt: record.startedAt,
          startedAtMs: record.startedAtMs,
          pid: record.pid!,
          ...(record.exitedAt !== undefined ? { exitedAt: record.exitedAt } : {}),
          ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
          ...(record.signal !== undefined ? { signal: record.signal } : {}),
          argsDigest: record.argsDigest,
          ...(record.idempotencyKey !== undefined ? { idempotencyKey: record.idempotencyKey } : {}),
          stdout: new TailBuffer(this.options.limits.maxProcessLogBytesPerStream),
          stderr: new TailBuffer(this.options.limits.maxProcessLogBytesPerStream),
          stdoutPath: record.stdoutPath,
          stderrPath: record.stderrPath,
          resultPath,
          manifestPath,
          controlPath,
          controlToken,
          cursorPath,
          ...(record.fingerprint !== undefined ? { fingerprint: record.fingerprint } : {}),
          persistent: true,
          terminationRequested: false,
          closed,
          resolveClosed: () => {},
        };
        this.records.set(restored.processId, restored);
        if (resultExists) this.applyIndependentResult(restored);
        if (state !== persistedState || (restored.state === "running" && !alive)) this.persistRecord(restored);
      } catch {
        const corruptPath = `${path.join(this.persistencePath, name)}.corrupt-${Date.now()}`;
        try { renameSync(path.join(this.persistencePath, name), corruptPath); } catch { /* recovery must not prevent other records loading */ }
      }
    }
  }

  private refreshRecovered(record: ManagedRecord): void {
    // Wrapper publication may lag behind its PID disappearing. An initial recovery
    // can conservatively mark the record unknown; keep accepting its independent,
    // validated result if it arrives later instead of making unknown permanent.
    if (record.state === "unknown") {
      if (this.applyIndependentResult(record)) this.persistRecord(record);
      return;
    }
    if (record.state === "stopping") {
      if (this.applyIndependentResult(record)) return;
      if (record.pid !== undefined && processAlive(record.pid)) return;
      record.state = "unknown";
      record.exitedAt = new Date(this.now()).toISOString();
      this.persistRecord(record);
      return;
    }
    if (record.state !== "running" || record.pid === undefined) return;
    // The wrapper result is authoritative even when the child PID has already disappeared.
    // Never convert a completed independent result into `unknown` merely because reaping
    // happened between daemon observations.
    if (this.applyIndependentResult(record)) {
      this.persistRecord(record);
      return;
    }
    if (!processAlive(record.pid)
      || (record.persistent && (!record.fingerprint || !sameProcessFingerprint(record.pid, record.fingerprint)))) {
      record.state = "unknown";
      record.exitedAt = new Date(this.now()).toISOString();
      this.persistRecord(record);
    }
  }

  descriptors(): ManagedProcessDescriptor[] {
    for (const record of this.records.values()) this.refreshRecovered(record);
    return [...this.records.values()].map((record) => ({
      processId: record.processId,
      command: record.command,
      cwd: record.cwd,
    }));
  }

  status(processId: string): ManagedProcessSummary | undefined {
    const record = this.records.get(processId);
    if (!record) return undefined;
    this.refreshRecovered(record);
    return summary(record);
  }

  logs(processId: string, cursor?: number): ManagedProcessLogs | undefined {
    const record = this.records.get(processId);
    if (!record) return undefined;
    this.refreshRecovered(record);
    if (!record.persistent || !record.stdoutPath || !record.stderrPath) {
      return {
        processId,
        ...(cursor !== undefined ? { cursor } : {}),
        stdout: record.stdout.snapshot(cursor),
        stderr: record.stderr.snapshot(cursor),
      };
    }
    const cursorState = (() => {
      if (!record.cursorPath) return { stdout: 0, stderr: 0 };
      try {
        const value = JSON.parse(readFileSync(record.cursorPath, "utf8")) as { stdout?: number; stderr?: number };
        return {
          stdout: Number.isSafeInteger(value.stdout) ? value.stdout! : 0,
          stderr: Number.isSafeInteger(value.stderr) ? value.stderr! : 0,
        };
      } catch {
        return { stdout: 0, stderr: 0 };
      }
    })();
    const readStream = (file: string, stream: "stdout" | "stderr") => {
      // The wrapper creates its files asynchronously; a reconnect/status call may race
      // that initialization. Treat an absent log as an empty stream, never as a lost job.
      if (!existsFile(file)) {
        return {
          content: "",
          bytes: 0,
          truncated: false,
          ...(cursor !== undefined ? { nextCursor: cursorState[stream] } : {}),
        };
      }
      const physicalBytes = statSync(file).size;
      const logicalBytes = cursorState[stream];
      const firstAvailable = Math.max(0, logicalBytes - physicalBytes);
      const requested = cursor ?? firstAvailable;
      const logicalStart = Math.min(Math.max(requested, firstAvailable), logicalBytes);
      const physicalStart = logicalStart - firstAvailable;
      const content = Buffer.alloc(physicalBytes - physicalStart);
      const fd = openSync(file, "r");
      try { readSync(fd, content, 0, content.byteLength, physicalStart); } finally { closeSync(fd); }
      const truncated = requested < firstAvailable || (cursor === undefined && firstAvailable > 0);
      return {
        content: content.toString("utf8"),
        bytes: content.byteLength,
        truncated,
        ...(cursor !== undefined ? { nextCursor: logicalBytes } : {}),
      };
    };
    return {
      processId,
      ...(cursor !== undefined ? { cursor } : {}),
      stdout: readStream(record.stdoutPath, "stdout"),
      stderr: readStream(record.stderrPath, "stderr"),
    };
  }

  async stop(processId: string): Promise<ManagedProcessSummary | undefined> {
    const record = this.records.get(processId);
    if (!record) return undefined;
    this.refreshRecovered(record);
    if (record.persistent && record.state === "unknown") throw new ProcessIdentityUnverifiedError();
    if (record.state !== "running") return summary(record);

    await this.terminate(record);
    await this.recordAudit("process.stop", record);
    return summary(record);
  }

  async close(preservePersistent = false): Promise<void> {
    if (preservePersistent) {
      // Do not let the daemon's ChildProcess handles keep the event loop alive;
      // the independent wrapper remains the owner of the persistent job.
      for (const record of this.records.values()) {
        if (record.state === "running" && record.persistent) record.child?.unref();
      }
    }
    const running = [...this.records.values()].filter((record) => record.state === "running" && (!record.persistent || !preservePersistent));
    await Promise.all(running.map(async (record) => {
      try {
        await this.terminate(record);
        await this.recordAudit("process.stop", record);
      } catch (error) {
        if (!(error instanceof ProcessControlUnavailableError)) throw error;
        // Never fall back to PID signalling during cleanup when the independent controller is unavailable.
        if (record.child) await this.waitForClose(record, 1_000);
      }
    }));
  }

  private async requestIndependentStop(record: ManagedRecord): Promise<void> {
    if (!record.controlPath || !record.controlToken) throw new ProcessControlUnavailableError();
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(record.controlPath!);
      let buffer = "";
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ProcessControlUnavailableError());
      };
      const timer = setTimeout(fail, Math.max(this.options.limits.processStopGraceMs, 1_000));
      timer.unref();
      socket.once("error", fail);
      socket.once("close", () => { if (!settled) fail(); });
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline === -1 || settled) return;
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as { ok?: boolean };
          if (response.ok !== true) { fail(); return; }
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve();
        } catch { fail(); }
      });
      socket.once("connect", () => socket.write(`${JSON.stringify({ token: record.controlToken, operation: "stop" })}\n`));
    });
  }

  private async terminate(record: ManagedRecord): Promise<void> {
    if (record.state !== "running") return;
    record.terminationRequested = true;
    if (record.persistent) {
      try {
        await this.requestIndependentStop(record);
      } catch (error) {
        record.terminationRequested = false;
        throw error;
      }
    } else {
      this.sendSignal(record, "SIGTERM");
    }
    if (!record.child) {
      record.state = record.persistent ? "stopping" : "stopped";
      if (!record.persistent) {
        record.exitedAt = new Date(this.now()).toISOString();
        record.signal = "SIGTERM";
      }
      this.persistRecord(record);
      return;
    }

    const closedGracefully = await this.waitForClose(record, record.persistent
      ? Math.max(this.options.limits.processStopGraceMs, 1_000)
      : this.options.limits.processStopGraceMs);
    if (!closedGracefully && record.state === "running") {
      if (record.persistent) throw new ProcessTerminationTimeoutError();
      this.sendSignal(record, "SIGKILL");
      await record.closed;
    }
  }

  private sendSignal(record: ManagedRecord, signal: NodeJS.Signals): void {
    const pid = record.pid ?? record.child?.pid;
    if (pid === undefined) {
      record.child?.kill(signal);
      return;
    }

    const target = this.platform === "win32" ? pid : -pid;
    try {
      this.signalProcess(target, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" && target !== pid) {
        try {
          this.signalProcess(pid, signal);
          return;
        } catch (fallbackError) {
          if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") throw fallbackError;
        }
      }
      if (code !== "ESRCH") throw error;
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

  private removePersistedRecord(record: ManagedRecord): void {
    if (!this.persistencePath) return;
    for (const file of [
      path.join(this.persistencePath, `${record.processId}.json`),
      record.manifestPath,
      record.resultPath,
      record.stdoutPath,
      record.stderrPath,
      record.cursorPath,
    ]) {
      if (!file) continue;
      try { unlinkSync(file); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
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
      this.removePersistedRecord(completed);
    }
    this.pendingStarts += 1;
  }
}
