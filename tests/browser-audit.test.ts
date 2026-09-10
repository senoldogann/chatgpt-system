import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { createScopedRuntime } from "../src/scoped-runtime.js";
import { createRuntimeServices } from "../src/server.js";

const PAGE_ID = "page_AUDIT_SENTINEL_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const FILL_SENTINEL = "FILL_SECRET_SENTINEL";
const SNAPSHOT_SENTINEL = "SNAPSHOT_PRIVATE_SENTINEL";
const SCREENSHOT_SENTINEL = "SCREENSHOT_BYTES_SENTINEL";
const CONSOLE_SENTINEL = "CONSOLE_PRIVATE_SENTINEL";
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

class AuditFakeBrowserBackend implements BrowserBackend {
  async health(): Promise<BrowserHealth> { return { enabled: true, state: "running", browserInstalled: true }; }
  async tabs(): Promise<BrowserTabView[]> {
    return [{ pageId: PAGE_ID, title: "Private tab", url: "https://example.com/private?token=TAB_SECRET#tab-fragment", active: true }];
  }
  async newTab(url?: string): Promise<BrowserTabView> {
    return { pageId: PAGE_ID, title: "Private tab", url: url ?? "about:blank", active: true };
  }
  async selectTab(): Promise<BrowserTabView> { return (await this.tabs())[0]!; }
  async closeTab(): Promise<void> {}
  async navigate(_pageId: string, url: string): Promise<BrowserTabView> {
    return { pageId: PAGE_ID, title: "Private tab", url, active: true };
  }
  async targetCount(): Promise<number> { return 1; }
  async targetMetadata(): Promise<BrowserTargetMetadata> {
    return { tagName: "INPUT", type: "text", autocomplete: "off", labels: ["Note"] };
  }
  async focusedMetadata(): Promise<BrowserTargetMetadata | null> { return null; }
  async snapshot(): Promise<string> { return `- textbox "Note": ${SNAPSHOT_SENTINEL}`; }
  async click(): Promise<void> {}
  async fill(_pageId: string, _target: BrowserTarget, _text: string): Promise<void> {}
  async selectOption(): Promise<void> {}
  async pressKey(_pageId: string, _key: BrowserKey): Promise<void> {}
  async waitForText(): Promise<void> {}
  async screenshot(): Promise<BrowserScreenshot> {
    return { pageId: PAGE_ID, pngBase64: Buffer.from(SCREENSHOT_SENTINEL).toString("base64"), width: 10, height: 10 };
  }
  async consoleErrors(): Promise<BrowserConsoleResult> {
    return { pageId: PAGE_ID, entries: [{ level: "error", message: CONSOLE_SENTINEL }], truncated: false };
  }
  async networkErrors(): Promise<BrowserNetworkResult> {
    return {
      pageId: PAGE_ID,
      entries: [{ method: "GET", url: "https://example.com/api?token=NETWORK_SECRET#network-fragment", status: 500 }],
      truncated: false,
    };
  }
  async close(): Promise<void> {}
}

describe("browser audit redaction", () => {
  it("records only categorical browser metadata and never browser content or authority identifiers", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-browser-audit-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    const auditFile = path.join(base, "audit.jsonl");
    const config: AppConfig = {
      roots: [root],
      auditFile,
      terminal: { enabled: true, commands: ["node", "git"] },
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
      http: { host: "127.0.0.1", port: 4312 },
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

    const runtime = createRuntimeServices(config, {
      browserBackendFactory: async () => new AuditFakeBrowserBackend(),
      browserInstalled: async () => true,
    } as never);
    try {
      const admin = await runtime.authority.start({ profile: "admin", requestedTtlSeconds: 120 });
      const scoped = createScopedRuntime(runtime as never, admin) as ReturnType<typeof createScopedRuntime> & {
        browser: {
          tabs(): Promise<unknown>;
          navigate(pageId: string, url: string): Promise<unknown>;
          fill(pageId: string, target: BrowserTarget, text: string): Promise<unknown>;
          snapshot(pageId: string): Promise<unknown>;
          screenshot(pageId: string): Promise<unknown>;
          consoleErrors(pageId: string): Promise<unknown>;
          networkErrors(pageId: string): Promise<unknown>;
          close(): Promise<unknown>;
        };
      };

      await scoped.browser.tabs();
      await scoped.browser.navigate(PAGE_ID, "https://example.com/path?token=NAV_SECRET#nav-fragment");
      await scoped.browser.fill(PAGE_ID, { by: "label", label: "Note" }, FILL_SENTINEL);
      await scoped.browser.snapshot(PAGE_ID);
      await scoped.browser.screenshot(PAGE_ID);
      await scoped.browser.consoleErrors(PAGE_ID);
      await scoped.browser.networkErrors(PAGE_ID);
      await scoped.browser.close();
      await runtime.authority.flushAudit();

      const audit = await readFile(auditFile, "utf8");
      expect(audit).toContain("browser.tabs");
      expect(audit).toContain("browser.navigate");
      expect(audit).toContain("browser.fill");
      expect(audit).toContain("https://example.com");

      for (const forbidden of [
        PAGE_ID,
        admin.leaseId,
        FILL_SENTINEL,
        SNAPSHOT_SENTINEL,
        SCREENSHOT_SENTINEL,
        Buffer.from(SCREENSHOT_SENTINEL).toString("base64"),
        CONSOLE_SENTINEL,
        "NAV_SECRET",
        "NETWORK_SECRET",
        "TAB_SECRET",
        "nav-fragment",
        "network-fragment",
        "tab-fragment",
      ]) {
        expect(audit).not.toContain(forbidden);
      }
    } finally {
      await runtime.processSupervisor.close();
      await (runtime as RuntimeServicesWithBrowser).browser?.close();
    }
  });
});

type RuntimeServicesWithBrowser = ReturnType<typeof createRuntimeServices> & {
  browser?: { close(): Promise<unknown> };
};
