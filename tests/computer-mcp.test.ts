import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { ComputerError } from "../src/computer-errors.js";
import type { ComputerAction } from "../src/computer-types.js";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

class FakeComputerRuntime {
  readonly calls: Array<{ method: string; input?: unknown }> = [];
  failMethod?: string;
  rawFailure = false;

  private answer(method: string, input?: unknown): unknown {
    this.calls.push({ method, ...(input !== undefined ? { input } : {}) });
    if (this.failMethod === method) {
      if (this.rawFailure) throw new Error("NATIVE_STDERR_CANARY REQUEST_ID_CANARY");
      throw new ComputerError("COMPUTER_ACTION_FAILED");
    }
    switch (method) {
      case "health":
        return {
          enabled: true,
          state: "running",
          accessibilityTrusted: true,
          screenCaptureAuthorized: true,
          eventListenAuthorized: true,
          eventPostAuthorized: true,
          fullHostJsEnabled: true,
        };
      case "observe":
        return {
          snapshotId: "snap-1",
          application: { name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true },
          windowTitle: "Fixture",
          elements: [{
            index: 0,
            role: "button",
            title: "Go",
            enabled: true,
            bounds: { x: 10, y: 20, width: 0, height: 0 },
          }],
          truncated: false,
          digest: "digest-1",
        };
      case "screenshot":
        return { pngBase64: "iVBORw0KGgo=", width: 2, height: 3 };
      case "pointerPosition":
        return { x: 10, y: 20 };
      case "openApp":
      case "focusApp":
      case "waitForFrontmost":
        return { name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true };
      case "waitUntilChanged":
        return { digest: "digest-2" };
      case "run": {
        const actions = (input as { actions: ComputerAction[] }).actions;
        return {
          state: "completed",
          completedCount: actions.length,
          actionCount: actions.length,
          steps: actions.map((action, index) => ({ index, type: action.type, state: "completed" })),
        };
      }
      default:
        return { state: "completed" };
    }
  }

  async health() { return this.answer("health") as never; }
  async observe() { return this.answer("observe"); }
  async screenshot() { return this.answer("screenshot") as never; }
  async pointerPosition() { return this.answer("pointerPosition"); }
  async listApps() { return []; }
  async activeWindow() { return { application: { name: "Fixture", frontmost: true }, title: "Fixture" }; }
  async openApp(input: unknown) { return this.answer("openApp", input); }
  async focusApp(input: unknown) { return this.answer("focusApp", input); }
  async moveMouse(input: unknown) { return this.answer("moveMouse", input); }
  async click(input: unknown) { return this.answer("click", input); }
  async drag(input: unknown) { return this.answer("drag", input); }
  async scroll(input: unknown) { return this.answer("scroll", input); }
  async typeText(input: unknown) { return this.answer("typeText", input); }
  async pressKey(input: unknown) { return this.answer("pressKey", input); }
  async waitForFrontmost(input: unknown) { return this.answer("waitForFrontmost", input); }
  async waitForText(input: unknown) { return this.answer("waitForText", input); }
  async waitUntilChanged(input: unknown) { return this.answer("waitUntilChanged", input); }
  async releaseInputs() { return this.answer("releaseInputs"); }
  async run(input: unknown) { return this.answer("run", input) as never; }
  async close(): Promise<void> {}
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => {
    await runtime.computer.close();
    await runtime.processSupervisor.close();
    await runtime.browser.close();
  }));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-computer-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "computer-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: [] },
    personalAdmin: { enabled: true },
    computerUse: {
      enabled: true,
      fullHostJsEnabled: true,
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

  const fake = new FakeComputerRuntime();
  const runtime = createRuntimeServices(config, { computerRuntime: fake as never });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "computer-mcp-test", version: "1.0.0" });
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

const expectedComputerTools = [
  "computer_health",
  "computer_observe",
  "computer_screenshot",
  "computer_pointer_position",
  "computer_open_app",
  "computer_focus_app",
  "computer_move_mouse",
  "computer_click",
  "computer_drag",
  "computer_scroll",
  "computer_type_text",
  "computer_press_key",
  "computer_release_inputs",
  "computer_wait_for_frontmost",
  "computer_wait_for_text",
  "computer_wait_until_changed",
  "computer_run",
] as const;

