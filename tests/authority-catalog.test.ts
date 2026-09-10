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
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(personalAdmin = false) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-authority-catalog-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "authority-catalog-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    computerUse: {
      enabled: false,
      hostBundlePath: "/tmp/ChatGPTSystemComputerRuntime.app",
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
    },
    personalAdmin: { enabled: personalAdmin },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
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
  const client = new Client({ name: "authority-catalog-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, client, transport };
}

describe("default authority MCP catalog", () => {
  it("advertises project creation only and hides local user/admin approval tools", async () => {
    const { client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("session_authority_start");
      expect(names).not.toContain("session_authority_request");
      expect(names).not.toContain("session_authority_request_status");

      const start = tools.find((tool) => tool.name === "session_authority_start");
      expect(start?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          profile: { const: "project" },
        },
        required: expect.arrayContaining(["profile", "projectRoots"]),
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
  it("advertises and accepts direct Admin creation only in personal-admin mode", async () => {
    const { client, transport } = await fixture(true);
    try {
      const { tools } = await client.listTools();
      const start = tools.find((tool) => tool.name === "session_authority_start");
      expect(JSON.stringify(start?.inputSchema)).toContain('"admin"');

      const admin = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "admin", requestedTtlSeconds: 60 },
      });
      expect(admin.isError).not.toBe(true);
      expect(admin.structuredContent).toMatchObject({
        profile: "admin", roots: ["/"], terminalEnabled: false, commands: [],
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

});
