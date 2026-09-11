import { describe, expect, it } from "vitest";
import type {
  BrowserConsoleResult,
  BrowserHealth,
  BrowserKey,
  BrowserNetworkResult,
  BrowserScreenshot,
  BrowserTabView,
  BrowserTarget,
} from "../src/browser-types.js";
import type {
  BrowserBackend,
  BrowserTargetMetadata,
} from "../src/browser-backend.js";
import { BrowserService } from "../src/browser-service.js";

const PAGE_ID = "page_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TARGET: BrowserTarget = { by: "role", role: "textbox", name: "Email", exact: true };

class FakeBrowserBackend implements BrowserBackend {
  healthValue: BrowserHealth = { enabled: true, state: "running", browserInstalled: true };
  tabsValue: BrowserTabView[] = [{ pageId: PAGE_ID, title: "Example", url: "https://example.com/", active: true }];
  targetCountValue = 1;
  targetMetadataValue: BrowserTargetMetadata = {
    tagName: "INPUT",
    type: "text",
    autocomplete: "email",
    labels: ["Email"],
    name: "email",
    id: "email",
    ariaLabel: "Email",
  };
  focusedMetadataValue: BrowserTargetMetadata | null = null;
  snapshotValue = '- textbox "Email": user@example.com\n- searchbox "Search": private query\n- combobox "Country": Finland\n- button "Save"';
  screenshotValue: BrowserScreenshot = {
    pageId: PAGE_ID,
    pngBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    width: 1,
    height: 1,
  };
  consoleValue: BrowserConsoleResult = {
    pageId: PAGE_ID,
    generation: 3,
    latestSequence: 7,
    entries: [{
      level: "error",
      message: "boom",
      evidence: { generation: 3, sequence: 7 },
      runtimeSource: {
        url: "https://example.com/assets/app.js?token=source-secret#source-fragment",
        lineNumber: 12,
        columnNumber: 34,
        sourceMapStatus: "UNAVAILABLE",
      },
    }],
    truncated: false,
  };
  networkValue: BrowserNetworkResult = {
    pageId: PAGE_ID,
    generation: 3,
    latestSequence: 8,
    entries: [
      {
        method: "GET",
        url: "https://example.com/api?token=secret#private",
        status: 500,
        failure: "server error",
        evidence: { generation: 3, sequence: 8 },
        requestId: "req_opaque_123",
        resourceType: "fetch",
        navigationRequest: false,
        initiator: { kind: "frame", url: "https://example.com/page?auth=secret#private" },
      },
    ],
    truncated: false,
  };

  fillCalls: Array<{ pageId: string; target: BrowserTarget; text: string }> = [];
  pressCalls: Array<{ pageId: string; key: BrowserKey }> = [];
  navigationCalls: string[] = [];
  operationOrder: string[] = [];
  private blockers = new Map<string, Promise<void>>();
  private releases = new Map<string, () => void>();

  block(operation: string): void {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.blockers.set(operation, blocker);
    this.releases.set(operation, release);
  }

  release(operation: string): void {
    this.releases.get(operation)?.();
  }

  private async enter(operation: string): Promise<void> {
    this.operationOrder.push(`start:${operation}`);
    await this.blockers.get(operation);
    this.operationOrder.push(`end:${operation}`);
  }

  async health(): Promise<BrowserHealth> {
    return this.healthValue;
  }

  async tabs(): Promise<BrowserTabView[]> {
    await this.enter("tabs");
    return this.tabsValue;
  }

  async newTab(url?: string): Promise<BrowserTabView> {
    await this.enter("newTab");
    if (url) this.navigationCalls.push(url);
    return this.tabsValue[0]!;
  }

  async selectTab(): Promise<BrowserTabView> {
    return this.tabsValue[0]!;
  }

  async closeTab(): Promise<void> {}

  async navigate(_pageId: string, url: string): Promise<BrowserTabView> {
    this.navigationCalls.push(url);
    return this.tabsValue[0]!;
  }

  async targetCount(): Promise<number> {
    return this.targetCountValue;
  }

  async targetMetadata(): Promise<BrowserTargetMetadata> {
    return this.targetMetadataValue;
  }

  async focusedMetadata(): Promise<BrowserTargetMetadata | null> {
    return this.focusedMetadataValue;
  }

  async snapshot(): Promise<string> {
    return this.snapshotValue;
  }

  async click(): Promise<void> {}

  async fill(pageId: string, target: BrowserTarget, text: string): Promise<void> {
    this.fillCalls.push({ pageId, target, text });
  }

  async selectOption(): Promise<void> {}

  async pressKey(pageId: string, key: BrowserKey): Promise<void> {
    this.pressCalls.push({ pageId, key });
  }

  async waitForText(): Promise<void> {}

  async screenshot(): Promise<BrowserScreenshot> {
    return this.screenshotValue;
  }

