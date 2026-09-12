import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { ConflictError } from "../src/errors.js";
import { PathPolicy } from "../src/policy.js";
import { TaskStateService } from "../src/task-state-service.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

interface Fixture {
  root: string;
  service: TaskStateService;
}

async function fixture(): Promise<Fixture> {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-task-state-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  await mkdir(root);
  await writeFile(path.join(root, "README.md"), "base\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Task State Test"]);
  git(root, ["config", "user.email", "task-state@example.invalid"]);
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-q", "-m", "base"]);

  return {
    root,
    service: new TaskStateService(
      new PathPolicy([root]),
      new AuditLogger(path.join(base, "audit.jsonl")),
      path.join(base, "state"),
      "project",
      { commandTimeoutMs: 5_000 },
    ),
  };
}

describe("task state consistency", () => {
  it("advances both revisions when two checkpoints run concurrently", async () => {
    const { root, service } = await fixture();
    const started = await service.start("consistency goal", root);

    const results = await Promise.all([
      service.checkpoint(started.taskId, { summary: "first" }, root),
      service.checkpoint(started.taskId, { summary: "second" }, root),
    ]);

    expect(results.map((item) => item.revision).sort()).toEqual([2, 3]);

    const persisted = await service.status(started.taskId, root);
    expect(persisted.revision).toBe(3);
    expect(persisted.checkpointCount).toBe(2);
    expect(persisted.checkpoints.map((item) => item.summary).sort()).toEqual(["first", "second"]);
  });

  it("keeps a concurrent checkpoint and completion on a single serialized history", async () => {
    const { root, service } = await fixture();
    const started = await service.start("serialized goal", root);
    const verified = await service.observeRepositoryState(root);

    const settled = await Promise.allSettled([
      service.checkpoint(started.taskId, { summary: "racing checkpoint" }, root),
      service.complete(started.taskId, "racing completion", undefined, root, {
        head: verified.head,
        workingTreeDigest: verified.workingTreeDigest,
      }),
    ]);

    const persisted = await service.status(started.taskId, root);
    expect(persisted.status).toBe("completed");
    expect(persisted.outcome?.summary).toBe("racing completion");

    const checkpointSettled = settled[0]!;
    if (checkpointSettled.status === "fulfilled") {
      expect(persisted.checkpointCount).toBe(1);
      expect(persisted.revision).toBe(3);
    } else {
      expect(checkpointSettled.reason).toBeInstanceOf(ConflictError);
      expect(persisted.checkpointCount).toBe(0);
      expect(persisted.revision).toBe(2);
    }
  });

  it("refuses completion when the repository moved after verification", async () => {
    const { root, service } = await fixture();
    const started = await service.start("verified goal", root);
    const verified = await service.observeRepositoryState(root);

    await writeFile(path.join(root, "README.md"), "changed after verification\n", "utf8");
    const moved = await service.observeRepositoryState(root);
    expect(moved.workingTreeDigest).not.toBe(verified.workingTreeDigest);

    await expect(service.complete(started.taskId, "stale completion", undefined, root, {
      head: verified.head,
      workingTreeDigest: verified.workingTreeDigest,
    })).rejects.toBeInstanceOf(ConflictError);

    const persisted = await service.status(started.taskId, root);
    expect(persisted.status).toBe("active");
  });
});
