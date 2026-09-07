import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  const sibling = path.join(base, "sibling");
  await mkdir(root);
  await mkdir(sibling);
  await writeFile(path.join(root, "fixture.txt"), "before\n", "utf8");
  await writeFile(path.join(sibling, "outside.txt"), "outside\n", "utf8");

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
  return { base, root, sibling, client, transport };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function startProjectLease(client: Client, root: string): Promise<string> {
  const started = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(started.isError).not.toBe(true);
  return (started.structuredContent as { leaseId: string }).leaseId;
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
      expect(textContent(afterEnd)).toContain("AUTHORITY_REQUIRED");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("requires an authority lease on every privileged filesystem, git, and terminal tool", async () => {
    const { client, transport } = await fixture();
    try {
      const privileged = [
        "fs_list", "fs_stat", "fs_read", "fs_write", "fs_apply_patch", "fs_mkdir", "fs_move", "fs_remove",
        "git_status", "git_diff", "git_log", "terminal_run",
      ];
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of privileged) {
        const schema = byName.get(name)?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
        expect(schema?.properties).toHaveProperty("authorityLeaseId");
        expect(schema?.required).toContain("authorityLeaseId");
      }

      const noLease = await client.callTool({ name: "fs_read", arguments: { path: "fixture.txt" } });
      expect(noLease.isError).toBe(true);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("confines project lease reads and enables allowlisted terminal only inside scope", async () => {
    const { root, sibling, client, transport } = await fixture();
    try {
      const leaseId = await startProjectLease(client, root);

      const inside = await client.callTool({
        name: "fs_read",
        arguments: { authorityLeaseId: leaseId, path: "fixture.txt", encoding: "utf8" },
      });
      expect(inside.isError).not.toBe(true);
      expect(inside.structuredContent).toMatchObject({ content: "before\n" });

      const outside = await client.callTool({
        name: "fs_read",
        arguments: { authorityLeaseId: leaseId, path: path.join(sibling, "outside.txt"), encoding: "utf8" },
      });
      expect(outside.isError).toBe(true);
      expect(textContent(outside)).toContain("POLICY_DENIED");

      const deniedCommand = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: leaseId, command: "sh", args: ["-c", "echo nope"], cwd: root },
      });
      expect(deniedCommand.isError).toBe(true);
      expect(textContent(deniedCommand)).toContain("POLICY_DENIED");

      const nodeVersion = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: leaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(nodeVersion.isError).not.toBe(true);
      expect(nodeVersion.structuredContent).toMatchObject({ exitCode: 0, timedOut: false });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("revokes guarded writes immediately when a lease ends", async () => {
    const { root, client, transport } = await fixture();
    try {
      const leaseId = await startProjectLease(client, root);
      const read = await client.callTool({
        name: "fs_read",
        arguments: { authorityLeaseId: leaseId, path: "fixture.txt", encoding: "utf8" },
      });
      const sha256 = (read.structuredContent as { sha256: string }).sha256;

      const written = await client.callTool({
        name: "fs_write",
        arguments: {
          authorityLeaseId: leaseId,
          path: "fixture.txt",
          content: "after\n",
          encoding: "utf8",
          expectedSha256: sha256,
        },
      });
      expect(written.isError).not.toBe(true);

      await client.callTool({ name: "session_authority_end", arguments: { authorityLeaseId: leaseId } });

      const afterEnd = await client.callTool({
        name: "fs_write",
        arguments: {
          authorityLeaseId: leaseId,
          path: "fixture.txt",
          content: "forbidden\n",
          encoding: "utf8",
          expectedSha256: (written.structuredContent as { sha256: string }).sha256,
        },
      });
      expect(afterEnd.isError).toBe(true);
      expect(textContent(afterEnd)).toContain("AUTHORITY_REQUIRED");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
