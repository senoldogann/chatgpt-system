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
import { registerComputerTools } from "../src/computer-tool-registration.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

class FakeComputerRuntime {
  readonly calls: Array<{ method: string; input?: unknown; options?: unknown }> = [];
  failMethod?: string;
  failError?: ComputerError;
  rawFailure = false;

  private answer(method: string, input?: unknown, options?: unknown): unknown {
    this.calls.push({ method, ...(input !== undefined ? { input } : {}), ...(options !== undefined ? { options } : {}) });
    if (this.failMethod === method) {
      if (this.rawFailure) throw new Error("NATIVE_STDERR_CANARY REQUEST_ID_CANARY");
      throw this.failError ?? new ComputerError("COMPUTER_ACTION_FAILED");
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
            parentIndex: null,
            depth: 0,
            role: "button",
            title: "Go",
            enabled: true,
            bounds: { x: 10, y: 20, width: 0, height: 0 },
            actions: ["AXPress"],
            scroll: { scrollable: false, axes: [] },
          }],
          truncated: false,
          digest: "digest-1",
          perception: {
            axQuality: "weak",
            webContentAccessible: false,
            ocrUsed: true,
            recommendedTargeting: "ocr",
            ocrCandidates: [{
              text: "Plugins",
              bounds: { x: 100, y: 120, width: 80, height: 24 },
              confidence: 0.93,
              source: "vision-fast",
            }],
          },
        };
      case "screenshot":
        return {
          pngBase64: "iVBORw0KGgo=",
          width: 2,
          height: 3,
          captureKind: "display",
          screenBounds: { x: -1, y: 10, width: 1, height: 1.5 },
          scaleX: 0.5,
          scaleY: 0.5,
        };
      case "pointerPosition":
        return { x: 10, y: 20 };
      case "openApp":
      case "focusApp":
      case "waitForFrontmost":
        return { name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true };
      case "waitUntilChanged":
        return { digest: "digest-2" };
      case "waitForText":
        return { state: "completed" };
      case "scrollUntilVisible":
        return { state: "target_visible", stepsUsed: 0, changed: false };
      case "run": {
        const actions = (input as { actions: ComputerAction[] }).actions;
        return {
          state: "completed",
          completedCount: actions.length,
          actionCount: actions.length,
          steps: actions.map((action, index) => ({ index, type: action.type, state: "completed" })),
          stepsTruncated: false,
        };
      }
      default:
        return {
          state: "completed_unverified",
          verification: { kind: "none", changed: null },
        };
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
  async scrollUntilVisible(input: unknown) { return this.answer("scrollUntilVisible", input); }
  async typeText(input: unknown) { return this.answer("typeText", input); }
  async pressKey(input: unknown) { return this.answer("pressKey", input); }
  async waitForFrontmost(input: unknown) { return this.answer("waitForFrontmost", input); }
  async waitForText(input: unknown) { return this.answer("waitForText", input); }
  async waitUntilChanged(input: unknown) { return this.answer("waitUntilChanged", input); }
  async releaseInputs() { return this.answer("releaseInputs"); }
  async run(input: unknown, options?: unknown) { return this.answer("run", input, options) as never; }
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
    projectExec: { enabled: false },
    continuity: {
      databasePath: path.join(path.dirname(path.join(base, "audit.jsonl")), "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },

    personalAdmin: { enabled: true },
    ownerRuntime: {
      enabled: true,
      shellPath: "/bin/zsh",
      maxScriptBytes: 262_144,
      maxTerminalSessions: 8,
      maxTerminalOutputBytes: 262_144,
      maxTerminalInputBytes: 65_536,
    },
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
      maxAutomaticRetriesPerAction: 2,
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
  "computer_scroll_until_visible",
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

      expect(byName.get("computer_health")?.description).toMatch(/explicitly asks for Computer Use/i);
      expect(byName.get("computer_open_app")?.description).toContain("com.google.Chrome");
      expect(byName.get("computer_open_app")?.description).toMatch(/real Google Chrome/i);
      expect(byName.get("computer_open_app")?.description).toMatch(/do not substitute.*browser_\*/i);
      expect(byName.get("computer_run")?.description).toMatch(/physical mouse.*keyboard/i);
      expect(byName.get("computer_run")?.description).toContain("com.google.Chrome");
      expect(byName.get("computer_observe")?.description).toMatch(/perception\.recommendedTargeting/i);
      expect(byName.get("computer_observe")?.description).toMatch(/ocrText/);
      expect(byName.get("computer_observe")?.description).toMatch(/visual-point/);
      expect(byName.get("computer_observe")?.description).toMatch(/blind.*point/i);
      const observeOutputSchema = byName.get("computer_observe")?.outputSchema as {
        properties?: {
          elements?: {
            items?: {
              properties?: {
                parentIndex?: unknown;
                depth?: unknown;
                actions?: { maxItems?: number };
                scroll?: {
                  properties?: { axes?: { items?: { enum?: string[] } } };
                  required?: string[];
                };
              };
              required?: string[];
            };
          };
          perception?: {
            properties?: {
              axQuality?: { enum?: string[] };
              recommendedTargeting?: { enum?: string[] };
              ocrCandidates?: { maxItems?: number };
            };
          };
        };
        required?: string[];
      };
      expect(observeOutputSchema.required).toContain("perception");
      expect(observeOutputSchema.properties?.perception?.properties?.axQuality?.enum).toEqual(["strong", "partial", "weak"]);
      expect(observeOutputSchema.properties?.perception?.properties?.recommendedTargeting?.enum).toEqual(["ax", "ocr", "visual-point"]);
      expect(observeOutputSchema.properties?.perception?.properties?.ocrCandidates?.maxItems).toBe(64);

      const elementSchema = observeOutputSchema.properties?.elements?.items;
      expect(elementSchema?.properties).toHaveProperty("parentIndex");
      expect(elementSchema?.properties).toHaveProperty("depth");
      expect(elementSchema?.properties?.actions?.maxItems).toBe(16);
      expect(elementSchema?.properties?.scroll?.required).toEqual(expect.arrayContaining(["scrollable", "axes"]));
      expect(elementSchema?.properties?.scroll?.properties?.axes?.items?.enum).toEqual(["vertical", "horizontal"]);
      expect(elementSchema?.required).toEqual(expect.arrayContaining(["index", "parentIndex", "depth", "role", "actions", "scroll"]));

      expect(byName.get("computer_observe")?.description).toMatch(/semantic AX/i);
      expect(byName.get("computer_observe")?.description).toMatch(/scoped.*scroll/i);
      expect(byName.get("computer_observe")?.description).toMatch(/OCR fallback/i);
      expect(byName.get("computer_observe")?.description).toMatch(/fresh screenshot/i);
      expect(byName.get("computer_observe")?.description).toMatch(/one.*point attempt/i);
      expect(byName.get("computer_observe")?.description).toMatch(/unchanged.*point.*scroll/i);

      const screenshotOutputSchema = byName.get("computer_screenshot")?.outputSchema as {
        properties?: {
          captureKind?: { const?: string };
          screenBounds?: { required?: string[] };
          scaleX?: { exclusiveMinimum?: number };
          scaleY?: { exclusiveMinimum?: number };
        };
        required?: string[];
      };
      expect(screenshotOutputSchema.properties?.captureKind?.const).toBe("display");
      expect(screenshotOutputSchema.required).toEqual(expect.arrayContaining([
        "width", "height", "captureKind", "screenBounds", "scaleX", "scaleY",
      ]));
      expect(screenshotOutputSchema.properties?.screenBounds?.required).toEqual(expect.arrayContaining([
        "x", "y", "width", "height",
      ]));
      expect(screenshotOutputSchema.properties?.scaleX?.exclusiveMinimum).toBe(0);
      expect(screenshotOutputSchema.properties?.scaleY?.exclusiveMinimum).toBe(0);

      const scrollUntilVisible = byName.get("computer_scroll_until_visible");
      expect(scrollUntilVisible?.description).toMatch(/deterministic scroll container/i);
      expect(scrollUntilVisible?.description).toMatch(/fresh.*observe.*needs_replan/i);
      expect(scrollUntilVisible?.description).toMatch(/never.*blind.*raw scroll/i);
      const boundedScrollInput = scrollUntilVisible?.inputSchema as {
        properties?: {
          direction?: { enum?: string[] };
          amount?: { enum?: string[] };
          maxSteps?: { minimum?: number; maximum?: number };
        };
      };
      expect(boundedScrollInput.properties?.direction?.enum).toEqual(["up", "down", "left", "right"]);
      expect(boundedScrollInput.properties?.amount?.enum).toEqual(["small", "page"]);
      expect(boundedScrollInput.properties?.maxSteps).toMatchObject({ minimum: 1, maximum: 6 });
      const boundedScrollOutput = scrollUntilVisible?.outputSchema as {
        properties?: { state?: { enum?: string[] } };
      };
      expect(boundedScrollOutput.properties?.state?.enum).toEqual(["target_visible", "boundary_reached", "needs_replan"]);

      const clickOutputSchema = byName.get("computer_click")?.outputSchema as {
        properties?: {
          state?: { enum?: string[] };
          verification?: {
            properties?: { kind?: { enum?: string[] } };
            required?: string[];
          };
        };
      };
      expect(clickOutputSchema.properties?.state?.enum).toEqual(["verified", "completed_unverified"]);
      expect(clickOutputSchema.properties?.verification?.properties?.kind?.enum).toEqual(["ax", "text", "screen-region", "none"]);
      expect(clickOutputSchema.properties?.verification?.required).toContain("changed");

      const waitForTextOutputSchema = byName.get("computer_wait_for_text")?.outputSchema as {
        properties?: { state?: { const?: string } };
      };
      expect(waitForTextOutputSchema.properties?.state?.const).toBe("completed");

      const pressKeySchema = byName.get("computer_press_key")?.inputSchema as {
        properties?: { key?: { enum?: string[] } };
      };
      expect(pressKeySchema.properties?.key?.enum).toEqual(expect.arrayContaining([
        "return", "enter", "esc", "backspace", "ArrowLeft", "F12", "A",
      ]));
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
        perception: {
          axQuality: "weak",
          webContentAccessible: false,
          ocrUsed: true,
          recommendedTargeting: "ocr",
          ocrCandidates: [{
            text: "Plugins",
            bounds: { x: 100, y: 120, width: 80, height: 24 },
            confidence: 0.93,
            source: "vision-fast",
          }],
        },
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

  it("passes the MCP request AbortSignal and Owner mode into computer_run", async () => {
    const { runtime, fake } = await fixture();
    const controller = new AbortController();
    let handler: ((input: Record<string, unknown>, ctx: { mcpReq: { signal?: AbortSignal } }) => Promise<unknown>) | undefined;
    const fakeServer = {
      registerTool: (name: string, _definition: unknown, candidate: typeof handler) => {
        if (name === "computer_run") handler = candidate;
      },
    };
    registerComputerTools(fakeServer as never, runtime);
    const admin = await runtime.authority.start({ profile: "admin" });

    await handler!({
      authorityLeaseId: admin.leaseId,
      actions: [{ type: "pointer_position" }],
      finalObservation: "none",
    }, { mcpReq: { signal: controller.signal } });

    const runCall = fake.calls.find((call) => call.method === "run");
    expect(runCall?.options).toMatchObject({ ownerMode: true, signal: controller.signal });
  });

  it("accepts semantic targets in computer_run without guessing coordinates", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const run = await client.callTool({
        name: "computer_run",
        arguments: {
          authorityLeaseId: admin.leaseId,
          finalObservation: "none",
          actions: [
            {
              type: "click",
              target: {
                by: "text",
                text: "Run",
                exact: true,
                within: { by: "role", role: "AXGroup", name: "Modal", exact: true },
              },
            },
          ],
        },
      });

      expect(run.isError).not.toBe(true);
      expect(fake.calls).toContainEqual(expect.objectContaining({
        method: "run",
        input: expect.objectContaining({
          actions: [{
            type: "click",
            target: {
              by: "text",
              text: "Run",
              exact: true,
              within: { by: "role", role: "AXGroup", name: "Modal", exact: true },
            },
          }],
        }),
      }));
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("accepts a semantic target in direct computer_click without guessed coordinates", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const click = await client.callTool({
        name: "computer_click",
        arguments: {
          authorityLeaseId: admin.leaseId,
          target: {
            by: "role",
            role: "AXButton",
            name: "Submit",
            exact: true,
            within: { by: "index", snapshotId: "snap-1", index: 10 },
          },
        },
      });

      expect(click.isError).not.toBe(true);
      expect(fake.calls).toContainEqual({
        method: "click",
        input: {
          target: {
            by: "role",
            role: "AXButton",
            name: "Submit",
            exact: true,
            within: { by: "index", snapshotId: "snap-1", index: 10 },
          },
          count: 1,
        },
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("normalizes canonical key aliases for direct and batched actions and rejects unknown keys before runtime", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const cases = [
        ["Enter", "return"],
        ["Esc", "escape"],
        ["Backspace", "delete"],
        ["ArrowLeft", "left"],
        ["F12", "f12"],
        ["A", "a"],
      ] as const;

      for (const [inputKey, canonicalKey] of cases) {
        const result = await client.callTool({
          name: "computer_press_key",
          arguments: {
            authorityLeaseId: admin.leaseId,
            key: inputKey,
            bundleIdentifier: "com.example.fixture",
          },
        });
        expect(result.isError).not.toBe(true);
        expect(fake.calls.at(-1)).toMatchObject({
          method: "pressKey",
          input: { key: canonicalKey, bundleIdentifier: "com.example.fixture" },
        });
      }

      const batch = await client.callTool({
        name: "computer_run",
        arguments: {
          authorityLeaseId: admin.leaseId,
          finalObservation: "none",
          actions: [
            { type: "press_key", key: "Enter", bundleIdentifier: "com.example.fixture" },
          ],
        },
      });
      expect(batch.isError).not.toBe(true);
      expect(fake.calls.at(-1)).toMatchObject({
        method: "run",
        input: {
          actions: [{ type: "press_key", key: "return", bundleIdentifier: "com.example.fixture" }],
        },
      });

      const callsBeforeInvalid = fake.calls.length;
      const invalid = await client.callTool({
        name: "computer_press_key",
        arguments: {
          authorityLeaseId: admin.leaseId,
          key: "HyperSuperKey",
          bundleIdentifier: "com.example.fixture",
        },
      });
      expect(invalid.isError).toBe(true);
      expect(fake.calls).toHaveLength(callsBeforeInvalid);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("rejects app-selector-less calls at the MCP boundary before reaching the runtime", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const callsBefore = fake.calls.length;
      for (const args of [
        { name: "computer_type_text", arguments: { authorityLeaseId: admin.leaseId, text: "hi" } },
        { name: "computer_press_key", arguments: { authorityLeaseId: admin.leaseId, key: "return" } },
        { name: "computer_open_app", arguments: { authorityLeaseId: admin.leaseId } },
        { name: "computer_focus_app", arguments: { authorityLeaseId: admin.leaseId } },
        { name: "computer_wait_for_frontmost", arguments: { authorityLeaseId: admin.leaseId } },
        {
          name: "computer_run",
          arguments: {
            authorityLeaseId: admin.leaseId,
            finalObservation: "none",
            actions: [{ type: "type_text", text: "hi" }],
          },
        },
      ]) {
        const result = await client.callTool(args);
        expect(result.isError).toBe(true);
      }
      expect(fake.calls).toHaveLength(callsBefore);

      const ok = await client.callTool({
        name: "computer_type_text",
        arguments: {
          authorityLeaseId: admin.leaseId,
          text: "hi",
          bundleIdentifier: "com.example.fixture",
        },
      });
      expect(ok.isError).not.toBe(true);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("enforces strict bounded-scroll schema and routes a valid semantic request", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      const base = {
        authorityLeaseId: admin.leaseId,
        target: { by: "text", text: "Refresh", exact: true },
        within: { by: "role", role: "AXScrollArea", name: "Plugins", exact: true },
      };

      for (const argumentsValue of [
        { ...base, direction: "down", maxSteps: 7 },
        { ...base, direction: "diagonal", maxSteps: 2 },
        { ...base, direction: "down", maxSteps: 2, arbitrary: true },
      ]) {
        const invalid = await client.callTool({ name: "computer_scroll_until_visible", arguments: argumentsValue });
        expect(invalid.isError).toBe(true);
      }
      expect(fake.calls).toHaveLength(0);

      const valid = await client.callTool({
        name: "computer_scroll_until_visible",
        arguments: { ...base, direction: "down", amount: "small", maxSteps: 4 },
      });
      expect(valid.isError).not.toBe(true);
      expect(valid.structuredContent).toEqual({ state: "target_visible", stepsUsed: 0, changed: false });
      expect(fake.calls).toContainEqual({
        method: "scrollUntilVisible",
        input: {
          target: { by: "text", text: "Refresh", exact: true },
          within: { by: "role", role: "AXScrollArea", name: "Plugins", exact: true },
          direction: "down",
          amount: "small",
          maxSteps: 4,
        },
      });
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
      expect(screenshot.structuredContent).toEqual({
        width: 2,
        height: 3,
        captureKind: "display",
        screenBounds: { x: -1, y: 10, width: 1, height: 1.5 },
        scaleX: 0.5,
        scaleY: 0.5,
      });
      expect(JSON.stringify(screenshot.structuredContent)).not.toContain("pngBase64");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("returns only bounded recovery evidence in MCP computer error details", async () => {
    const { runtime, fake, client, transport } = await fixture();
    try {
      const admin = await runtime.authority.start({ profile: "admin" });
      fake.failMethod = "click";
      fake.failError = new ComputerError("COMPUTER_TARGET_AMBIGUOUS", {
        candidateCount: 2,
        scopeResolved: false,
        activeScrollContainerCount: 1,
        recommendedRecovery: "scope-target",
        targetText: "Sensitive Missing Label",
      });

      const failed = await client.callTool({
        name: "computer_click",
        arguments: {
          authorityLeaseId: admin.leaseId,
          target: { by: "text", text: "Sensitive Missing Label", exact: true },
        },
      });

      expect(failed.isError).toBe(true);
      const payload = JSON.parse(textContent(failed)) as Record<string, unknown>;
      expect(payload).toMatchObject({
        error: "COMPUTER_TARGET_AMBIGUOUS",
        details: {
          candidateCount: 2,
          scopeResolved: false,
          activeScrollContainerCount: 1,
          recommendedRecovery: "scope-target",
        },
      });
      expect(JSON.stringify(payload)).not.toContain("Sensitive Missing Label");
      expect((payload.details as Record<string, unknown>)).not.toHaveProperty("targetText");
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
