import type { AuditLogger } from "./audit.js";
import type { BrowserService } from "./browser-service.js";
import type { BrowserKey, BrowserTarget } from "./browser-types.js";
import { PolicyError } from "./errors.js";

export class ScopedBrowserService {
  constructor(
    private readonly service: BrowserService,
    private readonly audit: AuditLogger,
    private readonly adminEnabled: boolean,
  ) {}

  tabs() {
    return this.run("browser.tabs", () => this.service.tabs());
  }

  newTab(url?: string) {
    return this.run("browser.new_tab", () => this.service.newTab(url), this.originMetadata(url));
  }

  selectTab(pageId: string) {
    return this.run("browser.select_tab", () => this.service.selectTab(pageId));
  }

  closeTab(pageId: string) {
    return this.run("browser.close_tab", () => this.service.closeTab(pageId));
  }

  navigate(pageId: string, url: string) {
    return this.run("browser.navigate", () => this.service.navigate(pageId, url), this.originMetadata(url));
  }

  snapshot(pageId: string) {
    return this.run("browser.snapshot", () => this.service.snapshot(pageId));
  }

  click(pageId: string, target: BrowserTarget) {
    return this.run("browser.click", () => this.service.click(pageId, target));
  }

  fill(pageId: string, target: BrowserTarget, text: string) {
    return this.run("browser.fill", () => this.service.fill(pageId, target, text));
  }

  selectOption(pageId: string, target: BrowserTarget, value: string) {
    return this.run("browser.select_option", () => this.service.selectOption(pageId, target, value));
  }

  pressKey(pageId: string, key: BrowserKey) {
    return this.run("browser.press_key", () => this.service.pressKey(pageId, key));
  }

  waitForText(pageId: string, text: string, timeoutMs?: number) {
    return this.run("browser.wait_for_text", () => this.service.waitForText(pageId, text, timeoutMs));
  }

  screenshot(pageId: string) {
    return this.run("browser.screenshot", () => this.service.screenshot(pageId));
  }

  consoleErrors(pageId: string) {
    return this.run("browser.console_errors", () => this.service.consoleErrors(pageId));
  }

  networkErrors(pageId: string) {
    return this.run("browser.network_errors", () => this.service.networkErrors(pageId));
  }

  close() {
    return this.run("browser.close", () => this.service.close());
  }

  private run<T>(action: string, operation: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    return this.audit.run(
      action,
      undefined,
      async () => {
        if (!this.adminEnabled) {
          throw new PolicyError("Browser automation requires an Admin authority lease.");
        }
        return operation();
      },
      metadata,
    );
  }

  private originMetadata(url?: string): Record<string, unknown> | undefined {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
      return { origin: parsed.origin };
    } catch {
      return undefined;
    }
  }
}
