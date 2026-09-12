# Existing Chrome Attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Admin-only mode that attaches the existing browser tools to the user's already-running Google Chrome Stable session through a user-consented, loopback-only Chrome DevTools Protocol connection without exporting credentials or closing the user's Chrome during runtime shutdown.

**Architecture:** Keep managed Playwright Chromium as the default. Existing-Chrome mode resolves a Chrome-managed `DevToolsActivePort`, validates a hard-coded loopback endpoint, connects with Playwright `connectOverCDP(..., { isLocal: true, noDefaults: true })`, exposes only eligible HTTP(S)/`about:blank` pages through the existing browser backend, and owns only the CDP connection rather than the user's default browser context. No automatic fallback exists between modes.

**Tech Stack:** Node.js 22+, TypeScript strict mode, Playwright 1.63.0, Vitest 3.2.7, existing MCP Browser Runtime and Admin authority model.

**Spec:** `docs/superpowers/specs/2026-09-11-browser-existing-chrome-attach-design.md`

## Global Constraints

- Work only in `/private/tmp/chatgpt-system-browser-existing-chrome-cdp` on branch `feat/browser-existing-chrome-cdp`.
- Exact feature base is `origin/main@3daf964357ce4fe7302f1badea95068a867145cd`.
- Existing managed-browser behavior remains the default and must stay backward compatible.
- Existing-Chrome mode is explicit opt-in and also requires `--enable-browser`.
- Existing-Chrome mode never launches or relaunches the user's default Chrome profile.
- Only a hard-coded `127.0.0.1` CDP host is constructed. No arbitrary endpoint configuration is added.
- Read `DevToolsActivePort` with a hard 4 KiB maximum and fail closed on malformed, missing, unreadable, oversized, or non-regular input.
- Do not expose or audit the Chrome user-data directory, CDP port, WebSocket browser path/token, cookies, storage state, localStorage/sessionStorage, password-store data, or profile databases.
- `connectOverCDP` must use `{ timeout: browser.timeoutMs, isLocal: true, noDefaults: true }`.
- Attached runtime shutdown disconnects Playwright only. It must not explicitly close the attached default `BrowserContext`, the user's Chrome process, or pre-existing tabs.
- Explicit `browser_close_tab` remains destructive for the selected eligible page.
- Attached page surface is limited to `http:`, `https:`, and `about:blank`; `chrome:`, `chrome-untrusted:`, `chrome-extension:`, `devtools:`, and all other schemes are not exposed through browser tools.
- Password/OTP/payment credential refusal remains unchanged.
- No automatic fallback from `existing-chrome` to `managed` is permitted.
- No new browser MCP tools are added in Delivery 1; the existing `browser_*` catalog and result shapes stay unchanged.
- Repository instructions prefer integration/smoke coverage. Pure parser/config tests are the only intended unit-style tests.
- No push, merge, publish, release, rebase, reset, destructive cleanup, or modification of another worktree without explicit user approval.
- **Coordination gate:** while `/private/tmp/chatgpt-system-coding-harness-v2` has uncommitted changes in `src/browser-service.ts`, `src/browser-tool-registration.ts`, `src/browser-types.ts`, `src/playwright-browser-backend.ts`, `src/tool-output-schemas.ts`, do not modify those files in this worktree. Re-read the other worktree state immediately before Tasks 3 and 4.

---

## File Structure

### New files

- `src/existing-chrome-discovery.ts` — platform default user-data-dir resolution plus bounded `DevToolsActivePort` parsing into an internal loopback WebSocket endpoint.
- `tests/existing-chrome-discovery.test.ts` — real temporary-file discovery tests.
- `tests/browser-existing-chrome-factory.test.ts` — factory/connector integration around the external Playwright boundary.
- `tests/browser-existing-chrome-acceptance.test.ts` — optional environment-gated smoke helper for a real local Chrome session; it must skip unless the explicit acceptance environment gate is set and must never print endpoint/session secrets.

### Existing files modified by the feature

