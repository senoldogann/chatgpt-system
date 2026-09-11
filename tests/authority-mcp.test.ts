import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
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

async function fixture(options: { personalAdmin?: boolean; terminalEnabled?: boolean } = {}) {
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
    terminal: { enabled: options.terminalEnabled ?? false, commands: ["node", "git"] },
    projectExec: { enabled: false },
    continuity: {
      databasePath: path.join(path.dirname(path.join(base, "audit.jsonl")), "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },

    personalAdmin: { enabled: options.personalAdmin ?? false },
    computerUse: {
      enabled: true,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
    },
    http: { host: "127.0.0.1", port: 0, token },
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
  it("reports personal admin capability state", async () => {
    const { client, transport } = await fixture({ personalAdmin: true });
    try {
      const capabilities = await client.callTool({ name: "system_capabilities", arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({
        personalAdmin: { enabled: true, adminLeaseMaxTtlSeconds: 3600 },
        computerUse: { enabled: true, fullHostJsEnabled: false },
        projectExecution: {
          enabled: false,
          sandboxed: true,
          backend: "docker",
          network: "none",
          hostFallback: false,
          image: "chatgpt-system-project-exec:0.1.0",
        },
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("mints personal Admin without bypassing the runtime terminal gate", async () => {
    for (const terminalEnabled of [false, true]) {
      const { client, transport } = await fixture({ personalAdmin: true, terminalEnabled });
      try {
        const started = await client.callTool({
          name: "session_authority_start",
          arguments: { profile: "admin", requestedTtlSeconds: 60 },
        });
        expect(started.isError).not.toBe(true);
        expect(started.structuredContent).toMatchObject({
          profile: "admin",
          roots: ["/"],
          terminalEnabled,
          commands: terminalEnabled ? ["node", "git"] : [],
        });
      } finally {
        await transport.terminateSession();
        await client.close();
      }
    }
  });

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
      const canonicalRoot = await realpath(root);
      const started = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
      });
      expect(started.isError).not.toBe(true);
      expect(started.structuredContent).toMatchObject({
        leaseId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
        profile: "project",
        roots: [canonicalRoot],
        terminalEnabled: false,
        commands: [],
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      });

      const leaseId = (started.structuredContent as { leaseId: string }).leaseId;
      const status = await client.callTool({
        name: "session_authority_status",
        arguments: { authorityLeaseId: leaseId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        leaseId,
        profile: "project",
        roots: [canonicalRoot],
        terminalEnabled: false,
        commands: [],
      });

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
        "git_status", "git_diff", "git_log",
        "git_create_branch", "git_switch_branch", "git_stage_paths", "git_commit", "git_merge_branch", "git_push",
        "terminal_run",
      ];
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of privileged) {
        const schema = byName.get(name)?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
        expect(schema?.properties).toHaveProperty("authorityLeaseId");
        expect(schema?.required).toContain("authorityLeaseId");
      }

      const pushSchema = byName.get("git_push")?.inputSchema as {
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      } | undefined;
      expect(Object.keys(pushSchema?.properties ?? {}).sort()).toEqual(["authorityLeaseId", "cwd"]);
      expect(pushSchema?.additionalProperties).toBe(false);

      const noLease = await client.callTool({ name: "fs_read", arguments: { path: "fixture.txt" } });
      expect(noLease.isError).toBe(true);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("confines project lease reads and rejects all terminal execution", async () => {
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

      for (const [command, args] of [["sh", ["-c", "echo nope"]], ["node", ["--version"]]] as const) {
        const denied = await client.callTool({
          name: "terminal_run",
          arguments: { authorityLeaseId: leaseId, command, args: [...args], cwd: root },
        });
        expect(denied.isError).toBe(true);
        expect(textContent(denied)).toContain("POLICY_DENIED");
      }

      const pushDenied = await client.callTool({
        name: "git_push",
        arguments: { authorityLeaseId: leaseId, cwd: root },
      });
      expect(pushDenied.isError).toBe(true);
      expect(textContent(pushDenied)).toContain("POLICY_DENIED");
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
