import type { AuthorityContext } from "./authority.js";
import { AuditLogger } from "./audit.js";
import type { BrowserService } from "../browser/browser-service.js";
import { CodeQueryService } from "../code/code-query-service.js";
import type { ComputerRuntime } from "../computer/computer-runtime.js";
import type { AppConfig } from "./config.js";
import { FileSystemService } from "../fs/fs-service.js";
import { GitService } from "../git/git-service.js";
import { ManagedProcessService } from "../process/managed-process-service.js";
import { OwnerShellService } from "../terminal/owner-shell-service.js";
import { TerminalSessionService } from "../terminal/terminal-session-service.js";
import type { OwnerShellSupervisor } from "../terminal/owner-shell-supervisor.js";
import type { TerminalSessionSupervisor } from "../terminal/terminal-session-supervisor.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "../process/process-service.js";
import { ProjectExecService } from "../project/project-exec-service.js";
import type { ProjectExecBackend } from "../project/project-exec-types.js";
import type { ProcessSupervisor } from "../process/process-supervisor.js";
import { ScopedBrowserService } from "../browser/scoped-browser-service.js";
import { ScopedComputerService } from "../computer/scoped-computer-service.js";

export interface ScopedRuntime {
  policy: PathPolicy;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
  processes: ManagedProcessService;
  shell: OwnerShellService;
  terminals: TerminalSessionService;
  codeQuery: CodeQueryService;
  projectExec: ProjectExecService;
  browser: ScopedBrowserService;
  computer: ScopedComputerService;
}

export interface ScopedRuntimeBase {
  config: AppConfig;
  audit: AuditLogger;
  processSupervisor: ProcessSupervisor;
  ownerShellSupervisor: OwnerShellSupervisor;
  terminalSessionSupervisor: TerminalSessionSupervisor;
  projectExecBackend: ProjectExecBackend;
  browser: BrowserService;
  computer: ComputerRuntime;
  authority?: { activeRoots(): string[] };
}

// Serbest mod: tüm kabiliyetler açıktır. Tek kapı startup flagleridir
// (terminal, projectExec, browser, computerUse). Lease profili yoktur.
export function createScopedRuntime(base: ScopedRuntimeBase, authority: AuthorityContext): ScopedRuntime {
  const policy = new PathPolicy([...authority.roots]);
  const config: AppConfig = {
    ...base.config,
    roots: [...authority.roots],
    terminal: {
      enabled: authority.terminalEnabled,
      commands: [...authority.commands],
    },
  };

  return {
    policy,
    fs: new FileSystemService(policy, base.audit, config.limits),
    git: new GitService(policy, base.audit, config, { remoteWriteEnabled: true }),
    process: new ProcessService(policy, base.audit, config),
    processes: new ManagedProcessService(policy, config.terminal, base.processSupervisor),
    shell: new OwnerShellService(
      policy,
      base.audit,
      base.ownerShellSupervisor,
      base.config.ownerRuntime,
      true,
    ),
    terminals: new TerminalSessionService(
      policy,
      base.audit,
      base.terminalSessionSupervisor,
      base.config.ownerRuntime,
      true,
    ),
    codeQuery: new CodeQueryService(policy, base.audit, config.limits),
    projectExec: new ProjectExecService(
      policy,
      base.audit,
      base.projectExecBackend,
      base.config.projectExec.enabled,
      "project",
      [...base.config.terminal.commands],
      base.config.limits,
    ),
    browser: new ScopedBrowserService(base.browser, base.audit, true),
    computer: new ScopedComputerService(
      base.computer,
      base.audit,
      true,
      base.config.ownerRuntime?.enabled === true,
    ),
  };
}

// Lease verilmediğinde bootstrap rootlarla açık kapsam kurulur.
export function createOpenRuntime(base: ScopedRuntimeBase): ScopedRuntime {
  // Bootstrap kökleri önce gelir: göreli yollar her zaman onlara göre çözülür.
  const leasedRoots = base.authority?.activeRoots() ?? [];
  const policy = new PathPolicy([...new Set([...base.config.roots, ...leasedRoots])]);
  const config: AppConfig = {
    ...base.config,
    terminal: {
      enabled: base.config.terminal.enabled,
      commands: [...base.config.terminal.commands],
    },
  };

  return {
    policy,
    fs: new FileSystemService(policy, base.audit, config.limits),
    git: new GitService(policy, base.audit, config, { remoteWriteEnabled: true }),
    process: new ProcessService(policy, base.audit, config),
    processes: new ManagedProcessService(policy, config.terminal, base.processSupervisor),
    shell: new OwnerShellService(
      policy,
      base.audit,
      base.ownerShellSupervisor,
      base.config.ownerRuntime,
      true,
    ),
    terminals: new TerminalSessionService(
      policy,
      base.audit,
      base.terminalSessionSupervisor,
      base.config.ownerRuntime,
      true,
    ),
    codeQuery: new CodeQueryService(policy, base.audit, config.limits),
    projectExec: new ProjectExecService(
      policy,
      base.audit,
      base.projectExecBackend,
      base.config.projectExec.enabled,
      "project",
      [...base.config.terminal.commands],
      base.config.limits,
    ),
    browser: new ScopedBrowserService(base.browser, base.audit, true),
    computer: new ScopedComputerService(
      base.computer,
      base.audit,
      true,
      base.config.ownerRuntime?.enabled === true,
    ),
  };
}
