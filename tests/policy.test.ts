import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PathPolicy } from "../src/policy.js";
import { PolicyError } from "../src/errors.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-policy-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  return { base, root, outside, policy: new PathPolicy([root]) };
}

describe("PathPolicy", () => {
  it("resolves relative paths inside the primary root", async () => {
    const { root, policy } = await fixture();
    await writeFile(path.join(root, "file.txt"), "ok");
    await expect(policy.resolve("file.txt")).resolves.toBe(path.join(root, "file.txt"));
  });

  it("allows an approved root whose own path contains a symlink", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-policy-root-link-"));
    cleanups.push(base);
    const realRoot = path.join(base, "real-root");
    const linkedRoot = path.join(base, "linked-root");
    await mkdir(realRoot);
    await symlink(realRoot, linkedRoot, "dir");
    await writeFile(path.join(realRoot, "file.txt"), "ok");

    const policy = new PathPolicy([linkedRoot]);
    await expect(policy.resolve("file.txt")).resolves.toBe(path.join(linkedRoot, "file.txt"));
  });

  it("accepts an absolute path through a symlink alias of a canonical allowed root", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-policy-canonical-alias-"));
    cleanups.push(base);
    const realRoot = path.join(base, "real-root");
    const linkedRoot = path.join(base, "linked-root");
    await mkdir(realRoot);
    await symlink(realRoot, linkedRoot, "dir");
    await writeFile(path.join(realRoot, "file.txt"), "ok");

    const canonicalRoot = await realpath(realRoot);
    const policy = new PathPolicy([canonicalRoot]);
    const aliasedFile = path.join(linkedRoot, "file.txt");

    await expect(policy.resolve(aliasedFile)).resolves.toBe(aliasedFile);
  });

  it("rejects lexical traversal outside a root", async () => {
    const { policy } = await fixture();
    await expect(policy.resolve("../outside/secret.txt")).rejects.toBeInstanceOf(PolicyError);
  });

  it("rejects a symlink escape even for a missing child path", async () => {
    const { root, outside, policy } = await fixture();
    await symlink(outside, path.join(root, "escape"), "dir");
    await expect(policy.resolve("escape/new.txt")).rejects.toBeInstanceOf(PolicyError);
  });
});
