# Computer-Use Bridge Design

Date: 2026-09-08
Status: proposed implementation contract
Repositories: `senoldogann/chatgpt-system`, `senoldogann/computer-use`

## 1. Goal

Let the ChatGPT agent use the real Mac through `chatgpt-system` without running a second LLM/API agent.

The authority and orchestration boundary remains:

```text
ChatGPT agent
  -> chatgpt-system MCP
  -> authority-scoped computer tools
  -> local computer-use bridge
  -> existing computer-use safety/controller layer
  -> existing Rust actuation driver
  -> macOS
```

ChatGPT is the only reasoning agent. The bridge is deterministic infrastructure and never calls an LLM provider.

## 2. Non-goals

This change does not add browser/CDP diagnostics, root/XPC privileges, launchd persistence, a second autonomous agent loop, cookie/token extraction, or a generic shell/script execution surface.

Browser diagnostics and production runtime are separate follow-up subsystems.

## 3. Existing components to preserve

`computer-use` already has the important host boundary:

- Python orchestration/safety and a separate Rust actuation process.
- Typed JSON-RPC over a Unix socket.
- Real and simulated driver backends.
- Driver peer UID/PID policy.
- Accessibility-first perception, screenshot/OCR fallback.
- Focus confirmation before keystroke-style actuation.
- Secure-field/credential detection.
- Emergency hotkey and mouse-takeover kill-switch logic.
- Input-release cleanup.

The bridge must reuse those components rather than bypass them or duplicate a second physical-input implementation inside `chatgpt-system`.

## 4. Architecture

### 4.1 `computer-use` side

Add a deterministic bridge process:

```text
python -m computeruse.bridge \
  --socket ~/.computeruse/bridge.sock \
  --driver /absolute/path/to/actuation-driver \
  --real
```

The bridge owns the Rust driver lifecycle. It starts the driver on a private per-user socket and passes `--allow-pid <bridge-pid>` so only the bridge process may use that driver instance.

CI/tests run the same bridge with the simulated driver backend. `--real` is explicit and macOS-only.

The bridge does not start `CuaReplEngine`, QuickJS, Node, an OpenAI provider, or the autonomous agent loop.

### 4.2 Shared host controller

The bridge must not call private `CuaReplEngine` methods or fork a second copy of its safety rules.

Extract the minimum reusable host-facing controller from the current CUA host dispatch path. Both `CuaReplEngine` and the new bridge call this controller for:

- application activation/focus confirmation;
- accessibility snapshots and element resolution;
- screenshot capture;
- click/drag/scroll;
- typing/hotkeys;
- secure-field refusal;
- kill-switch polling;
- input-release cleanup.

The existing REPL behavior must remain compatible. This is a targeted extraction, not a rewrite of the agent loop.

`chatgpt-system` authority replaces the REPL's human approval/grant decision for bridge-originated calls. The computer-use safety floor does not disappear: credential blocking, focus validation, coordinate/element validation, kill-switch checks, bounded payloads, and cleanup remain mandatory.

Reason: an active Admin lease is already the locally authenticated host-wide capability. Requiring a second unrelated approval/grant system for each physical action would create two competing authority systems. Conversely, running the bridge in permanent `SOVEREIGN` mode would create a broad standing grant and is explicitly rejected.

## 5. Local bridge protocol

Use versioned newline-delimited JSON over one private Unix socket.

Default socket:

```text
~/.computeruse/bridge.sock
```

Security properties:

- parent directory mode `0700`;
- socket mode `0600`;
- reject regular files and symlinks at the socket path;
- only an owned stale Unix socket may be removed before bind;
- one bounded request frame per connection;
- no TCP/HTTP listener;
- no API keys, authority lease IDs, passwords, helper paths, shell strings, or arbitrary environment maps in the protocol;
- physical mutations are serialized because there is only one host input stream;
- failures trigger `release_inputs` before returning whenever a held-input state could exist.

Threat model matches the local authority control plane: same-local-user processes are inside the OS-account trust boundary. The Rust driver still independently authenticates the bridge UID/PID.

