import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/core/config.js";
import { ComputerError } from "../src/computer/computer-errors.js";
import { COMPUTER_MAX_JS_OUTPUT_BYTES, COMPUTER_MAX_JS_SOURCE_BYTES } from "../src/core/config.js";
import { computerJsRunOutputSchema } from "../src/mcp/tool-output-schemas.js";
import type { ComputerJsRunInput } from "../src/computer/computer-js-runtime.js";
import { registerComputerJsTools } from "../src/computer/computer-js-tool-registration.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

class FakeComputerJsRuntime {
  readonly calls: ComputerJsRunInput[] = [];
  closeCalls = 0;
  async run(input: ComputerJsRunInput) {
    this.calls.push(input);
    return { stdout: "out", stderr: "err", result: { ok: true } };
  }
  async close() { this.closeCalls += 1; }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => {
    await runtime.computerJs.close();
    await runtime.computer.close();
    await runtime.processSupervisor.close();
    await runtime.browser.close();
  }));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(fullHostJsEnabled = true, ownerRuntimeEnabled = false) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "computer-js-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: [] },
    projectExec: { enabled: false },
    continuity: {
      databasePath: path.join(path.dirname(path.join(base, "audit.jsonl")), "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },

    skills: { enabled: true, directory: path.join(base, "skills") },
    goal: { enabled: true, maxTranscriptChars: 120_000 },
    workers: { enabled: true, maxWorkers: 8, maxParkedRuns: 16 },
    ownerRuntime: {
      enabled: ownerRuntimeEnabled,
      shellPath: "/bin/zsh",
      maxScriptBytes: 262_144,
      maxTerminalSessions: 8,
      maxTerminalOutputBytes: 262_144,
      maxTerminalInputBytes: 65_536,
    },
    computerUse: {
      enabled: true,
      fullHostJsEnabled,
      hostBundlePath: path.join(base, "fixture.app"),
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
    browser: { enabled: false, headless: true, timeoutMs: 2_000, userDataDir: path.join(base, "browser") },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, allowNonLoopback: false, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 2_000,
      maxManagedProcesses: 4,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  };
  const fake = new FakeComputerJsRuntime();
  const runtime = createRuntimeServices(config, { computerJsRuntime: fake as never });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "computer-js-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, runtime, fake, client, transport };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("computer_run_js MCP tool", () => {
  it("registers one strict owner-trust full-host JavaScript tool", async () => {
    const { client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const jsTools = tools.filter((tool) => tool.name.includes("run_js") || tool.name.includes("javascript"));
      expect(jsTools.map((tool) => tool.name)).toEqual(["computer_run_js"]);
      expect(jsTools[0]?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(jsTools[0]?.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(jsTools[0]?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("allows project and open scopes, rejects the disabled gate, and returns structured output", async () => {
    const enabled = await fixture(true);
    try {
      const project = await enabled.runtime.authority.start({ profile: "project", projectRoots: [enabled.root] });
      const success = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: project.leaseId, source: "return { ok: true };" },
      });
      expect(success.isError).not.toBe(true);
      expect(success.structuredContent).toEqual({ stdout: "out", stderr: "err", result: { ok: true } });
      expect(enabled.fake.calls).toHaveLength(1);

      const invalid = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: project.leaseId, source: "return 1;", unexpected: true },
      });
      expect(invalid.isError).toBe(true);
      expect(enabled.fake.calls).toHaveLength(1);

      const open = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { source: "return 1;" },
      });
      expect(open.isError).not.toBe(true);
      expect(enabled.fake.calls).toHaveLength(2);
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }

    const disabled = await fixture(false);
    try {
      // Kapalı kapı: araç kataloğa yayınlanmaz ve çağrı runtime'a ulaşmaz.
      const { tools } = await disabled.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain("computer_run_js");
      const admin = await disabled.runtime.authority.start({ profile: "project", projectRoots: [disabled.root] });
      await expect(disabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: "return 1;" },
      })).rejects.toThrow(/not found/i);
      expect(disabled.fake.calls).toHaveLength(0);
    } finally {
      await disabled.transport.terminateSession();
      await disabled.client.close();
    }
  });

  it("accepts explicit timeout above the legacy 30s cap only when Owner Runtime is enabled", async () => {
    const owner = await fixture(true, true);
    try {
      const admin = await owner.runtime.authority.start({ profile: "project", projectRoots: [owner.root] });
      const result = await owner.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: "return 1;", timeoutMs: 60_000 },
      });
      expect(result.isError).not.toBe(true);
      expect(owner.fake.calls[0]?.timeoutMs).toBe(60_000);
    } finally {
      await owner.transport.terminateSession();
      await owner.client.close();
    }

    const legacy = await fixture(true, false);
    try {
      const admin = await legacy.runtime.authority.start({ profile: "project", projectRoots: [legacy.root] });
      const result = await legacy.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: "return 1;", timeoutMs: 60_000 },
      });
      expect(result.isError).toBe(true);
      expect(legacy.fake.calls).toHaveLength(0);
    } finally {
      await legacy.transport.terminateSession();
      await legacy.client.close();
    }
  });

  it("bounds source at the MCP schema and stdout/stderr at the public output schema even in Owner mode", async () => {
    const enabled = await fixture(true, true);
    try {
      const admin = await enabled.runtime.authority.start({ profile: "project", projectRoots: [enabled.root] });
      const oversizedSource = "x".repeat(COMPUTER_MAX_JS_SOURCE_BYTES + 1);
      const rejected = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: oversizedSource },
      });
      expect(rejected.isError).toBe(true);
      expect(enabled.fake.calls).toHaveLength(0);
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }

    expect(computerJsRunOutputSchema.safeParse({
      stdout: "x".repeat(COMPUTER_MAX_JS_OUTPUT_BYTES + 1),
      stderr: "",
    }).success).toBe(false);
    expect(computerJsRunOutputSchema.safeParse({
      stdout: "",
      stderr: "x".repeat(COMPUTER_MAX_JS_OUTPUT_BYTES + 1),
    }).success).toBe(false);
  });

  it("passes the MCP request AbortSignal into the scoped runtime call", async () => {
    const controller = new AbortController();
    const observed: ComputerJsRunInput[] = [];
    const fakeServer = {
      registerTool: (_name: string, _definition: unknown, handler: (input: Record<string, unknown>, ctx: { mcpReq: { signal?: AbortSignal } }) => Promise<unknown>) => {
        void handler({ authorityLeaseId: "A".repeat(43), source: "return 1;" }, { mcpReq: { signal: controller.signal } });
      },
    };
    const runtime = {
      config: {
        ownerRuntime: { enabled: true },
        computerUse: { fullHostJsEnabled: true, maxJsSourceBytes: 262_144, maxJsRuntimeMs: 30_000 },
      },
      audit: { record: async () => undefined },
      authority: { resolve: () => ({ profile: "project" }) },
      computerJs: { run: async (input: ComputerJsRunInput) => { observed.push(input); return { stdout: "", stderr: "" }; } },
    };

    registerComputerJsTools(fakeServer as never, runtime as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(observed).toHaveLength(1);
    expect(observed[0]?.signal).toBe(controller.signal);
  });
});
