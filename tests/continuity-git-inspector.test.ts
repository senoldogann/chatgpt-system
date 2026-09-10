import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContinuityGitInspector,
  type ContinuityGitCommandResult,
} from "../src/continuity-git-inspector.js";

const execFileAsync = promisify(execFile);
const cleanups: string[] = [];

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

interface RepoFixture {
  root: string;
  repository: string;
  worktree: string;
  origin: string;
}

async function createRepoFixture(withOrigin: boolean): Promise<RepoFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-git-"));
  cleanups.push(root);
  const repository = path.join(root, "repository");
  const worktree = path.join(root, "worktree");
  const origin = path.join(root, "origin.git");

  await git(root, ["init", "-b", "main", repository]);
  await git(repository, ["config", "user.name", "Continuity Test"]);
  await git(repository, ["config", "user.email", "continuity@example.test"]);
  await writeFile(path.join(repository, "tracked.txt"), "initial\n");
  await git(repository, ["add", "tracked.txt"]);
  await git(repository, ["commit", "-m", "initial"]);
  await git(repository, ["worktree", "add", "-b", "feature/x", worktree]);

  if (withOrigin) {
    await git(root, ["init", "--bare", origin]);
    await git(repository, ["remote", "add", "origin", origin]);
    await git(repository, ["push", "origin", "main"]);
    await git(worktree, ["push", "-u", "origin", "feature/x"]);
  }

  return { root, repository, worktree, origin };
}