### 5.1 Request methods

Initial bridge methods:

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

No method accepts raw OS PID, process-group ID, signal, shell command, executable path, AppleScript source, arbitrary environment, or arbitrary subprocess request.

### 5.2 Targeting

Actuation methods require an `app` target except `release_inputs` and `open_url` when the caller intentionally requests the system default browser.

`click`, `drag`, and `scroll` accept the existing computer-use target vocabulary: bounded element index/query/role/title or explicit logical coordinates.

Before a focus-sensitive action the controller confirms the target app owns the frontmost context. If it cannot prove focus, it refuses rather than sending input to another application.

### 5.3 `open_url`

`open_url` accepts only `http://` or `https://` URLs in this subsystem.

Implementation uses a fixed local macOS launcher executable with argv data and `shell=false`. No caller-provided command is executed. When an app is supplied, the bridge opens the URL in that app and then confirms the target application is active.

`file:`, `javascript:`, `data:`, custom schemes, and command-like strings are refused here. Browser diagnostics may later have its own isolated navigation policy.

## 6. MCP surface in `chatgpt-system`

Add an explicit `ComputerUseClient` that connects only to the configured Unix socket. `chatgpt-system` never talks directly to the Rust driver.

Configuration:

```text
CHATGPT_SYSTEM_ENABLE_COMPUTER_USE=false
CHATGPT_SYSTEM_COMPUTER_USE_SOCKET=~/.computeruse/bridge.sock
CHATGPT_SYSTEM_COMPUTER_USE_TIMEOUT_MS=10000
```

Computer use is disabled unless explicitly enabled at runtime/setup. Enabling the catalog is not authority: every computer-use MCP call still requires a valid Admin lease.

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

All tools except `computer_health` require `authorityLeaseId`. `computer_health` reveals only categorical bridge readiness and no screen/app content.

All state-reading and mutating computer tools require `profile=admin` for the first production version. Project/User authority receives `POLICY_DENIED`.

This deliberately treats screenshots and accessibility state as sensitive host-wide data rather than pretending read-only screen access is harmless.

## 7. Screen and accessibility data

### 7.1 Screenshot

The bridge returns bounded PNG data and metadata. `chatgpt-system` converts PNG bytes to MCP image content (`image/png`) instead of placing a giant data URI in normal text.

A missing/empty capture is an error, never a successful blank image.

### 7.2 Accessibility snapshot

`computer_ui_snapshot` returns a bounded, compact representation suitable for grounding actions.

Rules:

- node/depth budgets are enforced;
- raw OS PID is removed;
- secure text field values are never returned;
- obvious credential/token-like values are redacted;
- payload size is bounded;
- element indices are snapshot-scoped hints, not durable global identifiers.

## 8. Safety invariants

The following remain true even with an Admin lease:

1. No credential/secure-field typing.
2. No action after the emergency kill-switch reports takeover.
3. Focus-sensitive actions fail closed when the target app cannot be confirmed.
4. Driver trust/Accessibility failures are explicit errors.
5. Input cleanup runs on action error/timeout/shutdown.
6. The caller cannot disable the kill switch, choose a weaker backend, choose the driver path, choose a signal, or bypass focus checks through MCP arguments.
7. The bridge never exposes a reusable raw actuation socket or OS PID through MCP.
8. No model/API provider is loaded by the bridge.

The bridge may reuse existing mouse-shake polling at the same action-gate cadence as the current OODA loop. The existing real-driver global emergency hotkey remains independently active.

## 9. Errors

Bridge errors are categorical and stable. Initial categories:

```text
BRIDGE_UNAVAILABLE
BRIDGE_PROTOCOL_INVALID
BRIDGE_TIMEOUT
DRIVER_UNAVAILABLE
DRIVER_UNTRUSTED
FOCUS_NOT_ACQUIRED
CREDENTIAL_ENTRY_REFUSED
KILL_SWITCH_TRIPPED
TARGET_NOT_FOUND
POLICY_DENIED
```

