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

async function closeServer(server: ReturnType<typeof startHttp>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-authority-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);

  const token = "authority-integration-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    http: { host: "127.0.0.1", port: 0, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 2_000,
    },
  };

  const server = startHttp(createRuntimeServices(config));
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "authority-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, client, transport };
}

describe("session authority MCP tools", () => {
  it("discovers explicit session tools with schemas and annotations", async () => {
    const { client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      for (const name of ["session_authority_start", "session_authority_status", "session_authority_end"]) {
        const tool = byName.get(name);
        expect(tool, `missing ${name}`).toBeDefined();
        expect(tool?.outputSchema).toMatchObject({ type: "object" });
        expect(tool?.annotations).toMatchObject({ openWorldHint: false });
      }

      expect(byName.get("session_authority_start")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
      expect(byName.get("session_authority_status")?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(byName.get("session_authority_end")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("starts, inspects, and revokes a project authority lease", async () => {
    const { root, client, transport } = await fixture();
    try {
      const started = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
      });
      expect(started.isError).not.toBe(true);
      expect(started.structuredContent).toMatchObject({
        leaseId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
        profile: "project",
        roots: [root],
        terminalEnabled: true,
        commands: expect.arrayContaining(["node", "git"]),
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      });

      const leaseId = (started.structuredContent as { leaseId: string }).leaseId;
      const status = await client.callTool({
        name: "session_authority_status",
        arguments: { authorityLeaseId: leaseId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({ leaseId, profile: "project", roots: [root] });

      const ended = await client.callTool({
        name: "session_authority_end",
        arguments: { authorityLeaseId: leaseId },
      });
      expect(ended.isError).not.toBe(true);
      expect(ended.structuredContent).toEqual({ ended: true });

      const afterEnd = await client.callTool({
        name: "session_authority_status",
        arguments: { authorityLeaseId: leaseId },
      });
      expect(afterEnd.isError).toBe(true);
      expect(afterEnd.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("AUTHORITY_REQUIRED") }),
      ]));
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
