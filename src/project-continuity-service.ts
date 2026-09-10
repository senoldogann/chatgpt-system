import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeProjectRoots,
  type AuthorityManager,
} from "./authority.js";
import { ContinuityWorktreeInvalidError } from "./continuity-errors.js";
import type { ContinuityGitInspector } from "./continuity-git-inspector.js";
import type { ContinuityStore } from "./continuity-store.js";
import type {
  ContinuityDecision,
  ContinuityLocalState,
  ContinuityPublishedState,
  ContinuitySemanticRecord,
  ContinuityTask,
  StoredProject,
  StoredWorktreeIdentity,
} from "./continuity-types.js";
import { AuthorityDeniedError } from "./errors.js";

export interface ProjectRegisterInput {
  alias: string;
  worktreePath: string;
  projectRoots: string[];
  task: ContinuityTask;
  decisions?: ContinuityDecision[];
  uncertainties?: string[];
  verificationSummary?: string[];
}

export interface ProjectCheckpointInput {
  authorityLeaseId: string;
  alias: string;
  expectedRecordVersion: number;
  task: ContinuityTask;
  decisions: ContinuityDecision[];
  uncertainties?: string[];
  verificationSummary?: string[];
}

export interface ProjectContinuityResult {
  projectId: string;
  alias: string;
  recordVersion: number;
  worktree: StoredWorktreeIdentity;
  localState: ContinuityLocalState;
  publishedState: ContinuityPublishedState;
  currentRecord: ContinuitySemanticRecord;
}

export type ProjectRegistrationResult = ProjectContinuityResult;
export type ProjectCheckpointResult = ProjectContinuityResult;
export type ProjectContextResult = ProjectContinuityResult;

export interface ProjectContinuityServiceOptions {
  store: ContinuityStore;
  inspector: ContinuityGitInspector;
  authority: AuthorityManager;
  homeDir: string;
}

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameCanonicalRootSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((entry, index) => entry === sortedRight[index]);
}

function continuityResult(project: StoredProject): ProjectContinuityResult {
  return {
    projectId: project.id,
    alias: project.alias,
    recordVersion: project.currentRecord.recordVersion,
    worktree: project.worktree,
    localState: project.localState,
    publishedState: project.publishedState,
    currentRecord: project.currentRecord,
  };
}

export class ProjectContinuityService {
  private readonly store: ContinuityStore;
  private readonly inspector: ContinuityGitInspector;
  private readonly authority: AuthorityManager;
  private readonly homeDir: string;

  constructor(options: ProjectContinuityServiceOptions) {
    this.store = options.store;
    this.inspector = options.inspector;
    this.authority = options.authority;
    this.homeDir = options.homeDir;
  }

  async register(input: ProjectRegisterInput): Promise<ProjectRegistrationResult> {
    const roots = await canonicalizeProjectRoots(this.homeDir, input.projectRoots);
    let canonicalWorktree: string;
    try {
      canonicalWorktree = await realpath(path.resolve(input.worktreePath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new ContinuityWorktreeInvalidError(
        "The project worktree path could not be resolved.",
        typeof code === "string" ? { path: input.worktreePath, causeCode: code } : { path: input.worktreePath },
      );
    }

    if (!roots.some((root) => pathIsInside(root, canonicalWorktree))) {
      throw new AuthorityDeniedError("The project worktree must be inside one of the registered Project roots.", {
        worktreePath: canonicalWorktree,
      });
    }

    const inspection = await this.inspector.inspect(canonicalWorktree);
    const stored = this.store.register({
      id: randomUUID(),
      alias: input.alias,
      roots,
      worktree: inspection.identity,
      localState: inspection.local,
      publishedState: inspection.published,
      semantic: {
        task: input.task,
        decisions: input.decisions ?? [],
        uncertainties: input.uncertainties ?? [],
        verificationSummary: input.verificationSummary ?? [],
      },
    });
    return continuityResult(stored);
  }

  async checkpoint(input: ProjectCheckpointInput): Promise<ProjectCheckpointResult> {
    const stored = this.store.getByAlias(input.alias);
    this.requireRegisteredProjectLease(input.authorityLeaseId, stored.roots);
    const inspection = await this.inspector.verifyIdentity(
      stored.worktree.canonicalPath,
      stored.worktree,
      stored.publishedState,
    );

    this.store.checkpoint({
      projectId: stored.id,
      expectedRecordVersion: input.expectedRecordVersion,
      semantic: {
        task: input.task,
        decisions: input.decisions,
        uncertainties: input.uncertainties ?? [],
        verificationSummary: input.verificationSummary ?? [],
      },
      localState: inspection.local,
      publishedState: inspection.published,
      checkedAt: inspection.local.checkedAt,
    });
    return continuityResult(this.store.getByAlias(stored.alias));
  }

  async contextRead(input: { authorityLeaseId: string; alias: string }): Promise<ProjectContextResult> {
    const stored = this.store.getByAlias(input.alias);
    this.requireRegisteredProjectLease(input.authorityLeaseId, stored.roots);
    return continuityResult(stored);
  }

  private requireRegisteredProjectLease(leaseId: string, storedRoots: string[]): void {
    const lease = this.authority.resolve(leaseId);
    if (lease.profile !== "project" || !sameCanonicalRootSet(lease.roots, storedRoots)) {
      throw new AuthorityDeniedError("Project continuity requires a Project lease for the exact registered roots.");
    }
  }
}
