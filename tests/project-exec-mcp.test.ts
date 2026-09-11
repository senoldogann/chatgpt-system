import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import type {
  ProjectExecBackend,
  ProjectExecRequest,
  ProjectExecResult,
} from "../src/project-exec-types.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

class RecordingProjectExecBackend implements ProjectExecBackend {
  readonly requests: ProjectExecRequest[] = [];

  async run(request: ProjectExecRequest): Promise<ProjectExecResult> {
    this.requests.push(request);
    return {
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      exitCode: 0,
      signal: null,
      stdout: "sandbox-ok\n",
      stderr: "",
      timedOut: false,
      sandbox: {
        backend: "docker",
        network: "none",
        hostFallback: false,
      },
    };
  }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(projectExecEnabled: boolean) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-project-exec-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  const sibling = path.join(base, "sibling");
  await mkdir(path.join(root, "packages", "app"), { recursive: true });
  await mkdir(sibling);

  const token = "project-exec-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands: ["node", "npm", "git"] },
    projectExec: { enabled: projectExecEnabled },
    personalAdmin: { enabled: true },
    computerUse: {
      enabled: false,
      fullHostJsEnabled: false,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    browser: {
      enabled: false,
      headless: true,
      timeoutMs: 1_000,
      userDataDir: path.join(base, "browser-profile"),
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

  const backend = new RecordingProjectExecBackend();
  const runtime = createRuntimeServices(config, { projectExecBackend: backend });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const client = new Client({ name: "project-exec-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, sibling, backend, runtime, client, transport };
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

describe("project_exec MCP tool", () => {
  it("exposes one strict Project-scoped sandbox tool and executes through the injected backend", async () => {
    const { root, backend, client, transport } = await fixture(true);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "project_exec");
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });

      const leaseId = await startProjectLease(client, root);
      const result = await client.callTool({
        name: "project_exec",
        arguments: {
          authorityLeaseId: leaseId,
          command: "npm",
          args: ["test"],
          cwd: "packages/app",
          timeoutMs: 1500,
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        command: "npm",
        args: ["test"],
        exitCode: 0,
        stdout: "sandbox-ok\n",
        sandbox: { backend: "docker", network: "none", hostFallback: false },
      });

      expect(backend.requests).toHaveLength(1);
      expect(backend.requests[0]).toMatchObject({
        projectRoot: await realpath(root),
        cwd: path.join(await realpath(root), "packages", "app"),
        command: "npm",
        args: ["test"],
        timeoutMs: 1500,
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("fails closed before backend work when project execution is not explicitly enabled", async () => {
    const { root, backend, client, transport } = await fixture(false);
    try {
      const leaseId = await startProjectLease(client, root);
      const result = await client.callTool({
        name: "project_exec",
        arguments: { authorityLeaseId: leaseId, command: "node", args: ["--version"], cwd: root },
      });

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("PROJECT_EXEC_DISABLED");
      expect(backend.requests).toHaveLength(0);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("fails closed for disallowed commands, out-of-scope cwd, and non-Project authority", async () => {
    const { root, sibling, backend, runtime, client, transport } = await fixture(true);
    try {
      const leaseId = await startProjectLease(client, root);

      const commandDenied = await client.callTool({
        name: "project_exec",
        arguments: { authorityLeaseId: leaseId, command: "sh", args: ["-c", "echo nope"], cwd: root },
      });
      expect(commandDenied.isError).toBe(true);
      expect(textContent(commandDenied)).toContain("COMMAND_NOT_ALLOWED");

      const pathDenied = await client.callTool({
        name: "project_exec",
        arguments: { authorityLeaseId: leaseId, command: "node", args: ["--version"], cwd: sibling },
      });
      expect(pathDenied.isError).toBe(true);
      expect(textContent(pathDenied)).toContain("POLICY_DENIED");

      const admin = await runtime.authority.start({ profile: "admin", requestedTtlSeconds: 60 });
      const adminDenied = await client.callTool({
        name: "project_exec",
        arguments: { authorityLeaseId: admin.leaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(adminDenied.isError).toBe(true);
      expect(textContent(adminDenied)).toContain("AUTHORITY_DENIED");

      const terminalStillDenied = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: leaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(terminalStillDenied.isError).toBe(true);
      expect(textContent(terminalStillDenied)).toContain("POLICY_DENIED");

      expect(backend.requests).toHaveLength(0);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
