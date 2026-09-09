# Browser Runtime Design

Date: 2026-09-09
Status: approved implementation contract
Repository: `senoldogann/chatgpt-system`

## 1. Goal

Give the ChatGPT agent a deterministic, authority-scoped browser capability through the existing `chatgpt-system` MCP runtime without requiring ChatGPT Work, a second LLM, or a second autonomous agent loop.

```text
ChatGPT Web
  -> OpenAI Secure MCP Tunnel
  -> chatgpt-system
  -> Admin authority
  -> BrowserService
  -> BrowserRuntime
  -> Playwright 1.63.0
  -> dedicated Chromium automation profile
```

ChatGPT remains the only reasoning agent. Playwright is deterministic browser infrastructure.

## 2. Why this comes before Computer Use

Browser automation is more deterministic and inspectable than pixel-driven mouse/keyboard control. Web tasks should prefer semantic DOM/accessibility targeting and browser-native diagnostics. The separate Computer-Use Bridge remains the fallback for native macOS applications or browser situations that cannot be handled through Playwright.

This design does not attempt to add a ChatGPT message scheduler. An MCP server cannot independently create a future ChatGPT reasoning turn after the current turn ends. A later execution queue may serialize deterministic local workflows, but it must not be represented as a queue for future LLM reasoning.

## 3. Architecture

`chatgpt-system` remains one modular monolith. Browser support is an optional capability module, not a second deployable service.

New responsibilities:

- `BrowserRuntime`: owns one Playwright persistent browser context, opaque page IDs, event capture, lifecycle, and operation serialization.
- `BrowserService`: enforces browser-specific policy and exposes a narrow application-facing API.
- `PlaywrightBrowserBackend`: the production Playwright adapter.
- MCP registration: maps strict MCP schemas to `BrowserService` only after authority resolution.

No browser code may bypass the existing `AuthorityManager`, `AuditLogger`, or runtime shutdown path.

## 4. Startup configuration

Browser automation is disabled by default.

Environment/configuration:

```text
CHATGPT_SYSTEM_ENABLE_BROWSER=false
CHATGPT_SYSTEM_BROWSER_HEADLESS=false
CHATGPT_SYSTEM_BROWSER_TIMEOUT_MS=10000
CHATGPT_SYSTEM_BROWSER_USER_DATA_DIR=~/.chatgpt-system/browser-profile
```

CLI:

```text
--enable-browser
--browser-headless
--browser-timeout-ms <positive integer>
--browser-user-data-dir <absolute path or ~/...>
```

The browser user-data directory is trusted startup configuration, never an MCP argument. The documented/default path is a dedicated automation profile. The default Chrome/Chromium personal profile must not be used.

Dependency:

```json
"playwright": "1.63.0"
```

Browser binaries are installed explicitly by the local operator:

```bash
npm run setup:browser
```

which executes the repository-pinned Playwright CLI to install Chromium. CI continues installing npm dependencies with scripts disabled and does not need a real browser for unit tests.

## 5. Authority boundary

`browser_health` is lease-free and returns categorical readiness only.

Every browser page read or mutation requires an active Admin lease:

- tabs and URLs can reveal authenticated browsing state;
- accessibility snapshots and screenshots can expose private content;
- console/network diagnostics can expose application data;
- navigation and DOM actions mutate browser state.

Project and User authority must receive `POLICY_DENIED` for all browser tools except `browser_health`.

Browser capability remains independently gated by `CHATGPT_SYSTEM_ENABLE_BROWSER`; an Admin lease cannot enable a disabled browser runtime.

## 6. Browser lifecycle

The runtime starts lazily on the first authorized browser call.

Production launch uses Playwright Chromium with `launchPersistentContext` and the configured dedicated `userDataDir`. Browser state therefore survives daemon restarts without automating the user's default Chrome profile.

The runtime owns:

- exactly one persistent browser context;
- zero or more pages;
- a cryptographically random opaque page ID for each page;
- bounded console/network diagnostic buffers;
- one operation serialization chain.

MCP never accepts or returns Playwright object handles, browser PIDs, CDP endpoints, raw WebSocket endpoints, executable paths, launch arguments, proxy settings, environment variables, or arbitrary JavaScript.

