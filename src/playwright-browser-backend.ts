import { randomBytes } from "node:crypto";
import type {
  BrowserContext,
  ConsoleMessage,
  Locator,
  Page,
  Request,
  Response,
} from "playwright";
import type { BrowserBackend, BrowserTargetMetadata } from "./browser-backend.js";
import type {
  BrowserConsoleEntry,
  BrowserConsoleResult,
  BrowserHealth,
  BrowserKey,
  BrowserNetworkEntry,
  BrowserNetworkResult,
  BrowserScreenshot,
  BrowserTabView,
  BrowserTarget,
} from "./browser-types.js";
import { BrowserError } from "./errors.js";

export interface PlaywrightBrowserBackendOptions {
  timeoutMs: number;
  maxDiagnosticEntries?: number;
}

interface PageDiagnostics {
  consoleEntries: BrowserConsoleEntry[];
  consoleTruncated: boolean;
  networkEntries: BrowserNetworkEntry[];
  networkTruncated: boolean;
}

export class PlaywrightBrowserBackend implements BrowserBackend {
  private readonly timeoutMs: number;
  private readonly maxDiagnosticEntries: number;
  private readonly pagesById = new Map<string, Page>();
  private readonly idsByPage = new WeakMap<Page, string>();
  private readonly diagnosticsByPageId = new Map<string, PageDiagnostics>();
  private activePageId: string | null = null;
  private closed = false;

