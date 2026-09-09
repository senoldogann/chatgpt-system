# Computer Runtime v2 Design

**Status:** Proposed for user review
**Date:** 2026-09-09
**Branch:** `feat/computer-runtime-v2`
**Base:** `main@876cb6b0b62b1da7a26517abd7fc1b27ee3a0335`

## 1. Goal

Build a fast native macOS computer-control runtime inside `chatgpt-system` so ChatGPT can perceive and manipulate the real Mac with low latency, visible smooth pointer movement, multi-step local execution, verification, retry, and bounded fallback.

ChatGPT remains the only reasoning agent. The local runtime is deterministic execution infrastructure. It never runs a second LLM, autonomous planner, or OODA loop.

```text
ChatGPT reasoning + MCP/plugins/skills
        |
        v
chatgpt-system authority / policy / audit
        |
        +--> computer_run(...)       typed fast path
        |
        +--> computer_run_js(...)    full Node.js power path
        |
        v
Computer Runtime v2
        |
        +--> native macOS perception
        +--> native macOS actuation
        +--> verification/recovery
        v
real Mac
```

A single `computer_run` or `computer_run_js` call may complete many local UI actions without returning to ChatGPT between every click, scroll, observation, and retry.

## 2. Superseded direction

The historical `feat/computer-use-bridge` design proposed reusing the separate `senoldogann/computer-use` Python/Rust stack. Computer Runtime v2 supersedes that direction.

The new subsystem has **no runtime/build dependency** on `senoldogann/computer-use`. The old Python/OODA orchestration is not reused. Useful concepts such as takeover, input cleanup, bounded retries, and deterministic actuation may be reimplemented natively.

Reason: the desired daily-driver experience is much faster than repeated Python/OODA/screenshot/OCR/model round trips, and there must be only one reasoning agent.

## 3. Non-goals

Computer Runtime v2 does not:

- replace Browser Runtime for ordinary semantic web automation;
- create another model/agent;
- bypass macOS TCC;
- provide hidden/stealth input or anti-detection behavior;
- promise full semantic visual understanding locally;
- persist autonomous jobs after daemon shutdown;
- create a generic remote-desktop server.

Browser Runtime remains the preferred browser path. Computer Runtime is the native-app/custom-UI/visual fallback path.

## 4. Architecture

### 4.1 TypeScript control plane

`chatgpt-system` owns:

- MCP registration and output schemas;
- Admin authority checks;
- startup feature gates;
- native-host lifecycle;
- one physical-action mutex;
- typed action-program validation;
- full-Node runner lifecycle;
- time/action/output limits;
- stable error normalization;
- audit/redaction;
- shutdown ordering.

Focused modules should keep `server.ts` from becoming the implementation:

```text
src/computer-types.ts
src/computer-native-client.ts
src/computer-runtime.ts
src/computer-action-runner.ts
src/computer-js-runner-supervisor.ts
src/computer-tool-registration.ts
```

Use existing `errors.ts` only if the computer errors remain readable there; otherwise isolate them in a focused internal module.

### 4.2 Native macOS host

A new Swift package lives at:

```text
native/macos-computer-runtime/
```

It uses native APIs directly:

- Accessibility / `AXUIElement` for structured UI perception;
- AppKit / `NSWorkspace` for app discovery, launch, activation and frontmost checks;
- CoreGraphics/Quartz events for mouse, keyboard, drag and scroll;
- ScreenCaptureKit for screen/window capture;
- Vision for OCR fallback;
- CoreGraphics display/window geometry for coordinate normalization.

It contains no planner or model.

### 4.3 Stable host bundle and TCC identity

The Swift executable is staged as a background app bundle with a stable local identity:

```text
~/.chatgpt-system/ChatGPTSystemComputerHost.app
```

Bundle identifier:

```text
com.senoldogann.chatgpt-system.computer-host
```

`LSUIElement=1` keeps it out of the Dock. `chatgpt-system` launches the bundle executable directly from `Contents/MacOS/` so stdin/stdout remain private parent-owned pipes.

`npm run setup:computer` builds, stages and locally signs the bundle for development/daily-driver use. Production/distribution signing can later use a stable Developer ID without changing the protocol contract.

Accessibility and Screen Recording permissions are granted by macOS to this stable host identity. Setup/doctor may report the required steps but never edits/bypasses TCC.

### 4.4 Parent-owned protocol

