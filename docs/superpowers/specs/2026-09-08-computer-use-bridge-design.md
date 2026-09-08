# Computer-Use Bridge Design

Date: 2026-09-08
Status: proposed implementation contract
Repositories: `senoldogann/chatgpt-system`, `senoldogann/computer-use`

## 1. Goal

Let the ChatGPT agent use the real Mac through `chatgpt-system` without a second LLM/API agent.

```text
ChatGPT agent
  -> chatgpt-system MCP + Admin authority
  -> authenticated local computer-use bridge
  -> shared computer-use safety/controller layer
  -> existing Rust actuation driver
  -> macOS
```

ChatGPT is the only reasoning agent. The bridge is deterministic local infrastructure and never loads an LLM/provider.

## 2. Non-goals

This subsystem does not add browser/CDP diagnostics, root/XPC privileges, launchd persistence, a second autonomous loop, cookie/token extraction, or generic shell/script execution.

## 3. Existing boundaries to preserve

`computer-use` already provides the physical-host foundation: separate Rust driver process, typed Unix-socket protocol, real/simulated backends, driver peer UID/PID checks, accessibility-first perception, screenshot/OCR support, focus verification, secure-field detection, kill-switch logic, and input-release cleanup.

The bridge reuses these components. `chatgpt-system` never implements a second mouse/keyboard driver and never talks directly to the Rust socket.

## 4. Trust chain and lifecycle

### 4.1 Explicit enablement

Computer use is disabled by default. It becomes available only when the local operator starts `chatgpt-system` with explicit computer-use enablement. No MCP argument can enable it or choose its executable/driver paths.

Trusted startup configuration identifies the installed/local `computer-use` bridge executable and Rust driver. These are operator configuration, not model-controlled data.

### 4.2 Parent-owned bridge

When computer use is enabled, `chatgpt-system` owns the bridge child lifecycle. The bridge is started lazily on the first authorized computer-use call or health probe and is stopped during runtime shutdown.

Startup chain:

```text
chatgpt-system process
  -> spawn fixed bridge command with shell=false
  -> send fresh 256-bit random bridge capability on child stdin
  -> close capability delivery stream
  -> bridge creates private Unix socket
  -> bridge spawns Rust driver with --allow-pid <bridge-pid>
```

The bridge capability is never placed in argv, environment variables, files, audit logs, MCP responses, or error text.

Every bridge request carries that capability and is compared in constant time. Socket permissions remain defense in depth:

- private parent directory `0700`;
- socket `0600`;
- regular files/symlinks at the socket path are refused;
- only an owned stale Unix socket may be replaced;
- no TCP/HTTP listener.

This closes the confused-deputy problem where an unrelated same-user process could otherwise reuse a TCC/Accessibility-authorized bridge.

The Rust driver independently accepts only the bridge process through its existing UID/PID peer policy.

### 4.3 Shutdown

```text
stop accepting new computer calls
-> release held inputs
-> stop owned Rust driver
-> remove owned bridge socket
-> stop bridge child
-> continue normal chatgpt-system shutdown
```

No restart path scans for or kills arbitrary foreign PIDs. If the bridge crashes, the current call fails closed; a later authorized call may start a fresh owned bridge instance.

## 5. Shared computer-use host controller

The bridge must not call private `CuaReplEngine` methods or duplicate its physical safety rules.

Extract the minimum reusable host-facing controller from the current CUA host dispatch path. Both `CuaReplEngine` and the bridge use it for:

- app activation and focus confirmation;
- accessibility snapshot/target resolution;
- screenshot capture;
- click/drag/scroll;
- typing/hotkeys;
- secure/editable-field handling;
- kill-switch polling;
- input release.

Existing standalone agent/CLI/REPL behavior must remain compatible. This is a targeted extraction, not a rewrite.

### Authority split

`chatgpt-system` Admin authority is the human-approved capability for bridge-originated physical actions. The bridge does **not** enter permanent computer-use `SOVEREIGN` mode and does not ask for a second independent approval/grant for every action.

The computer-use **safety floor remains mandatory** even with Admin authority:

1. secure/credential-field typing is refused;
2. kill-switch takeover is refused;
3. focus-sensitive actions fail closed unless the target app is confirmed;
4. target/coordinate validation remains active;
5. driver trust/Accessibility/capture failures are explicit;
6. input cleanup runs on failure, timeout and shutdown;
7. callers cannot disable safety, select signals/backends/driver paths, or access the raw driver socket.

The existing real-driver emergency hotkey remains independently active. Existing mouse-shake takeover logic is polled at the same action-gate cadence used by the current OODA path, before every physical mutation and between compound operations.

## 6. Bridge protocol

Versioned newline-delimited JSON, one bounded request per connection. Physical mutations are serialized because the host has one input stream.

Initial methods:

```text
health
active_window
list_apps
ui_snapshot
open_app
open_url
screenshot
click
drag
scroll
type_text
press_hotkey
release_inputs
```

No request accepts raw OS PID, process-group ID, signal, shell, executable path, AppleScript source, arbitrary environment, authority lease ID, API key or password.

### Targeting

Physical actions require an `app` target except `release_inputs` and `open_url` when intentionally using the default browser.