  constructor(
    private readonly context: BrowserContext,
    options: PlaywrightBrowserBackendOptions,
  ) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("Browser timeout must be a positive integer.");
    }
    this.timeoutMs = options.timeoutMs;
    this.maxDiagnosticEntries = Math.max(1, options.maxDiagnosticEntries ?? 100);

    for (const page of context.pages()) {
      this.registerPage(page, false);
    }
    const existing = context.pages();
    if (existing.length > 0) {
      this.activePageId = this.idsByPage.get(existing.at(-1)!) ?? null;
    }

    context.on("page", (page) => {
      this.registerPage(page, true);
    });
  }

  async health(): Promise<BrowserHealth> {
    return {
      enabled: true,
      state: this.closed ? "stopped" : "running",
      browserInstalled: true,
    };
  }

  async tabs(): Promise<BrowserTabView[]> {
    if (this.closed) return [];
    const views: BrowserTabView[] = [];
    for (const [pageId, page] of this.pagesById) {
      if (page.isClosed()) continue;
      views.push(await this.tabView(pageId, page));
    }
    return views;
  }

  async newTab(url?: string): Promise<BrowserTabView> {
    this.assertOpen();
    const page = await this.context.newPage();
    const pageId = this.registerPage(page, true);
    if (url !== undefined) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    }
    return this.tabView(pageId, page);
  }

  async selectTab(pageId: string): Promise<BrowserTabView> {
    const page = this.requirePage(pageId);
    await page.bringToFront();
    this.activePageId = pageId;
    return this.tabView(pageId, page);
  }

  async closeTab(pageId: string): Promise<void> {
    const page = this.requirePage(pageId);
    await page.close();
    this.unregisterPage(pageId, page);
  }

  async navigate(pageId: string, url: string, timeoutMs: number): Promise<BrowserTabView> {
    const page = this.requirePage(pageId);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    this.activePageId = pageId;
    return this.tabView(pageId, page);
  }

  async targetCount(pageId: string, target: BrowserTarget): Promise<number> {
    return this.locatorFor(this.requirePage(pageId), target).count();
  }

  async targetMetadata(pageId: string, target: BrowserTarget): Promise<BrowserTargetMetadata> {
    const locator = this.locatorFor(this.requirePage(pageId), target);
    return this.metadataFor(locator, this.semanticLabels(target));
  }

  async focusedMetadata(pageId: string): Promise<BrowserTargetMetadata | null> {
    const locator = this.requirePage(pageId).locator(":focus");
    if ((await locator.count()) !== 1) return null;
    return this.metadataFor(locator, []);
  }

  async snapshot(pageId: string): Promise<string> {
    const page = this.requirePage(pageId);
    return page.locator("body").ariaSnapshot({
      mode: "ai",
      depth: 12,
      timeout: this.timeoutMs,
    });
  }

  async click(pageId: string, target: BrowserTarget): Promise<void> {
    await this.locatorFor(this.requirePage(pageId), target).click({ timeout: this.timeoutMs });
  }

  async fill(pageId: string, target: BrowserTarget, text: string): Promise<void> {
    await this.locatorFor(this.requirePage(pageId), target).fill(text, { timeout: this.timeoutMs });
  }

  async selectOption(pageId: string, target: BrowserTarget, value: string): Promise<void> {
    await this.locatorFor(this.requirePage(pageId), target).selectOption(value, { timeout: this.timeoutMs });
  }

  async pressKey(pageId: string, key: BrowserKey): Promise<void> {
    await this.requirePage(pageId).keyboard.press(key);
  }

  async waitForText(pageId: string, text: string, timeoutMs: number): Promise<void> {
    await this.requirePage(pageId).getByText(text).waitFor({ state: "visible", timeout: timeoutMs });
  }

  async screenshot(pageId: string): Promise<BrowserScreenshot> {
    const page = this.requirePage(pageId);
    const buffer = await page.screenshot({ type: "png", timeout: this.timeoutMs });
    const viewport = page.viewportSize();
    return {
      pageId,
      pngBase64: buffer.toString("base64"),
      width: viewport?.width ?? 0,
      height: viewport?.height ?? 0,
    };
  }

  async consoleErrors(pageId: string): Promise<BrowserConsoleResult> {
    this.requirePage(pageId);
    const diagnostics = this.requireDiagnostics(pageId);
    return {
      pageId,
      entries: [...diagnostics.consoleEntries],
      truncated: diagnostics.consoleTruncated,
    };
  }

  async networkErrors(pageId: string): Promise<BrowserNetworkResult> {
    this.requirePage(pageId);
    const diagnostics = this.requireDiagnostics(pageId);
    return {
      pageId,
      entries: [...diagnostics.networkEntries],
      truncated: diagnostics.networkTruncated,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close();
    this.pagesById.clear();
    this.diagnosticsByPageId.clear();
    this.activePageId = null;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new BrowserError("BROWSER_UNAVAILABLE", "The browser context is closed.");
    }
  }

  private registerPage(page: Page, makeActive: boolean): string {
    const existing = this.idsByPage.get(page);
    if (existing !== undefined) {
      if (makeActive) this.activePageId = existing;
      return existing;
    }

    const pageId = randomBytes(32).toString("base64url");
    this.idsByPage.set(page, pageId);
    this.pagesById.set(pageId, page);
    this.diagnosticsByPageId.set(pageId, {
      consoleEntries: [],
      consoleTruncated: false,
      networkEntries: [],
      networkTruncated: false,
    });

    page.on("console", (message) => this.captureConsole(pageId, message));
    page.on("requestfailed", (request) => this.captureRequestFailure(pageId, request));
    page.on("response", (response) => this.captureResponseFailure(pageId, response));
    page.on("close", () => this.unregisterPage(pageId, page));

    if (makeActive || this.activePageId === null) this.activePageId = pageId;
    return pageId;
  }

  private unregisterPage(pageId: string, page: Page): void {
    if (this.pagesById.get(pageId) !== page) return;
    this.pagesById.delete(pageId);
    this.diagnosticsByPageId.delete(pageId);
    if (this.activePageId === pageId) {
      this.activePageId = this.pagesById.keys().next().value ?? null;
    }
  }

  private requirePage(pageId: string): Page {
    this.assertOpen();
    const page = this.pagesById.get(pageId);
    if (!page || page.isClosed()) {
      if (page) this.unregisterPage(pageId, page);
      throw new BrowserError("BROWSER_PAGE_NOT_FOUND", "The browser page was not found.");
    }
    return page;
  }

  private requireDiagnostics(pageId: string): PageDiagnostics {
    const diagnostics = this.diagnosticsByPageId.get(pageId);
    if (!diagnostics) {
      throw new BrowserError("BROWSER_PAGE_NOT_FOUND", "The browser page was not found.");
    }
    return diagnostics;
  }

  private async tabView(pageId: string, page: Page): Promise<BrowserTabView> {
    return {
      pageId,
      title: await page.title(),
      url: page.url(),
      active: this.activePageId === pageId,
    };
  }

  private locatorFor(page: Page, target: BrowserTarget): Locator {
    switch (target.by) {
      case "role":
        return page.getByRole(target.role, {
          ...(target.name !== undefined ? { name: target.name } : {}),
          ...(target.exact !== undefined ? { exact: target.exact } : {}),
        });
      case "text":
        return page.getByText(target.text, {
          ...(target.exact !== undefined ? { exact: target.exact } : {}),
        });
      case "label":
        return page.getByLabel(target.label, {
          ...(target.exact !== undefined ? { exact: target.exact } : {}),
        });
      case "testId":
        return page.getByTestId(target.testId);
    }
  }

  private semanticLabels(target: BrowserTarget): string[] {
    switch (target.by) {
      case "role":
        return target.name ? [target.name] : [];
      case "text":
        return [target.text];
      case "label":
        return [target.label];
      case "testId":
        return [target.testId];
    }
  }

  private async metadataFor(locator: Locator, labels: string[]): Promise<BrowserTargetMetadata> {
    const [type, autocomplete, name, id, ariaLabel] = await Promise.all([
      locator.getAttribute("type"),
      locator.getAttribute("autocomplete"),
      locator.getAttribute("name"),
      locator.getAttribute("id"),
      locator.getAttribute("aria-label"),
    ]);

    return {
      tagName: "",
      ...(type !== null ? { type } : {}),
      ...(autocomplete !== null ? { autocomplete } : {}),
      labels,
      ...(name !== null ? { name } : {}),
      ...(id !== null ? { id } : {}),
      ...(ariaLabel !== null ? { ariaLabel } : {}),
    };
  }

  private captureConsole(pageId: string, message: ConsoleMessage): void {
    const level = message.type();
    if (level !== "error" && level !== "warning") return;
    const diagnostics = this.diagnosticsByPageId.get(pageId);
    if (!diagnostics) return;
    this.appendBounded(
      diagnostics.consoleEntries,
      { level, message: message.text() },
      (truncated) => { diagnostics.consoleTruncated = truncated; },
    );
  }

  private captureRequestFailure(pageId: string, request: Request): void {
    const diagnostics = this.diagnosticsByPageId.get(pageId);
    if (!diagnostics) return;
    const failure = request.failure();
    this.appendBounded(
      diagnostics.networkEntries,
      {
        method: request.method(),
        url: request.url(),
        ...(failure?.errorText ? { failure: failure.errorText } : {}),
      },
      (truncated) => { diagnostics.networkTruncated = truncated; },
    );
  }

  private captureResponseFailure(pageId: string, response: Response): void {
    const status = response.status();
    if (status < 400) return;
    const diagnostics = this.diagnosticsByPageId.get(pageId);
    if (!diagnostics) return;
    this.appendBounded(
      diagnostics.networkEntries,
      {
        method: response.request().method(),
        url: response.url(),
        status,
      },
      (truncated) => { diagnostics.networkTruncated = truncated; },
    );
  }

  private appendBounded<T>(entries: T[], entry: T, markTruncated: (value: boolean) => void): void {
    entries.push(entry);
    if (entries.length <= this.maxDiagnosticEntries) return;
    entries.splice(0, entries.length - this.maxDiagnosticEntries);
    markTruncated(true);
  }
}
