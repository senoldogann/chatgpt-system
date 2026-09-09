import { describe, expect, it } from "vitest";
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
import { BrowserService } from "../src/browser-service.js";

function backendWithTabsError(error: Error): BrowserBackend {
  const unavailable = async (): Promise<never> => { throw error; };
  return {
    health: async (): Promise<BrowserHealth> => ({ enabled: true, state: "running", browserInstalled: true }),
    tabs: unavailable,
    newTab: unavailable,
    selectTab: unavailable,
    closeTab: unavailable,
    navigate: unavailable,
    targetCount: unavailable,
    targetMetadata: unavailable as unknown as (pageId: string, target: BrowserTarget) => Promise<BrowserTargetMetadata>,
    focusedMetadata: unavailable,
    snapshot: unavailable,
    click: unavailable,
    fill: unavailable,
    selectOption: unavailable,
    pressKey: unavailable as unknown as (pageId: string, key: BrowserKey) => Promise<void>,
    waitForText: unavailable,
    screenshot: unavailable as unknown as (pageId: string) => Promise<BrowserScreenshot>,
    consoleErrors: unavailable as unknown as (pageId: string) => Promise<BrowserConsoleResult>,
    networkErrors: unavailable as unknown as (pageId: string) => Promise<BrowserNetworkResult>,
    close: async (): Promise<void> => {},
  };
}

describe("BrowserService error normalization", () => {
  it("maps Playwright-style timeout errors to a stable timeout code without leaking raw text", async () => {
    const error = new Error("RAW_TIMEOUT_SECRET /Users/private/browser-profile");
    error.name = "TimeoutError";
    const service = new BrowserService(backendWithTabsError(error), { timeoutMs: 1_000 });

    await expect(service.tabs()).rejects.toMatchObject({
      code: "BROWSER_TIMEOUT",
      message: "Browser operation timed out.",
    });
    await expect(service.tabs()).rejects.not.toThrow("RAW_TIMEOUT_SECRET");
  });

  it("maps unknown backend failures to a stable unavailable error without leaking backend details", async () => {
    const service = new BrowserService(
      backendWithTabsError(new Error("RAW_PLAYWRIGHT_SECRET --user-data-dir=/private/profile")),
      { timeoutMs: 1_000 },
    );

    await expect(service.tabs()).rejects.toMatchObject({
      code: "BROWSER_UNAVAILABLE",
      message: "Browser operation failed.",
    });
    await expect(service.tabs()).rejects.not.toThrow("RAW_PLAYWRIGHT_SECRET");
  });
});