- `src/config.ts` — add `BrowserConnectionMode`, existing-Chrome opt-in, and explicit existing-Chrome data-dir override.
- `src/cli-command.ts` — parse the two new CLI flags.
- `src/cli.ts` — user-facing CLI help text.
- `src/browser-factory.ts` — select managed launch vs existing-Chrome CDP attach without fallback.
- `src/playwright-browser-backend.ts` — make lifecycle ownership injectable and enforce page eligibility at exposure/use boundaries.
- `scripts/setup-chatgpt-tunnel.mjs` — preserve the opt-in flags in generated ChatGPT tunnel commands and reject conflicting combinations.
- `tests/browser-config.test.ts`, `tests/cli-command.test.ts`, `tests/setup-chatgpt-tunnel.test.ts` — configuration and setup integration.
- `tests/playwright-browser-backend.test.ts` — ownership and page filtering behavior.
- `tests/browser-mcp.test.ts`, `tests/http-transport.test.ts` — unchanged public tool surface regression only if current assertions need explicit existing-Chrome coverage.
- `README.md`, `docs/CHATGPT_INTEGRATION.md` — explicit Chrome-consent setup and safety boundaries.

---

### Task 1: Bounded Existing-Chrome Discovery

**Files:**
- Create: `src/existing-chrome-discovery.ts`
- Create: `tests/existing-chrome-discovery.test.ts`

**Interfaces:**

```ts
export interface ExistingChromeDiscoveryInput {
  userDataDir: string;
}

export interface ExistingChromeEndpoint {
  endpoint: string;
}

export function defaultExistingChromeUserDataDir(
  platform: NodeJS.Platform,
  homeDir: string,
  localAppData: string | undefined,
): string;

export async function discoverExistingChromeEndpoint(
  input: ExistingChromeDiscoveryInput,
): Promise<ExistingChromeEndpoint>;
```

`discoverExistingChromeEndpoint()` returns an internal endpoint only. This type is never an MCP output type and must not be logged.

- [ ] **Step 1: Write RED real-file discovery tests**

Create temporary directories/files and assert:

```ts
const chromeDir = path.join(temp, "Chrome");
await mkdir(chromeDir, { recursive: true });
await writeFile(
  path.join(chromeDir, "DevToolsActivePort"),
  "9222\n/devtools/browser/test-browser-token\n",
);

await expect(discoverExistingChromeEndpoint({ userDataDir: chromeDir })).resolves.toEqual({
  endpoint: "ws://127.0.0.1:9222/devtools/browser/test-browser-token",
});
```

Also assert stable `BrowserError` failure for:

- missing file;
- directory instead of regular file;
- more than 4096 bytes;
- port `0`, `65536`, non-integer, signs/whitespace that do not parse canonically;
- browser path not beginning `/devtools/browser/`;
- browser path containing `://`, `?`, `#`, CR/LF injection, whitespace, or an extra non-empty line.

Public error message assertions must not contain the temp path, port, or browser token.

Assert platform defaults:

```ts
expect(defaultExistingChromeUserDataDir("darwin", "/Users/test", undefined))
  .toBe("/Users/test/Library/Application Support/Google/Chrome");
expect(defaultExistingChromeUserDataDir("linux", "/home/test", undefined))
  .toBe("/home/test/.config/google-chrome");
expect(defaultExistingChromeUserDataDir("win32", "C:\\Users\\test", "C:\\Users\\test\\AppData\\Local"))
  .toBe(path.win32.join("C:\\Users\\test\\AppData\\Local", "Google", "Chrome", "User Data"));
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
npm test -- tests/existing-chrome-discovery.test.ts
```

Expected: RED because `src/existing-chrome-discovery.ts` does not exist.

- [ ] **Step 3: Implement bounded discovery**

Implementation requirements:

```ts
const DEVTOOLS_ACTIVE_PORT_MAX_BYTES = 4096;
const BROWSER_PATH_PATTERN = /^\/devtools\/browser\/[A-Za-z0-9._~-]+$/;
```

Open the metadata through one file handle. Where the platform exposes `O_NOFOLLOW`, combine it with `O_RDONLY`; then call `FileHandle.stat()` on that same handle and require `isFile()`. On platforms without `O_NOFOLLOW`, perform an `lstat()` symlink refusal immediately before `open()` and still validate the opened handle with `stat()`. Read at most `4097` bytes from the handle so oversize input is detected without unbounded allocation. Decode UTF-8, accept canonical LF or CRLF line endings, reject bare carriage returns and unexpected additional non-empty lines, and allow at most one trailing empty line. Parse port with a canonical decimal regex such as `/^[1-9][0-9]{0,4}$/` followed by numeric `1..65535` validation.

