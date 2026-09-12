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
});
