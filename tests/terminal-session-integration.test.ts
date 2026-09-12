import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { closeRuntimeResources } from "../src/runtime-shutdown.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

interface Fixture {
  root: string;
  auditPath: string;
  runtime: RuntimeServices;
  server: ReturnType<typeof startHttp>;
  client: Client;
  transport: StreamableHTTPClientTransport;
  shutDown: boolean;
}

const fixtures: Fixture[] = [];
const cleanups: string[] = [];

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-terminal-integration-"));
  cleanups.push(root);
  const auditPath = path.join(root, "audit.jsonl");
  const token = "terminal-session-integration-token-0123456789";
  const config = await loadConfig({
    roots: [root],
    auditFile: auditPath,
    personalAdminEnabled: true,
    ownerRuntimeEnabled: true,
    ownerShellPath: "/bin/sh",
    host: "127.0.0.1",
    port: 0,
    token,
  });
  config.limits.processStopGraceMs = 100;
  const runtime = createRuntimeServices(config);
  const server = startHttp(runtime);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "terminal-session-integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  const fixture = { root, auditPath, runtime, server, client, transport, shutDown: false };
  fixtures.push(fixture);
  return fixture;
}

async function stopFixture(fixture: Fixture): Promise<void> {
  try {
    await fixture.transport.terminateSession();
  } catch {}
  try {
    await fixture.client.close();
  } catch {}
  if (!fixture.shutDown) {
    await closeRuntimeResources({
      runtime: fixture.runtime,
      closeTransport: async () => undefined,
    });
    fixture.shutDown = true;
  }
  if (fixture.server.listening) {
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  }
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(stopFixture));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function startAdmin(client: Client): Promise<string> {
  const result = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "admin", requestedTtlSeconds: 300 },
  });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { leaseId: string }).leaseId;
}

async function endAuthority(client: Client, authorityLeaseId: string): Promise<void> {
  const result = await client.callTool({
    name: "session_authority_end",
    arguments: { authorityLeaseId },
  });
  expect(result.isError).not.toBe(true);
}

async function openSession(client: Client, authorityLeaseId: string, cwd: string, cols = 80, rows = 24): Promise<string> {
  const result = await client.callTool({
    name: "terminal_session_open",
    arguments: { authorityLeaseId, cwd, cols, rows },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).not.toHaveProperty("pid");
  return (result.structuredContent as { sessionId: string }).sessionId;
}

async function writeSession(client: Client, authorityLeaseId: string, sessionId: string, data: string): Promise<void> {
  const result = await client.callTool({
    name: "terminal_session_write",
    arguments: { authorityLeaseId, sessionId, data },
  });
  expect(result.isError).not.toBe(true);
}

async function readUntil(
  client: Client,
  authorityLeaseId: string,
  sessionId: string,
  needle: string,
  afterSequence = 0,
): Promise<{ data: string; nextSequence: number }> {
  let combined = "";
  let cursor = afterSequence;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.callTool({
      name: "terminal_session_read",
      arguments: { authorityLeaseId, sessionId, afterSequence: cursor },
    });
    expect(result.isError).not.toBe(true);
    const content = result.structuredContent as {
      data: string;
      nextSequence: number;
      truncatedBefore: boolean;
    };
    expect(content.truncatedBefore).toBe(false);
    combined += content.data;
    cursor = content.nextSequence;
    if (combined.includes(needle)) return { data: combined, nextSequence: cursor };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`PTY marker was not observed: ${needle}`);
}

describe("Owner Runtime PTY integration", () => {
  it("supports real TTY interaction, cursoring, resize, lease handoff, and content-free audit", async () => {
    const fixture = await createFixture();
    const adminA = await startAdmin(fixture.client);
    const sessionId = await openSession(fixture.client, adminA, fixture.root, 80, 24);
    const firstMarker = "PTY_FIRST_MARKER_4f71";
    const secondMarker = "PTY_SECOND_MARKER_7c32";
    const inputSecret = "PTY_INPUT_SECRET_91ab";

    await writeSession(
      fixture.client,
      adminA,
      sessionId,
      `printf 'TTY:%s SIZE:%s ${firstMarker} ${inputSecret}\\n' \"$([ -t 0 ] && echo yes || echo no)\" \"$(stty size)\"\r`,
    );
    const first = await readUntil(fixture.client, adminA, sessionId, firstMarker);
    expect(first.data).toContain("TTY:yes");
    expect(first.data).toMatch(/SIZE:24 80/);

    const duplicateCheck = await fixture.client.callTool({
      name: "terminal_session_read",
      arguments: { authorityLeaseId: adminA, sessionId, afterSequence: first.nextSequence },
    });
    expect(duplicateCheck.isError).not.toBe(true);
    expect(duplicateCheck.structuredContent).toMatchObject({ data: "", nextSequence: first.nextSequence });

    const resized = await fixture.client.callTool({
      name: "terminal_session_resize",
      arguments: { authorityLeaseId: adminA, sessionId, cols: 100, rows: 30 },
    });
    expect(resized.isError).not.toBe(true);
    expect(resized.structuredContent).toMatchObject({ cols: 100, rows: 30 });

    await writeSession(fixture.client, adminA, sessionId, `printf 'SIZE2:%s ${secondMarker}\\n' \"$(stty size)\"\r`);
    const second = await readUntil(fixture.client, adminA, sessionId, secondMarker, first.nextSequence);
    expect(second.data).toMatch(/SIZE2:30 100/);

    await endAuthority(fixture.client, adminA);
    const adminB = await startAdmin(fixture.client);
    const listed = await fixture.client.callTool({
      name: "terminal_session_list",
      arguments: { authorityLeaseId: adminB },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      sessions: [expect.objectContaining({ sessionId, state: "running", cols: 100, rows: 30 })],
    });

    const handoffMarker = "PTY_HANDOFF_MARKER_a245";
    await writeSession(fixture.client, adminB, sessionId, `printf '${handoffMarker}\\n'\r`);
    const handoff = await readUntil(fixture.client, adminB, sessionId, handoffMarker, second.nextSequence);
    expect(handoff.data).toContain(handoffMarker);

    const closed = await fixture.client.callTool({
      name: "terminal_session_close",
      arguments: { authorityLeaseId: adminB, sessionId },
    });
    expect(closed.isError).not.toBe(true);
    expect(closed.structuredContent).toMatchObject({ state: expect.stringMatching(/^(stopped|exited)$/) });
    expect(closed.structuredContent).not.toHaveProperty("pid");

    const audit = await readFile(fixture.auditPath, "utf8");
    expect(audit).not.toContain(firstMarker);
    expect(audit).not.toContain(secondMarker);
    expect(audit).not.toContain(handoffMarker);
    expect(audit).not.toContain(inputSecret);
    expect(audit).not.toContain(sessionId);
  });

  it("closeRuntimeResources terminates an active PTY session without leaving it running", async () => {
    const fixture = await createFixture();
    const admin = await startAdmin(fixture.client);
    const sessionId = await openSession(fixture.client, admin, fixture.root);
    await writeSession(fixture.client, admin, sessionId, "while :; do sleep 1; done\r");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fixture.runtime.terminalSessionSupervisor.status(sessionId)?.state).toBe("running");

    const started = Date.now();
    await closeRuntimeResources({
      runtime: fixture.runtime,
      closeTransport: async () => undefined,
    });
    fixture.shutDown = true;

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fixture.runtime.terminalSessionSupervisor.status(sessionId)?.state).toBe("stopped");
  });
});