Map filesystem/parser failures to:

```ts
new BrowserError(
  "BROWSER_UNAVAILABLE",
  "Existing Chrome remote debugging is unavailable. Enable it in chrome://inspect/#remote-debugging and retry.",
)
```

Do not include `cause`, path, port, browser path, or raw file content in that public error.

- [ ] **Step 4: Run focused GREEN plus strict TypeScript**

```bash
npm test -- tests/existing-chrome-discovery.test.ts
npx tsc -p tsconfig.json
```

Expected: GREEN.

- [ ] **Step 5: Review coordination and commit Task 1**

Before committing, confirm the coding-harness worktree has not added these exact new files. Then:

```bash
git diff --check
git add src/existing-chrome-discovery.ts tests/existing-chrome-discovery.test.ts
git commit -m "feat: discover user-consented Chrome debugging"
```

---

### Task 2: Explicit Existing-Chrome Configuration and CLI

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli.ts`
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Modify: `tests/browser-config.test.ts`
- Modify: `tests/cli-command.test.ts`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`

**Interfaces:**

```ts
export type BrowserConnectionMode = "managed" | "existing-chrome";

export interface BrowserConfig {
  enabled: boolean;
  connectionMode: BrowserConnectionMode;
  headless: boolean;
  timeoutMs: number;
  userDataDir: string;
  existingChromeUserDataDir: string | null;
}
```

New config inputs:

```ts
browserExistingChrome?: boolean;
browserExistingChromeUserDataDir?: string;
```

New environment variables:

```text
CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME=true|false|1|0
CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME_USER_DATA_DIR=<absolute-or-~/path>
```

New CLI flags:

```text
--browser-existing-chrome
--browser-existing-chrome-user-data-dir <path>
```

- [ ] **Step 1: Coordination gate**

Read the coding-harness worktree status. If it has uncommitted changes in `src/config.ts`, `src/cli-command.ts`, `src/cli.ts`, `scripts/setup-chatgpt-tunnel.mjs`, or the listed tests, stop this task and wait for that work to stabilize. Do not copy or overwrite its edits.

- [ ] **Step 2: Write RED configuration/setup tests**

Assert:

```ts
const managed = await loadConfig({ roots: [root] });
expect(managed.browser.connectionMode).toBe("managed");
expect(managed.browser.existingChromeUserDataDir).toBeNull();
```

Existing-Chrome valid path:

```ts
const config = await loadConfig({
  roots: [root],
  browserEnabled: true,
  browserExistingChrome: true,
  browserExistingChromeUserDataDir: "~/Library/Application Support/Google/Chrome",
});
expect(config.browser.connectionMode).toBe("existing-chrome");
```

Reject:

- existing Chrome without browser enabled;
- existing Chrome with headless true;
- existing Chrome user-data-dir override without existing-Chrome mode.

`parseCommand()` must produce both new overrides. Tunnel setup must preserve the flags in the generated MCP command and reject the same invalid combinations. Existing managed/headless behavior must stay green.

- [ ] **Step 3: Run focused RED**

```bash
npm test -- tests/browser-config.test.ts tests/cli-command.test.ts tests/setup-chatgpt-tunnel.test.ts
```

- [ ] **Step 4: Implement the minimal config/CLI changes**

Compute `connectionMode` once during config load. When and only when `connectionMode === "existing-chrome"`, resolve `existingChromeUserDataDir` from the explicit override or `defaultExistingChromeUserDataDir(process.platform, homeDir, process.env.LOCALAPPDATA)`. Managed mode stores `existingChromeUserDataDir: null`. Unsupported platforms therefore fail only when existing-Chrome mode actually needs default discovery.

Do not reuse `browser.userDataDir`: managed and attached browser roots remain distinct config fields.

Validation must occur before runtime creation and use actionable messages that do not reveal session metadata.

- [ ] **Step 5: Run focused/full config regression**

```bash
npm test -- tests/browser-config.test.ts tests/cli-command.test.ts tests/setup-chatgpt-tunnel.test.ts
npx tsc -p tsconfig.json
```

- [ ] **Step 6: Commit Task 2**

