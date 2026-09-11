import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserBackend, BrowserTargetMetadata } from "../src/browser-backend.js";
import type {
  BrowserConsoleResult,
  BrowserHealth,
  BrowserKey,
  BrowserNetworkResult,
  BrowserScreenshot,
  BrowserTabView,
  BrowserTarget,
} from "../src/browser-types.js";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const PAGE_ID = "page_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

class FakeBrowserBackend implements BrowserBackend {
  metadata: BrowserTargetMetadata = {
    tagName: "INPUT",
    type: "text",
    autocomplete: "email",
    labels: ["Email"],
  };
  fillCalls: string[] = [];
  closeCalls = 0;

  async health(): Promise<BrowserHealth> { return { enabled: true, state: "running", browserInstalled: true }; }
  async tabs(): Promise<BrowserTabView[]> {
    return [{ pageId: PAGE_ID, title: "Example", url: "https://example.com/", active: true }];
  }
  async newTab(url?: string): Promise<BrowserTabView> {
    return { pageId: PAGE_ID, title: "Example", url: url ?? "about:blank", active: true };
  }
  async selectTab(): Promise<BrowserTabView> { return (await this.tabs())[0]!; }
  async closeTab(): Promise<void> {}
  async navigate(_pageId: string, url: string): Promise<BrowserTabView> {
    return { pageId: PAGE_ID, title: "Example", url, active: true };
  }
  async targetCount(): Promise<number> { return 1; }
  async targetMetadata(): Promise<BrowserTargetMetadata> { return this.metadata; }
  async focusedMetadata(): Promise<BrowserTargetMetadata | null> { return null; }
  async snapshot(): Promise<string> { return '- textbox "Email": user@example.com\n- button "Save"'; }
  async click(): Promise<void> {}
  async fill(_pageId: string, _target: BrowserTarget, text: string): Promise<void> { this.fillCalls.push(text); }
  async selectOption(): Promise<void> {}
  async pressKey(_pageId: string, _key: BrowserKey): Promise<void> {}
  async waitForText(): Promise<void> {}
  async screenshot(): Promise<BrowserScreenshot> {
    return { pageId: PAGE_ID, pngBase64: "iVBORw0KGgo=", width: 1, height: 1 };
  }
  async consoleErrors(): Promise<BrowserConsoleResult> {
    return {
      pageId: PAGE_ID,
      generation: 2,
      latestSequence: 7,
      entries: [{
        level: "error",
        message: "boom",
        evidence: { generation: 2, sequence: 7 },
        runtimeSource: {
          url: "https://example.com/assets/app.js?token=source-secret#fragment",
          lineNumber: 4,
          columnNumber: 9,
          sourceMapStatus: "UNAVAILABLE",
        },
      }],
      truncated: false,
    };
  }
  async networkErrors(): Promise<BrowserNetworkResult> {
    return {
      pageId: PAGE_ID,
      generation: 2,
      latestSequence: 8,
      entries: [{
        method: "GET",
        url: "https://example.com/api?token=secret#fragment",
        status: 500,
        evidence: { generation: 2, sequence: 8 },
        requestId: "opaque_request_123456",
        resourceType: "fetch",
        navigationRequest: false,
        initiator: { kind: "frame", url: "https://example.com/page?auth=secret#private" },
      }],
      truncated: false,
    };
  }
  async close(): Promise<void> { this.closeCalls += 1; }
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => {
    await runtime.processSupervisor.close();
    await (runtime as RuntimeServices & { browser?: { close(): Promise<unknown> } }).browser?.close();
  }));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-browser-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const token = "browser-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands: ["node", "git"] },
    projectExec: { enabled: false },
    personalAdmin: { enabled: false },
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
    browser: { enabled: true, headless: true, timeoutMs: 2_000, userDataDir: path.join(base, "browser-profile") },
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

  const fake = new FakeBrowserBackend();
  let factoryStarts = 0;
  const runtime = createRuntimeServices(config, {
    browserBackendFactory: async () => {
      factoryStarts += 1;
      return fake;
    },
    browserInstalled: async () => true,
  } as never);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "browser-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, runtime, client, transport, fake, factoryStarts: () => factoryStarts };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("browser MCP tools", () => {
  it("exposes a strict Admin-scoped browser surface with lease-free health", async () => {
    const { root, runtime, client, transport, fake, factoryStarts } = await fixture();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const expectedTools = [
        "browser_health",
        "browser_tabs",
        "browser_new_tab",
        "browser_select_tab",
        "browser_close_tab",
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_fill",
        "browser_select_option",
        "browser_press_key",
        "browser_wait_for_text",
        "browser_screenshot",
        "browser_console_errors",
        "browser_network_errors",
        "browser_close",
      ];
      for (const name of expectedTools) {
        expect(byName.get(name), `missing ${name}`).toBeDefined();
        expect(byName.get(name)?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }

      const health = await client.callTool({ name: "browser_health", arguments: {} });
      expect(health.isError).not.toBe(true);
      expect(health.structuredContent).toEqual({ enabled: true, state: "stopped", browserInstalled: true });
      expect(factoryStarts()).toBe(0);

      const project = await runtime.authority.start({ profile: "project", projectRoots: [root], requestedTtlSeconds: 120 });
      const projectTabs = await client.callTool({ name: "browser_tabs", arguments: { authorityLeaseId: project.leaseId } });
      expect(projectTabs.isError).toBe(true);
      expect(textContent(projectTabs)).toContain("POLICY_DENIED");
      expect(factoryStarts()).toBe(0);

      const user = await runtime.authority.start({ profile: "user", requestedTtlSeconds: 120 });
      const userTabs = await client.callTool({ name: "browser_tabs", arguments: { authorityLeaseId: user.leaseId } });
      expect(userTabs.isError).toBe(true);
      expect(textContent(userTabs)).toContain("POLICY_DENIED");
      expect(factoryStarts()).toBe(0);

      const admin = await runtime.authority.start({ profile: "admin", requestedTtlSeconds: 120 });
      const tabs = await client.callTool({ name: "browser_tabs", arguments: { authorityLeaseId: admin.leaseId } });
      expect(tabs.isError).not.toBe(true);
      expect(tabs.structuredContent).toMatchObject({ tabs: [expect.objectContaining({ pageId: PAGE_ID, title: "Example" })] });
      expect(factoryStarts()).toBe(1);

      const snapshot = await client.callTool({ name: "browser_snapshot", arguments: { authorityLeaseId: admin.leaseId, pageId: PAGE_ID } });
      expect(snapshot.structuredContent).toEqual({ pageId: PAGE_ID, snapshot: '- textbox "Email"\n- button "Save"' });

      fake.metadata = { tagName: "INPUT", type: "password", autocomplete: "current-password", labels: ["Password"] };
      const refusedFill = await client.callTool({
        name: "browser_fill",
        arguments: {
          authorityLeaseId: admin.leaseId,
          pageId: PAGE_ID,
          target: { by: "role", role: "textbox", name: "Password" },
          text: "do-not-type-this",
        },
      });
      expect(refusedFill.isError).toBe(true);
      expect(textContent(refusedFill)).toContain("BROWSER_CREDENTIAL_ENTRY_REFUSED");
      expect(fake.fillCalls).toHaveLength(0);

      const invalidExtra = await client.callTool({
        name: "browser_click",
        arguments: {
          authorityLeaseId: admin.leaseId,
          pageId: PAGE_ID,
          target: { by: "role", role: "button", name: "Save" },
          selector: "#password",
        },
      });
      expect(invalidExtra.isError).toBe(true);

      const screenshot = await client.callTool({ name: "browser_screenshot", arguments: { authorityLeaseId: admin.leaseId, pageId: PAGE_ID } });
      expect(screenshot.isError).not.toBe(true);
      expect(screenshot.content.some((item) => item.type === "image")).toBe(true);
      expect(screenshot.structuredContent).toEqual({ pageId: PAGE_ID, width: 1, height: 1 });
      expect(JSON.stringify(screenshot.structuredContent)).not.toContain("pngBase64");

      const consoleErrors = await client.callTool({
        name: "browser_console_errors",
        arguments: { authorityLeaseId: admin.leaseId, pageId: PAGE_ID },
      });
      expect(consoleErrors.isError).not.toBe(true);
      expect(consoleErrors.structuredContent).toMatchObject({
        generation: 2,
        latestSequence: 7,
        entries: [{
          evidence: { generation: 2, sequence: 7 },
          runtimeSource: {
            url: "https://example.com/assets/app.js",
            sourceMapStatus: "UNAVAILABLE",
          },
        }],
      });

      const networkErrors = await client.callTool({
        name: "browser_network_errors",
        arguments: { authorityLeaseId: admin.leaseId, pageId: PAGE_ID },
      });
      expect(networkErrors.isError).not.toBe(true);
      expect(networkErrors.structuredContent).toMatchObject({
        generation: 2,
        latestSequence: 8,
        entries: [{
          url: "https://example.com/api",
          requestId: "opaque_request_123456",
          resourceType: "fetch",
          navigationRequest: false,
          initiator: { kind: "frame", url: "https://example.com/page" },
        }],
      });

      const closed = await client.callTool({ name: "browser_close", arguments: { authorityLeaseId: admin.leaseId } });
      expect(closed.structuredContent).toEqual({ closed: true });
      expect(fake.closeCalls).toBe(1);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