The daemon communicates with the host over versioned newline-delimited JSON on stdin/stdout.

No TCP listener and no general Unix-socket service exists in v1.

The helper path is startup/operator configuration. MCP input cannot choose an executable path.

Both sides strictly validate protocol version, request ID, method, params and byte limits. Native stderr is diagnostic-only and is never copied verbatim into MCP errors.

### 4.5 One physical-action lane

The Mac has one pointer and keyboard. All physical mutations are serialized.

Read-only observations may be cached/coalesced, but two computer programs never click/type/drag concurrently.

`computer_run` and `computer_run_js` retain the lane while their local action sequence runs, while still checking cancellation and user takeover between physical mutations.

## 5. Enablement and authority

### 5.1 Disabled by default

Startup/setup flags:

```text
--enable-computer-use
--enable-full-host-js
```

The fixed host path is generated by setup and stored in trusted local configuration. MCP cannot enable either capability.

### 5.2 Admin-only

`computer_health` is lease-free because it returns categorical readiness only.

Every other `computer_*` tool requires an active Admin lease. Project/User authority cannot inspect the screen/AX tree or actuate the host.

### 5.3 Full-host JS is intentionally powerful

`computer_run_js` additionally requires `--enable-full-host-js`.

This mode is explicitly **not a sandbox**. The script executes as the current macOS user and may use normal Node.js capabilities including filesystem, network, `child_process`, `require(...)`, dynamic `import(...)`, and resolvable packages.

It may invoke any executable the current account itself can invoke. This includes `sudo` if present, but `chatgpt-system` never supplies a password, bypasses a prompt, grants a privileged helper, or otherwise elevates privileges automatically. A machine configured with passwordless `sudo` naturally has the privileges that configuration provides; full-host JS does not pretend otherwise.

The runner receives a sanitized environment so daemon/tunnel credentials and authority secrets are not automatically inherited. HOME, PATH, locale and normal runtime variables needed for ordinary user-level tooling are preserved deliberately.

`system_capabilities` and `system_environment` report whether computer use and full-host JS are enabled without revealing secrets.

## 6. Perception: cheap path first

The runtime must not do full screenshot + OCR for every action.

### 6.1 Accessibility first

`computer_observe` first returns a bounded normalized AX snapshot for the active or requested app/window.

Elements may include:

```text
snapshotId
index
role/subrole
label/title/description
focused/enabled/selected
x/y/width/height
supported semantic actions where useful
```

Never return raw AX pointers or OS PIDs.

Editable and secure current field values are omitted from structured observations. This prevents accidental reflection of passwords/tokens even in owner-trust mode.

### 6.2 Change detection

The host keeps bounded in-memory metadata/digests for the current window, AX snapshot and recent capture regions. Verification can cheaply answer “did the UI change?” without running OCR.

Screenshot pixels are not written to disk by default.

### 6.3 Screenshot/crop

When AX is absent, stale or insufficient, capture only what is useful when possible: active window, one display, or a bounded region.

`computer_screenshot` explicitly exposes PNG image content to ChatGPT. Internal verification may use captures without returning them.

### 6.4 Vision OCR fallback

Vision OCR is the text fallback for custom/canvas UIs that do not expose useful AX text.

OCR returns bounded text boxes and geometry. It is not treated as equivalent to model-level visual reasoning.

### 6.5 Replan boundary

If deterministic AX/OCR/geometry logic cannot identify the intended target confidently, stop with `COMPUTER_NEEDS_REPLAN` and return a bounded final observation plus an explicit screenshot/crop when useful.

The runtime never silently calls another LLM.

## 7. Targets and stale-state safety

```ts
type ComputerTarget =
  | { by: "index"; snapshotId: string; index: number }
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string; exact?: boolean }
  | { by: "ocrText"; text: string; exact?: boolean }
  | { by: "point"; x: number; y: number };
```

Snapshot indices are short-lived hints. Before mutation the runtime revalidates that the snapshot/target geometry is still usable.

Zero matches => `COMPUTER_TARGET_NOT_FOUND`.

Unsafe multiple matches => `COMPUTER_TARGET_AMBIGUOUS`.

Stale indexed target => `COMPUTER_STALE_SNAPSHOT`, then the configured recovery ladder may re-observe/re-resolve.

Raw coordinates are supported because some applications expose no useful semantic tree, but coordinates are bounded to current display topology and are the least-preferred target form.

## 8. Fast human-visible pointer motion

