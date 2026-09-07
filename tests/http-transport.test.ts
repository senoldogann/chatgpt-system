import { once } from "node:events";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

const expectedAnnotations = {
  system_capabilities: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_list: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_stat: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_write: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_apply_patch: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_mkdir: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  fs_move: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_remove: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  git_status: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_diff: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_log: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  terminal_run: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
} as const;

async function closeServer(server: ReturnType<typeof startHttp>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-http-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  await writeFile(path.join(root, "hello.txt"), "hello from mcp\n", "utf8");
  const compactModeFile = path.join(root, "compact-mode.txt");
  await writeFile(compactModeFile, "mode test\n", "utf8");
  await chmod(compactModeFile, 0o000);

  const token = "integration-test-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node"] },
    http: { host: "127.0.0.1", port: 0, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
  };

  const server = startHttp(createRuntimeServices(config));
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    root,
    token,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("HTTP MCP transport", () => {
  it("serves health and rejects unauthenticated MCP requests", async () => {
    const { baseUrl } = await fixture();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, name: "chatgpt-system" });

    const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects hostile browser origins on the loopback listener", async () => {
    const { baseUrl, token } = await fixture();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://attacker.example",
      },
    });

    expect(response.status).toBe(403);
  });

  it("completes a real MCP handshake and exposes structured, safety-described tools", async () => {
    const { baseUrl, token } = await fixture();
    const client = new Client({ name: "chatgpt-system-integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${token}` },
      },
    });

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: "chatgpt-system", version: "0.1.0" });

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(expectedAnnotations).sort());

      for (const tool of tools) {
        const expected = expectedAnnotations[tool.name as keyof typeof expectedAnnotations];
        expect(expected, `unexpected tool ${tool.name}`).toBeDefined();
        expect(tool.annotations).toMatchObject(expected);
        expect(tool.outputSchema).toMatchObject({ type: "object" });
      }

      const capabilities = await client.callTool({ name: "system_capabilities", arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({
        terminal: { enabled: false },
        safety: { terminalOsSandboxed: false },
      });

      const compactModeStat = await client.callTool({
        name: "fs_stat",
        arguments: { path: "compact-mode.txt" },
      });
      expect(compactModeStat.isError).not.toBe(true);
      expect(compactModeStat.structuredContent).toMatchObject({ mode: "00" });

      const result = await client.callTool({
        name: "fs_read",
        arguments: { path: "hello.txt", encoding: "utf8" },
      });
      expect(result.isError).not.toBe(true);
      expect(textContent(result)).toContain("hello from mcp");
      expect(result.structuredContent).toMatchObject({
        path: "hello.txt",
        encoding: "utf8",
        content: "hello from mcp\n",
        bytes: 15,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
