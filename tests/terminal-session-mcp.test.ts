import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

async function closeRuntime(runtime: RuntimeServices): Promise<void> {
  await runtime.computerJs.close();
  await runtime.computer.close();
  await (runtime as RuntimeServices & { terminalSessionSupervisor?: { close(): Promise<void> } }).terminalSessionSupervisor?.close();
  await runtime.ownerShellSupervisor.close();
  await runtime.processSupervisor.close();
  await runtime.browser.close();
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(closeRuntime));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(ownerRuntimeEnabled: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-terminal-mcp-"));
  cleanups.push(root);
  const token = "terminal-session-mcp-token-0123456789";
  // Keep the operator's real audit log out of the test suite; the default path is
  // ~/.chatgpt-system/audit.jsonl and we use that file as failure-boundary evidence.
  const auditDir = await mkdtemp(path.join(tmpdir(), "chatgpt-system-terminal-audit-"));
  cleanups.push(auditDir);
  const config = await loadConfig({
    roots: [root],
    auditFile: path.join(auditDir, "audit.jsonl"),
    ownerRuntimeEnabled,
    ownerShellPath: "/bin/sh",
    terminalEnabled: true,
    commands: ["node"],
    host: "127.0.0.1",
    port: 0,
    token,
  });
  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "terminal-session-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, runtime, client, transport };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function waitForOutput(client: Client, authorityLeaseId: string, sessionId: string, needle: string) {
  let afterSequence = 0;
  let data = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await client.callTool({
      name: "terminal_session_read",
      arguments: { authorityLeaseId, sessionId, afterSequence },
    });
    expect(result.isError).not.toBe(true);
    const content = result.structuredContent as { data: string; nextSequence: number };
    data += content.data;
    afterSequence = content.nextSequence;
    if (data.includes(needle)) return { data, afterSequence };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected PTY output marker was not observed: ${needle}`);
}

const terminalToolNames = [
  "terminal_session_open",
  "terminal_session_read",
  "terminal_session_write",
  "terminal_session_resize",
  "terminal_session_close",
  "terminal_session_list",
] as const;

describe("terminal_session MCP tools", () => {
  it("registers exactly six strict Owner Runtime terminal tools with no PID/signal/shell inputs", async () => {
    const { client, transport } = await fixture(true);
    try {
      const { tools } = await client.listTools();
      const terminalTools = tools.filter((tool) => terminalToolNames.includes(tool.name as typeof terminalToolNames[number]));
      expect(terminalTools.map((tool) => tool.name).sort()).toEqual([...terminalToolNames].sort());

      for (const tool of terminalTools) {
        expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
        expect(tool.outputSchema).toMatchObject({ type: "object" });
        const schema = JSON.stringify(tool.inputSchema);
        expect(schema).not.toContain('"pid"');
        expect(schema).not.toContain('"signal"');
        expect(schema).not.toContain('"shellPath"');
        expect(schema).not.toContain('"env"');
      }

      expect(tools.find((tool) => tool.name === "terminal_session_read")?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tools.find((tool) => tool.name === "terminal_session_list")?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      for (const name of ["terminal_session_open", "terminal_session_write", "terminal_session_close"] as const) {
        expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        });
      }
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("lets an enabled Project lease use the PTY lifecycle and denies it when the runtime is disabled", async () => {
    const enabled = await fixture(true);
    try {
      // Serbest mod: project lease tam yetkilidir; ayrı Admin kapısı yoktur.
      const project = await enabled.runtime.authority.start({ profile: "project", projectRoots: [enabled.root] });
      const opened = await enabled.client.callTool({
        name: "terminal_session_open",
        arguments: { authorityLeaseId: project.leaseId, cwd: enabled.root, cols: 80, rows: 24 },
      });
      expect(opened.isError).not.toBe(true);
      const sessionId = (opened.structuredContent as { sessionId: string }).sessionId;
      expect(opened.structuredContent).not.toHaveProperty("pid");

      const listed = await enabled.client.callTool({
        name: "terminal_session_list",
        arguments: { authorityLeaseId: project.leaseId },
      });
      expect(listed.structuredContent).toMatchObject({ sessions: [expect.objectContaining({ sessionId, state: "running" })] });

      const resized = await enabled.client.callTool({
        name: "terminal_session_resize",
        arguments: { authorityLeaseId: project.leaseId, sessionId, cols: 100, rows: 30 },
      });
      expect(resized.isError).not.toBe(true);
      expect(resized.structuredContent).toMatchObject({ cols: 100, rows: 30 });

      const written = await enabled.client.callTool({
        name: "terminal_session_write",
        arguments: { authorityLeaseId: project.leaseId, sessionId, data: "printf 'MCP_PTY_OK\\n'\r" },
      });
      expect(written.isError).not.toBe(true);
      const observed = await waitForOutput(enabled.client, project.leaseId, sessionId, "MCP_PTY_OK");
      expect(observed.data).toContain("MCP_PTY_OK");

      // Lease verilmeden de açık kapsamla aynı yaşam döngüsü çalışır.
      const openListed = await enabled.client.callTool({
        name: "terminal_session_list",
        arguments: {},
      });
      expect(openListed.isError).not.toBe(true);
      expect(openListed.structuredContent).toMatchObject({ sessions: [expect.objectContaining({ sessionId })] });

      const closed = await enabled.client.callTool({
        name: "terminal_session_close",
        arguments: { authorityLeaseId: project.leaseId, sessionId },
      });
      expect(closed.isError).not.toBe(true);
      expect(closed.structuredContent).toMatchObject({ state: "stopped" });
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }

    const disabled = await fixture(false);
    try {
      // Kapalı Owner Runtime: araç kataloğa yayınlanmaz ve çağrılamaz.
      const { tools } = await disabled.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain("terminal_session_open");
      const project = await disabled.runtime.authority.start({ profile: "project", projectRoots: [disabled.root] });
      await expect(disabled.client.callTool({
        name: "terminal_session_open",
        arguments: { authorityLeaseId: project.leaseId },
      })).rejects.toThrow(/not found/i);
    } finally {
      await disabled.transport.terminateSession();
      await disabled.client.close();
    }
  });

  it("rejects unexpected fields and malformed terminal session arguments at the MCP schema", async () => {
    const enabled = await fixture(true);
    try {
      const project = await enabled.runtime.authority.start({ profile: "project", projectRoots: [enabled.root] });
      const unexpected = await enabled.client.callTool({
        name: "terminal_session_open",
        arguments: { authorityLeaseId: project.leaseId, unexpected: true },
      });
      expect(unexpected.isError).toBe(true);

      const invalidResize = await enabled.client.callTool({
        name: "terminal_session_resize",
        arguments: { authorityLeaseId: project.leaseId, sessionId: "x".repeat(43), cols: 0, rows: 24 },
      });
      expect(invalidResize.isError).toBe(true);

      const emptyWrite = await enabled.client.callTool({
        name: "terminal_session_write",
        arguments: { authorityLeaseId: project.leaseId, sessionId: "x".repeat(43), data: "" },
      });
      expect(emptyWrite.isError).toBe(true);
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }
  });
});