The cursor should visibly move rather than teleport for ordinary clicks.

The native host generates a smooth distance-aware cubic path with easing. The objective is reliable, visually trackable interaction, not anti-detection behavior.

Default profiles:

```text
instant   explicit troubleshooting/speed mode
fast      smooth, recommended default
natural   slightly more visible/relaxed
```

Approximate `fast` timing goals:

```text
very short: 50-90 ms
short:      70-130 ms
medium:     100-190 ms
long:       140-260 ms
```

The path ends exactly at the requested target. Avoid random jitter that harms hit accuracy.

The model may request `instant`, `fast`, or `natural`, but cannot disable coordinate bounds or user takeover.

## 9. Physical actions, focus, typing and takeover

Native actions:

- mouse move;
- click / double-click;
- mouse down/up;
- drag;
- horizontal/vertical scroll;
- type text;
- key press;
- modifier chord/hotkey;
- release all held inputs.

Before focus-sensitive actions the intended application/window must be frontmost. Unexpected focus change causes bounded retry or `COMPUTER_FOCUS_FAILED`; typing never continues blindly into another app.

### 9.1 Secure-field behavior

Structured observations never return secure-field values.

Computer Runtime v2 does **not** impose a separate credential-entry refusal on Admin owner-trust input. If ChatGPT explicitly calls `computer_type_text` or a full-host JS program types into a secure field, the host may perform that input. Typed content is never audited.

This is intentionally different from the safer Browser Runtime credential policy and follows the explicit full-host daily-driver goal.

### 9.2 User takeover

The user can reclaim control immediately.

Synthetic CGEvents are tagged with a helper-owned event-source marker. An event tap ignores those owned events but watches real user input.

During runtime-owned motion/drag, unexpected real pointer movement or physical input interrupts the current action, releases held buttons/keys, and returns `COMPUTER_USER_TAKEOVER`.

Default pointer takeover tolerance is 18 logical pixels. It is startup/operator configuration, not model-controlled input.

Fixed emergency hotkey:

```text
Control + Option + Command + Escape
```

The hotkey cannot be disabled by MCP. Triggering it cancels the active computer action/program and releases held inputs.

## 10. Verification and bounded recovery

Emitting an input event is not success by itself.

Deterministic verification primitives include:

- target/text appeared or disappeared;
- AX state changed;
- focus changed as expected;
- active window changed;
- checkbox/selection value changed;
- requested screen region changed;
- app became frontmost;
- bounded wait completed.

Recovery ladder:

```text
1. fresh AX observation
2. re-resolve semantic target
3. refocus intended app/window
4. OCR-backed target lookup when relevant
5. explicitly supplied coordinate fallback
6. COMPUTER_NEEDS_REPLAN
```

The runtime never invents a random coordinate because semantic lookup failed.

Default bounds:

```text
maxAutomaticRetriesPerAction = 2
maxActionProgramActions = 100
maxActionProgramRuntimeMs = 30000
```

## 11. MCP surface

### 11.1 Health/observation

```text
computer_health
computer_observe
computer_screenshot
```

Health example:

```ts
{
  enabled: boolean;
  state: "disabled" | "stopped" | "running" | "unavailable";
  accessibilityTrusted: boolean;
  screenCaptureAuthorized: boolean;
  fullHostJsEnabled: boolean;
}
```

### 11.2 Direct operations

```text
computer_open_app
computer_focus_app
computer_move_mouse
computer_click
computer_drag
computer_scroll
computer_type_text
computer_press_key
computer_wait
computer_release_inputs
```

These remain valuable for debugging, acceptance and simple one-off actions.

### 11.3 `computer_run`: typed multi-action fast path

A single call receives a bounded action array. Initial action vocabulary:

```text
observe
screenshot
open_app
focus_app
move_mouse
click
double_click
drag
scroll
type_text
press_key
wait
wait_for_text
wait_until_changed
release_inputs
```

Each action may provide an optional verification condition and an explicitly bounded retry policy. Targeted actions may provide one explicit fallback target.

Example:

```json
{
  "actions": [
    {"type":"focus_app","app":"Xcode"},
    {"type":"click","target":{"by":"role","role":"button","name":"Run"}},
    {"type":"wait_for_text","text":"Build Succeeded","timeoutMs":10000}
  ]
}
```

The response contains per-step status summaries and one final bounded observation. It does not stream every internal mouse sample back through MCP.