```bash
git diff --check
git add src/config.ts src/cli-command.ts src/cli.ts scripts/setup-chatgpt-tunnel.mjs tests/browser-config.test.ts tests/cli-command.test.ts tests/setup-chatgpt-tunnel.test.ts
git commit -m "feat: configure existing Chrome browser mode"
```

---

### Task 2A: Isolated Existing-Chrome CDP Connector

**Files:**
- Create: `src/existing-chrome-connector.ts`
- Create: `tests/existing-chrome-connector.test.ts`

**Interfaces:**

```ts
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

export async function connectExistingChrome(
  input: { userDataDir: string; timeoutMs: number },
  dependencies: ExistingChromeConnectorDependencies,
): Promise<ExistingChromeConnection>;

export async function loadProductionExistingChromeChromium(): Promise<ExistingChromePlaywrightFacade>;
```

This task exists specifically so CDP attachment can be completed without editing browser-core files currently changed by the parallel coding-harness branch. It uses the real `DevToolsActivePort` discovery implementation and injects only the external Playwright boundary.

- [ ] **Step 1: Write RED connector integration tests**

Use a real temporary Chrome user-data directory and real `DevToolsActivePort` file. Inject only `loadChromium`. Assert:

```ts
expect(connectOverCDP).toHaveBeenCalledWith(
  "ws://127.0.0.1:9222/devtools/browser/test-browser-token",
  { timeout: 12_000, isLocal: true, noDefaults: true },
);
```

Also prove:

- the returned connection exposes the exact default context from `browser.contexts()[0]`;
- `disconnect()` calls connected `browser.close()` and never a context close method;
- zero contexts closes the connected browser and returns stable `BROWSER_LAUNCH_FAILED`;
- raw Playwright rejection text containing endpoint/token/path data is not present in the public error;
- missing/malformed `DevToolsActivePort` remains the existing stable `BROWSER_UNAVAILABLE` discovery error and does not call Playwright;
- disconnect failure is sanitized and does not include Playwright/endpoint details.

- [ ] **Step 2: Run focused RED**

```bash
npm test -- tests/existing-chrome-connector.test.ts
```

Expected: RED because `src/existing-chrome-connector.ts` does not exist.

- [ ] **Step 3: Implement the minimal connector**

Use `discoverExistingChromeEndpoint()` directly. `loadChromium()` is the sole injected external boundary. Map `connectOverCDP` and disconnect failures to stable `BrowserError` values without a raw `cause`, endpoint, token, or profile path. If CDP connects but no default context exists, attempt `browser.close()` before returning the stable launch failure; if cleanup also fails, preserve only a safe categorical `cleanupFailed: true` detail.

Production loading is a dynamic import:

```ts
export async function loadProductionExistingChromeChromium(): Promise<ExistingChromePlaywrightFacade> {
  const { chromium } = await import("playwright");
  return {
    connectOverCDP: (endpoint, options) => chromium.connectOverCDP(endpoint, options),
  };
}
```

- [ ] **Step 4: Run focused GREEN plus strict TypeScript**

```bash
npm test -- tests/existing-chrome-connector.test.ts tests/existing-chrome-discovery.test.ts
npx tsc -p tsconfig.json
```

- [ ] **Step 5: Run full regression and commit**

```bash
npm run check
git diff --check
git add src/existing-chrome-connector.ts tests/existing-chrome-connector.test.ts docs/superpowers/plans/2026-09-11-browser-existing-chrome-attach.md
git commit -m "feat: connect to user-consented Chrome debugging"
```

---

### Task 3: Browser Backend Ownership and Eligible-Page Surface

**Files:**
- Create: `src/existing-chrome-page-policy.ts`
- Create: `tests/existing-chrome-page-policy.test.ts`
- Modify after coordination gate: `src/playwright-browser-backend.ts`
- Modify after coordination gate: `tests/playwright-browser-backend.test.ts`

**Interfaces:**

Extend `PlaywrightBrowserBackendOptions` without a mode flag:

```ts
export interface PlaywrightBrowserBackendOptions {
  timeoutMs: number;
  maxDiagnosticEntries?: number;
  closeBackend?: () => Promise<void>;
  pageEligible?: (url: string) => boolean;
}
```

Defaults preserve current managed behavior:

```ts
closeBackend ?? (() => context.close())
pageEligible ?? (() => true)
```

