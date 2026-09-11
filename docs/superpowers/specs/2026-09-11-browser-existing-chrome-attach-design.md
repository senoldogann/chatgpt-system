# Existing Chrome Attach — Design

**Date:** 2026-09-11

**Repository:** `/Users/dogan/chatgpt-system`

**Worktree:** `/private/tmp/chatgpt-system-browser-existing-chrome-cdp`

**Branch:** `feat/browser-existing-chrome-cdp`

**Base:** `origin/main@3daf964357ce4fe7302f1badea95068a867145cd`

## Goal

Extend the existing Admin-only Browser Runtime so it can explicitly attach to the user's already-running Google Chrome session and operate the existing logged-in HTTP(S) tabs without copying credentials, exporting cookies, launching a second Chrome profile, or closing the user's Chrome process during daemon shutdown.

The managed Playwright browser remains the default. Existing-Chrome attach is explicit opt-in only.

## Current Problem

The current Browser Runtime always launches a Playwright persistent context under `~/.chatgpt-system/browser-profile`. That context is intentionally isolated from the user's normal Chrome profile. As a result, `browser_tabs` can be empty even while the user has normal Chrome tabs open and authenticated, and opening `https://chatgpt.com` may create an unauthenticated or otherwise separate session.

The desired flow is:

```text
user's already-running Chrome
    -> explicit Chrome remote-debugging consent
    -> local loopback CDP attach
    -> existing default browser context
    -> existing authenticated HTTP(S) tabs
    -> existing chatgpt-system browser tools
```

## Platform Facts

The target Mac currently has Google Chrome `152.0.7977.83` and Playwright `1.63.0`.

Chrome 144+ supports explicit remote-debugging enablement for a running Chrome instance through `chrome://inspect/#remote-debugging`. Chrome's current DevTools MCP implementation discovers the browser connection through the profile's `DevToolsActivePort` file and connects to a loopback WebSocket endpoint.

Chrome 136+ deliberately ignores classic `--remote-debugging-port` / `--remote-debugging-pipe` against the default data directory unless a non-standard `--user-data-dir` is used. Delivery 1 therefore must not try to restart the user's default Chrome with a debugging command-line switch.

Playwright `connectOverCDP` can attach to an existing Chromium browser. For a daily-driver browser, Playwright `1.63.0` exposes `isLocal: true` and `noDefaults: true`; the latter prevents Playwright from applying default context overrides such as accept-download, focus, and media emulation changes to the user's existing default browser context.

## Chosen Architecture

### Browser connection modes

The Browser Runtime gains two explicit connection modes:

```ts
type BrowserConnectionMode = "managed" | "existing-chrome";
```

`managed` remains the default and preserves all current behavior.

`existing-chrome` never launches Chrome. It discovers a Chrome-managed `DevToolsActivePort`, validates that it resolves to a loopback CDP endpoint, calls `chromium.connectOverCDP`, selects the existing default browser context, and exposes that context through the existing `BrowserBackend` interface.

No automatic fallback occurs between modes. If `existing-chrome` attach fails, the browser operation fails explicitly. The runtime must never silently launch the managed profile while the caller believes it is controlling the user's Chrome.

### Configuration

Delivery 1 adds:

```text
--browser-existing-chrome
CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME=true

--browser-existing-chrome-user-data-dir <absolute-or-~/path>
CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME_USER_DATA_DIR=<path>
```

`--enable-browser` remains required. The new flag changes only how the enabled Browser Runtime obtains its backend.

Invalid combinations fail during config parsing:

- `--browser-existing-chrome` without `--enable-browser` is invalid.
- `--browser-existing-chrome` with `--browser-headless` is invalid because an already-running user browser is not launched by this runtime.
- `--browser-existing-chrome-user-data-dir` without `--browser-existing-chrome` is invalid.

The existing managed `--browser-user-data-dir` keeps its current meaning and must not be reused for existing-Chrome discovery.

### Existing Chrome user-data directory

Default discovery is only for Google Chrome Stable:

- macOS: `~/Library/Application Support/Google/Chrome`
- Linux: `~/.config/google-chrome`
- Windows: `%LOCALAPPDATA%/Google/Chrome/User Data`

An explicit existing-Chrome user-data directory may override the default for non-standard installations. The override must resolve to an absolute path. Delivery 1 does not add Beta/Canary channel flags; an explicit path covers those installations without growing the public tool surface.

### DevToolsActivePort discovery

A dedicated module reads exactly one bounded local metadata file:

```text
<existingChromeUserDataDir>/DevToolsActivePort
```

Requirements:

- read is bounded to 4 KiB;
- regular-file semantics are required;
- malformed, oversized, missing, or unreadable data fail closed;
- the first line must parse as an integer TCP port in `1..65535`;
- the second line must start with `/devtools/browser/` and remain a path, not a host or full URL;
- additional non-empty lines are rejected;
- the constructed endpoint host is always hard-coded `127.0.0.1`;
- no arbitrary `http://`, `https://`, `ws://`, or `wss://` endpoint is accepted from configuration or file content;
- endpoint/token/path data is not returned through MCP or written to audit logs.

