import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { GitService } from "../src/git-service.js";
import { PathPolicy } from "../src/policy.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function fixture(remoteWriteEnabled = false, allowLocalRemote = false, beforeStage?: () => Promise<void> | void, beforeIndexWrite?: () => Promise<void> | void) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-git-"));
  cleanups.push(base);
  const repo = path.join(base, "repo");
  const remote = path.join(base, "remote.git");
  await mkdir(repo);
  git(base, ["init", "--bare", remote]);
  git(repo, ["init"]);
  git(repo, ["config", "user.name", "chatgpt-system test"]);
  git(repo, ["config", "user.email", "chatgpt-system@example.invalid"]);
  await writeFile(path.join(repo, "README.md"), "initial\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "initial"]);
  git(repo, ["branch", "-M", "main"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  const config = await loadConfig({ roots: [repo], auditFile: path.join(base, "audit.jsonl") });
  const service = new GitService(new PathPolicy(config.roots), new AuditLogger(config.auditFile), config, {
    remoteWriteEnabled,
    ...(allowLocalRemote ? { remoteUrlPolicy: () => true } : {}),
    ...(beforeStage ? { beforeStage } : {}),
    ...(beforeIndexWrite ? { beforeIndexWrite } : {}),
  });
  return { base, repo, remote, service };
}

describe("typed Git mutations", () => {
  it("returns complete categorized inventory pages and reviews deleted files by path", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, "README.md"), "modified\n", "utf8");
    await writeFile(path.join(repo, "deleted.txt"), "delete me\n", "utf8");
    git(repo, ["add", "deleted.txt"]);
    git(repo, ["commit", "-m", "add deleted fixture"]);
    await unlink(path.join(repo, "deleted.txt"));
    await writeFile(path.join(repo, "untracked.txt"), "untracked\n", "utf8");
    await writeFile(path.join(repo, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(path.join(repo, "ignored.txt"), "ignored\n", "utf8");
    const first = await service.inventory(".", 0, 2);
    expect(first.entries).toHaveLength(2);
    expect(first.complete).toBe(false);
    const second = await service.inventory(".", first.nextCursor, 20, first.snapshot);
    const entries = [...first.entries, ...second.entries];
    expect(entries.map((entry) => entry.category)).toEqual(expect.arrayContaining(["modified", "deleted", "untracked", "ignored"]));
    expect(new Set(entries.map((entry) => entry.path)).size).toBe(entries.length);
    await writeFile(path.join(repo, "later.txt"), "later\n", "utf8");
    await expect(service.inventory(".", second.nextCursor ?? 0, 20, first.snapshot)).rejects.toMatchObject({ code: "CONFLICT" });
    const deletedReview = await service.fileReview(".", "deleted.txt");
    expect(deletedReview.diff).toContain("deleted file");
    expect(deletedReview.diffSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(deletedReview.deletion).toBe(true);
    expect(deletedReview.deletionEvidence).toBe("worktree-path-missing");
    const untrackedReview = await service.fileReview(".", "untracked.txt");
    expect(untrackedReview.diff).toBe("untracked\n");
    expect(untrackedReview.contentSha256).toBe(createHash("sha256").update("untracked\n").digest("hex"));
    expect(untrackedReview.diffSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("classifies secret paths without returning their contents", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, ".env"), "TOKEN=do-not-return\n", "utf8");
    const review = await service.fileReview(".", ".env");
    expect(review.risk).toBe("secret");
    expect(review.diff).toContain("REDACTED");
    expect(review.diff).not.toContain("do-not-return");
    expect(review.contentSha256).toBe(createHash("sha256").update("TOKEN=do-not-return\n").digest("hex"));
  });

  it("checks staged and unstaged whitespace without altering existing diff output", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, "README.md"), "staged whitespace  \n", "utf8");
    expect((await service.stagePaths(".", ["README.md"], { "README.md": createHash("sha256").update("staged whitespace  \n").digest("hex") })).exitCode).toBe(0);
    expect((await service.diff(".", true, true)).exitCode).not.toBe(0);
    expect((await service.diff(".", false, true)).exitCode).toBe(0);
    expect((await service.diff(".", true)).stdout).toContain("+staged whitespace");
    await writeFile(path.join(repo, "README.md"), "clean\n", "utf8");
    expect((await service.diff(".", false, true)).exitCode).toBe(0);
    expect((await service.diff(".", true, true)).exitCode).not.toBe(0);
    expect((await service.stagePaths(".", ["README.md"], { "README.md": createHash("sha256").update("clean\n").digest("hex") })).exitCode).toBe(0);
    expect((await service.diff(".", true, true)).exitCode).toBe(0);
  });

  it("creates, stages, commits, switches, and merges without arbitrary Git arguments", async () => {
    const { repo, service } = await fixture();
    expect((await service.createBranch(".", "feat/typed-git")).exitCode).toBe(0);
    await writeFile(path.join(repo, "feature.txt"), "typed mutation\n", "utf8");
    expect((await service.stagePaths(".", ["feature.txt"], { "feature.txt": createHash("sha256").update("typed mutation\n").digest("hex") })).exitCode).toBe(0);
    expect((await service.commit(".", "feat: add typed git mutation")).exitCode).toBe(0);
    expect((await service.switchBranch(".", "main")).exitCode).toBe(0);
    expect((await service.mergeBranch(".", "feat/typed-git")).exitCode).toBe(0);
    expect(git(repo, ["log", "-1", "--pretty=%s"])).toBe("Merge branch 'feat/typed-git'");
    expect(git(repo, ["show", "HEAD:feature.txt"])).toBe("typed mutation");
  });

  it("requires content evidence before safe staging", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, "evidence.txt"), "evidence\n", "utf8");
    await expect(service.stagePaths(".", ["evidence.txt"])).rejects.toMatchObject({ code: "CONFLICT" });
    expect(git(repo, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("rejects a concurrent file change before explicit staging", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, "concurrent.txt"), "changed\n", "utf8");
    await expect(service.stagePaths(".", ["concurrent.txt"], { "concurrent.txt": createHash("sha256").update("before\n").digest("hex") })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(git(repo, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("detects a SHA-to-add race before explicit staging", async () => {
    const { repo, service } = await fixture(false, false, async () => {
      await writeFile(path.join(repo, "race.txt"), "attacker\n", "utf8");
    });
    await writeFile(path.join(repo, "race.txt"), "approved\n", "utf8");
    await expect(service.stagePaths(".", ["race.txt"], { "race.txt": createHash("sha256").update("approved\n").digest("hex") })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(git(repo, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("stages the approved blob when the worktree changes after the final check", async () => {
    let changed = false;
    const { repo, service } = await fixture(false, false, undefined, async () => {
      if (!changed) { changed = true; await writeFile(path.join(repo, "late-race.txt"), "unapproved\n", "utf8"); }
    });
    await writeFile(path.join(repo, "late-race.txt"), "approved\n", "utf8");
    expect((await service.stagePaths(".", ["late-race.txt"], { "late-race.txt": createHash("sha256").update("approved\n").digest("hex") })).exitCode).toBe(0);
    expect(git(repo, ["show", ":late-race.txt"])).toBe("approved");
  });

  it("stages an approved deletion without replacing unrelated index entries", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, "remove.txt"), "remove\n", "utf8");
    git(repo, ["add", "remove.txt"]);
    git(repo, ["commit", "-m", "add removable fixture"]);
    await unlink(path.join(repo, "remove.txt"));
    expect((await service.stagePaths(".", ["remove.txt"], { "remove.txt": "deleted" })).exitCode).toBe(0);
    expect(git(repo, ["ls-files", "--", "remove.txt"])).toBe("");
  });

  it("stages binary content by raw blob identity and preserves executable mode", async () => {
    const { repo, service } = await fixture();
    const binary = Buffer.from([0, 1, 2, 255, 3]);
    await writeFile(path.join(repo, "payload.bin"), binary);
    await chmod(path.join(repo, "payload.bin"), 0o755);
    expect((await service.stagePaths(".", ["payload.bin"], { "payload.bin": createHash("sha256").update(binary).digest("hex") })).exitCode).toBe(0);
    const staged = git(repo, ["ls-files", "--stage", "--", "payload.bin"]);
    expect(staged).toMatch(/^100755 [a-f0-9]{40} /);
    expect(execFileSync("git", ["show", ":payload.bin"], { cwd: repo })).toEqual(binary);
  });

  it("rejects unsafe branch names and stage paths outside the active authority root", async () => {
    const { base, repo, service } = await fixture();
    await writeFile(path.join(base, "outside.txt"), "outside\n", "utf8");
    await expect(service.createBranch(".", "--upload-pack=evil")).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(service.stagePaths(".", ["../outside.txt"], { "../outside.txt": "deleted" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(git(repo, ["status", "--porcelain"])).toBe("");
  });

  it("requires Admin-scoped remote-write capability for push", async () => {
    const { repo, service } = await fixture(false);
    await service.createBranch(".", "feat/local-only");
    await writeFile(path.join(repo, "local.txt"), "local\n", "utf8");
    await service.stagePaths(".", ["local.txt"], { "local.txt": createHash("sha256").update("local\n").digest("hex") });
    await service.commit(".", "feat: local only");
    await expect(service.push(".")).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("rejects a non-GitHub origin even when remote writes are enabled", async () => {
    const { service } = await fixture(true);
    await expect(service.push(".")).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("rejects an exact-state push when the verified HEAD or branch no longer matches", async () => {
    const { repo, service } = await fixture(true, true);
    await service.createBranch(".", "feat/exact-state");
    const head = git(repo, ["rev-parse", "HEAD"]);
    await expect(service.push(".", { branch: "feat/exact-state", head: "f".repeat(40) })).rejects.toMatchObject({ code: "LOCAL_VERIFICATION_STALE" });
    await expect(service.push(".", { branch: "feat/other", head })).rejects.toMatchObject({ code: "LOCAL_VERIFICATION_STALE" });
  });

  it("pushes only the current validated branch to origin when remote writes are enabled", async () => {
    const { repo, remote, service } = await fixture(true, true);
    await service.createBranch(".", "feat/remote-write");
    await writeFile(path.join(repo, "remote.txt"), "remote\n", "utf8");
    await service.stagePaths(".", ["remote.txt"], { "remote.txt": createHash("sha256").update("remote\n").digest("hex") });
    await service.commit(".", "feat: remote write");
    const head = git(repo, ["rev-parse", "HEAD"]);
    expect((await service.push(".", { branch: "feat/remote-write", head })).exitCode).toBe(0);
    expect(git(remote, ["show", "refs/heads/feat/remote-write:remote.txt"])).toBe("remote");
  });
});
