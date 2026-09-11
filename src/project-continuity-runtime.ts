import type { AuthorityManager } from "./authority.js";
import { ContinuityGitInspector } from "./continuity-git-inspector.js";
import { ContinuityStore } from "./continuity-store.js";
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
}

export interface ProjectContinuityRuntime {
  continuityStore: ContinuityStore;
  continuity: ProjectContinuityService;
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
    });

  return { continuityStore, continuity };
}
