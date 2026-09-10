import type { AuditLogger } from "./audit.js";
import { ComputerError } from "./computer-errors.js";
import type { ComputerJsRunInput } from "./computer-js-runtime.js";
import type { ComputerJsRunnerResult } from "./computer-js-runner-supervisor.js";
import { AppError, PolicyError } from "./errors.js";

export interface ScopedComputerJsBackend {
  run(input: ComputerJsRunInput): Promise<ComputerJsRunnerResult>;
}

export class ScopedComputerJsService {
  constructor(
    private readonly service: ScopedComputerJsBackend,
    private readonly audit: AuditLogger,
    private readonly adminEnabled: boolean,
    private readonly fullHostJsEnabled: boolean,
  ) {}

  async run(input: ComputerJsRunInput): Promise<ComputerJsRunnerResult> {
    const started = performance.now();
    try {
      if (!this.adminEnabled) {
        throw new PolicyError("Full-host computer JavaScript requires an Admin authority lease.");
      }
      if (!this.fullHostJsEnabled) {
        throw new ComputerError("COMPUTER_JS_DISABLED");
      }
      const result = await this.service.run(input);
      await this.safeRecord({
        action: "computer.run_js",
        outcome: "ok",
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      await this.safeRecord({
        action: "computer.run_js",
        outcome: "error",
        durationMs: performance.now() - started,
        metadata: {
          errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async safeRecord(event: Parameters<AuditLogger["record"]>[0]): Promise<void> {
    try {
      await this.audit.record(event);
    } catch {
      // A completed/failed full-host operation keeps its primary result even if audit persistence fails.
    }
  }
}
