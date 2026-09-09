import { access } from "node:fs/promises";
import type { BrowserBackend } from "./browser-backend.js";
import { BrowserRuntime } from "./browser-runtime.js";
import { BrowserService } from "./browser-service.js";
import type { AppConfig } from "./config.js";
import { PlaywrightBrowserBackend } from "./playwright-browser-backend.js";

export interface BrowserFactoryOptions {
  browserBackendFactory?: () => Promise<BrowserBackend>;
  browserInstalled?: () => Promise<boolean>;
}

export function createBrowserService(config: AppConfig, options: BrowserFactoryOptions = {}): BrowserService {
  const runtime = new BrowserRuntime({
    enabled: config.browser.enabled,
    browserInstalled: options.browserInstalled ?? probeBundledChromium,
    createBackend: options.browserBackendFactory ?? createProductionBackendFactory(config),
  });

  return new BrowserService(runtime, {
    timeoutMs: config.browser.timeoutMs,
    maxDiagnosticEntries: 100,
    maxDiagnosticMessageChars: 2_048,
  });
}

function createProductionBackendFactory(config: AppConfig): () => Promise<BrowserBackend> {
  return async () => {
    const { chromium } = await import("playwright");
    const context = await chromium.launchPersistentContext(config.browser.userDataDir, {
      headless: config.browser.headless,
    });
    return new PlaywrightBrowserBackend(context, {
      timeoutMs: config.browser.timeoutMs,
      maxDiagnosticEntries: 100,
    });
  };
}

async function probeBundledChromium(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    await access(chromium.executablePath());
    return true;
  } catch {
    return false;
  }
}
