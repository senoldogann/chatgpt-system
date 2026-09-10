import type { AuthorityContext } from "./authority.js";
import { AuditLogger } from "./audit.js";
import type { BrowserService } from "./browser-service.js";
import type { ComputerRuntime } from "./computer-runtime.js";
import type { AppConfig } from "./config.js";
import { FileSystemService } from "./fs-service.js";
import { GitService } from "./git-service.js";
import { ManagedProcessService } from "./managed-process-service.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import type { ProcessSupervisor } from "./process-supervisor.js";
import { ScopedBrowserService } from "./scoped-browser-service.js";
import { ScopedComputerService } from "./scoped-computer-service.js";

export interface ScopedRuntime {
  policy: PathPolicy;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
  processes: ManagedProcessService;
  browser: ScopedBrowserService;
  computer: ScopedComputerService;
}

export interface ScopedRuntimeBase {
  config: AppConfig;
  audit: AuditLogger;
  processSupervisor: ProcessSupervisor;
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
    browser: new ScopedBrowserService(base.browser, base.audit, authority.profile === "admin"),
    computer: new ScopedComputerService(base.computer, base.audit, authority.profile === "admin"),
  };
}
