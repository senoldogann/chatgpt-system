import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/core/config.js";
import { createRuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-authority-catalog-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "authority-catalog-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    projectExec: { enabled: false },
    continuity: {
      databasePath: path.join(path.dirname(path.join(base, "audit.jsonl")), "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },
    // Serbest model: kişisel yönetici alanı yoktur.
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
      hostBundlePath: "/tmp/ChatGPTSystemComputerRuntime.app",
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
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
  const client = new Client({ name: "authority-catalog-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, client, transport };
}

describe("default authority MCP catalog", () => {
  it("advertises project creation only and hides local user/admin approval tools", async () => {
    const { root, client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("session_authority_start");
      // Kapalı yeteneklerin araçları kataloğa hiç yayınlanmaz.
      expect(names).not.toContain("shell_run");
      expect(names).not.toContain("session_authority_request");
      expect(names).not.toContain("session_authority_request_status");
      // Kalıcı sahip aracı serbest modelde yoktur.
      expect(names).not.toContain("persistent_owner_mode");

      const start = tools.find((tool) => tool.name === "session_authority_start");
      expect(start?.description).toMatch(/outside.*bootstrap roots/i);
      expect(start?.description).toMatch(/project_register.*project_resume/i);
      expect(JSON.stringify(start?.inputSchema)).not.toContain('"admin"');
      expect(start?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          profile: { const: "project" },
        },
        required: ["projectRoots"],
      });

      const capabilities = await client.callTool({ name: "system_capabilities", arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).not.toHaveProperty("personalAdmin");
      expect(capabilities.structuredContent).not.toHaveProperty("persistentOwnerMode");
      expect(capabilities.structuredContent).toMatchObject({
        skills: { enabled: true },
        goal: { enabled: true },
        workers: { enabled: true },
      });

      const lease = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 60 },
      });
      expect(lease.isError).not.toBe(true);
      expect(lease.structuredContent).toMatchObject({ profile: "project", terminalEnabled: false, commands: [] });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
  it("rejects admin creation and requires explicit project roots", async () => {
    const { root, client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const start = tools.find((tool) => tool.name === "session_authority_start");
      expect(JSON.stringify(start?.inputSchema)).not.toContain('"admin"');

      // Yönetici profili artık geçersizdir.
      const admin = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "admin", requestedTtlSeconds: 60 },
      });
      expect(admin.isError).toBe(true);

      const missingRoots = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "project" },
      });
      expect(missingRoots.isError).toBe(true);

      const project = await client.callTool({
        name: "session_authority_start",
        arguments: { projectRoots: [root], requestedTtlSeconds: 60 },
      });
      expect(project.isError).not.toBe(true);
      expect(project.structuredContent).toMatchObject({ profile: "project" });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

});
