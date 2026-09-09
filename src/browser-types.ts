export const BROWSER_ROLES = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "option",
  "tab",
  "menuitem",
] as const;

export type BrowserRole = (typeof BROWSER_ROLES)[number];

export const BROWSER_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
] as const;

export type BrowserKey = (typeof BROWSER_KEYS)[number];

export type BrowserTarget =
  | { by: "role"; role: BrowserRole; name?: string | undefined; exact?: boolean | undefined }
  | { by: "text"; text: string; exact?: boolean | undefined }
  | { by: "label"; label: string; exact?: boolean | undefined }
  | { by: "testId"; testId: string };

export type BrowserRuntimeState = "disabled" | "stopped" | "running" | "unavailable";

export interface BrowserHealth {
  enabled: boolean;
  state: BrowserRuntimeState;
  browserInstalled: boolean;
}

export interface BrowserTabView {
  pageId: string;
  title: string;
  url: string;
  active: boolean;
}

export interface BrowserScreenshot {
  pageId: string;
  pngBase64: string;
  width: number;
  height: number;
}

export interface BrowserConsoleEntry {
  level: "error" | "warning";
  message: string;
}

export interface BrowserConsoleResult {
  pageId: string;
  entries: BrowserConsoleEntry[];
  truncated: boolean;
}

export interface BrowserNetworkEntry {
  method: string;
  url: string;
  status?: number;
  failure?: string;
}

export interface BrowserNetworkResult {
  pageId: string;
  entries: BrowserNetworkEntry[];
  truncated: boolean;
}

export const BROWSER_ERROR_CODES = [
  "BROWSER_DISABLED",
  "BROWSER_UNAVAILABLE",
  "BROWSER_LAUNCH_FAILED",
  "BROWSER_TIMEOUT",
  "BROWSER_PAGE_NOT_FOUND",
  "BROWSER_TARGET_NOT_FOUND",
  "BROWSER_TARGET_AMBIGUOUS",
  "BROWSER_NAVIGATION_REFUSED",
  "BROWSER_CREDENTIAL_ENTRY_REFUSED",
  "BROWSER_PROTOCOL_INVALID",
  "POLICY_DENIED",
] as const;

export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];
