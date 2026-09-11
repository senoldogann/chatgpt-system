import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { AuthorityManager } from "../src/authority.js";
import {
  ContinuityGitInspector,
  type ContinuityGitCommandResult,
} from "../src/continuity-git-inspector.js";
import { ContinuityStore } from "../src/continuity-store.js";
import { FileSystemService } from "../src/fs-service.js";
import { PathPolicy } from "../src/policy.js";
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

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout;
}

async function testGitRunner(
  cwd: string,
  args: readonly string[],
  timeoutMs: number | undefined,
): Promise<ContinuityGitCommandResult> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "buffer",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: string | number;
      stdout?: Buffer;
      stderr?: Buffer;
      killed?: boolean;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? Buffer.alloc(0),
      stderr: failure.stderr ?? Buffer.alloc(0),
      timedOut: failure.killed === true,
    };
  }
}

interface IntegrationFixture {
  root: string;
  home: string;
  projectRoot: string;
  repository: string;
  worktree: string;
  secondWorktree: string;
  origin: string;
  databasePath: string;
}

async function createFixture(withOrigin = true): Promise<IntegrationFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-integration-"));
  cleanups.push(root);
  const home = path.join(root, "home");
  const projectRoot = path.join(home, "project-x");
  const repository = path.join(projectRoot, "repository");
  const worktree = path.join(projectRoot, "worktree");
  const secondWorktree = path.join(projectRoot, "worktree-2");
  const origin = path.join(root, "origin.git");
  const databasePath = path.join(root, "state", "continuity.db");
  await mkdir(projectRoot, { recursive: true });

  await git(projectRoot, ["init", "-b", "main", repository]);
  await git(repository, ["config", "user.name", "Continuity Integration"]);
  await git(repository, ["config", "user.email", "continuity-integration@example.test"]);
  await writeFile(path.join(repository, "tracked.txt"), "initial\n");
  await git(repository, ["add", "tracked.txt"]);
  await git(repository, ["commit", "-m", "initial"]);
  await git(repository, ["worktree", "add", "-b", "feature/x", worktree]);
  await git(repository, ["worktree", "add", "-b", "feature/y", secondWorktree]);

  if (withOrigin) {
    await git(root, ["init", "--bare", origin]);
    await git(repository, ["remote", "add", "origin", origin]);
    await git(repository, ["push", "origin", "main"]);
    await git(worktree, ["push", "-u", "origin", "feature/x"]);
  }

  return { root, home, projectRoot, repository, worktree, secondWorktree, origin, databasePath };
}

function createAuthority(fixture: IntegrationFixture): TrackingAuthorityManager {
  return new TrackingAuthorityManager({
    homeDir: fixture.home,
    commands: ["git", "node"],
    terminalEnabled: true,
  });
}

function createInspector(overrides: Partial<ConstructorParameters<typeof ContinuityGitInspector>[0]> = {}) {
  return new ContinuityGitInspector({
    maxTrackedPaths: 100,
    remoteVerificationTimeoutMs: 2_000,
    maxCommandOutputBytes: 1_048_576,
    ...overrides,
  });
}

function createService(
  fixture: IntegrationFixture,
  store: ContinuityStore,
  authority: TrackingAuthorityManager,
  inspector = createInspector(),
  packageBuilder?: ConstructorParameters<typeof ProjectContinuityService>[0]["packageBuilder"],
): ProjectContinuityService {
  return new ProjectContinuityService({
    store,
    inspector,
    authority,
    homeDir: fixture.home,
    maxResumeChars: 12_000,
    ...(packageBuilder !== undefined ? { packageBuilder } : {}),
  });
}

function registrationInput(fixture: IntegrationFixture) {
  return {
    alias: "Project-X",
    worktreePath: fixture.worktree,
    projectRoots: [fixture.projectRoot],
    task: {
      goal: "Resume Project-X after a process-like restart.",
      constraints: ["Preserve the exact registered worktree."],
      successCriteria: ["A new chat resumes by alias without a pasted summary."],
      status: "active" as const,
      nextStep: "Create the restart checkpoint.",
      detail: "Current critical task detail must survive restart.",
    },
    decisions: [{
      decision: "Bind continuity to exact worktree identity.",
      rationale: "Path equality alone cannot detect replacement.",
      alternatives: ["Path-only lookup"],
      evidence: ["Real Git linked-worktree identity"],
      validWhile: "The project remains registered to this worktree.",
    }],
    uncertainties: ["Remote availability can change independently of local truth."],
    verificationSummary: ["Continuity integration fixture created."],
  };
}

