import { ProcessNotFoundError } from "./errors.js";
import { PathPolicy } from "./policy.js";
import { validateProcessInvocation } from "./process-policy.js";
import type {
  ManagedProcessDescriptor,
  ManagedProcessLogs,
  ManagedProcessSummary,
  ProcessSupervisor,
} from "./process-supervisor.js";

export class ManagedProcessService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly terminal: { enabled: boolean; commands: string[] },
    private readonly supervisor: ProcessSupervisor,
  ) {}

  async start(command: string, args: string[], cwdInput = "."): Promise<ManagedProcessSummary> {
    validateProcessInvocation(this.terminal, command, args);
    const cwd = await this.policy.resolve(cwdInput);
    return this.supervisor.start({ command, args, cwd });
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

  async status(processId: string): Promise<ManagedProcessSummary> {
    await this.requireManageable(processId);
    const value = this.supervisor.status(processId);
    if (!value) throw new ProcessNotFoundError();
    return value;
  }

  async logs(processId: string): Promise<ManagedProcessLogs> {
    await this.requireManageable(processId);
    const value = this.supervisor.logs(processId);
    if (!value) throw new ProcessNotFoundError();
    return value;
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