The callback controls ownership; no `managed/existing` boolean enters the backend.

- [ ] **Step 1: Coordination gate**

Re-read `/private/tmp/chatgpt-system-coding-harness-v2`. If `src/playwright-browser-backend.ts` or `tests/playwright-browser-backend.test.ts` is dirty there, stop this task. Do not edit the files concurrently.

- [ ] **Step 2: Write RED lifecycle and eligibility integration tests**

Prove current managed close still invokes `context.close()` exactly once.

For attached-style ownership, instantiate with:

```ts
const closeBackend = vi.fn(async () => undefined);
const backend = new PlaywrightBrowserBackend(context, {
  timeoutMs: 1_000,
  maxDiagnosticEntries: 10,
  closeBackend,
  pageEligible: (url) => isExistingChromePageEligible(url),
});
```

Assert `backend.close()` invokes `closeBackend` and does **not** call `context.close()`.

Add the pure predicate in `src/existing-chrome-page-policy.ts` before touching the shared backend:

```ts
export function isExistingChromePageEligible(url: string): boolean;
```

Expected true for `https://example.com`, `http://localhost:3000`, `about:blank`; false for `chrome://settings`, `chrome-untrusted://...`, `chrome-extension://id/page.html`, `devtools://...`, `file:///...`, `data:...`, `blob:...`, malformed URLs, and non-exact `about:` variants. The later backend change imports this predicate rather than defining policy inline.

Register both eligible and internal pages in the fake context. `tabs()` must return only eligible pages. Calling a page-targeting method for an internal-page ID that was never exposed or that became ineligible must return `BROWSER_PAGE_NOT_FOUND` rather than operate on it.

Explicit `closeTab()` for an eligible HTTP page still calls `page.close()`.

- [ ] **Step 3: Run focused RED**

```bash
npm test -- tests/playwright-browser-backend.test.ts
```

- [ ] **Step 4: Implement ownership injection and filtering**

Keep opaque IDs internal. It is acceptable to register internal pages internally so they can later become eligible, but every outward enumeration and `requirePage()` operation must re-check the current URL eligibility predicate.

`close()` must clear in-memory maps after invoking the configured ownership callback. It must remain idempotent.

- [ ] **Step 5: Run focused browser regression**

```bash
npm test -- tests/playwright-browser-backend.test.ts tests/browser-service.test.ts tests/browser-mcp.test.ts
npx tsc -p tsconfig.json
```

- [ ] **Step 6: Commit Task 3**

```bash
git diff --check
git add src/playwright-browser-backend.ts tests/playwright-browser-backend.test.ts
git commit -m "refactor: separate attached browser ownership"
```

---

### Task 4: CDP Attach Connector and Factory Selection

**Files:**
- Modify: `src/browser-factory.ts`
- Create: `tests/browser-existing-chrome-factory.test.ts`
- Modify if required only after coordination gate: `tests/browser-runtime.test.ts`

**Interfaces:**

Add a narrow injectable external boundary to `BrowserFactoryOptions`:

```ts
export interface ExistingChromePlaywrightFacade {
  connectOverCDP(
    endpoint: string,
    options: { timeout: number; isLocal: true; noDefaults: true },
  ): Promise<{
    contexts(): BrowserContext[];
    close(): Promise<void>;
  }>;
}

export interface BrowserFactoryOptions {
  browserBackendFactory?: () => Promise<BrowserBackend>;
  browserInstalled?: () => Promise<boolean>;
  loadExistingChromePlaywright?: () => Promise<ExistingChromePlaywrightFacade>;
}
```

`browserBackendFactory` remains the explicit whole-backend test override used by current tests. Existing-Chrome production construction is selected only when no whole-backend override was supplied.

- [ ] **Step 1: Coordination gate**

Re-read the coding-harness worktree. If it has uncommitted browser-factory/runtime integration that changes the same files, stop and reconcile ownership first.

- [ ] **Step 2: Write RED factory integration tests**

For managed mode assert `launchPersistentContext(config.userDataDir, { headless: config.headless })` behavior remains unchanged through current tests.

For existing-Chrome mode, inject discovery data and a facade whose `connectOverCDP` captures arguments. Assert exactly:

