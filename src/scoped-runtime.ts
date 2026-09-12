import type { AuthorityContext } from "./authority.js";
import { AuditLogger } from "./audit.js";
import type { BrowserService } from "./browser-service.js";
import { CodeQueryService } from "./code-query-service.js";
import type { ComputerRuntime } from "./computer-runtime.js";
import type { AppConfig } from "./config.js";
import { FileSystemService } from "./fs-service.js";
import { GitService } from "./git-service.js";
import { ManagedProcessService } from "./managed-process-service.js";
import { OwnerShellService } from "./owner-shell-service.js";
import { TerminalSessionService } from "./terminal-session-service.js";
import type { OwnerShellSupervisor } from "./owner-shell-supervisor.js";
import type { TerminalSessionSupervisor } from "./terminal-session-supervisor.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import { ProjectExecService } from "./project-exec-service.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import type { ProcessSupervisor } from "./process-supervisor.js";
import { ScopedBrowserService } from "./scoped-browser-service.js";
import { ScopedComputerService } from "./scoped-computer-service.js";

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
}

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
    git: new GitService(policy, base.audit, config, { remoteWriteEnabled: authority.profile === "admin" }),
    process: new ProcessService(policy, base.audit, config),
    processes: new ManagedProcessService(policy, config.terminal, base.processSupervisor),
    shell: new OwnerShellService(
      policy,
      base.audit,
      base.ownerShellSupervisor,
      base.config.ownerRuntime,
      authority.profile === "admin",
    ),
    terminals: new TerminalSessionService(
      policy,
      base.audit,
      base.terminalSessionSupervisor,
      base.config.ownerRuntime,
      authority.profile === "admin",
    ),
    codeQuery: new CodeQueryService(policy, base.audit, config.limits),
    projectExec: new ProjectExecService(
      policy,
      base.audit,
      base.projectExecBackend,
      base.config.projectExec.enabled,
      authority.profile,
      [...base.config.terminal.commands],
      base.config.limits,
    ),
    browser: new ScopedBrowserService(base.browser, base.audit, authority.profile === "admin"),
    computer: new ScopedComputerService(base.computer, base.audit, authority.profile === "admin"),
  };
}
