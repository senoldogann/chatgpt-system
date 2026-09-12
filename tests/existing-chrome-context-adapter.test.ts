import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { BrowserError } from "../src/errors.js";
import { createExistingChromeContextAdapter } from "../src/existing-chrome-context-adapter.js";
import { PlaywrightBrowserBackend } from "../src/playwright-browser-backend.js";

class FakePage extends EventEmitter {
  closed = false;
  currentUrl: string;
  readonly close = vi.fn(async () => {
    this.closed = true;
    this.emit("close");
  });
  readonly bringToFront = vi.fn(async () => undefined);

  constructor(url: string, readonly pageTitle: string) {
    super();
    this.currentUrl = url;
  }

  isClosed(): boolean {
    return this.closed;
  }

  url(): string {
    return this.currentUrl;
  }

  navigateTo(url: string): void {
    this.currentUrl = url;
    this.emit("framenavigated");
  }

  async title(): Promise<string> {
    return this.pageTitle;
  }
}

class FakeContext extends EventEmitter {
  readonly close = vi.fn(async () => undefined);
  readonly newPage = vi.fn(async () => {
    const page = new FakePage("about:blank", "new tab");
    this.fakePages.push(page);
    this.emit("page", page);
    return page as unknown as Page;
  });

  constructor(readonly fakePages: FakePage[]) {
    super();
  }

  pages(): Page[] {
    return this.fakePages as unknown as Page[];
  }
}

describe("existing Chrome context adapter", () => {
  it("exposes only eligible pages and disconnects without closing the attached default context", async () => {
    const eligible = new FakePage("https://example.com", "Example");
    const internal = new FakePage("chrome://settings", "Settings");
    const context = new FakeContext([eligible, internal]);
    const disconnect = vi.fn(async () => undefined);
    const adapted = createExistingChromeContextAdapter(context as unknown as BrowserContext, disconnect);
    const backend = new PlaywrightBrowserBackend(adapted, { timeoutMs: 1_000 });

    const tabs = await backend.tabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ title: "Example", url: "https://example.com" });

    await backend.close();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
    expect(eligible.close).not.toHaveBeenCalled();
    expect(internal.close).not.toHaveBeenCalled();
  });

  it("fails closed when an exposed page later navigates to an internal Chrome URL", async () => {
    const page = new FakePage("https://example.com", "Example");
    const context = new FakeContext([page]);
    const adapted = createExistingChromeContextAdapter(
      context as unknown as BrowserContext,
      async () => undefined,
    );
    const backend = new PlaywrightBrowserBackend(adapted, { timeoutMs: 1_000 });
    const pageId = (await backend.tabs())[0]!.pageId;

    page.currentUrl = "chrome://settings";

    expect(await backend.tabs()).toEqual([]);
    await expect(backend.selectTab(pageId)).rejects.toMatchObject<Partial<BrowserError>>({
      code: "BROWSER_PAGE_NOT_FOUND",
    });
    expect(page.bringToFront).not.toHaveBeenCalled();
  });

  it("keeps explicit close-tab destructive for an eligible page", async () => {
    const page = new FakePage("https://example.com", "Example");
    const context = new FakeContext([page]);
    const adapted = createExistingChromeContextAdapter(
      context as unknown as BrowserContext,
      async () => undefined,
    );
    const backend = new PlaywrightBrowserBackend(adapted, { timeoutMs: 1_000 });
    const pageId = (await backend.tabs())[0]!.pageId;

    await backend.closeTab(pageId);

    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it("registers a tab that only becomes eligible after navigation", async () => {
    const context = new FakeContext([]);
    const adapted = createExistingChromeContextAdapter(
      context as unknown as BrowserContext,
      async () => undefined,
    );
    const seen: Page[] = [];
    adapted.on("page", (page) => seen.push(page));

    const page = new FakePage("chrome://newtab", "New Tab");
    context.fakePages.push(page);
    context.emit("page", page);
    expect(seen).toEqual([]);

    page.navigateTo("https://example.com");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url()).toBe("https://example.com");
  });

  it("registers a newly eligible tab once and then drops its navigation listeners", async () => {
    const context = new FakeContext([]);
    const adapted = createExistingChromeContextAdapter(
      context as unknown as BrowserContext,
      async () => undefined,
    );
    const seen: Page[] = [];
    adapted.on("page", (page) => seen.push(page));

    const page = new FakePage("chrome://newtab", "New Tab");
    context.fakePages.push(page);
    context.emit("page", page);
    page.navigateTo("https://example.com");
    page.navigateTo("https://example.org");

    expect(seen).toHaveLength(1);
    expect(page.listenerCount("framenavigated")).toBe(0);
    expect(page.listenerCount("close")).toBe(0);
  });

  it("drops navigation listeners when an ineligible tab closes before becoming eligible", async () => {
    const context = new FakeContext([]);
    const adapted = createExistingChromeContextAdapter(
      context as unknown as BrowserContext,
      async () => undefined,
    );
    const seen: Page[] = [];
    adapted.on("page", (page) => seen.push(page));

    const page = new FakePage("chrome://newtab", "New Tab");
    context.fakePages.push(page);
    context.emit("page", page);
    expect(page.listenerCount("framenavigated")).toBe(1);

    await page.close();

    expect(seen).toEqual([]);
    expect(page.listenerCount("framenavigated")).toBe(0);
    expect(page.listenerCount("close")).toBe(0);
  });

  it("announces a duplicated page event only once", async () => {
    const context = new FakeContext([]);
    const adapted = createExistingChromeContextAdapter(
      context as unknown as BrowserContext,
      async () => undefined,
    );
    const seen: Page[] = [];
    adapted.on("page", (page) => seen.push(page));

    const page = new FakePage("https://example.com", "Example");
    context.fakePages.push(page);
    context.emit("page", page);
    context.emit("page", page);

    expect(seen).toHaveLength(1);
  });
});
