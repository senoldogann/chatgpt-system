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
  system_environment: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  session_authority_start: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  session_authority_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  session_authority_end: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  fs_list: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_stat: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_write: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_apply_patch: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_apply_patch_set: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  fs_mkdir: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  fs_move: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_remove: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  git_status: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_diff: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_log: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_create_branch: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  git_switch_branch: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  git_stage_paths: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  git_commit: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  git_merge_branch: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  git_push: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  terminal_run: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  process_start: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  process_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  process_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  process_logs: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  process_stop: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  code_query: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  task_state: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  project_exec: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  browser_health: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_tabs: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_new_tab: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_select_tab: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_close_tab: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_navigate: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_snapshot: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_click: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_fill: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_select_option: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_press_key: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  browser_wait_for_text: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_screenshot: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_console_errors: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_network_errors: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  browser_close: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_health: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_observe: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_screenshot: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_pointer_position: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_open_app: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_focus_app: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_move_mouse: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_click: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_drag: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_scroll: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_type_text: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_press_key: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_release_inputs: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_wait_for_frontmost: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_wait_for_text: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_wait_until_changed: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  computer_run: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  computer_run_js: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
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
  const compactModeDirectory = path.join(root, "compact-mode-dir");
  await mkdir(compactModeDirectory);
  await chmod(compactModeDirectory, 0o000);

  const token = "integration-test-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node"] },
    projectExec: { enabled: false },
    computerUse: {
      enabled: false,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
      maxManagedProcesses: 32,
      maxProcessLogBytesPerStream: 131_072,
      processStopGraceMs: 3_000,
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
    const { root, baseUrl, token } = await fixture();
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
        limits: {
          maxManagedProcesses: 32,
          maxProcessLogBytesPerStream: 131_072,
          processStopGraceMs: 3_000,
        },
        safety: { terminalOsSandboxed: false },
      });

      const started = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
      });
      expect(started.isError).not.toBe(true);
      const authorityLeaseId = (started.structuredContent as { leaseId: string }).leaseId;

      const compactModeStat = await client.callTool({
        name: "fs_stat",
        arguments: { authorityLeaseId, path: "compact-mode-dir" },
      });
      expect(compactModeStat.isError).not.toBe(true);
      expect(compactModeStat.structuredContent).toMatchObject({
        type: "directory",
        mode: "00",
      });

      const result = await client.callTool({
        name: "fs_read",
        arguments: { authorityLeaseId, path: "hello.txt", encoding: "utf8" },
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