```ts
expect(connectOverCDP).toHaveBeenCalledWith(endpoint, {
  timeout: config.timeoutMs,
  isLocal: true,
  noDefaults: true,
});
```

Return a fake connected browser with exactly one default context. Verify backend operations can see an eligible existing tab.

Assert:

- zero contexts -> `BROWSER_LAUNCH_FAILED`/stable browser failure without endpoint/path details;
- `connectOverCDP` rejection -> stable sanitized failure;
- existing-Chrome failure does not invoke managed launch;
- backend `close()` calls connected `browser.close()` and never the attached context's `close()`;
- retry after runtime close creates a new CDP connection.

- [ ] **Step 3: Run focused RED**

```bash
npm test -- tests/browser-existing-chrome-factory.test.ts tests/browser-runtime.test.ts
```

- [ ] **Step 4: Implement factory selection**

Managed factory stays structurally equivalent to current code.

Existing-Chrome factory sequence:

```ts
if (config.existingChromeUserDataDir === null) {
  throw new BrowserError("BROWSER_LAUNCH_FAILED", "Existing Chrome attach configuration is invalid.");
}
const endpoint = await discoverExistingChromeEndpoint({
  userDataDir: config.existingChromeUserDataDir,
});
const chromium = await loadExistingChromePlaywright();
const browser = await chromium.connectOverCDP(endpoint.endpoint, {
  timeout: config.timeoutMs,
  isLocal: true,
  noDefaults: true,
});
const context = browser.contexts()[0];
if (!context) {
  await browser.close();
  throw new BrowserError("BROWSER_LAUNCH_FAILED", "Existing Chrome attach failed.");
}
return new PlaywrightBrowserBackend(context, {
  timeoutMs: config.timeoutMs,
  maxDiagnosticEntries: 100,
  closeBackend: () => browser.close(),
  pageEligible: isExistingChromePageEligible,
});
```

Do not include endpoint/profile/cause text in the thrown public error.

- [ ] **Step 5: Run focused and browser-wide GREEN**

```bash
npm test -- tests/browser-existing-chrome-factory.test.ts tests/browser-runtime.test.ts tests/browser-service.test.ts tests/browser-mcp.test.ts tests/http-transport.test.ts
npx tsc -p tsconfig.json
```

- [ ] **Step 6: Commit Task 4**

```bash
git diff --check
git add src/browser-factory.ts tests/browser-existing-chrome-factory.test.ts tests/browser-runtime.test.ts
git commit -m "feat: attach browser runtime to existing Chrome"
```

Only stage `tests/browser-runtime.test.ts` if it actually changed.

---

### Task 5: Setup Documentation and Public-Surface Regression

