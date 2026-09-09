import type { BrowserBackend, BrowserTargetMetadata } from "./browser-backend.js";
import type {
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

export interface BrowserServiceOptions {
  timeoutMs: number;
  maxDiagnosticEntries?: number;
  maxDiagnosticMessageChars?: number;
  maxTabs?: number;
  maxTabTitleChars?: number;
  maxUrlChars?: number;
  maxSnapshotChars?: number;
  maxScreenshotBytes?: number;
}

const SENSITIVE_AUTOCOMPLETE = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
]);

const CREDENTIAL_KEYWORDS = [
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\botp\b/i,
  /\bone[- ]?time(?:\s+code)?\b/i,
  /\bverification\s+code\b/i,
  /\bsecurity\s+code\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bcard\s+number\b/i,
];

const EDITABLE_ARIA_VALUE = /^(\s*-\s+(?:textbox|searchbox|combobox|spinbutton)(?:\s+"[^"]*")?(?:\s+\[[^\]]+\])?):.*$/i;

export class BrowserService {
  private readonly timeoutMs: number;
  private readonly maxDiagnosticEntries: number;
  private readonly maxDiagnosticMessageChars: number;
  private readonly maxTabs: number;
  private readonly maxTabTitleChars: number;
  private readonly maxUrlChars: number;
  private readonly maxSnapshotChars: number;
  private readonly maxScreenshotBytes: number;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: BrowserBackend,
    options: BrowserServiceOptions,
  ) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("Browser timeout must be a positive integer.");
    }
    this.timeoutMs = options.timeoutMs;
    this.maxDiagnosticEntries = this.outputLimit(options.maxDiagnosticEntries, 100);
    this.maxDiagnosticMessageChars = this.outputLimit(options.maxDiagnosticMessageChars, 2_048);
    this.maxTabs = this.outputLimit(options.maxTabs, 64);
    this.maxTabTitleChars = this.outputLimit(options.maxTabTitleChars, 4_096);
    this.maxUrlChars = this.outputLimit(options.maxUrlChars, 16_384);
    this.maxSnapshotChars = this.outputLimit(options.maxSnapshotChars, 262_144);
    this.maxScreenshotBytes = this.outputLimit(options.maxScreenshotBytes, 8 * 1024 * 1024);
  }

  health(): Promise<BrowserHealth> {
    return this.serialize(() => this.backend.health());
  }

  tabs(): Promise<{ tabs: BrowserTabView[] }> {
    return this.serialize(async () => {
      const tabs = await this.backend.tabs();
      this.assertTabListWithinLimits(tabs);
      return { tabs };
    });
  }

  newTab(url?: string): Promise<BrowserTabView> {
    return this.serialize(async () => {
      if (url !== undefined) this.assertNavigableUrl(url);
      return this.assertTabViewWithinLimits(await this.backend.newTab(url));
    });
  }

  selectTab(pageId: string): Promise<BrowserTabView> {
    return this.serialize(async () => this.assertTabViewWithinLimits(await this.backend.selectTab(pageId)));
  }

  closeTab(pageId: string): Promise<{ closed: true }> {
    return this.serialize(async () => {
      await this.backend.closeTab(pageId);
      return { closed: true as const };
    });
  }

  navigate(pageId: string, url: string): Promise<BrowserTabView> {
    return this.serialize(async () => {
      this.assertNavigableUrl(url);
      return this.assertTabViewWithinLimits(await this.backend.navigate(pageId, url, this.timeoutMs));
    }, "navigation");
  }

  snapshot(pageId: string): Promise<{ pageId: string; snapshot: string }> {
    return this.serialize(async () => {
      const snapshot = this.redactEditableSnapshotValues(await this.backend.snapshot(pageId));
      this.assertOutputLength(snapshot, this.maxSnapshotChars, "Browser snapshot exceeded the safe output limit.");
      return { pageId, snapshot };
    });
  }

  click(pageId: string, target: BrowserTarget): Promise<{ ok: true }> {
    return this.serialize(async () => {
      await this.assertUniqueTarget(pageId, target);
      await this.backend.click(pageId, target);
      return { ok: true as const };
    });
  }

  fill(pageId: string, target: BrowserTarget, text: string): Promise<{ ok: true }> {
    return this.serialize(async () => {
      await this.assertUniqueTarget(pageId, target);
      const metadata = await this.backend.targetMetadata(pageId, target);
      this.assertNotCredentialTarget(metadata);
      await this.backend.fill(pageId, target, text);
      return { ok: true as const };
    });
  }

  selectOption(pageId: string, target: BrowserTarget, value: string): Promise<{ ok: true }> {
    return this.serialize(async () => {
      await this.assertUniqueTarget(pageId, target);
      await this.backend.selectOption(pageId, target, value);
      return { ok: true as const };
    });
  }

  pressKey(pageId: string, key: BrowserKey): Promise<{ ok: true }> {
    return this.serialize(async () => {
      const focused = await this.backend.focusedMetadata(pageId);
      if (focused) this.assertNotCredentialTarget(focused);
      await this.backend.pressKey(pageId, key);
      return { ok: true as const };
    });
  }

  waitForText(pageId: string, text: string, timeoutMs?: number): Promise<{ found: true }> {
    const requested = timeoutMs ?? this.timeoutMs;
    const boundedTimeout = Math.max(1, Math.min(requested, this.timeoutMs));
    return this.serialize(async () => {
      await this.backend.waitForText(pageId, text, boundedTimeout);
      return { found: true as const };
    });
  }

  screenshot(pageId: string): Promise<BrowserScreenshot> {
    return this.serialize(async () => {
      const screenshot = await this.backend.screenshot(pageId);
      const decodedBytes = Buffer.byteLength(screenshot.pngBase64, "base64");
      if (decodedBytes > this.maxScreenshotBytes) {
        throw this.protocolOutputLimit("Browser screenshot exceeded the safe output limit.");
      }
      return screenshot;
    });
  }

  consoleErrors(pageId: string): Promise<BrowserConsoleResult> {
    return this.serialize(async () => {
      const result = await this.backend.consoleErrors(pageId);
      const bounded = result.entries.map((entry) => ({
        ...entry,
        message: this.boundText(entry.message),
      }));
      const overflow = bounded.length > this.maxDiagnosticEntries;
      return {
        pageId: result.pageId,
        entries: bounded.slice(-this.maxDiagnosticEntries),
        truncated: result.truncated || overflow,
      };
    });
  }

  networkErrors(pageId: string): Promise<BrowserNetworkResult> {
    return this.serialize(async () => {
      const result = await this.backend.networkErrors(pageId);
      const sanitized = result.entries.map((entry) => this.sanitizeNetworkEntry(entry));
      const overflow = sanitized.length > this.maxDiagnosticEntries;
      return {
        pageId: result.pageId,
        entries: sanitized.slice(-this.maxDiagnosticEntries),
        truncated: result.truncated || overflow,
      };
    });
  }

  close(): Promise<{ closed: true }> {
    return this.serialize(async () => {
      await this.backend.close();
      return { closed: true as const };
    });
  }

  private serialize<T>(operation: () => Promise<T>, errorContext: "generic" | "navigation" = "generic"): Promise<T> {
    const result = this.operationChain
      .then(operation)
      .catch((error: unknown) => {
        throw this.normalizeBackendError(error, errorContext);
      });
    this.operationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private normalizeBackendError(error: unknown, errorContext: "generic" | "navigation"): BrowserError {
    if (error instanceof BrowserError) return error;
    if (error instanceof Error && error.name === "TimeoutError") {
      return new BrowserError("BROWSER_TIMEOUT", "Browser operation timed out.");
    }
    if (errorContext === "navigation") {
      return new BrowserError("BROWSER_NAVIGATION_FAILED", "Browser navigation failed.");
    }
    return new BrowserError("BROWSER_UNAVAILABLE", "Browser operation failed.");
  }

  private async assertUniqueTarget(pageId: string, target: BrowserTarget): Promise<void> {
    const count = await this.backend.targetCount(pageId, target);
    if (count === 0) {
      throw new BrowserError("BROWSER_TARGET_NOT_FOUND", "The browser target was not found.");
    }
    if (count !== 1) {
      throw new BrowserError("BROWSER_TARGET_AMBIGUOUS", "The browser target matched more than one element.", {
        matchCount: count,
      });
    }
  }

  private assertNavigableUrl(value: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BrowserError("BROWSER_NAVIGATION_REFUSED", "Browser navigation requires a valid HTTP(S) URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BrowserError("BROWSER_NAVIGATION_REFUSED", "Browser navigation permits only HTTP(S) URLs.");
    }
  }

  private assertNotCredentialTarget(metadata: BrowserTargetMetadata): void {
    if (metadata.type?.trim().toLowerCase() === "password") {
      throw this.credentialRefusal();
    }

    const autocompleteTokens = (metadata.autocomplete ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (autocompleteTokens.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) {
      throw this.credentialRefusal();
    }

    const searchable = [
      ...metadata.labels,
      metadata.name,
      metadata.id,
      metadata.ariaLabel,
    ].filter((value): value is string => Boolean(value)).join(" ");
    if (CREDENTIAL_KEYWORDS.some((pattern) => pattern.test(searchable))) {
      throw this.credentialRefusal();
    }
  }

  private credentialRefusal(): BrowserError {
    return new BrowserError(
      "BROWSER_CREDENTIAL_ENTRY_REFUSED",
      "Browser input into credential-shaped fields is refused.",
    );
  }

  private redactEditableSnapshotValues(snapshot: string): string {
    return snapshot
      .split("\n")
      .map((line) => line.replace(EDITABLE_ARIA_VALUE, "$1"))
      .join("\n");
  }

  private assertTabListWithinLimits(tabs: BrowserTabView[]): void {
    if (tabs.length > this.maxTabs) {
      throw this.protocolOutputLimit("Browser tab list exceeded the safe output limit.");
    }
    for (const tab of tabs) this.assertTabViewWithinLimits(tab);
  }

  private assertTabViewWithinLimits(tab: BrowserTabView): BrowserTabView {
    this.assertOutputLength(tab.title, this.maxTabTitleChars, "Browser tab title exceeded the safe output limit.");
    this.assertOutputLength(tab.url, this.maxUrlChars, "Browser tab URL exceeded the safe output limit.");
    return tab;
  }

  private assertOutputLength(value: string, maximum: number, message: string): void {
    if (value.length > maximum) throw this.protocolOutputLimit(message);
  }

  private protocolOutputLimit(message: string): BrowserError {
    return new BrowserError("BROWSER_PROTOCOL_INVALID", message);
  }

  private sanitizeNetworkEntry(entry: BrowserNetworkEntry): BrowserNetworkEntry {
    return {
      ...entry,
      url: this.sanitizeUrl(entry.url),
      ...(entry.failure !== undefined ? { failure: this.boundText(entry.failure) } : {}),
    };
  }

  private sanitizeUrl(value: string): string {
    try {
      const parsed = new URL(value);
      parsed.search = "";
      parsed.hash = "";
      const sanitized = parsed.toString();
      if (sanitized.length <= this.maxUrlChars) return sanitized;
      const truncated = `${parsed.origin}/[truncated]`;
      return truncated.length <= this.maxUrlChars ? truncated : "[url-truncated]";
    } catch {
      return "[invalid-url]";
    }
  }

  private boundText(value: string): string {
    if (value.length <= this.maxDiagnosticMessageChars) return value;
    return value.slice(value.length - this.maxDiagnosticMessageChars);
  }

  private outputLimit(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error("Browser output limits must be positive integers.");
    }
    return value;
  }
}