### 11.4 `computer_run_js`: full Node power path

Conceptual input:

```ts
{
  authorityLeaseId: string;
  source: string;
  cwd?: string;
  timeoutMs?: number;
}
```

`cwd` defaults to the first configured startup root for deterministic daily-driver behavior. Because this is full-host JS, the script itself may later change directory or access paths outside configured roots using ordinary Node APIs.

The source executes in a dedicated Node child, never in the daemon event loop.

Source is delivered through a private pipe/stdin, not argv or environment.

The child gets a parent-mediated `computer` object:

```js
await computer.observe(options)
await computer.screenshot(options)
await computer.find(target)
await computer.exists(target)
await computer.focusApp(name)
await computer.openApp(name)
await computer.moveMouse(targetOrPoint, options)
await computer.click(targetOrPoint, options)
await computer.drag(from, to, options)
await computer.scroll(options)
await computer.typeText(text, options)
await computer.pressKey(keyOrChord)
await computer.wait(ms)
await computer.waitForText(text, options)
await computer.waitUntilChanged(options)
await computer.releaseInputs()
```

Normal Node APIs remain available:

```js
const fs = require("node:fs");
const { execFile } = require("node:child_process");

await computer.focusApp("Xcode");
let run = await computer.find({ by: "role", role: "button", name: "Run" });
if (!run) {
  await computer.wait(100);
  run = await computer.find({ by: "text", text: "Run" });
}
if (!run) throw new Error("Run target unavailable");
await computer.click(run);
await computer.waitUntilChanged({ timeoutMs: 3000 });
return { homeEntries: fs.readdirSync(process.env.HOME).length };
```

The runner supports CommonJS `require(...)` and dynamic `await import(...)`.

Returned values must be JSON-serializable and bounded.

### 11.5 JS fault containment

The supervisor starts a fixed runner entrypoint with:

- resolved Node executable;
- `shell:false`;
- sanitized environment;
- bounded stdout/stderr;
- private Node IPC for `computer` RPC;
- owned POSIX process group;
- timeout/cancellation;
- descendant cleanup on timeout/shutdown.

`process.exit()` exits only the runner. A crash/exception cannot terminate the main daemon.

This is process fault containment, not a security sandbox.

## 12. Plugin/MCP/skill composition

The computer runtime does not embed another plugin manager or ChatGPT client.

The intended orchestration stays at ChatGPT level:

```text
ChatGPT
  + GitHub / other plugins
  + Context7
  + Build macOS Apps skill
  + Build Web Apps skill when relevant
  + chatgpt-system browser/process/fs/git/computer tools
```

A `computer_run_js` call can do many local steps, but cannot suspend mid-program to ask ChatGPT to invoke a cloud plugin. Plugin-derived data is obtained by ChatGPT before/after the local program.

## 13. Browser-first routing

Preferred policy:

```text
Browser Runtime semantic tool
    -> sufficient: use Browser Runtime
    -> native/custom/blocked: use Computer Runtime
```

Computer Runtime may physically control Chromium when necessary, but does not replace existing Browser Runtime for ordinary navigation, semantic forms, snapshots and diagnostics.

## 14. Native protocol

Versioned NDJSON envelope:

```ts
{
  protocolVersion: 1;
  requestId: string;
  method: string;
  params: object;
}
```

Response:

```ts
{
  protocolVersion: 1;
  requestId: string;
  ok: boolean;
  result?: object;
  error?: { code: string; message: string; details?: object };
}
```

Unknown methods/fields and oversized frames are rejected.

The native host never accepts authority leases, daemon secrets, shell source, arbitrary executable paths, raw PID actuation, or requests to disable takeover/bounds.

Full Node execution stays in the Node control plane.

## 15. Stable errors

```text
COMPUTER_DISABLED
COMPUTER_UNAVAILABLE
COMPUTER_PERMISSION_REQUIRED
COMPUTER_PROTOCOL_INVALID
COMPUTER_TIMEOUT
COMPUTER_TARGET_NOT_FOUND
COMPUTER_TARGET_AMBIGUOUS
COMPUTER_STALE_SNAPSHOT
COMPUTER_FOCUS_FAILED
COMPUTER_ACTION_FAILED
COMPUTER_USER_TAKEOVER
COMPUTER_NEEDS_REPLAN
COMPUTER_OUTPUT_LIMIT
COMPUTER_JS_DISABLED
COMPUTER_JS_FAILED
COMPUTER_JS_TIMEOUT
POLICY_DENIED
```

