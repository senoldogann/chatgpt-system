import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BrowserBackend } from "./browser-backend.js";
import { BrowserRuntime } from "./browser-runtime.js";
import { BrowserService } from "./browser-service.js";
import type { AppConfig } from "./config.js";
import { PlaywrightBrowserBackend } from "./playwright-browser-backend.js";

export interface BrowserFactoryOptions {
  browserBackendFactory?: () => Promise<BrowserBackend>;
  browserInstalled?: () => Promise<boolean>;
}

type BrowserConfig = AppConfig["browser"];

export function createBrowserService(config: AppConfig, options: BrowserFactoryOptions = {}): BrowserService {
  const browserConfig = resolveBrowserConfig(config);
  const runtime = new BrowserRuntime({
    enabled: browserConfig.enabled,
    browserInstalled: options.browserInstalled ?? probeBundledChromium,
    createBackend: options.browserBackendFactory ?? createProductionBackendFactory(browserConfig),
  });

  return new BrowserService(runtime, {
    timeoutMs: browserConfig.timeoutMs,
    maxDiagnosticEntries: 100,
    maxDiagnosticMessageChars: 2_048,
  });
}

function resolveBrowserConfig(config: AppConfig): BrowserConfig {
  return config.browser ?? {
    enabled: false,
    headless: true,
    timeoutMs: 15_000,
    userDataDir: path.join(homedir(), ".chatgpt-system", "browser-profile"),
  };
}

function createProductionBackendFactory(config: BrowserConfig): () => Promise<BrowserBackend> {
  return async () => {
    const { chromium } = await import("playwright");
    const context = await chromium.launchPersistentContext(config.userDataDir, {
      headless: config.headless,
    });
    return new PlaywrightBrowserBackend(context, {
      timeoutMs: config.timeoutMs,
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
