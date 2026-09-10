import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { ComputerError } from "../src/computer-errors.js";
import type { ComputerJsRunInput } from "../src/computer-js-runtime.js";
import { registerComputerJsTools } from "../src/computer-js-tool-registration.js";
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

async function fixture(fullHostJsEnabled = true) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "computer-js-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: [] },
    personalAdmin: { enabled: true },
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
    http: { host: "127.0.0.1", port: 0, token },
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

  it("rejects Project and User before runtime work, rejects disabled Admin, and returns structured enabled Admin output", async () => {
    const enabled = await fixture(true);
    try {
      const project = await enabled.runtime.authority.start({ profile: "project", projectRoots: [enabled.root] });
      const projectResult = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: project.leaseId, source: "return 1;" },
      });
      expect(projectResult.isError).toBe(true);
      expect(textContent(projectResult)).toContain("POLICY_DENIED");

      const user = await enabled.runtime.authority.start({ profile: "user" });
      const userResult = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: user.leaseId, source: "return 1;" },
      });
      expect(userResult.isError).toBe(true);
      expect(textContent(userResult)).toContain("POLICY_DENIED");
      expect(enabled.fake.calls).toHaveLength(0);

      const admin = await enabled.runtime.authority.start({ profile: "admin" });
      const invalid = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: "return 1;", unexpected: true },
      });
      expect(invalid.isError).toBe(true);
      expect(enabled.fake.calls).toHaveLength(0);

      const success = await enabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: "return { ok: true };" },
      });
      expect(success.isError).not.toBe(true);
      expect(success.structuredContent).toEqual({ stdout: "out", stderr: "err", result: { ok: true } });
      expect(enabled.fake.calls).toHaveLength(1);
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }

    const disabled = await fixture(false);
    try {
      const admin = await disabled.runtime.authority.start({ profile: "admin" });
      const result = await disabled.client.callTool({
        name: "computer_run_js",
        arguments: { authorityLeaseId: admin.leaseId, source: "return 1;" },
      });
      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("COMPUTER_JS_DISABLED");
      expect(disabled.fake.calls).toHaveLength(0);
    } finally {
      await disabled.transport.terminateSession();
      await disabled.client.close();
    }
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
      config: { computerUse: { fullHostJsEnabled: true, maxJsRuntimeMs: 30_000 } },
      audit: { record: async () => undefined },
      authority: { resolve: () => ({ profile: "admin" }) },
      computerJs: { run: async (input: ComputerJsRunInput) => { observed.push(input); return { stdout: "", stderr: "" }; } },
    };

    registerComputerJsTools(fakeServer as never, runtime as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(observed).toHaveLength(1);
    expect(observed[0]?.signal).toBe(controller.signal);
  });
});
