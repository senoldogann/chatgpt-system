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
import type { BrowserBackend, BrowserTargetMetadata } from "../src/browser-backend.js";
import { BrowserRuntime } from "../src/browser-runtime.js";

const PAGE_ID = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

class FakeBackend implements BrowserBackend {
  closeCalls = 0;
  tabsCalls = 0;
  tabsValue: BrowserTabView[] = [{ pageId: PAGE_ID, title: "Example", url: "https://example.com/", active: true }];

  async health(): Promise<BrowserHealth> {
    return { enabled: true, state: "running", browserInstalled: true };
  }

  async tabs(): Promise<BrowserTabView[]> {
    this.tabsCalls += 1;
    return this.tabsValue;
  }

  async newTab(): Promise<BrowserTabView> { return this.tabsValue[0]!; }
  async selectTab(): Promise<BrowserTabView> { return this.tabsValue[0]!; }
  async closeTab(): Promise<void> {}
  async navigate(): Promise<BrowserTabView> { return this.tabsValue[0]!; }
  async targetCount(): Promise<number> { return 1; }
  async targetMetadata(): Promise<BrowserTargetMetadata> { return { tagName: "INPUT", labels: [] }; }
  async focusedMetadata(): Promise<BrowserTargetMetadata | null> { return null; }
  async snapshot(): Promise<string> { return '- button "Save"'; }
  async click(): Promise<void> {}
  async fill(): Promise<void> {}
  async selectOption(): Promise<void> {}
  async pressKey(_pageId: string, _key: BrowserKey): Promise<void> {}
  async waitForText(): Promise<void> {}
  async screenshot(): Promise<BrowserScreenshot> {
    return { pageId: PAGE_ID, pngBase64: "iVBORw0KGgo=", width: 1, height: 1 };
  }
  async consoleErrors(): Promise<BrowserConsoleResult> { return { pageId: PAGE_ID, entries: [], truncated: false }; }
  async networkErrors(): Promise<BrowserNetworkResult> { return { pageId: PAGE_ID, entries: [], truncated: false }; }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

describe("BrowserRuntime lifecycle", () => {
  it("reports disabled health without starting a backend", async () => {
    let starts = 0;
    const runtime = new BrowserRuntime({
      enabled: false,
      browserInstalled: async () => true,
      createBackend: async () => {
        starts += 1;
        return new FakeBackend();
      },
    });

    expect(await runtime.health()).toEqual({ enabled: false, state: "disabled", browserInstalled: true });
    expect(starts).toBe(0);
    await expect(runtime.tabs()).rejects.toMatchObject({ code: "BROWSER_DISABLED" });
    expect(starts).toBe(0);
  });

  it("reports stopped readiness without eagerly launching Playwright", async () => {
    let starts = 0;
    const runtime = new BrowserRuntime({
      enabled: true,
      browserInstalled: async () => true,
      createBackend: async () => {
        starts += 1;
        return new FakeBackend();
      },
    });

    expect(await runtime.health()).toEqual({ enabled: true, state: "stopped", browserInstalled: true });
    expect(starts).toBe(0);
  });

  it("lazily creates exactly one backend for repeated operations", async () => {
    const fake = new FakeBackend();
    let starts = 0;
    const runtime = new BrowserRuntime({
      enabled: true,
      browserInstalled: async () => true,
      createBackend: async () => {
        starts += 1;
        return fake;
      },
    });

    await runtime.tabs();
    await runtime.tabs();
    expect(starts).toBe(1);
    expect(fake.tabsCalls).toBe(2);
    expect(await runtime.health()).toEqual({ enabled: true, state: "running", browserInstalled: true });
  });

  it("deduplicates concurrent lazy launch", async () => {
    const fake = new FakeBackend();
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new BrowserRuntime({
      enabled: true,
      browserInstalled: async () => true,
      createBackend: async () => {
        starts += 1;
        await gate;
        return fake;
      },
    });

    const first = runtime.tabs();
    const second = runtime.tabs();
    await Promise.resolve();
    expect(starts).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(starts).toBe(1);
  });

  it("maps backend launch failures to a stable error without leaking the raw failure", async () => {
    const runtime = new BrowserRuntime({
      enabled: true,
      browserInstalled: async () => true,
      createBackend: async () => {
        throw new Error("/private/path/with-sensitive-details");
      },
    });

    const failure = runtime.tabs();
    await expect(failure).rejects.toMatchObject({ code: "BROWSER_LAUNCH_FAILED" });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining("sensitive-details") });
    expect(await runtime.health()).toEqual({ enabled: true, state: "unavailable", browserInstalled: true });
  });

  it("closes idempotently and allows a later operation to start a fresh backend", async () => {
    const first = new FakeBackend();
    const second = new FakeBackend();
    const backends = [first, second];
    let starts = 0;
    const runtime = new BrowserRuntime({
      enabled: true,
      browserInstalled: async () => true,
      createBackend: async () => backends[starts++]!,
    });

    await runtime.tabs();
    await runtime.close();
    await runtime.close();
    expect(first.closeCalls).toBe(1);

    await runtime.tabs();
    expect(starts).toBe(2);
    expect(second.tabsCalls).toBe(1);
  });

  it("delegates the complete narrow browser backend surface", async () => {
    const fake = new FakeBackend();
    const runtime = new BrowserRuntime({
      enabled: true,
      browserInstalled: async () => true,
      createBackend: async () => fake,
    });
    const target: BrowserTarget = { by: "role", role: "button", name: "Save" };

    expect(await runtime.newTab()).toEqual(fake.tabsValue[0]);
    expect(await runtime.selectTab(PAGE_ID)).toEqual(fake.tabsValue[0]);
    await runtime.closeTab(PAGE_ID);
    expect(await runtime.navigate(PAGE_ID, "https://example.com", 1000)).toEqual(fake.tabsValue[0]);
    expect(await runtime.targetCount(PAGE_ID, target)).toBe(1);
    expect(await runtime.targetMetadata(PAGE_ID, target)).toEqual({ tagName: "INPUT", labels: [] });
    expect(await runtime.focusedMetadata(PAGE_ID)).toBeNull();
    expect(await runtime.snapshot(PAGE_ID)).toBe('- button "Save"');
    await runtime.click(PAGE_ID, target);
    await runtime.fill(PAGE_ID, target, "hello");
    await runtime.selectOption(PAGE_ID, target, "one");
    await runtime.pressKey(PAGE_ID, "Enter");
    await runtime.waitForText(PAGE_ID, "Done", 1000);
    expect((await runtime.screenshot(PAGE_ID)).pageId).toBe(PAGE_ID);
    expect((await runtime.consoleErrors(PAGE_ID)).entries).toEqual([]);
    expect((await runtime.networkErrors(PAGE_ID)).entries).toEqual([]);
  });
});
