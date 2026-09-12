import { spawn, type ChildProcess } from "node:child_process";
import { OwnerShellCancelledError, OwnerShellFailedError } from "./errors.js";
import { sanitizedChildEnvironment } from "./process-policy.js";

export interface OwnerShellExecutionInput {
  shellPath: string;
  script: string;
  cwd: string;
  timeoutMs?: number | null;
  signal?: AbortSignal;
}

export interface OwnerShellRunResult {
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutBytesSeen: number;
  stderrBytesSeen: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
}

export interface OwnerShellBackend {
  run(input: OwnerShellExecutionInput): Promise<OwnerShellRunResult>;
  close(): Promise<void>;
}

export interface OwnerShellSupervisorOptions {
  maxRetainedBytesPerStream: number;
  processStopGraceMs: number;
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  signalProcess?: (target: number, signal: NodeJS.Signals) => void;
}

class TailBuffer {
  private value = Buffer.alloc(0);
  private seen = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.seen += chunk.byteLength;
    const combined = Buffer.concat([this.value, chunk]);
    if (combined.byteLength <= this.maxBytes) {
      this.value = combined;
      return;
    }
    this.truncated = true;
    this.value = Buffer.from(combined.subarray(combined.byteLength - this.maxBytes));
  }

  snapshot(): { content: string; bytesSeen: number; truncated: boolean } {
    return {
      content: this.value.toString("utf8"),
      bytesSeen: this.seen,
      truncated: this.truncated,
    };
  }
}

type CancellationReason = "abort" | "shutdown";

interface ActiveRun {
  child: ChildProcess;
  closed: Promise<void>;
  resolveClosed: () => void;
  cancellationReason?: CancellationReason;
  timedOut: boolean;
  terminationPromise?: Promise<void>;
}

export class OwnerShellSupervisor implements OwnerShellBackend {
  private readonly active = new Set<ActiveRun>();
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: typeof spawn;
  private readonly signalProcess: (target: number, signal: NodeJS.Signals) => void;
  private closing = false;

  constructor(private readonly options: OwnerShellSupervisorOptions) {
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.signalProcess = options.signalProcess ?? ((target, signal) => process.kill(target, signal));
  }

  async run(input: OwnerShellExecutionInput): Promise<OwnerShellRunResult> {
    if (this.closing) throw new OwnerShellCancelledError("shutdown");
    if (input.signal?.aborted) throw new OwnerShellCancelledError("abort");

    const stdout = new TailBuffer(this.options.maxRetainedBytesPerStream);
    const stderr = new TailBuffer(this.options.maxRetainedBytesPerStream);
    let child: ChildProcess;
    try {
      child = this.spawnProcess(input.shellPath, ["-lc", input.script], {
        cwd: input.cwd,
        shell: false,
        env: sanitizedChildEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: this.platform !== "win32",
      });
    } catch {
      throw new OwnerShellFailedError();
    }

    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const active: ActiveRun = {
      child,
      closed,
      resolveClosed,
      timedOut: false,
    };
    this.active.add(active);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    let timer: NodeJS.Timeout | undefined;
    const abort = () => {
      if (active.cancellationReason === undefined) active.cancellationReason = "abort";
      void this.terminate(active);
    };
    if (input.signal) input.signal.addEventListener("abort", abort, { once: true });
    if (input.timeoutMs !== undefined && input.timeoutMs !== null) {
      timer = setTimeout(() => {
        active.timedOut = true;
        void this.terminate(active);
      }, input.timeoutMs);
      timer.unref();
    }

    try {
      const outcome = await new Promise<{ exitCode: number | null; signal: string | null }>((resolve, reject) => {
        let settled = false;
        child.once("error", () => {
          if (settled) return;
          settled = true;
          reject(new OwnerShellFailedError());
        });
        child.once("close", (exitCode, signal) => {
          active.resolveClosed();
          if (settled) return;
          settled = true;
          resolve({ exitCode, signal });
        });
      });

      if (active.cancellationReason !== undefined) {
        throw new OwnerShellCancelledError(active.cancellationReason);
      }

      const stdoutSnapshot = stdout.snapshot();
      const stderrSnapshot = stderr.snapshot();
      return {
        cwd: input.cwd,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        stdout: stdoutSnapshot.content,
        stderr: stderrSnapshot.content,
        stdoutBytesSeen: stdoutSnapshot.bytesSeen,
        stderrBytesSeen: stderrSnapshot.bytesSeen,
        stdoutTruncated: stdoutSnapshot.truncated,
        stderrTruncated: stderrSnapshot.truncated,
        timedOut: active.timedOut,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (input.signal) input.signal.removeEventListener("abort", abort);
      this.active.delete(active);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    const runs = [...this.active];
    await Promise.all(runs.map(async (active) => {
      if (active.cancellationReason === undefined) active.cancellationReason = "shutdown";
      await this.terminate(active);
    }));
  }

  private terminate(active: ActiveRun): Promise<void> {
    if (active.terminationPromise) return active.terminationPromise;
    active.terminationPromise = this.terminateOnce(active);
    return active.terminationPromise;
  }

  private async terminateOnce(active: ActiveRun): Promise<void> {
    this.sendSignal(active.child, "SIGTERM");
    const closedGracefully = await this.waitForClose(active, this.options.processStopGraceMs);
    if (!closedGracefully) {
      this.sendSignal(active.child, "SIGKILL");
      await active.closed;
    }
  }

  private sendSignal(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (pid === undefined) {
      child.kill(signal);
      return;
    }
    const target = this.platform === "win32" ? pid : -pid;
    try {
      this.signalProcess(target, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new OwnerShellFailedError();
    }
  }

  private async waitForClose(active: ActiveRun, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref();
      void active.closed.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
