import { spawn, type ChildProcess } from "node:child_process";
import { ComputerError, isComputerErrorCode } from "./computer-errors.js";
import {
  runnerMessageSchema,
  type ComputerJsRpcMethod,
  type RunnerRpcMessage,
  type RunnerRpcResponse,
} from "./computer-js-protocol.js";
import { sanitizedChildEnvironment } from "./process-policy.js";

export interface ComputerJsSpawnOptions {
  cwd: string;
  shell: false;
  env: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe", "ipc"];
  detached: boolean;
}

export type ComputerJsSpawn = (
  command: string,
  args: readonly string[],
  options: ComputerJsSpawnOptions,
) => ChildProcess;

export type ComputerJsSignal = (target: number, signal: NodeJS.Signals) => void;

export interface ComputerJsRunnerResult {
  stdout: string;
  stderr: string;
  result?: unknown;
}

export interface ComputerJsRunnerRequest {
  source: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onTerminate?: () => void;
  onRpc: (method: ComputerJsRpcMethod, params: unknown) => Promise<unknown>;
}

export interface ComputerJsRunnerSupervisorOptions {
  runnerEntrypoint: string;
  maxSourceBytes: number;
  maxOutputBytes: number;
  processStopGraceMs: number;
  spawnProcess?: ComputerJsSpawn;
  signalProcess?: ComputerJsSignal;
  platform?: NodeJS.Platform;
}

interface ActiveRunner {
  child: ChildProcess;
  closed: Promise<void>;
  isClosed: () => boolean;
  terminationPromise?: Promise<void>;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: ComputerJsSpawnOptions,
): ChildProcess {
  return spawn(command, [...args], options);
}

function defaultSignal(target: number, signal: NodeJS.Signals): void {
  process.kill(target, signal);
}

