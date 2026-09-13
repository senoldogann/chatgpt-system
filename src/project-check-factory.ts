import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { PathPolicy } from "./policy.js";
import { ProjectCheckService } from "./project-check-service.js";
import { ProjectExecService } from "./project-exec-service.js";
import type { ProjectExecBackend } from "./project-exec-types.js";

export interface ProjectCheckRuntimeDependencies {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  projectExecBackend: ProjectExecBackend;
  taskStateRoot: string;
}

export function createProjectCheckService(
  runtime: ProjectCheckRuntimeDependencies,
  authorityLeaseId: string,
): ProjectCheckService {
  const authority = runtime.authority.resolve(authorityLeaseId);
  const policy = new PathPolicy([...authority.roots]);
  const projectExec = new ProjectExecService(
    policy,
    runtime.audit,
    runtime.projectExecBackend,
    runtime.config.projectExec.enabled,
    authority.profile,
    [...runtime.config.terminal.commands],
    runtime.config.limits,
  );
  return new ProjectCheckService(
    policy,
    runtime.audit,
    runtime.taskStateRoot,
    authority.profile,
    runtime.config.limits,
    projectExec,
  );
}
