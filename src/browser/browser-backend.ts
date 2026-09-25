import type {
  BrowserConsoleResult,
  BrowserHealth,
  BrowserKey,
  BrowserNetworkResult,
  BrowserScreenshot,
  BrowserTabView,
  BrowserTarget,
} from "./browser-types.js";

export interface BrowserTargetMetadata {
  tagName: string;
  type?: string;
  autocomplete?: string;
  labels: string[];
  name?: string;
  id?: string;
  ariaLabel?: string;
}

export interface BrowserBackend {
  health(): Promise<BrowserHealth>;
  tabs(): Promise<BrowserTabView[]>;
  newTab(url?: string): Promise<BrowserTabView>;
  selectTab(pageId: string): Promise<BrowserTabView>;
  closeTab(pageId: string): Promise<void>;
  navigate(pageId: string, url: string, timeoutMs: number): Promise<BrowserTabView>;
  targetCount(pageId: string, target: BrowserTarget): Promise<number>;
  targetMetadata(pageId: string, target: BrowserTarget): Promise<BrowserTargetMetadata>;
  focusedMetadata(pageId: string): Promise<BrowserTargetMetadata | null>;
  snapshot(pageId: string): Promise<string>;
  click(pageId: string, target: BrowserTarget): Promise<void>;
  fill(pageId: string, target: BrowserTarget, text: string): Promise<void>;
  selectOption(pageId: string, target: BrowserTarget, value: string): Promise<void>;
  pressKey(pageId: string, key: BrowserKey): Promise<void>;
  waitForText(pageId: string, text: string, timeoutMs: number): Promise<void>;
  screenshot(pageId: string): Promise<BrowserScreenshot>;
  consoleErrors(pageId: string): Promise<BrowserConsoleResult>;
  networkErrors(pageId: string): Promise<BrowserNetworkResult>;
  close(): Promise<void>;
}