**Files:**
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`
- Modify if assertions require: `tests/browser-mcp.test.ts`
- Modify if assertions require: `tests/http-transport.test.ts`

**Interfaces:** No new MCP tools or output fields.

- [ ] **Step 1: Coordination gate**

Re-read the coding-harness branch before editing README/runbook or MCP catalog tests. If those files are dirty there, wait rather than creating competing edits.

- [ ] **Step 2: Write RED documentation/setup contract assertions**

Assert README/runbook include:

```text
chrome://inspect/#remote-debugging
--enable-browser --browser-existing-chrome
```

and do **not** instruct default Chrome launch using:

```text
--remote-debugging-port
--remote-debugging-pipe
```

Tunnel setup must preserve `--browser-existing-chrome` and the optional user-data-dir override while keeping secret/profile endpoint data out of printed summary output.

Assert the MCP browser tool names and annotations remain exactly unchanged.

- [ ] **Step 3: Run RED**

```bash
npm test -- tests/setup-chatgpt-tunnel.test.ts tests/browser-mcp.test.ts tests/http-transport.test.ts
```

- [ ] **Step 4: Update docs and setup output**

Document this exact user flow:

```text
1. Start normal Google Chrome Stable.
2. Open chrome://inspect/#remote-debugging.
3. Enable remote debugging and approve Chrome's connection prompt.
4. Run chatgpt-system with --enable-browser --browser-existing-chrome.
5. Use the existing browser_* tools.
```

Document that runtime shutdown disconnects only and that cookies/session data are used by Chrome normally but are never exported through MCP.

- [ ] **Step 5: Run docs/setup GREEN**

```bash
npm test -- tests/setup-chatgpt-tunnel.test.ts tests/browser-mcp.test.ts tests/http-transport.test.ts
```

- [ ] **Step 6: Commit Task 5**

```bash
git diff --check
git add README.md docs/CHATGPT_INTEGRATION.md tests/setup-chatgpt-tunnel.test.ts tests/browser-mcp.test.ts tests/http-transport.test.ts
git commit -m "docs: add existing Chrome browser mode"
```

Stage only files that changed.

---

### Task 6: Real-Mac Existing-Chrome Acceptance and Final Verification

**Files:**
- Create only if useful for repeatability: `tests/browser-existing-chrome-acceptance.test.ts`
- Modify: `docs/superpowers/plans/2026-09-11-browser-existing-chrome-attach.md` only to record acceptance commands/results if repository practice requires it.

**Interfaces:** No new public API.

- [ ] **Step 1: Add an explicit environment-gated smoke helper**

If automated scaffolding materially improves repeatability, create a test that skips unless:

```text
CHATGPT_SYSTEM_ACCEPT_EXISTING_CHROME=1
```

The helper may call the production discovery/factory path and assert an eligible tab exists, but it must never print or snapshot full personal tab content and must never send a message automatically. Human-controlled semantic actions remain the acceptance gate.

- [ ] **Step 2: Run clean install and full repository verification**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Expected: all baseline plus new tests GREEN.

- [ ] **Step 3: Fresh security/static review**

Run:

```bash
git diff --check origin/main...HEAD
rg -n "remote-debugging-port|remote-debugging-pipe|connectOverCDP|DevToolsActivePort|cookies\(|storageState\(|localStorage|sessionStorage" src scripts README.md docs/CHATGPT_INTEGRATION.md
```

Review every hit. `connectOverCDP` and `DevToolsActivePort` must appear only in the intended implementation/docs. No cookie/storage export API is allowed.

- [ ] **Step 4: Human Chrome consent gate**

Require the user to open normal Google Chrome Stable and enable remote debugging at:

```text
chrome://inspect/#remote-debugging
```

Do not modify Chrome command-line arguments or profile files to bypass this gate.

- [ ] **Step 5: Real browser acceptance**

Start the feature runtime in existing-Chrome mode without changing the normal Chrome process:

```text
--enable-browser --browser-existing-chrome
```

With a fresh Admin authority, verify through actual browser tools:

1. `browser_health` is enabled and usable.
2. `browser_tabs` sees at least one existing eligible HTTP(S) tab from the user's Chrome.
3. A ChatGPT tab can be created or selected.
4. `browser_snapshot` demonstrates the logged-in ChatGPT DOM without exposing credential fields.
5. Send one clearly labeled benign test message only after explicit user confirmation for that destructive real-site action.
6. Observe the sent message/result.
7. Invoke `browser_close` or stop the runtime.
8. Verify Chrome itself is still running.
9. Verify at least one pre-existing user tab remains open.

Do not record cookies, authorization headers, complete personal tab contents, WebSocket endpoint/token, or profile databases in acceptance output.

- [ ] **Step 6: Final verification before completion claim**

Run fresh:

```bash
npm run check
git diff --check origin/main...HEAD
git status --short --branch
```

Then use `superpowers:verification-before-completion` before claiming the feature complete.

- [ ] **Step 7: Local final commit only**

If Task 6 created or changed tracked files:

```bash
git add <only-the-Task-6-files-that-changed>
git commit -m "test: verify existing Chrome browser attach"
```

Do not push or merge without explicit user approval.

---

## Completion Gate

The feature is not complete until all of the following are true:

- managed-browser default behavior remains GREEN;
- existing-Chrome config is explicit and fail-closed;
- discovery is bounded and loopback-only;
- `connectOverCDP` uses `isLocal: true` and `noDefaults: true`;
- no arbitrary CDP endpoint is accepted;
- attached shutdown disconnects without closing the user's Chrome/default context;
- internal Chrome/extension/devtools pages are not exposed;
- existing Admin authority and credential-field refusal remain unchanged;
- no cookie/storage/profile export capability was added;
- no silent fallback to managed mode occurs;
- full repository verification is fresh and GREEN;
- real-Mac acceptance confirms the user's Chrome survives runtime shutdown;
- branch remains local until explicit push/merge approval.
