import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContinuityStore } from "../src/continuity-store.js";
import { ConflictError } from "../src/errors.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

function registrationFixture() {
  return {
    id: "project-1",
    alias: "Project-X",
    roots: ["/tmp/project-x"],
    worktree: {
      canonicalPath: "/tmp/project-x",
      repositoryRoot: "/tmp/project-x",
      commonGitDir: "/tmp/project-x/.git",
      gitDir: "/tmp/project-x/.git",
      repositoryIdentity: "a".repeat(64),
      worktreeIdentity: "b".repeat(64),
    },
    localState: {
      checkedAt: "2026-09-11T00:00:00.000Z",
      branch: "feature/x",
      headSha: "c".repeat(40),
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      pathsTruncated: false,
    },
    publishedState: {
      remoteName: "origin" as const,
      branch: {
        status: "verified" as const,
        ref: "refs/heads/feature/x",
        currentSha: "d".repeat(40),
        checkedAt: "2026-09-11T00:00:00.000Z",
        lastVerifiedSha: "d".repeat(40),
        lastVerifiedAt: "2026-09-11T00:00:00.000Z",
      },
      main: {
        status: "verified" as const,
        ref: "refs/heads/main",
        currentSha: "e".repeat(40),
        checkedAt: "2026-09-11T00:00:00.000Z",
        lastVerifiedSha: "e".repeat(40),
        lastVerifiedAt: "2026-09-11T00:00:00.000Z",
      },
    },
    semantic: {
      task: {
        goal: "Resume Project-X correctly.",
        constraints: ["Preserve the exact worktree."],
        successCriteria: ["A new chat can resume by alias."],
        status: "active" as const,
        nextStep: "Implement the continuity store.",
      },
      decisions: [],
      uncertainties: [],
      verificationSummary: [],
    },
  };
}