describe("computer MCP tools", () => {
  it("exposes the exact strict low-level catalog with lease-free health and no direct hold tools", async () => {
    const { client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of expectedComputerTools) {
        const tool = byName.get(name);
        expect(tool, `missing ${name}`).toBeDefined();
        expect(tool?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
        expect(tool?.outputSchema).toMatchObject({ type: "object" });
      }
      for (const absent of ["computer_mouse_down", "computer_mouse_up"]) {
        expect(byName.has(absent)).toBe(false);
      }

      const healthSchema = byName.get("computer_health")?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(healthSchema.properties ?? {}).not.toHaveProperty("authorityLeaseId");
      expect(healthSchema.required ?? []).not.toContain("authorityLeaseId");
      for (const name of expectedComputerTools.filter((name) => name !== "computer_health")) {
        const schema = byName.get(name)?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        expect(schema.properties).toHaveProperty("authorityLeaseId");
        expect(schema.required).toContain("authorityLeaseId");
      }

      expect(byName.get("computer_observe")?.annotations).toMatchObject({ readOnlyHint: true });
      expect(byName.get("computer_click")?.annotations).toMatchObject({ readOnlyHint: false });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("enforces authority before runtime work and returns structured Admin results", async () => {
    const { root, runtime, fake, client, transport } = await fixture();
    try {
      const capabilities = await client.callTool({ name: "system_capabilities", arguments: {} });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({
        computerUse: { enabled: true, fullHostJsEnabled: true },
      });

      const health = await client.callTool({ name: "computer_health", arguments: {} });
      expect(health.isError).not.toBe(true);
      expect(health.structuredContent).toMatchObject({ enabled: true, state: "running", fullHostJsEnabled: true });
      expect(fake.calls.map((call) => call.method)).toEqual(["health"]);

      const project = await runtime.authority.start({ profile: "project", projectRoots: [root] });
      const projectObserve = await client.callTool({
        name: "computer_observe",
        arguments: { authorityLeaseId: project.leaseId },
      });
      expect(projectObserve.isError).toBe(true);
      expect(textContent(projectObserve)).toContain("POLICY_DENIED");
      expect(fake.calls.map((call) => call.method)).toEqual(["health"]);

      const user = await runtime.authority.start({ profile: "user" });
      const userPointer = await client.callTool({
        name: "computer_pointer_position",
        arguments: { authorityLeaseId: user.leaseId },
      });
      expect(userPointer.isError).toBe(true);
      expect(textContent(userPointer)).toContain("POLICY_DENIED");
      expect(fake.calls.map((call) => call.method)).toEqual(["health"]);

      const admin = await runtime.authority.start({ profile: "admin" });
      const adminObserve = await client.callTool({
        name: "computer_observe",
        arguments: { authorityLeaseId: admin.leaseId },
      });
      expect(adminObserve.isError).not.toBe(true);
      expect(adminObserve.structuredContent).toMatchObject({
        snapshotId: "snap-1",
        digest: "digest-1",
        elements: [{ bounds: { x: 10, y: 20, width: 0, height: 0 } }],
      });
      expect(textContent(adminObserve)).toContain("snap-1");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("rejects unknown fields and keeps raw hold primitives only inside computer_run", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const invalid = await client.callTool({
        name: "computer_click",
        arguments: { authorityLeaseId: admin.leaseId, x: 1, y: 2, selector: "#nope" },
      });
      expect(invalid.isError).toBe(true);
      expect(fake.calls).toHaveLength(0);

      const run = await client.callTool({
        name: "computer_run",
        arguments: {
          authorityLeaseId: admin.leaseId,
          finalObservation: "none",
          actions: [
            { type: "mouse_down", button: "left" },
            { type: "mouse_up", button: "left" },
          ],
        },
      });
      expect(run.isError).not.toBe(true);
      expect(run.structuredContent).toMatchObject({ state: "completed", completedCount: 2, actionCount: 2 });
      expect(fake.calls.map((call) => call.method)).toEqual(["run"]);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("returns screenshot as image content plus metadata without duplicating base64", async () => {
    const { runtime, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const screenshot = await client.callTool({
        name: "computer_screenshot",
        arguments: { authorityLeaseId: admin.leaseId },
      });
      expect(screenshot.isError).not.toBe(true);
      expect(screenshot.content).toContainEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
      expect(screenshot.structuredContent).toEqual({ width: 2, height: 3 });
      expect(JSON.stringify(screenshot.structuredContent)).not.toContain("pngBase64");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("returns tool failures with isError and no structuredContent or raw native diagnostics", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      fake.failMethod = "pointerPosition";
      fake.rawFailure = true;
      const failed = await client.callTool({
        name: "computer_pointer_position",
        arguments: { authorityLeaseId: admin.leaseId },
      });
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toBeUndefined();
      expect(textContent(failed)).toContain("INTERNAL_ERROR");
      expect(textContent(failed)).not.toContain("NATIVE_STDERR_CANARY");
      expect(textContent(failed)).not.toContain("REQUEST_ID_CANARY");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
