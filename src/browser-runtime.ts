import type { BrowserBackend, BrowserTargetMetadata } from "./browser-backend.js";
import type {
  BrowserConsoleResult,
  BrowserHealth,
  BrowserKey,
  BrowserNetworkResult,
  BrowserScreenshot,
  BrowserTabView,
  BrowserTarget,
} from "./browser-types.js";
import { BrowserError } from "./errors.js";

export interface BrowserRuntimeOptions {
  enabled: boolean;
  browserInstalled: () => Promise<boolean>;
  createBackend: () => Promise<BrowserBackend>;
}

export class BrowserRuntime implements BrowserBackend {
  private backend: BrowserBackend | null = null;
  private startPromise: Promise<BrowserBackend> | null = null;
  private unavailable = false;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: BrowserRuntimeOptions) {}

  async health(): Promise<BrowserHealth> {
    const browserInstalled = await this.safeBrowserInstalledProbe();
    if (!this.options.enabled) {
      return { enabled: false, state: "disabled", browserInstalled };
    }
    if (this.backend) {
      return { enabled: true, state: "running", browserInstalled };
    }
    if (this.unavailable) {
      return { enabled: true, state: "unavailable", browserInstalled };
    }
    return { enabled: true, state: "stopped", browserInstalled };
  }

  async tabs(): Promise<BrowserTabView[]> {
    return (await this.requireBackend()).tabs();
  }

  async newTab(url?: string): Promise<BrowserTabView> {
    return (await this.requireBackend()).newTab(url);
  }

  async selectTab(pageId: string): Promise<BrowserTabView> {
    return (await this.requireBackend()).selectTab(pageId);
  }

  async closeTab(pageId: string): Promise<void> {
    await (await this.requireBackend()).closeTab(pageId);
  }

  async navigate(pageId: string, url: string, timeoutMs: number): Promise<BrowserTabView> {
    return (await this.requireBackend()).navigate(pageId, url, timeoutMs);
  }

  async targetCount(pageId: string, target: BrowserTarget): Promise<number> {
    return (await this.requireBackend()).targetCount(pageId, target);
  }

  async targetMetadata(pageId: string, target: BrowserTarget): Promise<BrowserTargetMetadata> {
    return (await this.requireBackend()).targetMetadata(pageId, target);
  }

  async focusedMetadata(pageId: string): Promise<BrowserTargetMetadata | null> {
    return (await this.requireBackend()).focusedMetadata(pageId);
  }

  async snapshot(pageId: string): Promise<string> {
    return (await this.requireBackend()).snapshot(pageId);
  }

  async click(pageId: string, target: BrowserTarget): Promise<void> {
    await (await this.requireBackend()).click(pageId, target);
  }

  async fill(pageId: string, target: BrowserTarget, text: string): Promise<void> {
    await (await this.requireBackend()).fill(pageId, target, text);
  }

  async selectOption(pageId: string, target: BrowserTarget, value: string): Promise<void> {
    await (await this.requireBackend()).selectOption(pageId, target, value);
  }

  async pressKey(pageId: string, key: BrowserKey): Promise<void> {
    await (await this.requireBackend()).pressKey(pageId, key);
  }

  async waitForText(pageId: string, text: string, timeoutMs: number): Promise<void> {
    await (await this.requireBackend()).waitForText(pageId, text, timeoutMs);
  }

  async screenshot(pageId: string): Promise<BrowserScreenshot> {
    return (await this.requireBackend()).screenshot(pageId);
  }

  async consoleErrors(pageId: string): Promise<BrowserConsoleResult> {
    return (await this.requireBackend()).consoleErrors(pageId);
  }

  async networkErrors(pageId: string): Promise<BrowserNetworkResult> {
    return (await this.requireBackend()).networkErrors(pageId);
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    const closing = this.closeInternal();
    this.closePromise = closing;
    try {
      await closing;
    } finally {
      if (this.closePromise === closing) this.closePromise = null;
    }
  }

  private async closeInternal(): Promise<void> {
    let backend = this.backend;
    if (!backend && this.startPromise) {
      try {
        backend = await this.startPromise;
      } catch {
        backend = null;
      }
    }

    this.backend = null;
    this.startPromise = null;
    this.unavailable = false;

    if (backend) await backend.close();
  }

  private async requireBackend(): Promise<BrowserBackend> {
    if (!this.options.enabled) {
      throw new BrowserError("BROWSER_DISABLED", "Browser automation is disabled.");
    }

    if (this.closePromise) await this.closePromise;
    if (this.backend) return this.backend;
    if (this.startPromise) return this.startPromise;

    const start = this.options.createBackend()
      .then((backend) => {
        this.backend = backend;
        this.unavailable = false;
        return backend;
      })
      .catch(() => {
        this.unavailable = true;
        throw new BrowserError("BROWSER_LAUNCH_FAILED", "Browser launch failed.");
      })
      .finally(() => {
        if (this.startPromise === start) this.startPromise = null;
      });

    this.startPromise = start;
    return start;
  }

  private async safeBrowserInstalledProbe(): Promise<boolean> {
    try {
      return await this.options.browserInstalled();
    } catch {
      return false;
    }
  }
}
