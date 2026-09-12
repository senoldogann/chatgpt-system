import type { AuditLogger } from "./audit.js";
import type { OwnerRuntimeConfig } from "./config.js";
import {
  LimitError,
  OwnerRuntimeDisabledError,
  PolicyError,
  TerminalSessionClosedError,
  TerminalSessionFailedError,
  TerminalSessionLimitError,
  TerminalSessionNotFoundError,
} from "./errors.js";
import type { PathPolicy } from "./policy.js";
import type {
  TerminalSessionReadResult,
  TerminalSessionSummary,
  TerminalSessionSupervisor,
} from "./terminal-session-supervisor.js";

export interface TerminalSessionOpenInput {
  cwd?: string;
  cols?: number;
  rows?: number;
}

export class TerminalSessionService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly supervisor: TerminalSessionSupervisor,
    private readonly config: OwnerRuntimeConfig,
    private readonly adminEnabled: boolean,
  ) {}

  async open(input: TerminalSessionOpenInput): Promise<TerminalSessionSummary> {
    this.requireOwnerRuntime();
    const cols = input.cols ?? 120;
    const rows = input.rows ?? 30;
    this.validateDimensions(cols, rows);
    const cwd = await this.policy.resolve(input.cwd ?? ".");

    let result: TerminalSessionSummary;
    try {
      result = await this.supervisor.open({
        shellPath: this.config.shellPath,
        cwd,
        cols,
        rows,
      });
    } catch (error) {
      if (error instanceof LimitError) throw new TerminalSessionLimitError();
      throw new TerminalSessionFailedError();
    }

    await this.recordAudit("terminal.session.open", {
      cols,
      rows,
      state: result.state,
    });
    return result;
  }

  async list(): Promise<{ sessions: TerminalSessionSummary[] }> {
    this.requireOwnerRuntime();
    const sessions: TerminalSessionSummary[] = [];
    for (const descriptor of this.supervisor.descriptors()) {
      if (!await this.isManageable(descriptor.sessionId, descriptor.cwd)) continue;
      const current = this.supervisor.status(descriptor.sessionId);
      if (current) sessions.push(current);
    }
    sessions.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return { sessions };
  }

  async read(sessionId: string, afterSequence = 0): Promise<TerminalSessionReadResult> {
    this.requireOwnerRuntime();
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new PolicyError("Terminal output sequence must be a non-negative integer.");
    }
    const current = await this.requireManageable(sessionId);
    if (afterSequence > current.outputSequence) {
      throw new PolicyError("Terminal output sequence is ahead of the current stream.");
    }
    const result = this.supervisor.read(sessionId, afterSequence);
    if (!result) throw new TerminalSessionNotFoundError();
    await this.recordAudit("terminal.session.read", {
      outputByteCount: result.bytes,
      truncated: result.truncatedBefore,
    });
    return result;
  }

  async write(sessionId: string, data: string): Promise<TerminalSessionSummary> {
    this.requireOwnerRuntime();
    const bytes = Buffer.byteLength(data, "utf8");
    if (bytes === 0) throw new PolicyError("Terminal input must not be empty.");
    if (bytes > this.config.maxTerminalInputBytes) {
      throw new LimitError("Terminal session input exceeds the configured byte limit.", {
        limit: this.config.maxTerminalInputBytes,
      });
    }
    const current = await this.requireManageable(sessionId);
    if (current.state !== "running") throw new TerminalSessionClosedError();

    let result: TerminalSessionSummary | undefined;
    try {
      result = this.supervisor.write(sessionId, data);
    } catch (error) {
      if (error instanceof LimitError) throw error;
      throw new TerminalSessionFailedError();
    }
    if (!result) throw new TerminalSessionNotFoundError();
    await this.recordAudit("terminal.session.write", { inputByteCount: bytes });
    return result;
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<TerminalSessionSummary> {
    this.requireOwnerRuntime();
    this.validateDimensions(cols, rows);
    const current = await this.requireManageable(sessionId);
    if (current.state !== "running") throw new TerminalSessionClosedError();

    let result: TerminalSessionSummary | undefined;
    try {
      result = this.supervisor.resize(sessionId, cols, rows);
    } catch {
      throw new TerminalSessionFailedError();
    }
    if (!result) throw new TerminalSessionNotFoundError();
    await this.recordAudit("terminal.session.resize", { cols, rows });
    return result;
  }

  async close(sessionId: string): Promise<TerminalSessionSummary> {
    this.requireOwnerRuntime();
    await this.requireManageable(sessionId);

    let result: TerminalSessionSummary | undefined;
    try {
      result = await this.supervisor.stop(sessionId);
    } catch {
      throw new TerminalSessionFailedError();
    }
    if (!result) throw new TerminalSessionNotFoundError();
    await this.recordAudit("terminal.session.close", { state: result.state });
    return result;
  }

  private requireOwnerRuntime(): void {
    if (!this.adminEnabled) {
      throw new PolicyError("Owner Runtime terminal sessions require an Admin authority lease.");
    }
    if (!this.config.enabled) throw new OwnerRuntimeDisabledError();
  }

  private async requireManageable(sessionId: string): Promise<TerminalSessionSummary> {
    const descriptor = this.supervisor.descriptors().find((item) => item.sessionId === sessionId);
    if (!descriptor || !await this.isManageable(descriptor.sessionId, descriptor.cwd)) {
      throw new TerminalSessionNotFoundError();
    }
    const current = this.supervisor.status(sessionId);
    if (!current) throw new TerminalSessionNotFoundError();
    return current;
  }

  private async isManageable(_sessionId: string, cwd: string): Promise<boolean> {
    try {
      await this.policy.resolve(cwd);
      return true;
    } catch {
      return false;
    }
  }

  private validateDimensions(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) {
      throw new PolicyError("Terminal dimensions must be integers between 1 and 1000.");
    }
  }

  private async recordAudit(action: string, metadata: Record<string, unknown>): Promise<void> {
    try {
      await this.audit.record({ action, outcome: "ok", durationMs: 0, metadata });
    } catch {
      // Terminal ownership and cleanup must remain available even if audit storage is unavailable.
    }
  }
}
