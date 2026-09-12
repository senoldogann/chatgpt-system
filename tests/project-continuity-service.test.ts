import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityManager } from "../src/authority.js";
import { ContinuityGitInspector } from "../src/continuity-git-inspector.js";
import { ContinuityStore } from "../src/continuity-store.js";
import { ProjectContinuityService } from "../src/project-continuity-service.js";

const execFileAsync = promisify(execFile);
const cleanups: string[] = [];

class TrackingAuthorityManager extends AuthorityManager {
  readonly startedLeaseIds: string[] = [];

  override async start(request: Parameters<AuthorityManager["start"]>[0]) {
    const lease = await super.start(request);
    this.startedLeaseIds.push(lease.leaseId);
    return lease;
  }
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", [...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

interface ServiceFixture {
  root: string;
  home: string;
  projectRoot: string;
  repository: string;
  worktree: string;
  secondWorktree: string;
  otherRoot: string;
  store: ContinuityStore;
  inspector: ContinuityGitInspector;
  service: ProjectContinuityService;
  authority: TrackingAuthorityManager;
  authorityStarts: { count: number };
}

async function createFixture(): Promise<ServiceFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-project-continuity-"));
  cleanups.push(root);
  const home = path.join(root, "home");
  const projectRoot = path.join(home, "project-x");
  const repository = path.join(projectRoot, "repository");
  const worktree = path.join(projectRoot, "worktree");
  const secondWorktree = path.join(projectRoot, "worktree-2");
  const otherRoot = path.join(home, "other-project");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(otherRoot, { recursive: true });

  await git(projectRoot, ["init", "-b", "main", repository]);
  await git(repository, ["config", "user.name", "Continuity Test"]);
  await git(repository, ["config", "user.email", "continuity@example.test"]);
  await writeFile(path.join(repository, "tracked.txt"), "initial\n");
  await git(repository, ["add", "tracked.txt"]);
  await git(repository, ["commit", "-m", "initial"]);
  await git(repository, ["worktree", "add", "-b", "feature/x", worktree]);
  await git(repository, ["worktree", "add", "-b", "feature/y", secondWorktree]);

  const authorityStarts = { count: 0 };
  const authority = new TrackingAuthorityManager({
    homeDir: home,
    commands: ["git", "node"],
    terminalEnabled: true,
    audit: (event) => {
      if (event.event === "authority.start") authorityStarts.count += 1;
    },
  });
  const store = new ContinuityStore({ databasePath: path.join(root, "state", "continuity.db") });
  const inspector = new ContinuityGitInspector({
    maxTrackedPaths: 100,
    remoteVerificationTimeoutMs: 2_000,
    maxCommandOutputBytes: 1_048_576,
  });
  const service = new ProjectContinuityService({
    store,
    inspector,
    authority,
    homeDir: home,
    maxResumeChars: 12_000,
  });

  return {
    root,
    home,
    projectRoot,
    repository,
    worktree,
    secondWorktree,
    otherRoot,
    store,
    inspector,
    service,
    authority,
    authorityStarts,
  };
}

