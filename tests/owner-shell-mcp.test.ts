import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { registerOwnerShellTool } from "../src/owner-shell-tool-registration.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

async function closeRuntime(runtime: RuntimeServices): Promise<void> {
  await runtime.computerJs.close();
  await runtime.computer.close();
  await runtime.ownerShellSupervisor.close();
  await runtime.processSupervisor.close();
  await runtime.browser.close();
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(closeRuntime));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(ownerRuntimeEnabled: boolean, legacyCommandTimeoutMs?: number) {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-shell-mcp-"));
  cleanups.push(root);
  const token = "owner-shell-mcp-token-0123456789";
  const config = await loadConfig({
    roots: [root],
    personalAdminEnabled: true,
    ownerRuntimeEnabled,
    ownerShellPath: "/bin/sh",
    terminalEnabled: true,
    commands: ["node"],
    host: "127.0.0.1",
    port: 0,
    token,
  });
  if (legacyCommandTimeoutMs !== undefined) config.limits.commandTimeoutMs = legacyCommandTimeoutMs;
  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "owner-shell-mcp-test", version: "1.0.0" });
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

describe("shell_run MCP tool", () => {
  it("registers one strict destructive open-world Owner shell tool", async () => {
    const { client, transport } = await fixture(true);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "shell_run");
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool?.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("denies Project, denies disabled Admin, permits enabled Admin, and leaves terminal_run narrow", async () => {
    const enabled = await fixture(true);
    try {
      const project = await enabled.runtime.authority.start({ profile: "project", projectRoots: [enabled.root] });
      const denied = await enabled.client.callTool({
        name: "shell_run",
        arguments: { authorityLeaseId: project.leaseId, script: "printf no" },
      });
      expect(denied.isError).toBe(true);
      expect(textContent(denied)).toContain("POLICY_DENIED");

      const user = await enabled.runtime.authority.start({ profile: "user" });
      const userDenied = await enabled.client.callTool({
        name: "shell_run",
        arguments: { authorityLeaseId: user.leaseId, script: "printf no" },
      });
      expect(userDenied.isError).toBe(true);
      expect(textContent(userDenied)).toContain("POLICY_DENIED");

      const admin = await enabled.runtime.authority.start({ profile: "admin" });
      const success = await enabled.client.callTool({
        name: "shell_run",
        arguments: { authorityLeaseId: admin.leaseId, cwd: enabled.root, script: "printf 'alpha' | tr a-z A-Z" },
      });
      expect(success.isError).not.toBe(true);
      expect(success.structuredContent).toMatchObject({
        cwd: enabled.root,
        exitCode: 0,
        stdout: "ALPHA",
        stdoutTruncated: false,
        timedOut: false,
      });

      const terminalStillNarrow = await enabled.client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: admin.leaseId, command: "sh", args: ["-c", "printf nope"], cwd: enabled.root },
      });
      expect(terminalStillNarrow.isError).toBe(true);
      expect(textContent(terminalStillNarrow)).toContain("POLICY_DENIED");
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }

    const disabled = await fixture(false);
    try {
      const admin = await disabled.runtime.authority.start({ profile: "admin" });
      const result = await disabled.client.callTool({
        name: "shell_run",
        arguments: { authorityLeaseId: admin.leaseId, script: "printf no" },
      });
      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("OWNER_RUNTIME_DISABLED");
    } finally {
      await disabled.transport.terminateSession();
      await disabled.client.close();
    }
  });

  it("lets Admin use cwd outside the bootstrap root and ignores the legacy terminal timeout when no shell timeout is supplied", async () => {
    const enabled = await fixture(true, 10);
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-shell-outside-"));
    cleanups.push(outsideRoot);
    try {
      const admin = await enabled.runtime.authority.start({ profile: "admin" });
      const result = await enabled.client.callTool({
        name: "shell_run",
        arguments: {
          authorityLeaseId: admin.leaseId,
          cwd: outsideRoot,
          script: "sleep 0.08; pwd",
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        cwd: outsideRoot,
        exitCode: 0,
        timedOut: false,
      });
      expect((result.structuredContent as { stdout: string }).stdout.trim()).toBe(await realpath(outsideRoot));
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }
  });

  it("rejects unexpected fields and invalid timeout values at the MCP schema", async () => {
    const enabled = await fixture(true);
    try {
      const admin = await enabled.runtime.authority.start({ profile: "admin" });
      const unexpected = await enabled.client.callTool({
        name: "shell_run",
        arguments: { authorityLeaseId: admin.leaseId, script: "printf no", unexpected: true },
      });
      expect(unexpected.isError).toBe(true);

      const invalidTimeout = await enabled.client.callTool({
        name: "shell_run",
        arguments: { authorityLeaseId: admin.leaseId, script: "printf no", timeoutMs: 0 },
      });
      expect(invalidTimeout.isError).toBe(true);
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }
  });
  it("passes the MCP request AbortSignal into the owned shell execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-shell-signal-"));
    cleanups.push(root);
    const config = await loadConfig({
      roots: [root],
      personalAdminEnabled: true,
      ownerRuntimeEnabled: true,
      ownerShellPath: "/bin/sh",
    });
    const runtime = createRuntimeServices(config);
    runtimes.push(runtime);
    const admin = await runtime.authority.start({ profile: "admin" });
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    runtime.ownerShellSupervisor.run = async (input) => {
      observedSignal = input.signal;
      return {
        cwd: input.cwd,
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        stdoutBytesSeen: 0,
        stderrBytesSeen: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
      };
    };

    let handler: ((input: Record<string, unknown>, ctx: { mcpReq: { signal?: AbortSignal } }) => Promise<unknown>) | undefined;
    const fakeServer = {
      registerTool: (_name: string, _definition: unknown, candidate: typeof handler) => { handler = candidate; },
    };
    registerOwnerShellTool(fakeServer as never, runtime);
    expect(handler).toBeDefined();
    await handler!({ authorityLeaseId: admin.leaseId, script: "printf ok" }, { mcpReq: { signal: controller.signal } });
    expect(observedSignal).toBe(controller.signal);
  });


});
