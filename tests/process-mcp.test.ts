import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-process-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "process-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands: ["node", "git"] },
    projectExec: { enabled: false },
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
  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "process-mcp-test", version: "1.0.0" });
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

async function waitForLogs(client: Client, authorityLeaseId: string, processId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logs = await client.callTool({ name: "process_logs", arguments: { authorityLeaseId, processId } });
    const stdout = (logs.structuredContent as { stdout?: { content?: string } } | undefined)?.stdout?.content ?? "";
    if (stdout.includes("process-ready")) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for process logs");
}

describe("managed process MCP tools", () => {
  it("exposes strict schemas and manages a process across compatible Admin leases", async () => {
    const { root, runtime, client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of ["process_start", "process_list", "process_status", "process_logs", "process_stop"]) {
        expect(byName.get(name), `missing ${name}`).toBeDefined();
        expect(byName.get(name)?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }

      const adminA = await runtime.authority.start({ profile: "admin", requestedTtlSeconds: 120 });
      const started = await client.callTool({
        name: "process_start",
        arguments: {
          authorityLeaseId: adminA.leaseId,
          command: "node",
          args: ["-e", "console.log('process-ready'); console.error('process-warn'); setInterval(() => {}, 1000)"],
          cwd: root,
        },
      });
      expect(started.isError).not.toBe(true);
      expect(started.structuredContent).toMatchObject({
        processId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
        command: "node",
        argCount: 2,
        state: "running",
      });
      expect(JSON.stringify(started.structuredContent)).not.toContain("pid");
      const processId = (started.structuredContent as { processId: string }).processId;
      await waitForLogs(client, adminA.leaseId, processId);

      const list = await client.callTool({ name: "process_list", arguments: { authorityLeaseId: adminA.leaseId } });
      expect(list.structuredContent).toMatchObject({ processes: [expect.objectContaining({ processId })] });

      const invalidExtraField = await client.callTool({
        name: "process_status",
        arguments: { authorityLeaseId: adminA.leaseId, processId, pid: 123 },
      });
      expect(invalidExtraField.isError).toBe(true);

      const adminB = await runtime.authority.start({ profile: "admin", requestedTtlSeconds: 120 });
      runtime.authority.end(adminA.leaseId);
      const status = await client.callTool({ name: "process_status", arguments: { authorityLeaseId: adminB.leaseId, processId } });
      expect(status.structuredContent).toMatchObject({ processId, state: "running" });

      const user = await runtime.authority.start({ profile: "user", requestedTtlSeconds: 120 });
      const userStart = await client.callTool({
        name: "process_start",
        arguments: { authorityLeaseId: user.leaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(userStart.isError).toBe(true);
      expect(textContent(userStart)).toContain("POLICY_DENIED");

      const userLookup = await client.callTool({ name: "process_status", arguments: { authorityLeaseId: user.leaseId, processId } });
      expect(userLookup.isError).toBe(true);
      expect(textContent(userLookup)).toContain("PROCESS_NOT_FOUND");

      const shellDenied = await client.callTool({
        name: "process_start",
        arguments: { authorityLeaseId: adminB.leaseId, command: "sh", args: ["-c", "echo nope"], cwd: root },
      });
      expect(shellDenied.isError).toBe(true);
      expect(textContent(shellDenied)).toContain("POLICY_DENIED");

      const stopped = await client.callTool({ name: "process_stop", arguments: { authorityLeaseId: adminB.leaseId, processId } });
      expect(stopped.structuredContent).toMatchObject({ processId, state: "stopped" });
      const stoppedAgain = await client.callTool({ name: "process_stop", arguments: { authorityLeaseId: adminB.leaseId, processId } });
      expect(stoppedAgain.structuredContent).toMatchObject({ processId, state: "stopped" });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