function registrationInput(fixture: ServiceFixture, overrides: Partial<Parameters<ProjectContinuityService["register"]>[0]> = {}) {
  return {
    alias: "Project-X",
    worktreePath: fixture.worktree,
    projectRoots: [fixture.projectRoot],
    task: {
      goal: "Resume Project-X in a new chat.",
      constraints: ["Preserve the exact worktree."],
      successCriteria: ["Resume by alias without a pasted chat summary."],
      status: "active" as const,
      nextStep: "Implement project registration.",
    },
    decisions: [{
      decision: "Use exact worktree identity.",
      rationale: "Path equality alone is insufficient.",
      alternatives: ["Path-only lookup"],
      evidence: ["Continuity design v1"],
    }],
    uncertainties: [],
    verificationSummary: ["Task 2 Git inspector tests are green."],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("ProjectContinuityService registration", () => {
  it("registers exact worktree state without creating an authority lease", async () => {
    const fixture = await createFixture();

    const result = await fixture.service.register(registrationInput(fixture));

    expect(result).toMatchObject({
      alias: "Project-X",
      recordVersion: 1,
      localState: {
        branch: "feature/x",
        headSha: expect.stringMatching(/^[a-f0-9]{40,64}$/),
      },
    });
    expect(result.currentRecord.task.goal).toBe("Resume Project-X in a new chat.");
    expect(result.currentRecord.decisions[0]?.rationale).toBe("Path equality alone is insufficient.");
    expect(fixture.authorityStarts.count).toBe(0);
    expect(fixture.store.getByAlias("project-x").worktree.canonicalPath).toBe(result.worktree.canonicalPath);
    fixture.store.close();
  });

  it("rejects missing, broad, and out-of-scope worktrees", async () => {
    const fixture = await createFixture();

    await expect(fixture.service.register(registrationInput(fixture, {
      alias: "Missing",
      worktreePath: path.join(fixture.projectRoot, "missing-worktree"),
    }))).rejects.toMatchObject({ code: "CONTINUITY_WORKTREE_INVALID" });

    await expect(fixture.service.register(registrationInput(fixture, {
      alias: "Broad",
      projectRoots: [fixture.home],
    }))).rejects.toMatchObject({ code: "AUTHORITY_DENIED" });

    await expect(fixture.service.register(registrationInput(fixture, {
      alias: "Outside",
      projectRoots: [fixture.otherRoot],
    }))).rejects.toMatchObject({ code: "AUTHORITY_DENIED" });
    expect(fixture.authorityStarts.count).toBe(0);
    fixture.store.close();
  });

  it("rejects a duplicate normalized alias even for a different valid worktree", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));

    await expect(fixture.service.register(registrationInput(fixture, {
      alias: " project-x ",
      worktreePath: fixture.secondWorktree,
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    fixture.store.close();
  });

  it("requires the exact Project lease for checkpoint and current-record reads", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));
    const validLease = await fixture.authority.start({ profile: "project", projectRoots: [fixture.projectRoot] });
    const wrongProjectLease = await fixture.authority.start({ profile: "project", projectRoots: [fixture.otherRoot] });
    const userLease = await fixture.authority.start({ profile: "user" });
    const adminLease = await fixture.authority.start({ profile: "admin" });
    const checkpoint = {
      authorityLeaseId: validLease.leaseId,
      alias: "project-x",
      expectedRecordVersion: 1,
      task: {
        ...registrationInput(fixture).task,
        nextStep: "Checkpoint the active continuity task.",
      },
      decisions: registrationInput(fixture).decisions ?? [],
      uncertainties: ["Remote origin is not configured."],
      verificationSummary: ["Registration integration is green."],
    };

    for (const lease of [wrongProjectLease, userLease, adminLease]) {
      await expect(fixture.service.checkpoint({
        ...checkpoint,
        authorityLeaseId: lease.leaseId,
      })).rejects.toMatchObject({ code: "AUTHORITY_DENIED" });
      await expect(fixture.service.contextRead({
        authorityLeaseId: lease.leaseId,
        alias: "project-x",
      })).rejects.toMatchObject({ code: "AUTHORITY_DENIED" });
    }

    await writeFile(path.join(fixture.worktree, "tracked.txt"), "changed after registration\n");
    const version2 = await fixture.service.checkpoint(checkpoint);
    expect(version2.recordVersion).toBe(2);
    expect(version2.currentRecord.task.nextStep).toBe("Checkpoint the active continuity task.");
    expect(version2.localState.unstagedPaths).toContain("tracked.txt");

    const current = await fixture.service.contextRead({
      authorityLeaseId: validLease.leaseId,
      alias: "PROJECT-X",
    });
    expect(current.recordVersion).toBe(2);
    expect(current.currentRecord).toEqual(version2.currentRecord);

    await expect(fixture.service.checkpoint({
      ...checkpoint,
      task: { ...checkpoint.task, nextStep: "A stale writer must not win." },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.store.getByAlias("project-x").currentRecord.recordVersion).toBe(2);
    fixture.store.close();
  });

  it("re-verifies stored worktree identity before checkpointing", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));
    const lease = await fixture.authority.start({ profile: "project", projectRoots: [fixture.projectRoot] });

    await git(fixture.repository, ["worktree", "remove", "--force", fixture.worktree]);
    await git(fixture.repository, ["worktree", "add", "-b", "feature/replacement", fixture.worktree]);

    await expect(fixture.service.checkpoint({
      authorityLeaseId: lease.leaseId,
      alias: "project-x",
      expectedRecordVersion: 1,
      task: registrationInput(fixture).task,
      decisions: registrationInput(fixture).decisions ?? [],
    })).rejects.toMatchObject({ code: "CONTINUITY_WORKTREE_MISMATCH" });
    expect(fixture.store.getByAlias("project-x").currentRecord.recordVersion).toBe(1);
    fixture.store.close();
  });

  it("resumes the same project with a fresh Project lease on every call", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));
    await writeFile(path.join(fixture.worktree, "tracked.txt"), "changed before resume\n");
    const canonicalRoot = await realpath(fixture.projectRoot);

    const first = await fixture.service.resume({ alias: "project-x", requestedTtlSeconds: 120 });
    const second = await fixture.service.resume({ alias: "Project-X", requestedTtlSeconds: 120 });

    expect(first.authorityLease.profile).toBe("project");
    expect(second.authorityLease.profile).toBe("project");
    expect(first.authorityLease.leaseId).not.toBe(second.authorityLease.leaseId);
    expect(first.authorityLease.roots).toEqual([canonicalRoot]);
    expect(second.authorityLease.roots).toEqual([canonicalRoot]);
    expect(first.resumePackage).toContain("nextStep: Implement project registration.");
    expect(first.resumePackage).toContain(`worktree: ${await realpath(fixture.worktree)}`);
    expect(first.resumePackage).toContain("unstaged: tracked.txt");
    expect(fixture.store.getByAlias("project-x").currentRecord.recordVersion).toBe(1);
    expect(fixture.store.getByAlias("project-x").localState.unstagedPaths).toContain("tracked.txt");
    expect(fixture.authority.startedLeaseIds.slice(-2)).toEqual([
      first.authorityLease.leaseId,
      second.authorityLease.leaseId,
    ]);

    fixture.authority.end(first.authorityLease.leaseId);
    fixture.authority.end(second.authorityLease.leaseId);
    fixture.store.close();
  });

  it("revokes only the fresh lease when resume fails after authority creation", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));
    const failingService = new ProjectContinuityService({
      store: fixture.store,
      inspector: fixture.inspector,
      authority: fixture.authority,
      homeDir: fixture.home,
      maxResumeChars: 12_000,
      packageBuilder: () => {
        throw new Error("package assembly failed");
      },
    });
    const before = fixture.authority.startedLeaseIds.length;

    await expect(failingService.resume({ alias: "project-x" })).rejects.toThrow("package assembly failed");

    expect(fixture.authority.startedLeaseIds).toHaveLength(before + 1);
    const failedLeaseId = fixture.authority.startedLeaseIds.at(-1);
    expect(failedLeaseId).toBeDefined();
    expect(() => fixture.authority.status(failedLeaseId!)).toThrowError(
      expect.objectContaining({ code: "AUTHORITY_REQUIRED" }),
    );
    fixture.store.close();
  });

  it("preserves the primary resume failure when the fresh lease was already revoked", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));
    const failingService = new ProjectContinuityService({
      store: fixture.store,
      inspector: fixture.inspector,
      authority: fixture.authority,
      homeDir: fixture.home,
      maxResumeChars: 12_000,
      packageBuilder: () => {
        const leaseId = fixture.authority.startedLeaseIds.at(-1);
        if (leaseId !== undefined) fixture.authority.end(leaseId);
        throw new Error("package assembly failed after external revocation");
      },
    });

    await expect(failingService.resume({ alias: "project-x" })).rejects.toThrow(
      "package assembly failed after external revocation",
    );
    fixture.store.close();
  });

  it("does not create a lease when strict worktree verification fails before resume authority", async () => {
    const fixture = await createFixture();
    await fixture.service.register(registrationInput(fixture));
    const before = fixture.authority.startedLeaseIds.length;
    await git(fixture.repository, ["worktree", "remove", "--force", fixture.worktree]);

    await expect(fixture.service.resume({ alias: "project-x" })).rejects.toMatchObject({
      code: "CONTINUITY_WORKTREE_INVALID",
    });
    expect(fixture.authority.startedLeaseIds).toHaveLength(before);
    fixture.store.close();
  });
});
