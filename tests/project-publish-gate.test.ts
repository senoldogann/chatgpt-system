import { describe, expect, it, vi } from "vitest";
import type { ContinuityResumeContext } from "../src/continuity/continuity-resume-registry.js";
import type { GitResult } from "../src/git/git-service.js";
import type { ProjectCheckStatus, ProjectCheckView } from "../src/project/project-check-types.js";
import { ProjectPublishGate } from "../src/project/project-publish-gate.js";

const VERIFIED_HEAD = "a".repeat(40);
const DIGEST = "b".repeat(64);

function gitResult(stdout: string, exitCode = 0): GitResult {
  return { cwd: "/repo", exitCode, stdout, stderr: "" };
}

function context(): ContinuityResumeContext {
  return {
    projectId: "project-1",
    alias: "Project-X",
    recordVersion: 4,
    canonicalWorktree: "/repo",
    repositoryRoot: "/main-checkout",
    repositoryIdentity: "c".repeat(64),
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

function report(overallStatus: ProjectCheckStatus = "PASS", repositoryRoot = "/repo"): ProjectCheckView {
  return {
    operation: "report",
    repositoryRoot,
    required: true,
    overallStatus,
    observed: { head: VERIFIED_HEAD, workingTreeDigest: DIGEST },
    checks: [],
  };
}

function fixture(options: { statuses?: string[]; verification?: ProjectCheckView } = {}) {
  const statuses = [...(options.statuses ?? ["## feature/x\n", "## feature/x\n"])];
  const projectGit = {
    status: vi.fn(async () => gitResult(statuses.shift() ?? "## feature/x\n")),
  };
  const adminGit = {
    push: vi.fn(async () => gitResult("ok\n")),
  };
  const projectCheck = {
    report: vi.fn(async () => options.verification ?? report()),
  };
  const gate = new ProjectPublishGate({ projectGit, adminGit, projectCheck });
  return { gate, projectGit, adminGit, projectCheck };
}

describe("ProjectPublishGate", () => {
  it("requires an exact resumed Project context", async () => {
    const { gate } = fixture();
    await expect(gate.push({ cwd: "." })).rejects.toMatchObject({ code: "PROJECT_RESUME_REQUIRED" });
  });

  it("denies main publication", async () => {
    const { gate } = fixture({ statuses: ["## main\n"] });
    await expect(gate.push({ cwd: ".", resumeContext: context() })).rejects.toMatchObject({ code: "MAIN_PUSH_DENIED" });
  });

  it.each([
    ["unstaged", "## feature/x\n M src/app.ts\n"],
    ["staged", "## feature/x\nM  src/app.ts\n"],
    ["untracked", "## feature/x\n?? tmp.txt\n"],
    ["untracked ownership metadata", "## feature/x\n?? .freebuff/other\n"],
  ])("denies a %s working tree", async (_label, status) => {
    const { gate } = fixture({ statuses: [status] });
    await expect(gate.push({ cwd: ".", resumeContext: context() })).rejects.toMatchObject({ code: "WORKTREE_NOT_CLEAN" });
  });

  it("allows the single user-owned .freebuff project identity file", async () => {
    const { gate, adminGit } = fixture({ statuses: ["## feature/x\n?? .freebuff/project-id\n", "## feature/x\n?? .freebuff/project-id\n"] });
    await expect(gate.push({ cwd: ".", resumeContext: context() })).resolves.toMatchObject({ exitCode: 0 });
    expect(adminGit.push).toHaveBeenCalled();
  });

  it.each(["NOT_RUN", "FAIL", "UNAVAILABLE"] as const)(
    "requires passing verification when report status is %s",
    async (overallStatus) => {
      const { gate } = fixture({ verification: report(overallStatus) });
      await expect(gate.push({ cwd: ".", resumeContext: context() })).rejects.toMatchObject({
        code: "LOCAL_VERIFICATION_REQUIRED",
        details: { overallStatus },
      });
    },
  );

  it("distinguishes stale verification", async () => {
    const { gate } = fixture({ verification: report("STALE") });
    await expect(gate.push({ cwd: ".", resumeContext: context() })).rejects.toMatchObject({ code: "LOCAL_VERIFICATION_STALE" });
  });

  it("rejects verification from a different worktree", async () => {
    const { gate } = fixture({ verification: report("PASS", "/other-worktree") });
    await expect(gate.push({ cwd: ".", resumeContext: context() })).rejects.toMatchObject({ code: "PROJECT_RESUME_REQUIRED" });
  });

  it("rejects a branch change after verification", async () => {
    const { gate } = fixture({ statuses: ["## feature/x\n", "## feature/y\n"] });
    await expect(gate.push({ cwd: ".", resumeContext: context() })).rejects.toMatchObject({ code: "LOCAL_VERIFICATION_STALE" });
  });

  it("publishes only the exact clean branch and verified HEAD", async () => {
    const { gate, adminGit, projectCheck } = fixture();
    const result = await gate.push({ cwd: ".", resumeContext: context() });

    expect(projectCheck.report).toHaveBeenCalledWith(".");
    expect(adminGit.push).toHaveBeenCalledWith(".", { branch: "feature/x", head: VERIFIED_HEAD });
    expect(result.exitCode).toBe(0);
  });
});