Raw AX/native exception text, JS stack traces, screen text, stderr and secret-bearing command lines are not blindly copied into stable MCP errors.

## 16. Privacy and audit

Screen/AX data is Admin-only.

Structured observation never returns raw PID, AX pointer identity or secure/editable current field values.

Explicit screenshots contain whatever is visibly on screen by definition.

Audit computer operations with metadata only:

```text
action category
duration
success/failure
safe app identity when useful
action count for computer_run
JS source byte count + SHA-256 digest
stable error code
```

Never audit:

- JS source;
- JS stdout/stderr/return value;
- typed text;
- screenshot pixels;
- OCR/AX document text;
- URL query/fragment;
- lease IDs;
- environment values;
- raw coordinates when avoidable.

## 17. Configuration

Initial config/limits:

```text
computerUse.enabled = false
computerUse.fullHostJsEnabled = false
computerUse.hostBundlePath = ~/.chatgpt-system/ChatGPTSystemComputerHost.app
computerUse.requestTimeoutMs = 10000
computerUse.maxObservationElements = 500
computerUse.maxObservationChars = 262144
computerUse.maxScreenshotBytes = 8388608
computerUse.maxActionProgramActions = 100
computerUse.maxActionProgramRuntimeMs = 30000
computerUse.maxAutomaticRetriesPerAction = 2
computerUse.maxJsSourceBytes = 262144
computerUse.maxJsRuntimeMs = 30000
computerUse.maxJsOutputBytes = 1048576
computerUse.pointerMode = "fast"
computerUse.userTakeoverTolerancePx = 18
```

Numeric options are positive bounded startup settings. MCP cannot raise those limits.

## 18. Lifecycle and shutdown

Native host starts lazily on first enabled health probe or authorized computer call.

A crashed host makes the current call fail closed. A later call may launch a fresh host.

Shutdown order:

```text
stop accepting computer programs
-> cancel active JS runner
-> release held native inputs
-> terminate owned JS process group
-> close native host
-> existing ProcessSupervisor close
-> existing Browser Runtime close
-> control/transport shutdown
```

No startup sweep scans/kills foreign processes.

## 19. Performance acceptance goals

Real-Mac targets, not flaky CI deadlines:

- warm `computer_health`: effectively immediate;
- ordinary AX-only `computer_observe`: median <150 ms target;
- warm screenshot: <250 ms target;
- current-snapshot semantic lookup: <50 ms target;
- long smooth pointer move in `fast`: normally <260 ms;
- 5 simple UI actions execute locally without 5 MCP/LLM round trips;
- 10 deterministic fixture actions should normally complete within ~3 seconds excluding deliberate waits/build time;
- OCR/full capture usage should be exceptional when AX suffices.

Instrument durations/counts only, never UI content.

## 20. Test strategy

### 20.1 TypeScript

Must cover:

1. disabled-by-default config;
2. strict tool schemas;
3. lease-free categorical health;
4. Admin-only screen/actuation;
5. explicit full-host-JS gate;
6. native request correlation/timeout/size validation;
7. malformed native response fails closed;
8. physical-action serialization;
9. typed action count/runtime bounds;
10. target missing/ambiguous/stale mapping;
11. retry budget stops deterministically;
12. native raw errors do not leak;
13. audit redaction;
14. JS runner timeout cleans its process group;
15. runner crash/process.exit does not crash daemon;
16. JS source absent from argv/env/audit;
17. daemon secret env absent from runner;
18. shutdown releases inputs before host termination;
19. existing Browser/Process behavior remains green.

### 20.2 Swift

Use injectable host adapters so CI can test logic without real TCC permissions.

Must cover:

1. AX normalization/redaction;
2. observation bounds;
3. target resolution/stale snapshots;
4. display coordinate bounds;
5. pointer path exact endpoints;
6. pointer duration clamps;
7. owned synthetic event tagging;
8. user takeover detection;
9. emergency hotkey cancellation;
10. input release on every failure path;
11. focus verification;
12. screenshot bounds/encoding;
13. OCR bounds;
14. strict protocol/correlation;
15. clean shutdown.

### 20.3 Disposable native fixture

Build a harmless fixture app exposing:

- button;
- text field;
- checkbox;
- scroll view;
- drag targets;
- deterministic status text;
- one custom-drawn/OCR-only region.

