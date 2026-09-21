import type { AuthorityManager } from "./authority.js";
import path from "node:path";
import { ActiveProjectTracker } from "./active-project.js";
import { ContinuityGitInspector } from "./continuity-git-inspector.js";
import { ContinuityStore } from "./continuity-store.js";
import { ContinuityResumeRegistry } from "./continuity-resume-registry.js";
import { ProjectContinuityService } from "./project-continuity-service.js";

export interface ProjectContinuityRuntimeConfig {
  continuity: {
    databasePath: string;
    maxTrackedPaths: number;
    remoteVerificationTimeoutMs: number;
    maxResumeChars: number;
  };
  limits: {
    maxCommandOutputBytes: number;
  };
}

export interface ProjectContinuityRuntimeOptions {
  homeDir: string;
  continuityStore?: ContinuityStore;
  continuityService?: ProjectContinuityService;
  continuityResumeRegistry?: ContinuityResumeRegistry;
}

export interface ProjectContinuityRuntime {
  continuityStore: ContinuityStore;
  continuity: ProjectContinuityService;
  continuityResumeRegistry: ContinuityResumeRegistry;
  activeProject: ActiveProjectTracker;
}

export function createProjectContinuityRuntime(
  config: ProjectContinuityRuntimeConfig,
  authority: AuthorityManager,
  options: ProjectContinuityRuntimeOptions,
): ProjectContinuityRuntime {
  if (options.continuityService !== undefined && options.continuityStore === undefined) {
    throw new Error("continuityStore is required when continuityService is injected.");
  }

  const continuityStore = options.continuityStore
    ?? new ContinuityStore({ databasePath: config.continuity.databasePath });
  const continuityResumeRegistry = options.continuityResumeRegistry
    ?? options.continuityService?.resumeRegistry
    ?? new ContinuityResumeRegistry();
  const activeProject = new ActiveProjectTracker(path.dirname(config.continuity.databasePath));
  const continuity = options.continuityService
    ?? new ProjectContinuityService({
      store: continuityStore,
      inspector: new ContinuityGitInspector({
        maxTrackedPaths: config.continuity.maxTrackedPaths,
        remoteVerificationTimeoutMs: config.continuity.remoteVerificationTimeoutMs,
        maxCommandOutputBytes: config.limits.maxCommandOutputBytes,
      }),
      authority,
      homeDir: options.homeDir,
      maxResumeChars: config.continuity.maxResumeChars,
      resumeRegistry: continuityResumeRegistry,
      onActive: (alias) => activeProject.record(alias),
    });

  return { continuityStore, continuity, continuityResumeRegistry, activeProject };
}