`click`, `drag` and `scroll` use the existing computer-use target vocabulary: bounded element index/query/role/title or explicit logical coordinates. Focus is confirmed before actuation.

### URL opening

`open_url` accepts only `http://` and `https://`. It uses a fixed local launcher with argv data and `shell=false`. Optional target-app selection is data, never command source. `file:`, `javascript:`, `data:` and custom schemes are rejected.

## 7. `chatgpt-system` MCP surface

Trusted startup config:

```text
CHATGPT_SYSTEM_ENABLE_COMPUTER_USE=false
CHATGPT_SYSTEM_COMPUTER_USE_BRIDGE=<operator-configured executable>
CHATGPT_SYSTEM_COMPUTER_USE_DRIVER=<operator-configured driver binary>
CHATGPT_SYSTEM_COMPUTER_USE_TIMEOUT_MS=10000
```

Equivalent CLI flags may be added. Setup tooling may write these only from explicit local operator options; MCP calls cannot modify them.

MCP tools:

```text
computer_health
computer_active_window
computer_list_apps
computer_ui_snapshot
computer_open_app
computer_open_url
computer_screenshot
computer_click
computer_drag
computer_scroll
computer_type_text
computer_press_hotkey
computer_release_inputs
```

`computer_health` reveals only categorical readiness and may be called without a lease. Every other computer tool requires an active **Admin** lease. Project/User receive `POLICY_DENIED`, including screenshot and accessibility reads.

This treats host screen/accessibility state as sensitive data rather than harmless read-only access.

## 8. Screen/accessibility data and errors

### Screenshot

The bridge returns bounded PNG bytes plus non-sensitive dimensions. `chatgpt-system` emits MCP `image/png` content, not a giant data URI in text. Empty/missing capture is an error.

### Accessibility snapshot

`computer_ui_snapshot` returns a bounded compact element list suitable for grounding:

```text
index
role
title (when present)
focused
x/y/width/height
value only for non-editable, non-secure UI content
```

Raw PID is never returned. Secure fields and all editable text controls omit their current value. Snapshot node/depth/payload budgets are enforced; indices are snapshot-scoped hints, not durable identifiers.

### Stable errors

```text
BRIDGE_UNAVAILABLE
BRIDGE_PROTOCOL_INVALID
BRIDGE_TIMEOUT
BRIDGE_UNAUTHORIZED
DRIVER_UNAVAILABLE
DRIVER_UNTRUSTED
FOCUS_NOT_ACQUIRED
CREDENTIAL_ENTRY_REFUSED
KILL_SWITCH_TRIPPED
TARGET_NOT_FOUND
POLICY_DENIED
```

Errors do not leak bridge capability, driver stderr, environment values, raw frames, screenshots, typed text or private AX values.

## 9. Audit and tests

### Audit

Record only categorical computer-use lifecycle metadata: tool category, success/failure, duration, safe app identity when useful, and error code.

Never audit bridge capability, lease IDs, typed text, URL query/fragment, screenshots, accessibility values, coordinates/element document text, driver PID/socket frames, credentials or tokens.

### `computer-use` tests

Must cover:

- shared-controller parity with existing REPL behavior;
- bridge capability authentication;
- socket path/mode/stale-socket rules;
- simulated driver lifecycle and `--allow-pid` binding;
- secure/editable-field typing refusal;
- kill-switch and focus refusal;
- bounded/redacted AX snapshot;
- screenshot success/failure;
- URL scheme validation;
- action serialization and release-input cleanup;
- bridge/driver shutdown;
- all existing tests remain green.

### `chatgpt-system` tests

Must cover:

- computer-use disabled-by-default config;
- bridge child capability delivered by stdin only;
- Admin-only policy for every host-read/action tool;
- strict schemas with no PID/shell/env/backend/path escape fields;
- client auth/timeout/malformed-response handling;
- MCP image response;
- categorical error mapping and audit redaction;
- owned bridge shutdown ordering;
- existing Node 22/24/native authority CI remains green.

## 10. Delivery and acceptance

Implementation order:

1. `computer-use`: shared host controller + authenticated bridge + simulated tests.
2. `computer-use`: exact-head CI, PR, merge.
3. `chatgpt-system`: bridge supervisor/client + Admin policy + MCP tools + tests/docs.
4. `chatgpt-system`: exact-head CI, PR, merge.
5. Real-Mac ChatGPT acceptance; only evidence-driven hardening fixes.

Real-Mac acceptance uses a disposable app/page and verifies:

- bridge health;
- active window and real screenshot;
- harmless app/HTTP(S) URL opening;
- benign click/type/scroll/hotkey;
- AX grounding;
- password/secure-field typing refusal;
- emergency hotkey blocks further physical action;
- User lease cannot inspect or actuate;
- ended Admin lease cannot continue;
- runtime shutdown releases inputs and removes owned bridge/driver state.

No destructive system setting, purchase, account mutation, secret-bearing page or credential entry is required.

## Definition of done

The subsystem is complete when the ChatGPT agent, with no secondary API agent, can use a locally approved Admin lease to perceive and safely manipulate the real Mac through the existing computer-use driver, while the trust chain, safety floor, cleanup, redaction and CI requirements above remain intact.