async function registerAndCheckpointVersion2(
  fixture: IntegrationFixture,
  store: ContinuityStore,
  authority: TrackingAuthorityManager,
  service: ProjectContinuityService,
) {
  await service.register(registrationInput(fixture));
  const lease = await authority.start({ profile: "project", projectRoots: [fixture.projectRoot] });
  const version2 = await service.checkpoint({
    authorityLeaseId: lease.leaseId,
    alias: "project-x",
    expectedRecordVersion: 1,
    task: {
      ...registrationInput(fixture).task,
      nextStep: "Resume from version 2 in a fresh service instance.",
    },
    decisions: registrationInput(fixture).decisions,
    uncertainties: registrationInput(fixture).uncertainties,
    verificationSummary: ["Version 2 checkpoint persisted."],
  });
  return { lease, version2, project: store.getByAlias("project-x") };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("Project Continuity v1 integration hardening", () => {
  it("persists semantic context and exact worktree identity across a process-like restart", async () => {
    const fixture = await createFixture();
    const firstStore = new ContinuityStore({ databasePath: fixture.databasePath });
    const firstAuthority = createAuthority(fixture);
    const firstService = createService(fixture, firstStore, firstAuthority);
    const { lease: oldLease, version2, project: beforeRestart } = await registerAndCheckpointVersion2(
      fixture,
      firstStore,
      firstAuthority,
      firstService,
    );
    expect(version2.recordVersion).toBe(2);
    firstStore.close();

    const restartedStore = new ContinuityStore({ databasePath: fixture.databasePath });
    const restartedAuthority = createAuthority(fixture);
    const restartedService = createService(fixture, restartedStore, restartedAuthority);
    const resumed = await restartedService.resume({ alias: "PROJECT-X", requestedTtlSeconds: 120 });
    const afterRestart = restartedStore.getByAlias("project-x");

    expect(resumed.recordVersion).toBe(2);
    expect(resumed.authorityLease.profile).toBe("project");
    expect(resumed.authorityLease.leaseId).not.toBe(oldLease.leaseId);
    expect(afterRestart.currentRecord.task.goal).toBe(registrationInput(fixture).task.goal);
    expect(afterRestart.currentRecord.task.nextStep).toBe("Resume from version 2 in a fresh service instance.");
    expect(afterRestart.currentRecord.decisions[0]).toMatchObject({
      decision: "Bind continuity to exact worktree identity.",
      rationale: "Path equality alone cannot detect replacement.",
    });
    expect(afterRestart.worktree).toEqual(beforeRestart.worktree);
    expect(resumed.resumePackage).toContain("recordVersion: 2");
    expect(resumed.resumePackage).toContain("Resume from version 2 in a fresh service instance.");
    expect(resumed.resumePackage).toContain("Path equality alone cannot detect replacement.");

    restartedAuthority.end(resumed.authorityLease.leaseId);
    restartedStore.close();
  });

  it.each([
    "missing path",
    "unrelated repository replacement",
    "same-repository worktree replacement",
  ] as const)("fails closed without minting a lease when the registered worktree has %s", async (scenario) => {
    const fixture = await createFixture(false);
    const store = new ContinuityStore({ databasePath: fixture.databasePath });
    const authority = createAuthority(fixture);
    const service = createService(fixture, store, authority);
    await service.register(registrationInput(fixture));
    const beforeStarts = authority.startedLeaseIds.length;

    await git(fixture.repository, ["worktree", "remove", "--force", fixture.worktree]);
    if (scenario === "unrelated repository replacement") {
      await git(fixture.projectRoot, ["init", "-b", "main", fixture.worktree]);
      await git(fixture.worktree, ["config", "user.name", "Replacement Repo"]);
      await git(fixture.worktree, ["config", "user.email", "replacement@example.test"]);
      await writeFile(path.join(fixture.worktree, "replacement.txt"), "replacement\n");
      await git(fixture.worktree, ["add", "replacement.txt"]);
      await git(fixture.worktree, ["commit", "-m", "replacement"]);
    } else if (scenario === "same-repository worktree replacement") {
      await git(fixture.repository, ["worktree", "add", "-b", "feature/replacement", fixture.worktree]);
    }

    await expect(service.resume({ alias: "project-x" })).rejects.toMatchObject({
      code: expect.stringMatching(/^CONTINUITY_WORKTREE_(INVALID|MISMATCH)$/),
    });
    expect(authority.startedLeaseIds).toHaveLength(beforeStarts);
    expect(store.getByAlias("project-x").worktree.canonicalPath).toBe(await realpath(path.dirname(fixture.worktree)).then(
      (parent) => path.join(parent, path.basename(fixture.worktree)),
    ));
    store.close();
  });

  it("preserves last-good remote evidence and reports unverified when origin becomes unreachable after restart", async () => {
    const fixture = await createFixture(true);
    const firstStore = new ContinuityStore({ databasePath: fixture.databasePath });
    const firstAuthority = createAuthority(fixture);
    const firstService = createService(fixture, firstStore, firstAuthority);
    await firstService.register(registrationInput(fixture));
    const initial = firstStore.getByAlias("project-x");
    expect(initial.publishedState.branch.status).toBe("verified");
    expect(initial.publishedState.main.status).toBe("verified");
    const branchLastGood = initial.publishedState.branch.lastVerifiedSha;
    const mainLastGood = initial.publishedState.main.lastVerifiedSha;
    const branchLastGoodAt = initial.publishedState.branch.lastVerifiedAt;
    const mainLastGoodAt = initial.publishedState.main.lastVerifiedAt;
    firstStore.close();

    const offlineInspector = createInspector({
      runGit: async (cwd, args, timeoutMs) => {
        if (args.includes("ls-remote")) {
          return {
            exitCode: 1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from("network unavailable"),
            timedOut: true,
          };
        }
        return testGitRunner(cwd, args, timeoutMs);
      },
    });
    const restartedStore = new ContinuityStore({ databasePath: fixture.databasePath });
    const restartedAuthority = createAuthority(fixture);
    const restartedService = createService(fixture, restartedStore, restartedAuthority, offlineInspector);
    const resumed = await restartedService.resume({ alias: "project-x" });
    const refreshed = restartedStore.getByAlias("project-x");

    expect(refreshed.publishedState.branch).toMatchObject({
      status: "unverified",
      reason: "remote_error",
      lastVerifiedSha: branchLastGood,
      lastVerifiedAt: branchLastGoodAt,
    });
    expect(refreshed.publishedState.main).toMatchObject({
      status: "unverified",
      reason: "remote_error",
      lastVerifiedSha: mainLastGood,
      lastVerifiedAt: mainLastGoodAt,
    });
    expect(resumed.resumePackage).toContain("branchPublished: unverified");
    expect(resumed.resumePackage).toContain("mainPublished: unverified");
    expect(resumed.resumePackage).not.toContain("branchPublished: not_found");

    restartedAuthority.end(resumed.authorityLease.leaseId);
    restartedStore.close();
  });

  it("rejects corrupt bytes and schema-version mismatch without replacing the existing database", async () => {
    const fixture = await createFixture(false);
    await mkdir(path.dirname(fixture.databasePath), { recursive: true });
    const corruptBytes = Buffer.from("definitely-not-a-sqlite-database");
    await writeFile(fixture.databasePath, corruptBytes);

    expect(() => new ContinuityStore({ databasePath: fixture.databasePath })).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_DATABASE_INVALID" }),
    );
    expect(await readFile(fixture.databasePath)).toEqual(corruptBytes);

    const schemaPath = path.join(fixture.root, "state", "unsupported.db");
    const raw = new Database(schemaPath);
    raw.exec(`
      CREATE TABLE continuity_meta (schema_version INTEGER NOT NULL);
      CREATE TABLE projects (sentinel TEXT);
      CREATE TABLE worktrees (sentinel TEXT);
      CREATE TABLE continuity_records (sentinel TEXT);
    `);
    raw.prepare("INSERT INTO continuity_meta (schema_version) VALUES (?)").run(999);
    raw.close();

    expect(() => new ContinuityStore({ databasePath: schemaPath })).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_DATABASE_INVALID" }),
    );
    const readonly = new Database(schemaPath, { readonly: true });
    expect(readonly.prepare("SELECT schema_version FROM continuity_meta").pluck().get()).toBe(999);
    expect(readonly.prepare("PRAGMA table_info(projects)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sentinel" })]),
    );
    readonly.close();
  });

  it("rejects a stale chat checkpoint and preserves version 3 across restart", async () => {
    const fixture = await createFixture(false);
    const store = new ContinuityStore({ databasePath: fixture.databasePath });
    const authority = createAuthority(fixture);
    const service = createService(fixture, store, authority);
    await service.register(registrationInput(fixture));
    const lease = await authority.start({ profile: "project", projectRoots: [fixture.projectRoot] });

    const version2 = await service.checkpoint({
      authorityLeaseId: lease.leaseId,
      alias: "project-x",
      expectedRecordVersion: 1,
      task: { ...registrationInput(fixture).task, nextStep: "Both chats read version 2." },
      decisions: registrationInput(fixture).decisions,
    });
    expect(version2.recordVersion).toBe(2);
    const chatA = await service.contextRead({ authorityLeaseId: lease.leaseId, alias: "project-x" });
    const chatB = await service.contextRead({ authorityLeaseId: lease.leaseId, alias: "project-x" });
    expect(chatA.recordVersion).toBe(2);
    expect(chatB.recordVersion).toBe(2);

    const version3 = await service.checkpoint({
      authorityLeaseId: lease.leaseId,
      alias: "project-x",
      expectedRecordVersion: chatB.recordVersion,
      task: { ...registrationInput(fixture).task, nextStep: "Chat B committed version 3." },
      decisions: registrationInput(fixture).decisions,
    });
    expect(version3.recordVersion).toBe(3);

    await expect(service.checkpoint({
      authorityLeaseId: lease.leaseId,
      alias: "project-x",
      expectedRecordVersion: chatA.recordVersion,
      task: { ...registrationInput(fixture).task, nextStep: "Chat A stale write must fail." },
      decisions: registrationInput(fixture).decisions,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.getByAlias("project-x").currentRecord.task.nextStep).toBe("Chat B committed version 3.");
    store.close();

    const restarted = new ContinuityStore({ databasePath: fixture.databasePath });
    expect(restarted.getByAlias("project-x").currentRecord).toMatchObject({
      recordVersion: 3,
      task: { nextStep: "Chat B committed version 3." },
    });
    restarted.close();
  });

  it("revokes a post-start failed resume lease and never persists the lease token", async () => {
    const fixture = await createFixture(false);
    const store = new ContinuityStore({ databasePath: fixture.databasePath });
    const authority = createAuthority(fixture);
    const service = createService(fixture, store, authority);
    await service.register(registrationInput(fixture));
    const failingService = createService(
      fixture,
      store,
      authority,
      createInspector(),
      () => { throw new Error("package assembly failed in integration"); },
    );

    await expect(failingService.resume({ alias: "project-x" })).rejects.toThrow(
      "package assembly failed in integration",
    );
    const leaseId = authority.startedLeaseIds.at(-1);
    expect(leaseId).toBeDefined();
    expect(() => authority.status(leaseId!)).toThrowError(
      expect.objectContaining({ code: "AUTHORITY_REQUIRED" }),
    );
    expect((await readFile(fixture.databasePath)).includes(Buffer.from(leaseId!))).toBe(false);
    store.close();
  });

  it("does not silently treat unrelated filesystem reads as automatic continuity checkpoints", async () => {
    const fixture = await createFixture(false);
    const store = new ContinuityStore({ databasePath: fixture.databasePath });
    const authority = createAuthority(fixture);
    const service = createService(fixture, store, authority);
    await service.register(registrationInput(fixture));
    const lease = await authority.start({ profile: "project", projectRoots: [fixture.projectRoot] });
    const version2 = await service.checkpoint({
      authorityLeaseId: lease.leaseId,
      alias: "project-x",
      expectedRecordVersion: 1,
      task: { ...registrationInput(fixture).task, nextStep: "Semantic checkpoint is version 2." },
      decisions: registrationInput(fixture).decisions,
    });
    const before = store.getByAlias("project-x").currentRecord;
    expect(version2.recordVersion).toBe(2);

    const fsService = new FileSystemService(
      new PathPolicy([await realpath(fixture.projectRoot)]),
      new AuditLogger(path.join(fixture.root, "fs-audit.jsonl")),
      {
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        maxDirectoryEntries: 100,
        maxCommandOutputBytes: 1024 * 1024,
        commandTimeoutMs: 2_000,
        maxManagedProcesses: 4,
        maxProcessLogBytesPerStream: 4096,
        processStopGraceMs: 100,
      },
    );
    await fsService.read(path.join(fixture.worktree, "tracked.txt"), "utf8");

    const after = store.getByAlias("project-x").currentRecord;
    expect(after).toEqual(before);
    expect(after.recordVersion).toBe(2);
    store.close();
  });
});
