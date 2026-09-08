import type { AuthorityContext } from "./authority.js";
import { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { FileSystemService } from "./fs-service.js";
import { GitService } from "./git-service.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";

export interface ScopedRuntime {
  policy: PathPolicy;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
}

export interface ScopedRuntimeBase {
  config: AppConfig;
  audit: AuditLogger;
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
    git: new GitService(policy, base.audit, config),
    process: new ProcessService(policy, base.audit, config),
  };
}