The resulting endpoint has the internal form:

```text
ws://127.0.0.1:<validated-port><validated-browser-path>
```

This preserves the local-only trust boundary.

### CDP attach

The production attach path is:

```ts
const browser = await chromium.connectOverCDP(endpoint, {
  timeout: config.timeoutMs,
  isLocal: true,
  noDefaults: true,
});
```

The runtime uses the existing default context from `browser.contexts()[0]`.

If no context is exposed, attach fails closed as browser unavailable. Delivery 1 does not create a new incognito context because that would not share the user's logged-in state.

### Backend ownership and shutdown

Managed and attached browsers have different ownership semantics:

```text
managed
  runtime owns BrowserContext
  shutdown -> context.close()

existing-chrome
  runtime owns only the CDP connection
  shutdown -> connected Browser.close() / disconnect semantics
  user's Chrome process and existing default context remain running
```

Playwright documents that `Browser.close()` on a connected Browser disconnects from the browser server rather than terminating a browser launched elsewhere. The attached default context itself must never be explicitly `context.close()`d because it belongs to the user's Chrome and Playwright's default context is not closable.

`browser_close_tab` remains an explicit destructive user action and may close a selected HTTP(S) page. Daemon shutdown, `browser_close`, backend restart, or attach failure must not close existing user tabs.

The current `PlaywrightBrowserBackend` therefore must not retain an unconditional `context.close()` lifecycle. Its lifecycle is refactored behind an injected close/disconnect callback or equivalent explicit ownership mode, with current managed behavior preserved by tests.

### Existing-page filtering

Attached Chrome can contain internal or extension pages that the current managed profile usually does not expose. Delivery 1 limits the attached page surface to:

- `http://...`
- `https://...`
- `about:blank`

The backend does not expose or operate:

- `chrome://...`
- `chrome-untrusted://...`
- `chrome-extension://...`
- `devtools://...`
- other non-HTTP(S) internal schemes

New tabs begin as `about:blank`, so that page remains temporarily eligible until navigation.

The existing navigation URL policy still accepts only HTTP(S).

### Credential and session policy

Existing-Chrome attach intentionally uses the user's browser session, but the plugin must not add APIs that extract authentication material.

Delivery 1 adds no tools for:

- cookie enumeration/export;
- storage-state export;
- localStorage/sessionStorage dumping;
- password-store access;
- profile-file copying;
- browser database reading;
- Chrome command-line credential bypasses.

Existing credential-field refusal stays active for `browser_fill` and keyboard actions. Password, OTP, and payment credential fields remain refused.

A logged-in page may naturally send its existing cookies during normal browser navigation or DOM actions; that is the purpose of attaching to the user's session. Those cookie values are never surfaced as MCP results.

### Authority model

No new authority profile is introduced.

All content-reading or mutating browser tools remain Admin-only exactly as today. `browser_health` remains lease-free and categorical. Existing-Chrome mode does not grant Project/User authority access to personal browser state.

The Chrome UI remains an independent consent boundary: remote debugging must already be enabled by the user through `chrome://inspect/#remote-debugging`, and Chrome may show an allow/deny prompt for the incoming debugging connection.

### Health and error behavior

The existing `BrowserHealth` public shape remains unchanged in Delivery 1 to avoid growing the MCP result contract unnecessarily.

When existing-Chrome mode is configured:

- config valid, no action yet: state remains `stopped`;
- successful attach: `running`;
- missing/invalid `DevToolsActivePort`, no running Chrome, denied/timed-out attach, or no default context: operation returns a stable browser-unavailable/launch-failed class without raw WebSocket endpoint, profile path, Chrome diagnostic, or Playwright exception text;
- after failed attach, health may report `unavailable` and a later Admin browser action may retry;
- `browser_close` clears runtime state and disconnects only.

The user-facing remediation text may mention enabling remote debugging at `chrome://inspect/#remote-debugging`, but must not reveal connection tokens or filesystem internals.

## Components

### `src/existing-chrome-discovery.ts`

Single responsibility: resolve the default/explicit Chrome Stable user-data directory and parse a bounded `DevToolsActivePort` file into an internal loopback WebSocket endpoint.

No MCP registration, no Playwright calls, no browser automation.

### `src/browser-factory.ts`

Select managed launch vs existing-Chrome attach. Existing mode imports Playwright, discovers the loopback endpoint, calls `connectOverCDP`, validates a usable default context, and constructs the backend with disconnect ownership.

### `src/playwright-browser-backend.ts`

Keep semantic browser behavior. Refactor lifecycle so close semantics are injected/owned explicitly. Add an optional page-eligibility predicate used by existing-Chrome mode. Managed mode remains behaviorally unchanged.

### `src/config.ts` and `src/cli-command.ts`

Parse the opt-in mode and optional existing-Chrome user-data-dir override while rejecting conflicting flags.

### `src/cli.ts`, README, runbook

Document the explicit setup:

```text
1. Start normal Google Chrome Stable.
2. Open chrome://inspect/#remote-debugging.
3. Enable remote debugging and approve Chrome's prompt when requested.
4. Start chatgpt-system with --enable-browser --browser-existing-chrome.
5. Use the existing browser_* tools.
```

No instruction should tell the user to launch default Chrome with `--remote-debugging-port`.

## Security Invariants

1. Existing-Chrome mode is disabled by default.
2. Browser tools remain Admin-only.
3. Only a hard-coded loopback CDP host may be used.
4. No arbitrary endpoint config is added.
5. No cookies, storage state, credentials, DevToolsActivePort contents, WebSocket token, or profile databases are exposed in MCP output or audit.
6. Chrome's explicit remote-debugging consent is not bypassed.
7. No command-line relaunch of the user's default profile is attempted.
8. Managed mode remains isolated and unchanged by default.
9. Runtime shutdown disconnects from an attached browser and never closes the user's Chrome process/default context.
10. Internal Chrome/extension/devtools pages are not exposed through browser tab tools.
11. Password/OTP/payment credential refusal remains unchanged.
12. Attach failure never silently falls back to managed mode.

## Testing Strategy

Repository instructions prefer integration/smoke tests where practical. Use minimal unit tests only for pure bounded parsers/config logic.

### Configuration tests

Prove:

- default remains managed;
- explicit existing-Chrome flag works only with browser enabled;
- headless + existing-Chrome is rejected;
- existing-Chrome directory override requires existing-Chrome mode;
- managed user-data-dir behavior remains unchanged.

### Discovery tests

Use temporary real files and directories. Prove:

- valid two-line `DevToolsActivePort` becomes a `127.0.0.1` endpoint;
- malformed port/path/additional lines fail;
- oversized file fails;
- missing/unreadable file fails with a stable browser error;
- endpoint data is never returned in public errors.

### Browser factory integration

Inject a Playwright facade only at the external Playwright boundary. Prove:

- existing mode calls `connectOverCDP` with `isLocal: true` and `noDefaults: true`;
- it uses the existing default context;
- no context fails closed;
- attach failure is sanitized;
- managed mode still launches the persistent context exactly as before;
- no automatic fallback occurs.

### Backend lifecycle integration

Use Playwright-like fakes only for ownership semantics. Prove:

- managed close closes its owned context;
- attached close invokes disconnect/connected-browser close and not context close;
- attached page filtering excludes internal/extension/devtools pages;
- explicitly closing a visible HTTP(S) tab still closes that page;
- newly created about:blank pages are tracked and become normal after HTTP(S) navigation.

### MCP regression

Existing `browser_*` catalog and annotations must remain unchanged. Existing authority/credential/refusal tests must remain green.

### Real-Mac acceptance

This is a manual/real-browser gate, not a mocked substitute.

Preconditions:

- normal Google Chrome Stable is already running;
- user is logged into ChatGPT in that Chrome profile;
- remote debugging is enabled via `chrome://inspect/#remote-debugging`;
- user approves any Chrome connection prompt.

Acceptance sequence:

```text
browser_health
  -> browser_tabs sees at least one existing HTTP(S) Chrome tab
  -> create/select a ChatGPT tab
  -> snapshot confirms the real logged-in ChatGPT DOM
  -> send one clearly identifiable benign test message through normal semantic browser tools
  -> observe the sent message/result
  -> browser_close / daemon shutdown
  -> verify user's Chrome process remains alive
  -> verify pre-existing Chrome tabs remain open
```

The acceptance log must not record the user's cookies, credentials, full personal tab contents, or WebSocket endpoint/token.

## Coordination Constraints

This feature is developed only in:

```text
/private/tmp/chatgpt-system-browser-existing-chrome-cdp
feat/browser-existing-chrome-cdp
```

Do not modify:

- `/private/tmp/chatgpt-system-project-continuity-v1`
- `/private/tmp/chatgpt-system-coding-harness-v2`
- their branches, dirty files, state, managed processes, or local commits.

The three feature lines currently share `origin/main` as their base. Any later reconciliation with Continuity v1 or Coding Harness v2 is a separate controlled integration step. No push, merge, publish, release, rebase, reset, or destructive cleanup occurs without explicit user approval.

## Out of Scope

Delivery 1 does not add:

- Chrome DevTools performance/network debugging tools beyond the existing browser API;
- raw CDP command execution;
- Chrome extension automation;
- arbitrary remote CDP endpoints;
- cookie/storage export;
- automatic login;
- browser credential entry;
- profile cloning;
- Beta/Canary channel flags;
- fallback from existing Chrome to managed Chromium;
- changes to Project/User authority;
- Continuity v1 or Coding Harness v2 integration.

## External References

- Chrome for Developers: Chrome 136 remote-debugging switch security changes.
- Chrome for Developers: Chrome 144+ user-consented auto-connect flow for running Chrome.
- ChromeDevTools/chrome-devtools-mcp: current `autoConnect` / `DevToolsActivePort` discovery implementation.
- Playwright BrowserType: `connectOverCDP`, including `isLocal` and `noDefaults`.
- Playwright Browser: connected-browser `close()` disconnect semantics.