This fixture is the primary deterministic E2E target before touching real user apps.

### 20.4 CI

Node 22, Node 24 and macOS-native remain mandatory. macOS-native builds/tests the new Swift package/bundle. Real TCC-dependent capture/input remains real-Mac acceptance unless a safe CI harness exists.

## 21. Serious real-Mac acceptance

### A. Readiness

- exact main SHA / clean tree;
- full CI green;
- setup/staging/signing succeeds;
- Accessibility + Screen Recording readiness verified;
- daily-driver restart uses merged binary/bundle.

### B. Deterministic fixture

- observe real AX tree;
- visible smooth mouse move + click;
- verify UI state change after click;
- benign text typing + verification;
- scroll + verification;
- drag + verification;
- 10+ step `computer_run` in one MCP call;
- intentional stale target recovery;
- AX failure -> OCR/explicit-coordinate fallback;
- real mouse takeover -> immediate release;
- `Ctrl+Option+Command+Esc` -> immediate cancellation/release.

### C. Full Node

- Node `fs` read-only operation;
- same script uses injected `computer` API;
- condition/loop/retry local logic;
- harmless child process spawn/cleanup;
- `process.exit()` runner isolation;
- timeout/descendant cleanup;
- sanitized environment canary test;
- source/stdout/stderr/return value absent from audit;
- explicit cwd/default-root behavior.

### D. Real applications

Smoke test Finder, TextEdit, Xcode, System Settings and Chromium without destructive system changes, purchases, account mutations or secret extraction.

Measure observation latency, target accuracy, pointer quality, action throughput, recovery success and OCR fallback rate.

### E. ChatGPT Web E2E

Prove:

```text
ChatGPT Web
-> plugin/tunnel
-> Admin lease
-> computer_observe
-> computer_run / computer_run_js
-> native host
-> visible real Mac action
-> verified result back to ChatGPT
```

Also verify ChatGPT can compose the computer tools with connected MCP/plugins in the surrounding workflow.

## 22. Delivery slices

### Slice 1: native host foundation

- Swift package + stable host bundle;
- setup/doctor;
- protocol;
- health/TCC state;
- app/window discovery;
- AX observe;
- screenshot;
- simulated/native tests.

### Slice 2: physical input + verification

- focus/open app;
- smooth pointer motion;
- click/drag/scroll;
- keyboard;
- synthetic event tagging;
- takeover + fixed emergency hotkey;
- release-input cleanup;
- verification primitives.

### Slice 3: TypeScript runtime + MCP

- host supervisor/client;
- Admin policy;
- low-level tools;
- typed `computer_run`;
- output/errors/audit;
- shutdown integration.

### Slice 4: full Node power path

- `--enable-full-host-js`;
- runner supervisor;
- private `computer` IPC API;
- `computer_run_js`;
- cwd/env semantics;
- timeout/process-group cleanup;
- output/audit limits.

### Slice 5: recovery/performance

- observation cache/digests;
- Vision OCR;
- bounded recovery ladder;
- stale-target recovery;
- timing instrumentation;
- real-Mac tuning.

### Slice 6: acceptance/freeze

- deterministic fixture suite;
- real-app smoke suite;
- ChatGPT Web E2E;
- evidence-driven fixes only;
- freeze if speed/reliability is good enough; otherwise revise/remove instead of preserving it merely because it was expensive.

Every slice uses TDD where practical, full repository verification, exact-head CI, PR review, merge and post-merge CI before the next slice.

## 23. Definition of done

Computer Runtime v2 is complete only when:

- ChatGPT can inspect bounded native UI state;
- the real cursor visibly moves/clicks/drags/scrolls and keyboard input works;
- ordinary native UI work is AX-first and fast;
- one MCP call can execute many local actions;
- actions verify effects and recover locally within bounded budgets;
- full Node.js is available under explicit local-owner enablement and can use the same computer API;
- Node runner crashes/timeouts cannot crash the daemon or leave held inputs;
- the user can interrupt automation physically and with the fixed emergency hotkey;
- full-host JS does not automatically inherit daemon/tunnel secrets;
- Browser Runtime remains preferred for semantic browser work and keeps passing;
- Node 22/24, macOS-native CI and serious real-Mac acceptance are green;
- ChatGPT Web -> plugin/tunnel -> local computer -> visible Mac action is proven end-to-end;
- measured speed and reliability are good enough for daily use.
