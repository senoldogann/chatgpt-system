import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function fixture(remoteWriteEnabled = false, allowLocalRemote = false) {
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

  const config = await loadConfig({
    roots: [repo],
    auditFile: path.join(base, "audit.jsonl"),
  });
  const service = new GitService(
    new PathPolicy(config.roots),
    new AuditLogger(config.auditFile),
    config,
    {
      remoteWriteEnabled,
      ...(allowLocalRemote ? { remoteUrlPolicy: () => true } : {}),
    },
  );
  return { base, repo, remote, service };
}

describe("typed Git mutations", () => {
  it("checks staged and unstaged whitespace without altering existing diff output", async () => {
    const { repo, service } = await fixture();
    await writeFile(path.join(repo, "README.md"), "staged whitespace  \n", "utf8");
    expect((await service.stagePaths(".", ["README.md"])).exitCode).toBe(0);

    const stagedCheck = await service.diff(".", true, true);
    expect(stagedCheck.exitCode).not.toBe(0);
    expect(stagedCheck.stdout).toContain("trailing whitespace");
    expect((await service.diff(".", false, true)).exitCode).toBe(0);
    expect((await service.diff(".", true)).stdout).toContain("+staged whitespace");

    await writeFile(path.join(repo, "README.md"), "clean\n", "utf8");
    expect((await service.diff(".", false, true)).exitCode).toBe(0);
    expect((await service.diff(".", true, true)).exitCode).not.toBe(0);
    expect((await service.stagePaths(".", ["README.md"])).exitCode).toBe(0);
    expect((await service.diff(".", true, true)).exitCode).toBe(0);
  });

  it("creates, stages, commits, switches, and merges without arbitrary Git arguments", async () => {
    const { repo, service } = await fixture();

    expect((await service.createBranch(".", "feat/typed-git")).exitCode).toBe(0);
    expect(git(repo, ["branch", "--show-current"])).toBe("feat/typed-git");

    await writeFile(path.join(repo, "feature.txt"), "typed mutation\n", "utf8");
    expect((await service.stagePaths(".", ["feature.txt"])).exitCode).toBe(0);
    expect((await service.commit(".", "feat: add typed git mutation")).exitCode).toBe(0);

    expect((await service.switchBranch(".", "main")).exitCode).toBe(0);
    expect((await service.mergeBranch(".", "feat/typed-git")).exitCode).toBe(0);
    expect(git(repo, ["log", "-1", "--pretty=%s"])).toBe("Merge branch 'feat/typed-git'");
    expect(git(repo, ["show", "HEAD:feature.txt"])).toBe("typed mutation");
  });

  it("rejects unsafe branch names and stage paths outside the active authority root", async () => {
    const { base, repo, service } = await fixture();
    await writeFile(path.join(base, "outside.txt"), "outside\n", "utf8");

    await expect(service.createBranch(".", "--upload-pack=evil")).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(service.stagePaths(".", ["../outside.txt"])).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(git(repo, ["status", "--porcelain"])).toBe("");
  });

  it("requires Admin-scoped remote-write capability for push", async () => {
    const { repo, service } = await fixture(false);
    await service.createBranch(".", "feat/local-only");
    await writeFile(path.join(repo, "local.txt"), "local\n", "utf8");
    await service.stagePaths(".", ["local.txt"]);
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

    await expect(service.push(".", { branch: "feat/exact-state", head: "f".repeat(40) }))
      .rejects.toMatchObject({ code: "LOCAL_VERIFICATION_STALE" });
    await expect(service.push(".", { branch: "feat/other", head }))
      .rejects.toMatchObject({ code: "LOCAL_VERIFICATION_STALE" });
  });

  it("pushes only the current validated branch to origin when remote writes are enabled", async () => {
    const { repo, remote, service } = await fixture(true, true);
    await service.createBranch(".", "feat/remote-write");
    await writeFile(path.join(repo, "remote.txt"), "remote\n", "utf8");
    await service.stagePaths(".", ["remote.txt"]);
    await service.commit(".", "feat: remote write");

    const head = git(repo, ["rev-parse", "HEAD"]);
    const pushed = await service.push(".", { branch: "feat/remote-write", head });
    expect(pushed.exitCode).toBe(0);
    expect(git(remote, ["show", "refs/heads/feat/remote-write:remote.txt"])).toBe("remote");
  });
});
