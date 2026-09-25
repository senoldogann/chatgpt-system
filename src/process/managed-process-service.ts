import { homedir } from "node:os";
import { ExecutableNotFoundError, ProcessNotFoundError } from "../core/errors.js";
import { resolveExecutablePath } from "../core/executable-resolution.js";
import { PathPolicy } from "../core/policy.js";
import { validateProcessInvocation } from "./process-policy.js";
import type {
  ManagedProcessDescriptor,
  ManagedProcessLogs,
  ManagedProcessState,
  ManagedProcessSummary,
  ProcessSupervisor,
} from "./process-supervisor.js";

// Uzun komutlar beklenirken her kısa yoklama modele ayrı bir tur yaptırır.
// Sınırlı bekleme bu turları azaltır; üst sınır hosted yanıt süresinin çok
// altında tutulur ki tek çağrı asla komut yanıt bütçesine yaklaşmasın.
export const MAX_PROCESS_WAIT_MS = 30_000;
const WAIT_POLL_INTERVAL_MS = 150;

export interface ProcessWaitOptions {
  waitMs?: number;
  signal?: AbortSignal;
}

export type ManagedProcessLogsWithState = ManagedProcessLogs & {
  state: ManagedProcessState;
  exitCode?: number | null;
};

function waitDeadline(waitMs: number | undefined): number {
  const bounded = Math.min(Math.max(waitMs ?? 0, 0), MAX_PROCESS_WAIT_MS);
  return Date.now() + bounded;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

export class ManagedProcessService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly terminal: { enabled: boolean; commands: string[] },
    private readonly supervisor: ProcessSupervisor,
  ) {}

  async start(command: string, args: string[], cwdInput = ".", idempotencyKey?: string): Promise<ManagedProcessSummary> {
    validateProcessInvocation(this.terminal, command, args);
    // terminal_run ile aynı semantik: allowlist'te olup bulunamayan binary
    // structured EXECUTABLE_NOT_FOUND verir, ham OS hatası sızdırmaz.
    const resolved = await resolveExecutablePath(command, {
      pathValue: process.env.PATH,
      homeDir: homedir(),
    });
    if (resolved === null) throw new ExecutableNotFoundError(command);
    const cwd = await this.policy.resolve(cwdInput);
    return this.supervisor.start({ command, args, cwd, ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) });
  }

  async list(): Promise<{ processes: ManagedProcessSummary[] }> {
    const processes: ManagedProcessSummary[] = [];
    for (const descriptor of this.supervisor.descriptors()) {
      if (!await this.isManageable(descriptor)) continue;
      const status = this.supervisor.status(descriptor.processId);
      if (status) processes.push(status);
    }
    processes.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return { processes };
  }

  // waitMs verilirse süreç çalışmayı bırakana ya da süre dolana kadar bekler.
  async status(processId: string, options: ProcessWaitOptions = {}): Promise<ManagedProcessSummary> {
    await this.requireManageable(processId);
    const deadline = waitDeadline(options.waitMs);
    for (;;) {
      const value = this.supervisor.status(processId);
      if (!value) throw new ProcessNotFoundError();
      if (value.state !== "running" || Date.now() >= deadline || options.signal?.aborted === true) return value;
      await pause(Math.min(WAIT_POLL_INTERVAL_MS, deadline - Date.now()));
    }
  }

  // cursor ve waitMs birlikte verilirse imleçten sonra yeni çıktı gelene, süreç
  // çalışmayı bırakana ya da süre dolana kadar bekler.
  async logs(processId: string, cursor?: number, options: ProcessWaitOptions = {}): Promise<ManagedProcessLogsWithState> {
    await this.requireManageable(processId);
    const deadline = waitDeadline(options.waitMs);
    for (;;) {
      const value = this.supervisor.logs(processId, cursor);
      const summary = this.supervisor.status(processId);
      if (!value || !summary) throw new ProcessNotFoundError();
      const hasOutput = value.stdout.bytes > 0 || value.stderr.bytes > 0;
      if (hasOutput || summary.state !== "running" || Date.now() >= deadline || options.signal?.aborted === true) {
        return {
          ...value,
          state: summary.state,
          ...(summary.exitCode !== undefined ? { exitCode: summary.exitCode } : {}),
        };
      }
      await pause(Math.min(WAIT_POLL_INTERVAL_MS, deadline - Date.now()));
    }
  }

  async stop(processId: string): Promise<ManagedProcessSummary> {
    await this.requireManageable(processId);
    const value = await this.supervisor.stop(processId);
    if (!value) throw new ProcessNotFoundError();
    return value;
  }

  private async requireManageable(processId: string): Promise<void> {
    const descriptor = this.supervisor.descriptors().find((item) => item.processId === processId);
    if (!descriptor || !await this.isManageable(descriptor)) throw new ProcessNotFoundError();
  }

  private async isManageable(descriptor: ManagedProcessDescriptor): Promise<boolean> {
    if (!this.terminal.enabled) return false;
    if (!this.terminal.commands.includes(descriptor.command)) return false;
    try {
      await this.policy.resolve(descriptor.cwd);
      return true;
    } catch {
      return false;
    }
  }
}
