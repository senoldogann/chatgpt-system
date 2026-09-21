import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-worker-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root, { recursive: true });
  const token = "worker-test-token-0123456789abcdef";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: [] },
    projectExec: { enabled: false },
    skills: { enabled: true, directory: path.join(base, "skills") },
    goal: { enabled: true, maxTranscriptChars: 120_000 },
    workers: { enabled: true, maxWorkers: 8, maxParkedRuns: 16 },
    ownerRuntime: {
      enabled: false,
      shellPath: "/bin/sh",
      maxScriptBytes: 262_144,
      maxTimeoutMs: 120_000,
      maxTerminalSessions: 32,
      maxTerminalOutputBytes: 262_144,
      maxTerminalInputBytes: 65_536,
    },
    computerUse: {
      enabled: false,
      fullHostJsEnabled: false,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
      maxAutomaticRetriesPerAction: 2,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    jevTargeting: { enabled: false, apiKey: null },
    continuity: {
      databasePath: path.join(base, "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },
    sessionEvents: { enabled: false },
    browser: {
      enabled: false,
      connectionMode: "managed",
      headless: true,
      timeoutMs: 2_000,
      userDataDir: path.join(base, "browser"),
      existingChromeUserDataDir: null,
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, allowNonLoopback: false, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 2_000,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  };
  const server = startHttp(createRuntimeServices(config));
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "worker-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}

function workersOf(run: Record<string, unknown>): Record<string, unknown>[] {
  return run.workers as Record<string, unknown>[];
}

describe("worker MCP tools", () => {
  it("runs the full spawn/message/sleep/finish lifecycle and parks the run", async () => {
    const { client } = await fixture();
    const spawned = structured(await client.callTool({
      name: "worker_spawn",
      arguments: {
        primeAlias: "shop",
        sharedContext: "Repo uses strict TS.",
        workers: [{ task: "Fix cart bug", label: "cart" }, { task: "Write test", alias: "shop-test" }],
      },
    }));
    expect(spawned.primeAlias).toBe("shop");
    expect(workersOf(spawned).length).toBe(2);
    expect(spawned.parked).toBe(false);
    const runId = spawned.runId as string;
    const first = workersOf(spawned)[0]!;
    const second = workersOf(spawned)[1]!;
    expect(first.task as string).toContain("Repo uses strict TS.");
    expect(first.task as string).toContain("Fix cart bug");

    const messaged = structured(await client.callTool({
      name: "worker_message",
      arguments: { runId, workerId: first.id, message: "Focus on checkout first." },
    }));
    expect(workersOf(messaged)[0]).toMatchObject({ id: first.id });

    const slept = structured(await client.callTool({
      name: "worker_sleep",
      arguments: { runId, workerId: second.id },
    }));
    expect(workersOf(slept).find((worker) => worker.id === second.id)?.state).toBe("sleeping");

    const woken = structured(await client.callTool({
      name: "worker_message",
      arguments: { runId, workerId: second.id, message: "Wake up, new info." },
    }));
    expect(workersOf(woken).find((worker) => worker.id === second.id)?.state).toBe("active");

    await client.callTool({
      name: "worker_finish",
      arguments: { runId, workerId: first.id, report: "Cart fixed and verified." },
    });
    const done = structured(await client.callTool({
      name: "worker_finish",
      arguments: { runId, workerId: second.id, report: "Tests green." },
    }));
    expect(done.parked).toBe(true);
    expect(workersOf(done).find((worker) => worker.id === second.id)?.result).toBe("Tests green.");

    const status = structured(await client.callTool({ name: "worker_status", arguments: { runId } }));
    expect(status.parked).toBe(true);

    const terminalMessage = await client.callTool({
      name: "worker_message",
      arguments: { runId, workerId: first.id, message: "Too late." },
    });
    expect(terminalMessage.isError).toBe(true);
    await client.close();
  });

  it("rejects empty spawns, unknown runs and double finish", async () => {
    const { client } = await fixture();
    expect((await client.callTool({
      name: "worker_spawn",
      arguments: { primeAlias: "shop", sharedContext: "", workers: [] },
    })).isError).toBe(true);
    expect((await client.callTool({ name: "worker_status", arguments: { runId: "missing" } })).isError).toBe(true);

    const spawned = structured(await client.callTool({
      name: "worker_spawn",
      arguments: { primeAlias: "shop", sharedContext: "", workers: [{ task: "One job" }] },
    }));
    const runId = spawned.runId as string;
    const workerId = workersOf(spawned)[0]!.id as string;
    await client.callTool({ name: "worker_finish", arguments: { runId, workerId, report: "Done." } });
    expect((await client.callTool({
      name: "worker_finish",
      arguments: { runId, workerId, report: "Again." },
    })).isError).toBe(true);
    await client.close();
  });
});

describe("handoff_prepare tool", () => {
  it("builds a brief plus the exact replacement bootstrap", async () => {
    const { client } = await fixture();
    const result = structured(await client.callTool({
      name: "handoff_prepare",
      arguments: {
        summary: "Migrated the cart module. NEXT: verify checkout.",
        planSteps: [{ step: "Migrate cart", status: "done" }, { step: "Verify checkout", status: "todo" }],
        continuationToken: "ära-123",
      },
    }));
    expect(result.truncated).toBe(false);
    expect(result.brief as string).toContain("Migrated the cart module.");
    expect(result.brief as string).toContain("[todo] Verify checkout");
    expect(result.bootstrap as string).toContain("ära-123");
    expect(result.bootstrap as string).toContain("Migrated the cart module.");
    await client.close();
  });

  it("flags truncation for oversized summaries", async () => {
    const { client } = await fixture();
    const result = structured(await client.callTool({
      name: "handoff_prepare",
      arguments: {
        summary: `TASK: big\n${"z".repeat(7_900)}\nNEXT: small`,
        planSteps: [{ step: "Extra plan weight", status: "todo", details: "x".repeat(500) }],
      },
    }));
    expect(result.truncated).toBe(true);
    expect(result.brief as string).toContain("TASK: big");
    expect(result.brief as string).toContain("NEXT: small");
    await client.close();
  });
});

describe("goal_advise tool", () => {
  it("advises stop on completion and continue on remaining work", async () => {
    const { client } = await fixture();
    const stop = structured(await client.callTool({
      name: "goal_advise",
      arguments: {
        objective: "Fix cart",
        transcriptTail: "Fix cart is done, tests pass.",
        planSteps: [{ step: "Fix", status: "done" }],
        successCriteria: ["tests pass"],
      },
    }));
    expect(stop.action).toBe("stop");

    const go = structured(await client.callTool({
      name: "goal_advise",
      arguments: {
        objective: "Fix cart",
        transcriptTail: "Started.",
        planSteps: [{ step: "Fix", status: "todo" }],
        successCriteria: [],
      },
    }));
    expect(go.action).toBe("continue");
    expect(go.reply as string).toContain("Fix");
    await client.close();
  });
});
