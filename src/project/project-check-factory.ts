import type { AuthorityManager } from "../core/authority.js";
import type { AuditLogger } from "../core/audit.js";
import type { AppConfig } from "../core/config.js";
import { PathPolicy } from "../core/policy.js";
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

export function createProjectCheckServiceForRoots(
  runtime: ProjectCheckRuntimeDependencies,
  roots: string[],
): ProjectCheckService {
  const policy = new PathPolicy([...roots]);
  const projectExec = new ProjectExecService(
    policy,
    runtime.audit,
    runtime.projectExecBackend,
    runtime.config.projectExec.enabled,
    "project",
    [...runtime.config.terminal.commands],
    runtime.config.limits,
  );
  return new ProjectCheckService(
    policy,
    runtime.audit,
    runtime.taskStateRoot,
    "project",
    runtime.config.limits,
    projectExec,
  );
}

export function createProjectCheckHostExecutorFactory(
  runtime: ProjectCheckRuntimeDependencies,
  authorityLeaseId: string,
): ProjectCheckExecutorFactory {
  const authority = runtime.authority.resolve(authorityLeaseId);
  return (repositoryRoot) => runtime.projectCheckHostExecutorFactory?.(authority, repositoryRoot)
    ?? createAdminHostProjectCheckExecutor(authority, repositoryRoot, runtime.audit, runtime.config);
}
