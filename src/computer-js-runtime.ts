import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ComputerUseConfig } from "./config.js";
import { ComputerError } from "./computer-errors.js";
import { dispatchComputerJsRpc } from "./computer-js-rpc.js";
import type { ComputerRuntime } from "./computer-runtime.js";
import type {
  ComputerJsRunnerRequest,
  ComputerJsRunnerResult,
} from "./computer-js-runner-supervisor.js";

export interface ComputerJsRunInput {
  source: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComputerJsRunnerLike {
  run(request: ComputerJsRunnerRequest): Promise<ComputerJsRunnerResult>;
  close(): Promise<void>;
}

export interface ComputerJsRuntimeConfig {
  roots: string[];
  computerUse: ComputerUseConfig;
}

export class ComputerJsRuntime {
  private closing = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly computer: ComputerRuntime,
    private readonly config: ComputerJsRuntimeConfig,
    private readonly supervisor: ComputerJsRunnerLike,
  ) {}

  async run(input: ComputerJsRunInput): Promise<ComputerJsRunnerResult> {
    if (this.closing) throw new ComputerError("COMPUTER_JS_FAILED");
    if (!this.config.computerUse.fullHostJsEnabled) throw new ComputerError("COMPUTER_JS_DISABLED");
    if (Buffer.byteLength(input.source, "utf8") > this.config.computerUse.maxJsSourceBytes) {
      throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
    }

    const cwd = await this.resolveCwd(input.cwd);
    if (this.closing) throw new ComputerError("COMPUTER_JS_FAILED");

    let timeoutMs = this.config.computerUse.maxJsRuntimeMs;
    if (input.timeoutMs !== undefined) {
      if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
        throw new ComputerError("COMPUTER_PROTOCOL_INVALID");
      }
      timeoutMs = Math.min(input.timeoutMs, this.config.computerUse.maxJsRuntimeMs);
    }

    return this.computer.withExclusiveProgram((session) => {
      if (this.closing) throw new ComputerError("COMPUTER_JS_FAILED");
      return this.supervisor.run({
        source: input.source,
        cwd,
        timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
        onTerminate: () => session.cancel(),
        onRpc: (method, params) => dispatchComputerJsRpc(session, method, params),
      });
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.supervisor.close();
    return this.closePromise;
  }

  private async resolveCwd(input: string | undefined): Promise<string> {
    const root = this.config.roots[0];
    if (!root) throw new ComputerError("COMPUTER_JS_FAILED");
    const requested = input === undefined
      ? root
      : path.isAbsolute(input)
        ? path.resolve(input)
        : path.resolve(root, input);
    try {
      const canonical = await realpath(requested);
      const info = await stat(canonical);
      if (!info.isDirectory()) throw new ComputerError("COMPUTER_JS_FAILED");
      return canonical;
    } catch (error) {
      if (error instanceof ComputerError) throw error;
      throw new ComputerError("COMPUTER_JS_FAILED");
    }
  }
}
