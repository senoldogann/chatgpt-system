import path from "node:path";
import type { ContinuityResumeContext } from "./continuity-resume-registry.js";
import {
  LocalVerificationRequiredError,
  LocalVerificationStaleError,
  MainPushDeniedError,
  PolicyError,
  ProjectResumeRequiredError,
  WorktreeNotCleanError,
} from "./errors.js";
import { validateBranchName, type GitResult, type GitService } from "./git-service.js";
import type { ProjectCheckService } from "./project-check-service.js";

export interface ProjectPublishGateInput {
  cwd: string;
  resumeContext?: ContinuityResumeContext;
}

interface ProjectGitReader {
  status(cwd?: string): Promise<GitResult>;
}

interface AdminGitPublisher {
  push(cwd?: string, expected?: { branch: string; head: string }): Promise<GitResult>;
}

interface ProjectCheckReporter {
  report(cwd?: string): ReturnType<ProjectCheckService["report"]>;
}

const ALLOWED_UNTRACKED_OWNERSHIP_METADATA = "?? .freebuff/project-id";

function cleanBranch(result: GitResult): string {
  if (result.exitCode !== 0) throw new PolicyError("Git status failed before project publication.");
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  const changes = lines.slice(1).filter((line) => line !== ALLOWED_UNTRACKED_OWNERSHIP_METADATA);
  const header = lines[0];
  if (!header?.startsWith("## ")) throw new PolicyError("Git status did not report a named current branch.");
  if (changes.length > 0) throw new WorktreeNotCleanError();

  const summary = header.slice(3);
  let branch: string;
  if (summary.startsWith("No commits yet on ")) branch = summary.slice("No commits yet on ".length);
  else if (summary.startsWith("Initial commit on ")) branch = summary.slice("Initial commit on ".length);
  else branch = summary.split("...", 1)[0] ?? "";
  if (!branch || branch.startsWith("HEAD ") || branch === "HEAD") {
    throw new PolicyError("Git push requires a named current branch.");
  }
  return validateBranchName(branch.trim());
}

export class ProjectPublishGate {
  constructor(private readonly options: {
    projectGit: ProjectGitReader | Pick<GitService, "status">;
    adminGit: AdminGitPublisher | Pick<GitService, "push">;
    projectCheck: ProjectCheckReporter | Pick<ProjectCheckService, "report">;
  }) {}

  async push(input: ProjectPublishGateInput): Promise<GitResult> {
    const resumeContext = input.resumeContext;
    if (!resumeContext) throw new ProjectResumeRequiredError();

    const branch = cleanBranch(await this.options.projectGit.status(input.cwd));
    if (branch === "main") throw new MainPushDeniedError();

    const verification = await this.options.projectCheck.report(input.cwd);
    if (path.resolve(verification.repositoryRoot) !== path.resolve(resumeContext.canonicalWorktree)) {
      throw new ProjectResumeRequiredError("The active verification worktree does not match the resumed project worktree.");
    }
    if (verification.overallStatus === "STALE") throw new LocalVerificationStaleError();
    if (verification.overallStatus !== "PASS") {
      throw new LocalVerificationRequiredError(verification.overallStatus);
    }

    const currentBranch = cleanBranch(await this.options.projectGit.status(input.cwd));
    if (currentBranch !== branch) throw new LocalVerificationStaleError();

    return this.options.adminGit.push(input.cwd, {
      branch,
      head: verification.observed.head,
    });
  }
}
