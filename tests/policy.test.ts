import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
