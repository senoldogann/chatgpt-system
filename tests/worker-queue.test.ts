import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { WorkerStore, assertWorkerAliasLive, briefFor } from "../src/worker-store.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), "chatgpt-system-queue-"));
  cleanups.push(dir);
  const audit = new AuditLogger(path.join(dir, "audit.jsonl"));
  const workerStore = await WorkerStore.open(dir, audit, 8, 16);
  return { dir, audit, workerStore };
}

async function spawned() {
  const { dir, audit, workerStore } = await store();
  const run = await workerStore.spawn("shop", "ctx", [
    { task: "Fix cart", label: "cart", alias: "shop-cart" },
    { task: "Write test", label: "test" },
  ]);
  return { dir, audit, workerStore, run };
}

function scopeFor(dir: string, audit: AuditLogger) {
  return { taskStateRoot: dir, audit, maxWorkers: 8, maxParkedRuns: 16 };
}

describe("worker message queue", () => {
  it("queues directed messages and exposes them with read flags", async () => {
    const { workerStore, run } = await spawned();
    const target = run.workers[0]!.id;
    await workerStore.message(run.runId, target, "Prime note.", "prime");
    await workerStore.message(run.runId, target, "Worker reply.", "worker");

    const listed = await workerStore.listForPrime("shop");
    const inbox = listed[0]!.workers[0]!.inbox;
    expect(inbox.length).toBe(2);
    expect(inbox[0]).toMatchObject({ from: "prime", text: "Prime note.", readAt: null });
    expect(inbox[1]).toMatchObject({ from: "worker", text: "Worker reply.", readAt: null });
  });

  it("acks unread messages on status", async () => {
    const { workerStore, run } = await spawned();
    const target = run.workers[0]!.id;
    await workerStore.message(run.runId, target, "Read me.", "prime");
    const read = await workerStore.status(run.runId);
    expect(read.workers[0]!.inbox[0]!.readAt).not.toBe(null);
    const again = await workerStore.status(run.runId);
    expect(again.workers[0]!.inbox[0]!.readAt).toBe(read.workers[0]!.inbox[0]!.readAt);
  });

  it("drops oldest read first at the 200 cap and refuses when all unread", async () => {
    const { workerStore, run } = await spawned();
    const target = run.workers[0]!.id;
    for (let index = 0; index < 200; index += 1) {
      await workerStore.message(run.runId, target, `note-${index}`, "prime");
    }
    await expect(workerStore.message(run.runId, target, "one too many", "prime")).rejects.toThrow(/Kuyruk dolu/);
    await workerStore.status(run.runId);
    await workerStore.message(run.runId, target, "fits after read", "prime");
    const current = await workerStore.listForPrime("shop");
    const inbox = current[0]!.workers[0]!.inbox;
    expect(inbox.length).toBe(200);
    expect(inbox.some((message) => message.text === "note-0")).toBe(false);
    expect(inbox[inbox.length - 1]!.text).toBe("fits after read");
  });

  it("migrates legacy notes into unread prime messages", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "chatgpt-system-queue-legacy-"));
    cleanups.push(dir);
    const audit = new AuditLogger(path.join(dir, "audit.jsonl"));
    const legacy = [{
      runId: "run-legacy",
      primeAlias: "shop",
      sharedContext: "",
      createdAt: new Date(0).toISOString(),
      parked: false,
      workers: [{
        id: "w-1",
        label: "old",
        task: briefFor("", "Old task"),
        state: "active",
        alias: null,
        worktreePath: null,
        notes: ["kept note"],
        createdAt: new Date(0).toISOString(),
        lastSeenAt: new Date(0).toISOString(),
        result: null,
      }],
    }];
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "workers.json"), JSON.stringify(legacy), "utf8");
    const workerStore = await WorkerStore.open(dir, audit, 8, 16);
    const runs = await workerStore.listForPrime("shop");
    expect(runs[0]!.workers[0]!.inbox).toMatchObject([{ from: "prime", text: "kept note", readAt: null }]);
  });

  it("retires the worker alias on finish and fences later writes", async () => {
    const { dir, audit, workerStore, run } = await spawned();
    const target = run.workers[0]!.id;
    expect(await workerStore.isRetired("shop-cart")).toBe(false);
    await workerStore.finish(run.runId, target, "Done.", false);
    expect(await workerStore.isRetired("shop-cart")).toBe(true);
    expect(await workerStore.isRetired("shop")).toBe(false);
    await expect(assertWorkerAliasLive(scopeFor(dir, audit), "shop-cart")).rejects.toMatchObject({ code: "WORKER_RETIRED" });
    await assertWorkerAliasLive(scopeFor(dir, audit), "shop");
  });
});
