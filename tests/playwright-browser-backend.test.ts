import { describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright";
import type { BrowserTarget } from "../src/browser-types.js";
import { PlaywrightBrowserBackend } from "../src/playwright-browser-backend.js";

class FakeLocator {
  countValue = 1;
  attributes = new Map<string, string | null>();
  ariaSnapshotValue = '- textbox "Email": person@example.com';
  calls: Array<{ method: string; value?: string; options?: unknown }> = [];

  async count(): Promise<number> { return this.countValue; }
  async getAttribute(name: string): Promise<string | null> { return this.attributes.get(name) ?? null; }
  async ariaSnapshot(options?: unknown): Promise<string> {
    this.calls.push({ method: "ariaSnapshot", options });
    return this.ariaSnapshotValue;
  }
  async click(options?: unknown): Promise<void> { this.calls.push({ method: "click", options }); }
  async fill(value: string, options?: unknown): Promise<void> { this.calls.push({ method: "fill", value, options }); }
  async selectOption(value: string, options?: unknown): Promise<string[]> {
    this.calls.push({ method: "selectOption", value, options });
    return [value];
  }
  async waitFor(options?: unknown): Promise<void> { this.calls.push({ method: "waitFor", options }); }
}

class FakePage {
  private currentUrl = "about:blank";
  private currentTitle = "Blank";
  closed = false;
  bringToFrontCalls = 0;
  closeCalls = 0;
  gotoCalls: Array<{ url: string; options: unknown }> = [];
  keyboardCalls: string[] = [];
  screenshotOptions: unknown[] = [];
  roleLocator = new FakeLocator();
  textLocator = new FakeLocator();
  labelLocator = new FakeLocator();
  testIdLocator = new FakeLocator();
  focusLocator = new FakeLocator();
  bodyLocator = new FakeLocator();
  locatorCalls: string[] = [];
  semanticCalls: Array<{ kind: string; args: unknown[] }> = [];
  listeners = new Map<string, Array<(...args: any[]) => void>>();

  keyboard = {
    press: async (key: string) => { this.keyboardCalls.push(key); },
  };

  url(): string { return this.currentUrl; }
  async title(): Promise<string> { return this.currentTitle; }
  isClosed(): boolean { return this.closed; }
  viewportSize(): { width: number; height: number } { return { width: 1280, height: 720 }; }

  setLocation(url: string, title = "Example"): void {
    this.currentUrl = url;
    this.currentTitle = title;
  }

  on(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  getByRole(role: string, options?: unknown): FakeLocator {
    this.semanticCalls.push({ kind: "role", args: [role, options] });
    return this.roleLocator;
  }
  getByText(text: string, options?: unknown): FakeLocator {
    this.semanticCalls.push({ kind: "text", args: [text, options] });
    return this.textLocator;
  }
  getByLabel(label: string, options?: unknown): FakeLocator {
    this.semanticCalls.push({ kind: "label", args: [label, options] });
    return this.labelLocator;
  }
  getByTestId(testId: string): FakeLocator {
    this.semanticCalls.push({ kind: "testId", args: [testId] });
    return this.testIdLocator;
  }
  locator(selector: string): FakeLocator {
    this.locatorCalls.push(selector);
    if (selector === ":focus") return this.focusLocator;
    if (selector === "body") return this.bodyLocator;
    throw new Error(`Unexpected selector ${selector}`);
  }

  async goto(url: string, options: unknown): Promise<null> {
    this.gotoCalls.push({ url, options });
    this.setLocation(url);
    return null;
  }
  async bringToFront(): Promise<void> { this.bringToFrontCalls += 1; }
  async close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
    this.emit("close");
  }
  async screenshot(options: unknown): Promise<Buffer> {
    this.screenshotOptions.push(options);
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
}

class FakeContext {
  pagesValue: FakePage[];
  closeCalls = 0;
  listeners = new Map<string, Array<(page: Page) => void>>();

  constructor(pages: FakePage[]) {
    this.pagesValue = pages;
  }

  pages(): Page[] { return this.pagesValue as unknown as Page[]; }
  async newPage(): Promise<Page> {
    const page = new FakePage();
    this.pagesValue.push(page);
    this.emitPage(page);
    return page as unknown as Page;
  }
  on(event: string, listener: (page: Page) => void): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }
  emitPage(page: FakePage): void {
    for (const listener of this.listeners.get("page") ?? []) listener(page as unknown as Page);
  }
  async close(): Promise<void> { this.closeCalls += 1; }
}

function makeBackend(page = new FakePage()): { context: FakeContext; page: FakePage; backend: PlaywrightBrowserBackend } {
  const context = new FakeContext([page]);
  const backend = new PlaywrightBrowserBackend(context as unknown as BrowserContext, { timeoutMs: 4_000, maxDiagnosticEntries: 2 });
  return { context, page, backend };
}

describe("PlaywrightBrowserBackend", () => {
  it("maps context pages to opaque in-memory page IDs without exposing browser handles", async () => {
    const { backend } = makeBackend();

    const tabs = await backend.tabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.pageId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(tabs[0]).toEqual(expect.objectContaining({ title: "Blank", url: "about:blank", active: true }));
    expect(tabs[0]).not.toHaveProperty("pid");
  });

  it("creates, selects, navigates, and closes pages through opaque IDs", async () => {
    const { context, backend } = makeBackend();

    const created = await backend.newTab("https://example.com/start");
    const createdPage = context.pagesValue[1]!;
    expect(createdPage.gotoCalls[0]).toEqual({
      url: "https://example.com/start",
      options: { waitUntil: "domcontentloaded", timeout: 4_000 },
    });

    expect((await backend.selectTab(created.pageId)).active).toBe(true);
    expect(createdPage.bringToFrontCalls).toBe(1);

    await backend.navigate(created.pageId, "https://example.com/next", 1_500);
    expect(createdPage.gotoCalls.at(-1)).toEqual({
      url: "https://example.com/next",
      options: { waitUntil: "domcontentloaded", timeout: 1_500 },
    });

    await backend.closeTab(created.pageId);
    expect(createdPage.closeCalls).toBe(1);
    await expect(backend.selectTab(created.pageId)).rejects.toMatchObject({ code: "BROWSER_PAGE_NOT_FOUND" });
  });

  it.each([
    [{ by: "role", role: "button", name: "Save", exact: true }, "role"],
    [{ by: "text", text: "Save", exact: true }, "text"],
    [{ by: "label", label: "Email", exact: true }, "label"],
    [{ by: "testId", testId: "save-button" }, "testId"],
  ] as const)("resolves semantic target %j without accepting raw selectors", async (target, expectedKind) => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;

    expect(await backend.targetCount(pageId, target as BrowserTarget)).toBe(1);
    expect(page.semanticCalls.at(-1)?.kind).toBe(expectedKind);
  });

  it("returns fixed target metadata plus semantic labels for credential policy", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;
    page.roleLocator.attributes.set("type", "password");
    page.roleLocator.attributes.set("autocomplete", "current-password");
    page.roleLocator.attributes.set("name", "account-password");
    page.roleLocator.attributes.set("id", "pw");
    page.roleLocator.attributes.set("aria-label", "Account password");

    expect(await backend.targetMetadata(pageId, { by: "role", role: "textbox", name: "Password" })).toEqual({
      tagName: "",
      type: "password",
      autocomplete: "current-password",
      labels: ["Password"],
      name: "account-password",
      id: "pw",
      ariaLabel: "Account password",
    });
  });

  it("uses a fixed focus locator for focused-field metadata", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;
    page.focusLocator.countValue = 1;
    page.focusLocator.attributes.set("type", "password");

    expect(await backend.focusedMetadata(pageId)).toEqual(expect.objectContaining({ type: "password" }));
    expect(page.locatorCalls).toContain(":focus");
  });

  it("captures bounded AI ARIA snapshots from the body", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;

    expect(await backend.snapshot(pageId)).toContain("person@example.com");
    expect(page.bodyLocator.calls).toContainEqual({
      method: "ariaSnapshot",
      options: { mode: "ai", depth: 12, timeout: 4_000 },
    });
  });

  it("delegates actions with the configured timeout and fixed key surface", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;
    const target: BrowserTarget = { by: "role", role: "textbox", name: "Email" };

    await backend.click(pageId, target);
    await backend.fill(pageId, target, "hello");
    await backend.selectOption(pageId, { by: "label", label: "Country" }, "FI");
    await backend.pressKey(pageId, "Enter");
    await backend.waitForText(pageId, "Done", 1_250);

    expect(page.roleLocator.calls).toContainEqual({ method: "click", options: { timeout: 4_000 } });
    expect(page.roleLocator.calls).toContainEqual({ method: "fill", value: "hello", options: { timeout: 4_000 } });
    expect(page.labelLocator.calls).toContainEqual({ method: "selectOption", value: "FI", options: { timeout: 4_000 } });
    expect(page.keyboardCalls).toEqual(["Enter"]);
    expect(page.textLocator.calls).toContainEqual({ method: "waitFor", options: { state: "visible", timeout: 1_250 } });
  });

  it("returns screenshots in memory without writing a path", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;

    const result = await backend.screenshot(pageId);
    expect(result).toEqual({
      pageId,
      pngBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
      width: 1280,
      height: 720,
    });
    expect(page.screenshotOptions).toEqual([{ type: "png", timeout: 4_000 }]);
  });

  it("correlates diagnostics with opaque evidence metadata and advances generation on explicit navigation", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;

    page.emit("console", {
      type: () => "error",
      text: () => "before reload",
      location: () => ({
        url: "https://example.com/assets/app.js?token=source-secret#fragment",
        lineNumber: 12,
        columnNumber: 34,
      }),
    });
    const before = await backend.consoleErrors(pageId);
    expect(before).toMatchObject({ generation: 0, latestSequence: 1 });
    expect(before.entries[0]).toMatchObject({
      evidence: { generation: 0, sequence: 1 },
      runtimeSource: {
        url: "https://example.com/assets/app.js?token=source-secret#fragment",
        lineNumber: 12,
        columnNumber: 34,
        sourceMapStatus: "UNAVAILABLE",
      },
    });

    const request = {
      method: () => "POST",
      url: () => "https://example.com/api?token=network-secret",
      resourceType: () => "fetch",
      isNavigationRequest: () => false,
      frame: () => ({ url: () => "https://example.com/page?auth=secret#private" }),
    };
    page.emit("response", {
      status: () => 503,
      url: () => request.url(),
      request: () => request,
    });
    const network = await backend.networkErrors(pageId);
    expect(network).toMatchObject({ generation: 0, latestSequence: 2 });
    expect(network.entries[0]).toMatchObject({
      evidence: { generation: 0, sequence: 2 },
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
      resourceType: "fetch",
      navigationRequest: false,
      initiator: { kind: "frame", url: "https://example.com/page?auth=secret#private" },
    });

    await backend.navigate(pageId, "https://example.com/reloaded", 1_500);
    page.emit("console", {
      type: () => "warning",
      text: () => "after reload",
      location: () => ({ url: "https://example.com/assets/app.js", lineNumber: 20, columnNumber: 2 }),
    });
    const after = await backend.consoleErrors(pageId);
    expect(after).toMatchObject({ generation: 1, latestSequence: 3 });
    expect(after.entries.at(-1)).toMatchObject({
      evidence: { generation: 1, sequence: 3 },
      message: "after reload",
    });
  });

  it("keeps bounded console and network error tails per page", async () => {
    const { page, backend } = makeBackend();
    const pageId = (await backend.tabs())[0]!.pageId;

    page.emit("console", { type: () => "error", text: () => "one" });
    page.emit("console", { type: () => "warning", text: () => "two" });
    page.emit("console", { type: () => "error", text: () => "three" });
    page.emit("requestfailed", {
      method: () => "GET",
      url: () => "https://example.com/a?secret=1",
      failure: () => ({ errorText: "failed-one" }),
      resourceType: () => "fetch",
      isNavigationRequest: () => false,
      frame: () => ({ url: () => "https://example.com/page" }),
    });
    page.emit("response", {
      status: () => 503,
      url: () => "https://example.com/b?token=2",
      request: () => ({
        method: () => "POST",
        resourceType: () => "fetch",
        isNavigationRequest: () => false,
        frame: () => ({ url: () => "https://example.com/page" }),
      }),
    });
    page.emit("requestfailed", {
      method: () => "DELETE",
      url: () => "https://example.com/c?token=3",
      failure: () => ({ errorText: "failed-three" }),
      resourceType: () => "xhr",
      isNavigationRequest: () => false,
      frame: () => ({ url: () => "https://example.com/page" }),
    });

    expect(await backend.consoleErrors(pageId)).toEqual({
      pageId,
      generation: 0,
      latestSequence: 6,
      entries: [
        { level: "warning", message: "two", evidence: { generation: 0, sequence: 2 } },
        { level: "error", message: "three", evidence: { generation: 0, sequence: 3 } },
      ],
      truncated: true,
    });
    expect((await backend.networkErrors(pageId)).entries.map((entry) => entry.method)).toEqual(["POST", "DELETE"]);
  });

  it("registers popups from the context and clears everything on close", async () => {
    const { context, backend } = makeBackend();
    const popup = new FakePage();
    popup.setLocation("https://example.com/popup", "Popup");
    context.pagesValue.push(popup);
    context.emitPage(popup);

    expect((await backend.tabs()).map((tab) => tab.title)).toContain("Popup");
    await backend.close();
    expect(context.closeCalls).toBe(1);
    expect(await backend.tabs()).toEqual([]);
  });
});
