import { describe, expect, it } from "vitest";
import {
  buildResumePackage,
  type ResumePackageInput,
} from "../src/continuity-resume-package.js";

function fixture(): ResumePackageInput {
  const checkedAt = "2026-09-11T02:30:00.000Z";
  const record = {
    recordVersion: 2,
    task: {
      goal: "Resume the exact registered project in a new normal chat.",
      constraints: ["Keep the exact worktree.", "Never auto-escalate to Admin."],
      successCriteria: ["Resume by alias.", "Return the exact next step."],
      status: "active" as const,
      nextStep: "Implement the bounded resume package.",
      detail: "Current task detail remains part of the semantic record.",
    },
    decisions: [{
      decision: "Use a fresh Project lease on every resume.",
      rationale: "Old authority must never be reused across chats.",
      alternatives: ["Reuse the prior lease"],
      evidence: ["Continuity design v1"],
      validWhile: "Project authority remains the least-privilege execution scope.",
    }],
    uncertainties: ["Automatic app invocation is platform-dependent."],
    verificationSummary: ["Continuity store, Git inspector, and checkpoint tests are green."],
    createdAt: "2026-09-11T02:20:00.000Z",
  };
  const worktree = {
    canonicalPath: "/private/tmp/project-x",
    repositoryRoot: "/private/tmp/project-x-repository",
    commonGitDir: "/private/tmp/project-x-repository/.git",
    gitDir: "/private/tmp/project-x-repository/.git/worktrees/project-x",
    repositoryIdentity: "a".repeat(64),
    worktreeIdentity: "b".repeat(64),
  };
  const localState = {
    checkedAt,
    branch: "feature/project-x",
    headSha: "c".repeat(40),
    stagedPaths: ["src/a.ts"],
    unstagedPaths: ["src/b.ts"],
    untrackedPaths: ["notes.txt"],
    pathsTruncated: false,
  };
  const publishedState = {
    remoteName: "origin" as const,
    branch: {
      status: "verified" as const,
      ref: "refs/heads/feature/project-x",
      currentSha: "d".repeat(40),
      checkedAt,
      lastVerifiedSha: "d".repeat(40),
      lastVerifiedAt: checkedAt,
    },
    main: {
      status: "unverified" as const,
      ref: "refs/heads/main",
      checkedAt,
      lastVerifiedSha: "e".repeat(40),
      lastVerifiedAt: "2026-09-11T02:00:00.000Z",
      reason: "remote_error" as const,
    },
  };
  const project = {
    id: "project-123",
    alias: "Project-X",
    aliasKey: "project-x",
    roots: ["/private/tmp"],
    worktree,
    localState,
    publishedState,
    currentRecord: record,
    createdAt: "2026-09-11T02:10:00.000Z",
    updatedAt: "2026-09-11T02:20:00.000Z",
  };

  return {
    project,
    record,
    inspection: {
      identity: worktree,
      local: localState,
      published: publishedState,
    },
  };
}

describe("buildResumePackage", () => {
  it("builds deterministic complete current-project context for a small record", () => {
    const input = fixture();

    const first = buildResumePackage(input, 12_000);
    const second = buildResumePackage(input, 12_000);

    expect(first).toEqual(second);
    expect(first.truncated).toBe(false);
    expect(first.contextAvailable).toBe(false);
    expect(first.text.length).toBeLessThanOrEqual(12_000);
    expect(first.text).toContain("UNTRUSTED STORED PROJECT CONTEXT");
    expect(first.text).toContain("projectId: project-123");
    expect(first.text).toContain("recordVersion: 2");
    expect(first.text).toContain("goal: Resume the exact registered project in a new normal chat.");
    expect(first.text).toContain("constraint: Keep the exact worktree.");
    expect(first.text).toContain("successCriterion: Return the exact next step.");
    expect(first.text).toContain("status: active");
    expect(first.text).toContain("nextStep: Implement the bounded resume package.");
    expect(first.text).toContain("worktree: /private/tmp/project-x");
    expect(first.text).toContain("branch: feature/project-x");
    expect(first.text).toContain(`HEAD: ${"c".repeat(40)}`);
    expect(first.text).toContain("staged: src/a.ts");
    expect(first.text).toContain("unstaged: src/b.ts");
    expect(first.text).toContain("untracked: notes.txt");
    expect(first.text).toContain("branchPublished: verified");
    expect(first.text).toContain("mainPublished: unverified");
    expect(first.text).toContain(`lastVerifiedSha: ${"e".repeat(40)}`);
    expect(first.text).toContain("decision: Use a fresh Project lease on every resume.");
    expect(first.text).toContain("rationale: Old authority must never be reused across chats.");
    expect(first.text).toContain("uncertainty: Automatic app invocation is platform-dependent.");
    expect(first.text).toContain("verification: Continuity store, Git inspector, and checkpoint tests are green.");
  });

  it("omits oversized optional detail deterministically and preserves a bounded current-context escape hatch", () => {
    const input = fixture();
    input.record.task.detail = "detail-".repeat(5_000);
    input.record.decisions = Array.from({ length: 20 }, (_, index) => ({
      decision: `Decision ${index} ${"x".repeat(1_000)}`,
      rationale: `Rationale ${index} ${"y".repeat(1_500)}`,
      alternatives: [`Alternative ${index} ${"z".repeat(600)}`],
      evidence: [`Evidence ${index} ${"e".repeat(600)}`],
    }));
    input.record.uncertainties = Array.from({ length: 20 }, (_, index) => `Uncertainty ${index} ${"u".repeat(1_000)}`);
    input.record.verificationSummary = Array.from({ length: 20 }, (_, index) => `Verification ${index} ${"v".repeat(1_000)}`);
    input.project.currentRecord = input.record;

    const first = buildResumePackage(input, 12_000);
    const second = buildResumePackage(input, 12_000);

    expect(first).toEqual(second);
    expect(first.text.length).toBeLessThanOrEqual(12_000);
    expect(first.truncated).toBe(true);
    expect(first.contextAvailable).toBe(true);
    expect(first.text).toContain("[CONTINUITY_TRUNCATED projectId=project-123 recordVersion=2]");
    expect(first.text).toContain("project_context_read");
    expect(first.text).toContain("nextStep: Implement the bounded resume package.");
    expect(first.text).not.toContain("detail-detail-detail-detail-detail-detail-detail-detail-detail-detail");
  });
});