Clean shutdown closes the browser context before the control socket/transport finishes closing. Browser shutdown failure is reported categorically and does not prevent later shutdown phases.

## 7. Page identity and concurrency

Each Playwright `Page` is mapped to a random base64url page ID. IDs are in-memory only and never persisted or written to audit logs.

Unknown and already-closed page IDs return `BROWSER_PAGE_NOT_FOUND`.

All browser operations are serialized through one runtime-owned promise chain. This prevents two ChatGPT sessions from simultaneously changing focus, tabs, or page state. This is an action-level serialization boundary, not a persistent job queue.

## 8. Target model

Browser actions do not accept CSS selectors, XPath, JavaScript expressions, raw DOM handles, or generated Playwright code.

A target is one of:

```ts
type BrowserTarget =
  | { by: "role"; role: BrowserRole; name?: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string; exact?: boolean }
  | { by: "testId"; testId: string };
```

Initial `BrowserRole` values are the common interactive roles needed for normal application work:

```text
button link textbox searchbox checkbox radio combobox option tab menuitem
```

Every action requires the target to resolve to exactly one element. Zero matches return `BROWSER_TARGET_NOT_FOUND`; multiple matches return `BROWSER_TARGET_AMBIGUOUS`. The runtime never guesses.

## 9. URL policy

Caller-supplied navigation accepts only `http:` and `https:` URLs.

The following are rejected before Playwright receives them:

```text
file:
javascript:
data:
chrome:
chrome-extension:
about:
custom application schemes
```

Redirects remain browser behavior and are not represented as a network security boundary. Browser navigation is an Admin-authorized capability, not a sandbox.

Returned URLs are bounded. Audit metadata, when a host is useful, records only a sanitized origin/host and never query strings or fragments.

## 10. Credential and editable-value policy

The browser runtime does not type credentials.

Before `browser_fill`, the resolved element is inspected. The action fails with `BROWSER_CREDENTIAL_ENTRY_REFUSED` when any of these deterministic signals are present:

