import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { closeRuntimeResources } from "../src/runtime-shutdown.js";
import { createRuntimeServices } from "../src/server.js";
import { SessionEventStore } from "../src/session-event-store.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(enabled: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), "session-event-runtime-"));
  cleanups.push(root);
  const project = path.join(root, "project");
  const taskStateRoot = path.join(root, "state");
  await mkdir(project, { mode: 0o700 });
  const config = await loadConfig({
    roots: [project], auditFile: path.join(root, "audit.jsonl"),
    continuityDatabasePath: path.join(root, "continuity", "continuity.db"),
    sessionEventsEnabled: enabled,
    terminalEnabled: false, projectExecEnabled: false, personalAdminEnabled: false,
    computerUseEnabled: false, fullHostJsEnabled: false, browserEnabled: false, controlEnabled: false,
  });
  return { root, config, taskStateRoot, databasePath: path.join(taskStateRoot, "session-events", "metadata.db") };
}

describe("session event runtime opt-in", () => {
// Centralize runtime construction so every test uses fixture()'s private audit path.
function fixtureRuntime(test: Awaited<ReturnType<typeof fixture>>, injected?: SessionEventStore) {
  return createRuntimeServices(test.config, {
    taskStateRoot: test.taskStateRoot,
    ...(injected ? { sessionEventStore: injected } : {}),
  });
}

  it("does not construct a metadata store or create a database when disabled", async () => {
    const test = await fixture(false);
    const runtime = fixtureRuntime(test);
    expect(runtime.sessionEventStore).toBeUndefined();
    await expect(stat(test.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
    await closeRuntimeResources({ runtime, closeTransport: async () => {} });
    await expect(stat(test.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists metadata only under injected test root and owns shutdown", async () => {
    const test = await fixture(true);
    const runtime = fixtureRuntime(test);
    expect(runtime.sessionEventStore).toBeInstanceOf(SessionEventStore);
    const created = runtime.sessionEventStore!.createSession("verified-fixture-project");
    expect((await stat(test.databasePath)).isFile()).toBe(true);
    const spy = vi.spyOn(runtime.sessionEventStore!, "close");
    await closeRuntimeResources({ runtime, closeTransport: async () => {} });
    expect(spy).toHaveBeenCalledTimes(1);
    const reopened = new SessionEventStore({ databasePath: test.databasePath });
    try { expect(reopened.getSession(created.sessionId, "verified-fixture-project")).toEqual(created); }
    finally { reopened.close(); }
  });

  it("refuses injected store when disabled instead of silently enabling it", async () => {
    const test = await fixture(false);
    const injected = new SessionEventStore({ databasePath: path.join(test.root, "injected", "metadata.db") });
    try {
      expect(() => fixtureRuntime(test, injected)).toThrow();
      await expect(stat(test.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { injected.close(); }
  });

  it("does not add or remove any MCP tools when metadata storage is enabled", async () => {
    async function listTools(enabled: boolean): Promise<string[]> {
      const test = await fixture(enabled);
      test.config.http.port = 0;
      test.config.http.token = "session-metadata-test-token-0123456789";
      const runtime = fixtureRuntime(test);
      const http = startHttp(runtime);
      const client = new Client({ name: "session-event-catalog-test", version: "1.0.0" });
      try {
        await once(http, "listening");
        const address = http.address() as AddressInfo;
        const connection = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${test.config.http.token}` } },
        });
        await client.connect(connection);
        try {
          return (await client.listTools()).tools.map((tool) => tool.name).sort();
        } finally {
          await connection.terminateSession();
          await client.close();
        }
      } finally {
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await closeRuntimeResources({ runtime, closeTransport: async () => {} });
      }
    }
    const disabled = await listTools(false);
    const enabled = await listTools(true);
    expect(enabled).toEqual(disabled);
    expect(enabled.some((name) => name.startsWith("session_event_"))).toBe(false);
  });
});