  async consoleErrors(): Promise<BrowserConsoleResult> {
    return this.consoleValue;
  }

  async networkErrors(): Promise<BrowserNetworkResult> {
    return this.networkValue;
  }

  async close(): Promise<void> {}
}

function makeService(fake = new FakeBrowserBackend(), timeoutMs = 10_000): { fake: FakeBrowserBackend; service: BrowserService } {
  return { fake, service: new BrowserService(fake, { timeoutMs, maxDiagnosticEntries: 2 }) };
}

describe("BrowserService policy", () => {
  it("allows only http and https caller navigation before the backend sees a URL", async () => {
    const { fake, service } = makeService();

    await service.navigate(PAGE_ID, "https://example.com/path?q=1#x");
    await expect(service.navigate(PAGE_ID, "file:///tmp/private")).rejects.toMatchObject({
      code: "BROWSER_NAVIGATION_REFUSED",
    });
    await expect(service.newTab("javascript:alert(1)")).rejects.toMatchObject({
      code: "BROWSER_NAVIGATION_REFUSED",
    });

    expect(fake.navigationCalls).toEqual(["https://example.com/path?q=1#x"]);
  });

  it("requires semantic targets to resolve to exactly one element", async () => {
    const { fake, service } = makeService();

    fake.targetCountValue = 0;
    await expect(service.click(PAGE_ID, { by: "text", text: "Save" })).rejects.toMatchObject({
      code: "BROWSER_TARGET_NOT_FOUND",
    });

    fake.targetCountValue = 2;
    await expect(service.click(PAGE_ID, { by: "role", role: "button", name: "Save" })).rejects.toMatchObject({
      code: "BROWSER_TARGET_AMBIGUOUS",
    });
  });

  it("refuses password fields before any fill reaches the backend", async () => {
    const { fake, service } = makeService();
    fake.targetMetadataValue = {
      tagName: "INPUT",
      type: "password",
      autocomplete: "current-password",
      labels: ["Password"],
    };

    await expect(service.fill(PAGE_ID, TARGET, "secret-value")).rejects.toMatchObject({
      code: "BROWSER_CREDENTIAL_ENTRY_REFUSED",
    });
    expect(fake.fillCalls).toHaveLength(0);
  });

  it.each([
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
  ])("refuses sensitive autocomplete token %s", async (autocomplete) => {
    const { fake, service } = makeService();
    fake.targetMetadataValue = {
      tagName: "INPUT",
      type: "text",
      autocomplete,
      labels: ["Value"],
    };

    await expect(service.fill(PAGE_ID, TARGET, "sensitive")).rejects.toMatchObject({
      code: "BROWSER_CREDENTIAL_ENTRY_REFUSED",
    });
    expect(fake.fillCalls).toHaveLength(0);
  });

  it.each(["Password", "Enter OTP", "Verification code", "Security code", "CVV", "CVC", "Card number"])(
    "refuses credential-shaped field metadata %s",
    async (label) => {
      const { fake, service } = makeService();
      fake.targetMetadataValue = {
        tagName: "INPUT",
        type: "text",
        autocomplete: "off",
        labels: [label],
      };

      await expect(service.fill(PAGE_ID, TARGET, "sensitive")).rejects.toMatchObject({
        code: "BROWSER_CREDENTIAL_ENTRY_REFUSED",
      });
      expect(fake.fillCalls).toHaveLength(0);
    },
  );

  it("redacts current values from editable ARIA roles before returning a snapshot", async () => {
    const { service } = makeService();

    expect((await service.snapshot(PAGE_ID)).snapshot).toBe(
      '- textbox "Email"\n- searchbox "Search"\n- combobox "Country"\n- button "Save"',
    );
  });

  it("redacts descendant content from editable ARIA roles before returning a snapshot", async () => {
    const fake = new FakeBrowserBackend();
    fake.snapshotValue = [
      '- textbox "Chat with ChatGPT" [active] [ref=e270]:',
      '  - paragraph [ref=e851]: UNSENT_REDACTION_PROBE_7F3A',
      '- button "Attach files" [ref=e852]',
    ].join("\n");
    const { service } = makeService(fake);

    expect((await service.snapshot(PAGE_ID)).snapshot).toBe([
      '- textbox "Chat with ChatGPT" [active] [ref=e270]',
      '- button "Attach files" [ref=e852]',
    ].join("\n"));
  });

  it("refuses key input when the focused element is credential-shaped", async () => {
    const { fake, service } = makeService();
    fake.focusedMetadataValue = {
      tagName: "INPUT",
      type: "password",
      autocomplete: "current-password",
      labels: ["Password"],
    };

    await expect(service.pressKey(PAGE_ID, "Enter")).rejects.toMatchObject({
      code: "BROWSER_CREDENTIAL_ENTRY_REFUSED",
    });
    expect(fake.pressCalls).toHaveLength(0);
  });

  it("caps caller wait time at the configured browser timeout", async () => {
    const fake = new FakeBrowserBackend();
    let observedTimeout = 0;
    fake.waitForText = async (_pageId: string, _text: string, timeoutMs: number) => {
      observedTimeout = timeoutMs;
    };
    const { service } = makeService(fake, 2_500);

    await service.waitForText(PAGE_ID, "Loaded", 99_999);
    expect(observedTimeout).toBe(2_500);
  });

  it("sanitizes correlation URLs while preserving opaque diagnostic evidence metadata", async () => {
    const { service } = makeService();

    expect(await service.consoleErrors(PAGE_ID)).toEqual({
      pageId: PAGE_ID,
      generation: 3,
      latestSequence: 7,
      entries: [{
        level: "error",
        message: "boom",
        evidence: { generation: 3, sequence: 7 },
        runtimeSource: {
          url: "https://example.com/assets/app.js",
          lineNumber: 12,
          columnNumber: 34,
          sourceMapStatus: "UNAVAILABLE",
        },
      }],
      truncated: false,
    });

    expect(await service.networkErrors(PAGE_ID)).toEqual({
      pageId: PAGE_ID,
      generation: 3,
      latestSequence: 8,
      entries: [{
        method: "GET",
        url: "https://example.com/api",
        status: 500,
        failure: "server error",
        evidence: { generation: 3, sequence: 8 },
        requestId: "req_opaque_123",
        resourceType: "fetch",
        navigationRequest: false,
        initiator: { kind: "frame", url: "https://example.com/page" },
      }],
      truncated: false,
    });
  });

  it("bounds diagnostic entries even when the backend returns more", async () => {
    const fake = new FakeBrowserBackend();
    fake.consoleValue = {
      pageId: PAGE_ID,
      entries: [
        { level: "error", message: "one" },
        { level: "warning", message: "two" },
        { level: "error", message: "three" },
      ],
      truncated: false,
    };
    const { service } = makeService(fake);

    expect(await service.consoleErrors(PAGE_ID)).toEqual({
      pageId: PAGE_ID,
      entries: [
        { level: "warning", message: "two" },
        { level: "error", message: "three" },
      ],
      truncated: true,
    });
  });

  it("refuses tab lists that exceed the configured output count limit", async () => {
    const fake = new FakeBrowserBackend();
    fake.tabsValue = [fake.tabsValue[0]!, { ...fake.tabsValue[0]!, pageId: `${PAGE_ID}_2` }];
    const service = new BrowserService(fake, { timeoutMs: 10_000, maxTabs: 1 });

    await expect(service.tabs()).rejects.toMatchObject({ code: "BROWSER_PROTOCOL_INVALID" });
  });

  it("refuses oversized tab metadata before it reaches MCP output", async () => {
    const fake = new FakeBrowserBackend();
    fake.tabsValue = [{
      ...fake.tabsValue[0]!,
      title: "title-too-long",
      url: "https://example.com/path-that-is-too-long",
    }];
    const service = new BrowserService(fake, {
      timeoutMs: 10_000,
      maxTabTitleChars: 8,
      maxUrlChars: 24,
    });

    await expect(service.tabs()).rejects.toMatchObject({ code: "BROWSER_PROTOCOL_INVALID" });
  });

  it("refuses oversized snapshots before returning browser content", async () => {
    const fake = new FakeBrowserBackend();
    fake.snapshotValue = "x".repeat(33);
    const service = new BrowserService(fake, { timeoutMs: 10_000, maxSnapshotChars: 32 });

    await expect(service.snapshot(PAGE_ID)).rejects.toMatchObject({ code: "BROWSER_PROTOCOL_INVALID" });
  });

  it("refuses oversized screenshots before returning image content", async () => {
    const fake = new FakeBrowserBackend();
    fake.screenshotValue = {
      pageId: PAGE_ID,
      pngBase64: Buffer.alloc(33).toString("base64"),
      width: 1,
      height: 1,
    };
    const service = new BrowserService(fake, { timeoutMs: 10_000, maxScreenshotBytes: 32 });

    await expect(service.screenshot(PAGE_ID)).rejects.toMatchObject({ code: "BROWSER_PROTOCOL_INVALID" });
  });

  it("serializes browser operations so concurrent sessions cannot interleave state mutations", async () => {
    const fake = new FakeBrowserBackend();
    fake.block("tabs");
    const { service } = makeService(fake);

    const first = service.tabs();
    const second = service.newTab();
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.operationOrder).toEqual(["start:tabs"]);
    fake.release("tabs");
    await first;
    await second;
    expect(fake.operationOrder).toEqual(["start:tabs", "end:tabs", "start:newTab", "end:newTab"]);
  });
});
