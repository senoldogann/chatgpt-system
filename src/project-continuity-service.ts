import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  canonicalizeProjectRoots,
  type AuthorityLeaseView,
  type AuthorityManager,
} from "./authority.js";
import { ContinuityWorktreeInvalidError } from "./continuity-errors.js";
import {
  buildResumePackage,
  type ResumePackageInput,
} from "./continuity-resume-package.js";
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
import { AuthorityDeniedError, AuthorityRequiredError } from "./errors.js";

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

export interface ProjectResumeInput {
  alias: string;
  requestedTtlSeconds?: number;
}

export interface ProjectResumeResult {
  projectId: string;
  alias: string;
  recordVersion: number;
  authorityLease: AuthorityLeaseView;
  resumePackage: string;
  packageTruncated: boolean;
  contextAvailable: boolean;
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
  maxResumeChars: number;
  packageBuilder?: (input: ResumePackageInput, maxChars: number) => ReturnType<typeof buildResumePackage>;
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
  private readonly maxResumeChars: number;
  private readonly packageBuilder: (input: ResumePackageInput, maxChars: number) => ReturnType<typeof buildResumePackage>;

  constructor(options: ProjectContinuityServiceOptions) {
    this.store = options.store;
    this.inspector = options.inspector;
    this.authority = options.authority;
    this.homeDir = options.homeDir;
    this.maxResumeChars = options.maxResumeChars;
    this.packageBuilder = options.packageBuilder ?? buildResumePackage;
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

  async resume(input: ProjectResumeInput): Promise<ProjectResumeResult> {
    const project = this.store.getByAlias(input.alias);
    const revalidatedRoots = await canonicalizeProjectRoots(this.homeDir, project.roots);
    if (!sameCanonicalRootSet(revalidatedRoots, project.roots)) {
      throw new AuthorityDeniedError("Stored Project roots no longer resolve to the registered root set.");
    }

    const inspection = await this.inspector.verifyIdentity(
      project.worktree.canonicalPath,
      project.worktree,
      project.publishedState,
    );
    const authorityLease = await this.authority.start({
      profile: "project",
      projectRoots: revalidatedRoots,
      ...(input.requestedTtlSeconds !== undefined
        ? { requestedTtlSeconds: input.requestedTtlSeconds }
        : {}),
    });

    try {
      const packaged = this.packageBuilder(
        { project, record: project.currentRecord, inspection },
        this.maxResumeChars,
      );
      this.store.updateOperationalState(
        project.id,
        inspection.local,
        inspection.published,
        inspection.local.checkedAt,
      );
      return {
        projectId: project.id,
        alias: project.alias,
        recordVersion: project.currentRecord.recordVersion,
        authorityLease,
        resumePackage: packaged.text,
        packageTruncated: packaged.truncated,
        contextAvailable: packaged.contextAvailable,
      };
    } catch (error) {
      let rollbackError: unknown;
      try {
        this.authority.end(authorityLease.leaseId);
      } catch (candidate) {
        if (!(candidate instanceof AuthorityRequiredError)) rollbackError = candidate;
      }
      await this.authority.flushAudit();
      if (rollbackError !== undefined) {
        throw new AggregateError(
          [error, rollbackError],
          "Project resume failed and fresh authority rollback also failed.",
        );
      }
      throw error;
    }
  }

  private requireRegisteredProjectLease(leaseId: string, storedRoots: string[]): void {
    const lease = this.authority.resolve(leaseId);
    if (lease.profile !== "project" || !sameCanonicalRootSet(lease.roots, storedRoots)) {
      throw new AuthorityDeniedError("Project continuity requires a Project lease for the exact registered roots.");
    }
  }
}