function inspector(
  overrides: Partial<ConstructorParameters<typeof ContinuityGitInspector>[0]>,
): ContinuityGitInspector {
  return new ContinuityGitInspector({
    maxTrackedPaths: 100,
    remoteVerificationTimeoutMs: 2_000,
    maxCommandOutputBytes: 1_048_576,
    now: () => Date.parse("2026-09-11T01:00:00.000Z"),
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("ContinuityGitInspector", () => {
  it("inspects exact linked-worktree identity and current dirty state", async () => {
    const fixture = await createRepoFixture(false);
    await writeFile(path.join(fixture.worktree, "tracked.txt"), "unstaged\n");
    await writeFile(path.join(fixture.worktree, "staged.txt"), "staged\n");
    await git(fixture.worktree, ["add", "staged.txt"]);
    await writeFile(path.join(fixture.worktree, "untracked.txt"), "untracked\n");

    const result = await inspector({}).inspect(fixture.worktree);

    expect(result.identity.canonicalPath).toBe(await realpath(fixture.worktree));
    expect(result.identity.repositoryRoot).toBe(await realpath(fixture.repository));
    expect(result.identity.repositoryIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identity.worktreeIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identity.repositoryIdentity).not.toBe(result.identity.worktreeIdentity);
    expect(result.local.branch).toBe("feature/x");
    expect(result.local.headSha).toMatch(/^[a-f0-9]{40,64}$/);
    expect(result.local.stagedPaths).toEqual(["staged.txt"]);
    expect(result.local.unstagedPaths).toEqual(["tracked.txt"]);
    expect(result.local.untrackedPaths).toEqual(["untracked.txt"]);
    expect(result.local.pathsTruncated).toBe(false);
    expect(result.published.branch).toMatchObject({ status: "unverified", reason: "remote_missing" });
    expect(result.published.main).toMatchObject({ status: "unverified", reason: "remote_missing" });
  });

  it("distinguishes verified, not_found, and unverified remote truth while preserving last-good evidence", async () => {
    const fixture = await createRepoFixture(true);
    const first = await inspector({}).inspect(fixture.worktree);

    expect(first.published.remoteName).toBe("origin");
    expect(first.published.branch).toMatchObject({
      status: "verified",
      ref: "refs/heads/feature/x",
      currentSha: first.local.headSha,
      lastVerifiedSha: first.local.headSha,
      lastVerifiedAt: "2026-09-11T01:00:00.000Z",
    });
    expect(first.published.main.status).toBe("verified");

    await git(fixture.root, ["--git-dir", fixture.origin, "update-ref", "-d", "refs/heads/feature/x"]);
    const second = await inspector({
      now: () => Date.parse("2026-09-11T01:01:00.000Z"),
    }).inspect(fixture.worktree, first.published);

    expect(second.published.branch).toMatchObject({
      status: "not_found",
      ref: "refs/heads/feature/x",
      checkedAt: "2026-09-11T01:01:00.000Z",
      lastVerifiedSha: first.published.branch.lastVerifiedSha,
      lastVerifiedAt: first.published.branch.lastVerifiedAt,
    });
    expect(second.published.branch.currentSha).toBeUndefined();
    expect(second.published.main.status).toBe("verified");

    const unavailable = inspector({
      now: () => Date.parse("2026-09-11T01:02:00.000Z"),
      runGit: async (cwd, args, timeoutMs) => {
        if (args.includes("ls-remote")) {
          return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("offline"), timedOut: true };
        }
        return testGitRunner(cwd, args, timeoutMs);
      },
    });
    const third = await unavailable.inspect(fixture.worktree, second.published);

    expect(third.published.branch).toMatchObject({
      status: "unverified",
      reason: "remote_error",
      lastVerifiedSha: first.published.branch.lastVerifiedSha,
      lastVerifiedAt: first.published.branch.lastVerifiedAt,
    });
    expect(third.published.main).toMatchObject({
      status: "unverified",
      reason: "remote_error",
      lastVerifiedSha: second.published.main.lastVerifiedSha,
      lastVerifiedAt: second.published.main.lastVerifiedAt,
    });
  });

  it("parses staged renames and caps dirty path categories deterministically", async () => {
    const fixture = await createRepoFixture(false);
    await git(fixture.worktree, ["mv", "tracked.txt", "renamed.txt"]);
    await writeFile(path.join(fixture.worktree, "c-untracked.txt"), "c\n");
    await writeFile(path.join(fixture.worktree, "a-untracked.txt"), "a\n");
    await writeFile(path.join(fixture.worktree, "b-untracked.txt"), "b\n");

    const result = await inspector({ maxTrackedPaths: 2 }).inspect(fixture.worktree);

    expect(result.local.stagedPaths).toEqual(["renamed.txt"]);
    expect(result.local.unstagedPaths).toEqual([]);
    expect(result.local.untrackedPaths).toEqual(["a-untracked.txt", "b-untracked.txt"]);
    expect(result.local.pathsTruncated).toBe(true);
  });

  it("reports detached branch state without guessing a branch", async () => {
    const fixture = await createRepoFixture(true);
    await git(fixture.worktree, ["checkout", "--detach"]);

    const result = await inspector({}).inspect(fixture.worktree);

    expect(result.local.branch).toBeNull();
    expect(result.published.branch).toMatchObject({
      status: "not_found",
      ref: null,
      reason: "detached_head",
    });
    expect(result.published.main.status).toBe("verified");
  });

  it("rejects a worktree identity mismatch instead of accepting path equality", async () => {
    const fixture = await createRepoFixture(false);
    const first = await inspector({}).inspect(fixture.worktree);

    await expect(inspector({}).verifyIdentity(fixture.worktree, {
      ...first.identity,
      worktreeIdentity: "0".repeat(64),
    })).rejects.toMatchObject({ code: "CONTINUITY_WORKTREE_MISMATCH" });
  });

  it("fails closed when local Git metadata exceeds the configured output bound", async () => {
    const fixture = await createRepoFixture(false);
    await writeFile(path.join(fixture.worktree, "a-long-untracked-file-name.txt"), "x\n");
    await writeFile(path.join(fixture.worktree, "another-long-untracked-file-name.txt"), "x\n");

    await expect(inspector({ maxCommandOutputBytes: 32 }).inspect(fixture.worktree)).rejects.toMatchObject({
      code: "CONTINUITY_WORKTREE_INVALID",
    });
  });
});