function fixedRpcFailure(id: string, error: unknown): RunnerRpcResponse {
  if (error instanceof ComputerError && isComputerErrorCode(error.code)) {
    return {
      type: "rpc_result",
      id,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }
  const fallback = new ComputerError("COMPUTER_JS_FAILED");
  return {
    type: "rpc_result",
    id,
    ok: false,
    error: { code: fallback.code, message: fallback.message },
  };
}

export class ComputerJsRunnerSupervisor {
  private readonly spawnProcess: ComputerJsSpawn;
  private readonly signalProcess: ComputerJsSignal;
  private readonly platform: NodeJS.Platform;
  private readonly active = new Set<ActiveRunner>();
  private closing = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: ComputerJsRunnerSupervisorOptions) {
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.signalProcess = options.signalProcess ?? defaultSignal;
    this.platform = options.platform ?? process.platform;
  }

  async run(request: ComputerJsRunnerRequest): Promise<ComputerJsRunnerResult> {
    if (this.closing) throw new ComputerError("COMPUTER_JS_FAILED");
    if (Buffer.byteLength(request.source, "utf8") > this.options.maxSourceBytes) {
      throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
    }

    let child: ChildProcess;
    try {
      child = this.spawnProcess(process.execPath, [this.options.runnerEntrypoint], {
        cwd: request.cwd,
        shell: false,
        env: sanitizedChildEnvironment(),
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        detached: this.platform !== "win32",
      });
    } catch {
      throw new ComputerError("COMPUTER_JS_FAILED");
    }

    if (!child.stdin || !child.stdout || !child.stderr || typeof child.send !== "function") {
      child.kill("SIGKILL");
      throw new ComputerError("COMPUTER_JS_FAILED");
    }

    let closed = false;
    let resolveClosed!: () => void;
    const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const active: ActiveRunner = { child, closed: closedPromise, isClosed: () => closed };
    this.active.add(active);
    child.once("close", () => {
      closed = true;
      resolveClosed();
      this.active.delete(active);
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    return new Promise<ComputerJsRunnerResult>((resolve, reject) => {
      let terminal = false;
      let completing = false;
      let outputBytes = 0;
      let timer: NodeJS.Timeout | undefined;
      const abort = (): void => finishError(new ComputerError("COMPUTER_JS_FAILED"));

      const clearExecutionTimer = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };

      const detachRequestGuards = (): void => {
        clearExecutionTimer();
        request.signal?.removeEventListener("abort", abort);
      };

      const finishError = (error: unknown): void => {
        if (terminal) return;
        terminal = true;
        detachRequestGuards();
        request.onTerminate?.();
        const primary = error instanceof ComputerError ? error : new ComputerError("COMPUTER_JS_FAILED");
        void this.terminate(active).then(
          () => reject(primary),
          () => reject(primary),
        );
      };

      const appendOutput = (target: Buffer[], chunk: Buffer | string): void => {
        if (terminal) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += buffer.byteLength;
        if (outputBytes > this.options.maxOutputBytes) {
          finishError(new ComputerError("COMPUTER_OUTPUT_LIMIT"));
          return;
        }
        target.push(buffer);
      };

      const finishSuccess = (message: { resultJson?: string | undefined }): void => {
        if (terminal || completing) {
          finishError(new ComputerError("COMPUTER_JS_FAILED"));
          return;
        }
        const resultBytes = message.resultJson === undefined ? 0 : Buffer.byteLength(message.resultJson, "utf8");
        if (outputBytes + resultBytes > this.options.maxOutputBytes) {
          finishError(new ComputerError("COMPUTER_OUTPUT_LIMIT"));
          return;
        }

        let result: unknown;
        try {
          result = message.resultJson === undefined ? undefined : JSON.parse(message.resultJson);
        } catch {
          finishError(new ComputerError("COMPUTER_JS_FAILED"));
          return;
        }

        outputBytes += resultBytes;
        completing = true;
        clearExecutionTimer();
        // The fixed runner sends `complete` only after its worker-output boundaries
        // have been forwarded through the runner's stdout/stderr write callbacks.
        // Start group cleanup now so ordinary descendants cannot keep the Worker alive,
        // but keep collectors active until `terminate()` observes child `close`, which
        // occurs after the child stdio streams have closed.
        void this.terminate(active).then(() => {
          if (terminal) return;
          terminal = true;
          detachRequestGuards();
          resolve({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            ...(message.resultJson !== undefined ? { result } : {}),
          });
        }, () => {
          if (terminal) return;
          terminal = true;
          detachRequestGuards();
          reject(new ComputerError("COMPUTER_JS_FAILED"));
        });
      };

      child.stdout!.on("data", (chunk: Buffer | string) => appendOutput(stdout, chunk));
      child.stderr!.on("data", (chunk: Buffer | string) => appendOutput(stderr, chunk));
      child.once("error", () => finishError(new ComputerError("COMPUTER_JS_FAILED")));
      child.once("close", () => {
        if (!terminal && !completing) finishError(new ComputerError("COMPUTER_JS_FAILED"));
      });
      child.on("message", (raw: unknown) => {
        if (terminal) return;
        if (completing) {
          finishError(new ComputerError("COMPUTER_JS_FAILED"));
          return;
        }
        const parsed = runnerMessageSchema.safeParse(raw);
        if (!parsed.success) {
          finishError(new ComputerError("COMPUTER_JS_FAILED"));
          return;
        }
        const message = parsed.data;
        if (message.type === "complete") {
          finishSuccess(message);
          return;
        }
        if (message.type === "worker_exit") {
          finishError(new ComputerError("COMPUTER_JS_FAILED"));
          return;
        }
        void this.handleRpc(child, message, request).catch((error) => finishError(error));
      });

      timer = setTimeout(() => finishError(new ComputerError("COMPUTER_JS_TIMEOUT")), Math.max(0, request.timeoutMs));
      timer.unref();
      if (request.signal?.aborted) {
        finishError(new ComputerError("COMPUTER_JS_FAILED"));
        return;
      }
      request.signal?.addEventListener("abort", abort, { once: true });
      child.stdin!.end(request.source, "utf8");
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = Promise.all([...this.active].map(async (runner) => {
      try {
        await this.terminate(runner);
      } catch {
        // Closing remains idempotent and best-effort; active run promises observe their own stable failure.
      }
    })).then(() => undefined);
    return this.closePromise;
  }

  private async handleRpc(
    child: ChildProcess,
    message: RunnerRpcMessage,
    request: ComputerJsRunnerRequest,
  ): Promise<void> {
    try {
      const result = await request.onRpc(message.method, message.params);
      this.send(child, { type: "rpc_result", id: message.id, ok: true, result });
    } catch (error) {
      if (error instanceof ComputerError && error.code === "COMPUTER_USER_TAKEOVER") throw error;
      this.send(child, fixedRpcFailure(message.id, error));
    }
  }

  private send(child: ChildProcess, response: RunnerRpcResponse): void {
    if (!child.connected || typeof child.send !== "function") {
      throw new ComputerError("COMPUTER_JS_FAILED");
    }
    try {
      child.send(response);
    } catch {
      throw new ComputerError("COMPUTER_JS_FAILED");
    }
  }

  private terminate(runner: ActiveRunner): Promise<void> {
    if (runner.terminationPromise) return runner.terminationPromise;
    runner.terminationPromise = this.terminateOnce(runner);
    return runner.terminationPromise;
  }

  private async terminateOnce(runner: ActiveRunner): Promise<void> {
    const pid = runner.child.pid;
    if (pid !== undefined) this.sendSignal(pid, "SIGTERM");
    else runner.child.kill("SIGTERM");

    if (await this.waitClosed(runner, this.options.processStopGraceMs)) return;
    if (pid !== undefined) this.sendSignal(pid, "SIGKILL");
    else runner.child.kill("SIGKILL");
    await runner.closed;
  }

  private sendSignal(pid: number, signal: NodeJS.Signals): void {
    const target = this.platform === "win32" ? pid : -pid;
    try {
      this.signalProcess(target, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") throw error;
    }
  }

  private async waitClosed(runner: ActiveRunner, timeoutMs: number): Promise<boolean> {
    if (runner.isClosed()) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref();
      void runner.closed.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