- `input[type=password]`;
- `autocomplete` contains `current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, or `cc-exp-year`;
- the element's accessible label/name/id metadata matches a bounded credential-keyword policy such as password, passcode, OTP, verification code, security code, CVV/CVC, or card number.

The same guard is checked against the focused element before key actions that could submit or modify a credential control.

`browser_snapshot` uses Playwright's AI-oriented ARIA snapshot, but the returned text is post-processed so current values of editable roles (`textbox`, `searchbox`, `combobox`, `spinbutton`) are removed before the snapshot leaves the local runtime. Snapshot size and depth are bounded.

This is deliberate because Playwright ARIA snapshots may include current editable values.

## 11. MCP surface

Initial tools:

```text
browser_health
browser_tabs
browser_new_tab
browser_select_tab
browser_close_tab
browser_navigate
browser_snapshot
browser_click
browser_fill
browser_select_option
browser_press_key
browser_wait_for_text
browser_screenshot
browser_console_errors
browser_network_errors
browser_close
```

Not exposed in v1:

- JavaScript evaluation or arbitrary Playwright code;
- CSS/XPath/raw selectors;
- cookie/localStorage/sessionStorage APIs;
- credential or secret stores;
- file upload/download filesystem writes;
- request interception/routing/mocking;
- arbitrary HTTP headers, proxies, permissions, browser flags, extensions, or executable paths;
- CDP endpoint configuration through MCP;
- PDF generation;
- clipboard APIs.

These exclusions are intentional safety boundaries, not missing roadmap boxes.

### Tool semantics

`browser_health`
: Returns `{enabled, state, browserInstalled}` without starting the browser when possible.

`browser_tabs`
: Returns bounded `{pageId, title, url, active}` records.

`browser_new_tab`
: Creates a page, optionally navigating to an HTTP(S) URL.

`browser_select_tab`
: Brings one page to front and marks it active.

`browser_close_tab`
: Closes one page. Closing the final page does not implicitly stop the browser runtime.

`browser_navigate`
: Navigates one page to an HTTP(S) URL and waits for DOM content loaded within the configured timeout.

`browser_snapshot`
: Returns a bounded, editable-value-redacted ARIA snapshot using Playwright AI snapshot mode.

`browser_click`
: Clicks one uniquely resolved semantic target.

`browser_fill`
: Fills one uniquely resolved editable target after credential checks.

`browser_select_option`
: Selects one option on a uniquely resolved combobox/select target.

`browser_press_key`
: Allows a fixed key vocabulary only: `Enter`, `Escape`, `Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Backspace`, `Delete`.

`browser_wait_for_text`
: Waits for bounded visible text with a caller timeout capped by the configured browser timeout.

`browser_screenshot`
: Returns PNG image content plus width/height metadata. Screenshot bytes are never copied into audit logs.

`browser_console_errors`
: Returns a bounded recent error/warning buffer. Console payload is never audited.

`browser_network_errors`
: Returns bounded recent failed requests and HTTP error responses with query strings and fragments stripped from URLs.

`browser_close`
: Closes the owned persistent browser context and clears all in-memory page IDs and diagnostic buffers. A later authorized action may lazily start a fresh context against the same automation profile.

## 12. Stable errors

```text
BROWSER_DISABLED
BROWSER_UNAVAILABLE
BROWSER_LAUNCH_FAILED
BROWSER_TIMEOUT
BROWSER_PAGE_NOT_FOUND
BROWSER_TARGET_NOT_FOUND
BROWSER_TARGET_AMBIGUOUS
BROWSER_NAVIGATION_REFUSED
BROWSER_CREDENTIAL_ENTRY_REFUSED
BROWSER_PROTOCOL_INVALID
POLICY_DENIED
```

Errors must not include browser executable arguments, local profile contents, page HTML, screenshots, typed text, cookies, authorization lease IDs, or raw Playwright stack traces in MCP-visible payloads.

## 13. Audit

Audit only categorical browser lifecycle/action metadata:

- operation category;
- success/failure;
- duration;
- page count where useful;
- sanitized host/origin where useful;
- stable error code.

Never audit:

- page IDs;
- authority lease IDs;
- typed/fill text;
- snapshot text;
- screenshots;
- console text;
- request/response bodies;
- URL query strings/fragments;
- cookies/storage;
- credentials or secrets.

## 14. Testing

Tests use dependency injection and a fake `BrowserBackend`; CI does not require a graphical browser or downloaded Chromium.

Required coverage:

- browser disabled by default;
- startup config and dedicated user-data-dir normalization;
- health does not disclose content;
- every content/action tool is Admin-only;
- lazy launch and one-context ownership;
- opaque page IDs and unknown-page behavior;
- operation serialization across concurrent calls;
- semantic target uniqueness enforcement;
- URL scheme refusal;
- password/autocomplete/credential-label fill refusal;
- editable ARIA values are redacted;
- screenshot returns non-empty PNG-compatible bytes;
- console/network diagnostics are bounded and network URLs are sanitized;
- audit excludes page IDs, typed text, snapshot data, screenshot bytes, console text, query strings, and fragments;
- browser shutdown occurs before control/transport shutdown;
- all existing Node 22/24 and macOS native tests remain green.

## 15. Real-Mac acceptance

After CI is green, acceptance on the real Mac uses the dedicated automation profile and a disposable page/application:

1. run `npm run setup:browser` once;
2. start `chatgpt-system` with browser explicitly enabled;
3. obtain an Admin lease;
4. verify health, new tab, HTTP(S) navigation, tab listing/select/close;
5. verify ARIA snapshot, click, benign fill, select, key, wait, screenshot;
6. verify console/network diagnostics on a disposable page;
7. verify password-field fill is refused;
8. verify User/Project leases cannot inspect browser state;
9. revoke/end Admin authority and verify later calls fail;
10. stop runtime and verify the owned browser closes cleanly.

If acceptance exposes a code defect, reproduce it with a failing automated test before fixing it.

## 16. Definition of done

The Browser Runtime is complete when ChatGPT Web can use `chatgpt-system` with an Admin lease to semantically inspect and manipulate a dedicated persistent Chromium profile, receive bounded screenshots and diagnostics, and cannot access arbitrary JavaScript, raw selectors, storage/cookies, credential entry, or startup escape hatches through MCP.