describe("ContinuityStore", () => {
  it("persists registration across reopen and resolves normalized aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const databasePath = path.join(root, "continuity.db");

    const store = new ContinuityStore({
      databasePath,
      now: () => Date.parse("2026-09-11T00:00:00.000Z"),
    });
    const first = store.register(registrationFixture());
    expect(first.currentRecord.recordVersion).toBe(1);
    store.close();

    const reopened = new ContinuityStore({
      databasePath,
      now: () => Date.parse("2026-09-11T00:01:00.000Z"),
    });
    expect(reopened.getByAlias("Project-X").id).toBe(first.id);
    expect(reopened.getByAlias(" project-x ").currentRecord.recordVersion).toBe(1);
    reopened.close();
  });

  it("returns a stable continuity error for an unknown alias", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const store = new ContinuityStore({ databasePath: path.join(root, "continuity.db") });

    expect(() => store.getByAlias("missing-project")).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_NOT_FOUND" }),
    );
    store.close();
  });

  it("keeps immutable semantic history and rejects a stale checkpoint atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const store = new ContinuityStore({
      databasePath: path.join(root, "continuity.db"),
      now: () => Date.parse("2026-09-11T00:02:00.000Z"),
    });
    const registered = store.register(registrationFixture());
    const nextLocalState = {
      ...registered.localState,
      checkedAt: "2026-09-11T00:02:00.000Z",
      unstagedPaths: ["src/continuity-store.ts"],
    };
    const nextPublishedState = {
      ...registered.publishedState,
      branch: {
        ...registered.publishedState.branch,
        checkedAt: "2026-09-11T00:02:00.000Z",
      },
      main: {
        ...registered.publishedState.main,
        checkedAt: "2026-09-11T00:02:00.000Z",
      },
    };
    const nextSemantic = {
      ...registrationFixture().semantic,
      task: {
        ...registrationFixture().semantic.task,
        nextStep: "Implement OCC.",
      },
    };

    const version2 = store.checkpoint({
      projectId: registered.id,
      expectedRecordVersion: 1,
      semantic: nextSemantic,
      localState: nextLocalState,
      publishedState: nextPublishedState,
      checkedAt: nextLocalState.checkedAt,
    });

    expect(version2.recordVersion).toBe(2);
    expect(store.getRecord(registered.id, 1).task.nextStep).toBe("Implement the continuity store.");
    expect(store.getByAlias("project-x").currentRecord.task.nextStep).toBe("Implement OCC.");

    expect(() => store.checkpoint({
      projectId: registered.id,
      expectedRecordVersion: 1,
      semantic: {
        ...nextSemantic,
        task: { ...nextSemantic.task, nextStep: "This stale write must not win." },
      },
      localState: nextLocalState,
      publishedState: nextPublishedState,
      checkedAt: nextLocalState.checkedAt,
    })).toThrowError(ConflictError);

    expect(store.getByAlias("project-x").currentRecord.recordVersion).toBe(2);
    expect(store.getByAlias("project-x").currentRecord.task.nextStep).toBe("Implement OCC.");
    store.close();
  });

  it("rejects duplicate normalized aliases and duplicate canonical worktrees with a stable conflict", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const store = new ContinuityStore({ databasePath: path.join(root, "continuity.db") });
    const first = registrationFixture();
    store.register(first);

    expect(() => store.register({
      ...first,
      id: "project-2",
      alias: " project-x ",
      worktree: {
        ...first.worktree,
        canonicalPath: "/tmp/project-y",
        gitDir: "/tmp/project-y/.git",
        worktreeIdentity: "f".repeat(64),
      },
    })).toThrowError(ConflictError);

    expect(() => store.register({
      ...first,
      id: "project-3",
      alias: "Project-Y",
      worktree: { ...first.worktree },
    })).toThrowError(ConflictError);

    expect(store.getByAlias("project-x").id).toBe("project-1");
    store.close();
  });

  it("fails closed for corrupt database bytes and unsupported schema versions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);

    const corruptPath = path.join(root, "corrupt.db");
    await writeFile(corruptPath, "not-a-sqlite-database");
    expect(() => new ContinuityStore({ databasePath: corruptPath })).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_DATABASE_INVALID" }),
    );

    const schemaPath = path.join(root, "schema.db");
    const raw = new Database(schemaPath);
    raw.exec("CREATE TABLE continuity_meta (schema_version INTEGER NOT NULL)");
    raw.prepare("INSERT INTO continuity_meta (schema_version) VALUES (?)").run(999);
    raw.close();

    expect(() => new ContinuityStore({ databasePath: schemaPath })).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_DATABASE_INVALID" }),
    );

    const after = new Database(schemaPath, { readonly: true });
    const projectTable = after.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
    ).get();
    after.close();
    expect(projectTable).toBeUndefined();
  });

  it("maps malformed persisted JSON to a stable database error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const databasePath = path.join(root, "continuity.db");
    const store = new ContinuityStore({ databasePath });
    store.register(registrationFixture());
    store.close();

    const raw = new Database(databasePath);
    raw.prepare("UPDATE worktrees SET local_state_json = ? WHERE project_id = ?").run("{not-json", "project-1");
    raw.close();

    const reopened = new ContinuityStore({ databasePath });
    expect(() => reopened.getByAlias("project-x")).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_DATABASE_INVALID" }),
    );
    reopened.close();
  });

  it("refreshes operational state without changing semantic recordVersion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const store = new ContinuityStore({ databasePath: path.join(root, "continuity.db") });
    const registered = store.register(registrationFixture());
    const refreshedLocal = {
      ...registered.localState,
      checkedAt: "2026-09-11T00:10:00.000Z",
      stagedPaths: ["src/continuity-types.ts"],
    };
    const refreshedPublished = {
      ...registered.publishedState,
      branch: {
        ...registered.publishedState.branch,
        status: "unverified" as const,
        checkedAt: "2026-09-11T00:10:00.000Z",
        reason: "remote_error" as const,
      },
    };

    store.updateOperationalState(
      registered.id,
      refreshedLocal,
      refreshedPublished,
      refreshedLocal.checkedAt,
    );

    const after = store.getByAlias("project-x");
    expect(after.currentRecord.recordVersion).toBe(1);
    expect(after.currentRecord.task).toEqual(registered.currentRecord.task);
    expect(after.localState).toEqual(refreshedLocal);
    expect(after.publishedState).toEqual(refreshedPublished);
    store.close();
  });

  it("creates private local storage and closes idempotently", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-continuity-store-"));
    cleanups.push(root);
    const parent = path.join(root, "private-state");
    const databasePath = path.join(parent, "continuity.db");
    const store = new ContinuityStore({ databasePath });

    const parentInfo = await stat(parent);
    const databaseInfo = await stat(databasePath);
    expect(parentInfo.mode & 0o777).toBe(0o700);
    expect(databaseInfo.mode & 0o777).toBe(0o600);

    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
