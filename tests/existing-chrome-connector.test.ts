import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { BrowserError } from "../src/errors.js";
import {
  connectExistingChrome,
  type ExistingChromePlaywrightFacade,
} from "../src/existing-chrome-connector.js";

const cleanups: string[] = [];

async function createChromeDataDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-existing-chrome-connector-"));
  cleanups.push(root);
  const chromeDir = path.join(root, "Chrome");
  await mkdir(chromeDir, { recursive: true });
  await writeFile(
    path.join(chromeDir, "DevToolsActivePort"),
    "9222\n/devtools/browser/test-browser-token\n",
  );
  return chromeDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("existing Chrome CDP connector", () => {
  it("connects to the discovered loopback endpoint with daily-driver-safe Playwright options", async () => {
    const userDataDir = await createChromeDataDir();
    const context = {} as BrowserContext;
    const close = vi.fn(async () => undefined);
    const connectOverCDP = vi.fn(async () => ({
      contexts: () => [context],
      close,
    }));
    const loadChromium = vi.fn(async (): Promise<ExistingChromePlaywrightFacade> => ({ connectOverCDP }));

    const connection = await connectExistingChrome(
      { userDataDir, timeoutMs: 12_000 },
      { loadChromium },
    );

    expect(loadChromium).toHaveBeenCalledTimes(1);
    expect(connectOverCDP).toHaveBeenCalledWith(
      "ws://127.0.0.1:9222/devtools/browser/test-browser-token",
      { timeout: 12_000, isLocal: true, noDefaults: true },
    );
    expect(connection.context).toBe(context);

    await connection.disconnect();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("sanitizes default-context enumeration failures and closes the connected browser", async () => {
    const userDataDir = await createChromeDataDir();
    const close = vi.fn(async () => undefined);
    const connectOverCDP = vi.fn(async () => ({
      contexts: () => {
        throw new Error("context enumeration failed for test-browser-token");
      },
      close,
    }));

    let caught: unknown;
    try {
      await connectExistingChrome(
        { userDataDir, timeoutMs: 5_000 },
        { loadChromium: async () => ({ connectOverCDP }) },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "BROWSER_LAUNCH_FAILED",
      message: "Existing Chrome attach failed.",
    });
    expect(String(caught)).not.toContain("test-browser-token");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes an unusable connection and fails when Chrome exposes no default context", async () => {
    const userDataDir = await createChromeDataDir();
    const close = vi.fn(async () => undefined);
    const connectOverCDP = vi.fn(async () => ({ contexts: () => [], close }));

    await expect(connectExistingChrome(
      { userDataDir, timeoutMs: 5_000 },
      { loadChromium: async () => ({ connectOverCDP }) },
    )).rejects.toMatchObject({
      code: "BROWSER_LAUNCH_FAILED",
      message: "Existing Chrome attach failed.",
    });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("sanitizes Playwright loader failures", async () => {
    const userDataDir = await createChromeDataDir();

    await expect(connectExistingChrome(
      { userDataDir, timeoutMs: 5_000 },
      {
        loadChromium: async () => {
          throw new Error(`playwright load failed at ${userDataDir} for test-browser-token`);
        },
      },
    )).rejects.toMatchObject({
      code: "BROWSER_LAUNCH_FAILED",
      message: "Existing Chrome attach failed.",
    });
  });

  it("preserves only categorical cleanup failure state when no default context exists", async () => {
    const userDataDir = await createChromeDataDir();
    const close = vi.fn(async () => {
      throw new Error("close failed for test-browser-token");
    });
    const connectOverCDP = vi.fn(async () => ({ contexts: () => [], close }));

    let caught: unknown;
    try {
      await connectExistingChrome(
        { userDataDir, timeoutMs: 5_000 },
        { loadChromium: async () => ({ connectOverCDP }) },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "BROWSER_LAUNCH_FAILED",
      message: "Existing Chrome attach failed.",
      details: { cleanupFailed: true },
    });
    expect(String(caught)).not.toContain("test-browser-token");
  });

  it("sanitizes Playwright attach failures without exposing endpoint or profile data", async () => {
    const userDataDir = await createChromeDataDir();
    const connectOverCDP = vi.fn(async () => {
      throw new Error(`connect failed for ws://127.0.0.1:9222/devtools/browser/test-browser-token at ${userDataDir}`);
    });

    let caught: unknown;
    try {
      await connectExistingChrome(
        { userDataDir, timeoutMs: 5_000 },
        { loadChromium: async () => ({ connectOverCDP }) },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BrowserError);
    expect(caught).toMatchObject({
      code: "BROWSER_LAUNCH_FAILED",
      message: "Existing Chrome attach failed.",
    });
    expect(String(caught)).not.toContain("test-browser-token");
    expect(String(caught)).not.toContain(userDataDir);
    expect(String(caught)).not.toContain("9222");
  });

  it("does not load Playwright when DevToolsActivePort discovery fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-existing-chrome-missing-"));
    cleanups.push(root);
    const loadChromium = vi.fn(async (): Promise<ExistingChromePlaywrightFacade> => {
      throw new Error("must not be called");
    });

    await expect(connectExistingChrome(
      { userDataDir: root, timeoutMs: 5_000 },
      { loadChromium },
    )).rejects.toMatchObject({
      code: "BROWSER_UNAVAILABLE",
    });

    expect(loadChromium).not.toHaveBeenCalled();
  });

  it("sanitizes disconnect failures", async () => {
    const userDataDir = await createChromeDataDir();
    const context = {} as BrowserContext;
    const close = vi.fn(async () => {
      throw new Error("browser close failed for test-browser-token");
    });
    const connectOverCDP = vi.fn(async () => ({ contexts: () => [context], close }));

    const connection = await connectExistingChrome(
      { userDataDir, timeoutMs: 5_000 },
      { loadChromium: async () => ({ connectOverCDP }) },
    );

    let caught: unknown;
    try {
      await connection.disconnect();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "BROWSER_UNAVAILABLE",
      message: "Existing Chrome connection could not be closed cleanly.",
    });
    expect(String(caught)).not.toContain("test-browser-token");
  });
});
