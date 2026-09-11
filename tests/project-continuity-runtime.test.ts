import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityManager } from "../src/authority.js";
import { ContinuityGitInspector } from "../src/continuity-git-inspector.js";
import { ContinuityStore } from "../src/continuity-store.js";
import { ProjectContinuityService } from "../src/project-continuity-service.js";
import { createProjectContinuityRuntime } from "../src/project-continuity-runtime.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-runtime-"));
  cleanups.push(root);
  const home = path.join(root, "home");
  await mkdir(home, { recursive: true });
  const authority = new AuthorityManager({
    homeDir: home,
    commands: ["git", "node"],
    terminalEnabled: false,
  });
  const config = {
    continuity: {
      databasePath: path.join(root, "state", "continuity.db"),
      maxTrackedPaths: 37,
      remoteVerificationTimeoutMs: 1_234,
      maxResumeChars: 12_000,
    },
    limits: {
      maxCommandOutputBytes: 654_321,
    },
  };
  return { root, home, authority, config };
}

describe("createProjectContinuityRuntime", () => {
  it("constructs one continuity store and service from configured runtime limits", async () => {
    const test = await fixture();

    const runtime = createProjectContinuityRuntime(test.config, test.authority, { homeDir: test.home });

    expect(runtime.continuityStore).toBeInstanceOf(ContinuityStore);
    expect(runtime.continuity).toBeInstanceOf(ProjectContinuityService);
    expect((await stat(test.config.continuity.databasePath)).isFile()).toBe(true);
    expect(() => runtime.continuityStore.getByAlias("missing")).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_NOT_FOUND" }),
    );
    runtime.continuityStore.close();
  });

  it("reuses injected store and service without creating a second configured database", async () => {
    const test = await fixture();
    const injectedPath = path.join(test.root, "injected", "continuity.db");
    const injectedStore = new ContinuityStore({ databasePath: injectedPath });
    const inspector = new ContinuityGitInspector({
      maxTrackedPaths: 10,
      remoteVerificationTimeoutMs: 500,
      maxCommandOutputBytes: 1024,
    });
    const injectedService = new ProjectContinuityService({
      store: injectedStore,
      inspector,
      authority: test.authority,
      homeDir: test.home,
      maxResumeChars: 12_000,
    });

    const runtime = createProjectContinuityRuntime(test.config, test.authority, {
      homeDir: test.home,
      continuityStore: injectedStore,
      continuityService: injectedService,
    });

    expect(runtime.continuityStore).toBe(injectedStore);
    expect(runtime.continuity).toBe(injectedService);
    await expect(stat(test.config.continuity.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
    injectedStore.close();
  });
});
