import type { Browser, BrowserContext } from "playwright";
import { BrowserError } from "./errors.js";
import { discoverExistingChromeEndpoint } from "./existing-chrome-discovery.js";

const ATTACH_FAILED_MESSAGE = "Existing Chrome attach failed.";
const DISCONNECT_FAILED_MESSAGE = "Existing Chrome connection could not be closed cleanly.";

export interface ExistingChromePlaywrightFacade {
  connectOverCDP(
    endpoint: string,
    options: { timeout: number; isLocal: true; noDefaults: true },
  ): Promise<Pick<Browser, "contexts" | "close">>;
}

export interface ExistingChromeConnectorDependencies {
  loadChromium: () => Promise<ExistingChromePlaywrightFacade>;
}

export interface ExistingChromeConnection {
  context: BrowserContext;
  disconnect: () => Promise<void>;
}

export interface ExistingChromeConnectorInput {
  userDataDir: string;
  timeoutMs: number;
}

function attachFailed(details?: Record<string, unknown>): BrowserError {
  return new BrowserError("BROWSER_LAUNCH_FAILED", ATTACH_FAILED_MESSAGE, details);
}

function disconnectFailed(): BrowserError {
  return new BrowserError("BROWSER_UNAVAILABLE", DISCONNECT_FAILED_MESSAGE);
}

async function closeConnectedBrowser(
  browser: Pick<Browser, "close">,
): Promise<void> {
  try {
    await browser.close();
  } catch {
    throw disconnectFailed();
  }
}

async function failConnectedAttach(
  browser: Pick<Browser, "close">,
): Promise<never> {
  try {
    await browser.close();
  } catch {
    throw attachFailed({ cleanupFailed: true });
  }
  throw attachFailed();
}

export async function loadProductionExistingChromeChromium(): Promise<ExistingChromePlaywrightFacade> {
  const { chromium } = await import("playwright");
  return {
    connectOverCDP: (endpoint, options) => chromium.connectOverCDP(endpoint, options),
  };
}

export async function connectExistingChrome(
  input: ExistingChromeConnectorInput,
  dependencies: ExistingChromeConnectorDependencies,
): Promise<ExistingChromeConnection> {
  const discovered = await discoverExistingChromeEndpoint({ userDataDir: input.userDataDir });

  let chromium: ExistingChromePlaywrightFacade;
  try {
    chromium = await dependencies.loadChromium();
  } catch {
    throw attachFailed();
  }

  let browser: Pick<Browser, "contexts" | "close">;
  try {
    browser = await chromium.connectOverCDP(discovered.endpoint, {
      timeout: input.timeoutMs,
      isLocal: true,
      noDefaults: true,
    });
  } catch {
    throw attachFailed();
  }

  let contexts: BrowserContext[];
  try {
    contexts = browser.contexts();
  } catch {
    return failConnectedAttach(browser);
  }

  const context = contexts[0];
  if (context === undefined) {
    return failConnectedAttach(browser);
  }

  return {
    context,
    disconnect: () => closeConnectedBrowser(browser),
  };
}
