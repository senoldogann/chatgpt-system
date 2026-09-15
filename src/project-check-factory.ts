import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { AuthorityDeniedError } from "./errors.js";
import { PathPolicy } from "./policy.js";
import {
  createAdminHostProjectCheckExecutor,
  type ProjectCheckHostExecutorFactory,
} from "./project-check-host-executor.js";
import { ProjectCheckService } from "./project-check-service.js";
import type { ProjectCheckExecutorFactory } from "./project-check-types.js";
import { ProjectExecService } from "./project-exec-service.js";
import type { ProjectExecBackend } from "./project-exec-types.js";

export interface ProjectCheckRuntimeDependencies {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  projectExecBackend: ProjectExecBackend;
  projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
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

export function createProjectCheckHostExecutorFactory(
  runtime: ProjectCheckRuntimeDependencies,
  adminAuthorityLeaseId: string,
): ProjectCheckExecutorFactory {
  const authority = runtime.authority.resolve(adminAuthorityLeaseId);
  if (authority.profile !== "admin") {
    throw new AuthorityDeniedError("Native project verification requires an active Admin authority lease.");
  }
  return (repositoryRoot) => runtime.projectCheckHostExecutorFactory?.(authority, repositoryRoot)
    ?? createAdminHostProjectCheckExecutor(authority, repositoryRoot, runtime.audit, runtime.config);
}
