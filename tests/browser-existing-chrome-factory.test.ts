import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { createBrowserService, type BrowserFactoryOptions } from "../src/browser-factory.js";
import { loadConfig } from "../src/config.js";
import type { ExistingChromePlaywrightFacade } from "../src/existing-chrome-connector.js";

const cleanups: string[] = [];

class FakePage extends EventEmitter {
  closed = false;

  constructor(private readonly currentUrl: string, private readonly pageTitle: string) {
    super();
  }

  isClosed(): boolean { return this.closed; }
  url(): string { return this.currentUrl; }
  async title(): Promise<string> { return this.pageTitle; }
  async close(): Promise<void> { this.closed = true; this.emit("close"); }
}

class FakeContext extends EventEmitter {
  readonly close = vi.fn(async () => undefined);

  constructor(private readonly fakePages: FakePage[]) {
    super();
  }

  pages(): Page[] { return this.fakePages as unknown as Page[]; }

  async newPage(): Promise<Page> {
    const page = new FakePage("about:blank", "new tab");
    this.fakePages.push(page);
    this.emit("page", page);
    return page as unknown as Page;
  }
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-existing-chrome-factory-"));
  cleanups.push(root);
  const projectRoot = path.join(root, "project");
  const chromeDir = path.join(root, "Chrome");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(chromeDir, { recursive: true });
  await writeFile(
    path.join(chromeDir, "DevToolsActivePort"),
    "9222\n/devtools/browser/factory-test-token\n",
  );
  const config = await loadConfig({
    roots: [projectRoot],
    browserEnabled: true,
    browserExistingChrome: true,
    browserExistingChromeUserDataDir: chromeDir,
    browserTimeoutMs: 12_000,
  });
  return { config, chromeDir };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("existing Chrome browser factory", () => {
  it("attaches through CDP, exposes eligible existing tabs, and disconnects without closing the default context", async () => {
    const { config } = await createFixture();
    const eligible = new FakePage("https://chatgpt.com/", "ChatGPT");
    const internal = new FakePage("chrome://settings", "Settings");
    const context = new FakeContext([eligible, internal]);
    const closeBrowser = vi.fn(async () => undefined);
    const connectOverCDP = vi.fn(async () => ({
      contexts: () => [context as unknown as BrowserContext],
      close: closeBrowser,
    }));
    const loadExistingChromeChromium = vi.fn(async (): Promise<ExistingChromePlaywrightFacade> => ({ connectOverCDP }));

    const options: BrowserFactoryOptions = {
      browserInstalled: async () => true,
      loadExistingChromeChromium,
    };
    const service = createBrowserService(config, options);

    expect(await service.tabs()).toEqual({
      tabs: [expect.objectContaining({ title: "ChatGPT", url: "https://chatgpt.com/" })],
    });
    expect(connectOverCDP).toHaveBeenCalledWith(
      "ws://127.0.0.1:9222/devtools/browser/factory-test-token",
      { timeout: 12_000, isLocal: true, noDefaults: true },
    );

    await service.close();
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
  });

  it("does not fall back to managed launch and reconnects after runtime close", async () => {
    const { config } = await createFixture();
    const contexts = [
      new FakeContext([new FakePage("https://example.com/one", "one")]),
      new FakeContext([new FakePage("https://example.com/two", "two")]),
    ];
    let index = 0;
    const closeBrowser = vi.fn(async () => undefined);
    const connectOverCDP = vi.fn(async () => ({
      contexts: () => [contexts[index++]! as unknown as BrowserContext],
      close: closeBrowser,
    }));
    const service = createBrowserService(config, {
      browserInstalled: async () => true,
      loadExistingChromeChromium: async () => ({ connectOverCDP }),
    });

    expect((await service.tabs()).tabs[0]?.title).toBe("one");
    await service.close();
    expect((await service.tabs()).tabs[0]?.title).toBe("two");
    expect(connectOverCDP).toHaveBeenCalledTimes(2);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("returns a stable launch failure when existing Chrome attach fails", async () => {
    const { config } = await createFixture();
    const service = createBrowserService(config, {
      browserInstalled: async () => true,
      loadExistingChromeChromium: async () => ({
        connectOverCDP: async () => {
          throw new Error("raw attach failure with factory-test-token");
        },
      }),
    });

    await expect(service.tabs()).rejects.toMatchObject({
      code: "BROWSER_LAUNCH_FAILED",
      message: "Browser launch failed.",
    });
  });
});