`chatgpt-system` maps these to stable MCP tool errors without leaking driver stderr, environment values, raw socket frames, screenshots, typed text, or private AX values.

## 10. Audit

`chatgpt-system` audit records computer-use lifecycle metadata only:

- tool/method category;
- success/failure category;
- target app name when non-sensitive;
- duration;
- categorical error code.

Do not audit:

- authority lease IDs;
- typed/pasted text;
- URL query/fragment values;
- screenshots;
- accessibility values;
- coordinates/element text when they could expose document content;
- driver PID/socket frames;
- credentials or tokens.

`computer-use` may keep its existing local diagnostic tracing when explicitly enabled by its own operator configuration; the bridge does not enable model traces by default.

## 11. Lifecycle

For this subsystem, the bridge process is started separately from `chatgpt-system`. `chatgpt-system` only connects to it and reports availability.

This avoids silently spawning a physical-input service merely because the MCP server started.

The later production-runtime subsystem may compose both processes under launchd after real-Mac acceptance. That later change must not weaken the explicit `--real`/computer-use enablement boundary.

Bridge shutdown sequence:

```text
stop accepting requests
-> release inputs
-> stop owned Rust driver
-> remove owned bridge socket
-> exit
```

A bridge restart never scans for or kills arbitrary foreign driver/PID state it cannot prove it owns.

## 12. Testing

### `computer-use`

Automated tests must cover:

- bridge protocol parsing and frame limits;
- socket path type/permission/stale-socket rules;
- simulated driver health and lifecycle;
- PID-bound driver connection;
- shared-controller parity with existing CUA behavior;
- secure-field typing refusal;
- kill-switch refusal;
- focus-failure refusal;
- bounded/redacted AX snapshot;
- screenshot non-empty/error behavior;
- URL scheme validation;
- action serialization and release-input cleanup;
- graceful bridge/driver shutdown.

Existing computer-use tests must remain green.

### `chatgpt-system`

Automated tests must cover:

- computer-use config defaults/overrides;
- Admin-only policy for all screen/action tools;
- strict MCP schemas with no PID/shell/env escape fields;
- bridge client protocol/timeout/malformed-response behavior;
- MCP image response for screenshot;
- categorical error mapping;
- audit redaction;
- real MCP lifecycle against a fake/local bridge fixture;
- existing Node 22/24 and native authority CI remains green.

## 13. Real-Mac acceptance

After both repository CIs are green:

1. Build the current `computer-use` Rust driver.
2. Start the bridge with `--real` on the user's Mac.
3. Start/refresh the `chatgpt-system` tunnel with computer use explicitly enabled.
4. Create an Admin authority lease through existing Touch ID flow.
5. From ChatGPT normal conversation, verify:
   - `computer_health` reports ready;
   - active window can be read;
   - screenshot returns a real image;
   - a harmless app can be opened;
   - a harmless URL can be opened;
   - a benign control in a disposable app/page can be clicked and typed into;
   - secure/password-field typing is refused;
   - emergency hotkey stops further physical action;
   - User lease cannot read screenshots or actuate;
   - ending the Admin lease prevents further calls.
6. Stop the bridge and verify owned driver/socket cleanup.

No destructive OS setting, credential entry, purchase, account mutation, or secret-bearing page is needed for acceptance.

## 14. Delivery

Implementation order:

1. `computer-use`: shared host controller extraction + bridge server + simulated tests.
2. `computer-use`: PR, exact-head CI, merge.
3. `chatgpt-system`: bridge client + authority policy + MCP tools + tests/docs.
4. `chatgpt-system`: PR, exact-head CI, merge.
5. Real-Mac/ChatGPT acceptance and only necessary hardening fixes.

The repositories remain independently usable. `computer-use` retains its standalone CLI/agent/REPL; `chatgpt-system` treats it as an optional local capability provider.

## 15. Definition of done

The subsystem is complete when the ChatGPT agent, without an API-side secondary agent, can use an Admin lease to perceive and safely manipulate the real Mac through the existing computer-use driver while all safety, scope, CI, cleanup, and redaction requirements above hold.