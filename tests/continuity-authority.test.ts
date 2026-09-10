import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AuthorityManager,
  canonicalizeProjectRoots,
} from "../src/authority.js";
import { AuthorityDeniedError } from "../src/errors.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function fixture(): Promise<{ home: string; projectA: string; projectB: string; homeAlias: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-authority-"));
  cleanups.push(root);
  const home = path.join(root, "home");
  const projectA = path.join(home, "project-a");
  const projectB = path.join(home, "project-b");
  const homeAlias = path.join(root, "home-alias");
  await mkdir(projectA, { recursive: true });
  await mkdir(projectB, { recursive: true });
  await symlink(home, homeAlias, "dir");
  return { home, projectA, projectB, homeAlias };
}

describe("project authority root canonicalization", () => {
  it("canonicalizes and deduplicates project roots with the same broad-root refusals as AuthorityManager", async () => {
    const { home, projectA, projectB, homeAlias } = await fixture();
    const canonicalA = await realpath(projectA);
    const canonicalB = await realpath(projectB);

    await expect(canonicalizeProjectRoots(home, [projectA, ` ${projectA} `, projectB])).resolves.toEqual([
      canonicalA,
      canonicalB,
    ]);

    await expect(canonicalizeProjectRoots(home, [])).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(canonicalizeProjectRoots(home, [home])).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(canonicalizeProjectRoots(home, [homeAlias])).rejects.toBeInstanceOf(AuthorityDeniedError);
    await expect(canonicalizeProjectRoots(home, [path.parse(home).root])).rejects.toBeInstanceOf(AuthorityDeniedError);

    const authority = new AuthorityManager({
      homeDir: home,
      commands: ["git", "node"],
      terminalEnabled: true,
    });
    const lease = await authority.start({ profile: "project", projectRoots: [projectA, projectB] });
    expect(lease.roots).toEqual([canonicalA, canonicalB]);
    expect(lease.terminalEnabled).toBe(false);
    expect(lease.commands).toEqual([]);
  });
});
