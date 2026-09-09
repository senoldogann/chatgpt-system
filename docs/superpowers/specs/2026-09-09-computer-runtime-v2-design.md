# Computer Runtime v2 Design

**Status:** Proposed for user review
**Date:** 2026-09-09
**Branch:** `feat/computer-runtime-v2`
**Base:** `main@876cb6b0b62b1da7a26517abd7fc1b27ee3a0335`

## 1. Goal

Add a fast native macOS computer-control runtime to `chatgpt-system` so the ChatGPT agent can perceive and manipulate the real Mac with low latency, smooth visible pointer movement, multi-step local execution, verification, retry, and bounded fallback.

The ChatGPT model remains the only reasoning agent. The local runtime is deterministic execution infrastructure. It does not run a second LLM, autonomous planner, or OODA loop.

The target user experience is:

```text
ChatGPT reasoning + MCP/plugins/skills
        |
        v
chatgpt-system authority / policy / audit
        |
        +--> computer_run(...)       fast typed multi-action path
        |
        +--> computer_run_js(...)    full Node.js power path
        |
        v
Computer Runtime v2
        |
        +--> native macOS perception
        +--> native macOS actuation
        +--> action verification
        +--> bounded retry/fallback
        v
real Mac
```

A single `computer_run` or `computer_run_js` call may complete many local UI actions without returning to ChatGPT between every click, scroll, observation, and retry.

## 2. Why this replaces the old computer-use bridge direction

The historical `feat/computer-use-bridge` design proposed reusing the separate `senoldogann/computer-use` Python/Rust stack. That stack contains useful safety and driver ideas, but the desired product has changed:

- the existing Python/OODA orchestration is too slow for the intended interactive daily-driver experience;
- the new runtime must not add a second reasoning loop;
- perception and actuation should be native and local;
- repeated screenshot/OCR/model round trips must not be the default interaction path;
- ChatGPT should be able to send a multi-step action program and let the Mac execute it locally at high speed.

Computer Runtime v2 therefore does **not** depend on the `senoldogann/computer-use` repository. Useful ideas may be reimplemented, but there is no runtime or build dependency on that repository.

## 3. Non-goals

This subsystem does not:

- replace Browser Runtime for ordinary web automation;
- create a second LLM or local autonomous planner;
- provide root or automatic `sudo` privileges;
- bypass macOS TCC permissions;
- promise that every application exposes a useful Accessibility tree;
- promise local semantic image understanding equivalent to a multimodal model;
- provide hidden/stealth input or bot-detection evasion;
- persist autonomous jobs after the `chatgpt-system` daemon exits;
- create a generic remote desktop protocol.

Browser Runtime remains the preferred surface for browser-native work. Computer Runtime v2 is the native-app and visual fallback/control layer.

## 4. Core architecture

### 4.1 TypeScript control plane

`chatgpt-system` owns:

- MCP registration;
- authority enforcement;
- startup feature gates;
- native-helper lifecycle;
- action serialization;
- typed action program validation;
- full-Node runner lifecycle;
- time/action/output limits;
- error normalization;
- audit metadata and redaction;
- daemon shutdown ordering.

Suggested focused modules:

```text
src/computer-types.ts
src/computer-native-client.ts
src/computer-runtime.ts
src/computer-action-runner.ts
src/computer-js-runner-supervisor.ts
src/computer-tool-registration.ts
src/computer-errors.ts          // or existing errors.ts if kept focused
```

The existing `server.ts` must remain registration/composition code rather than becoming the computer-use implementation.

### 4.2 Native macOS host helper

A new native helper lives in this repository:

```text
native/macos-computer-runtime/
```

It is implemented in Swift using the smallest direct macOS APIs needed for the host boundary:

- Accessibility (`AXUIElement`) for structured UI perception and semantic actions/geometry;
- `NSWorkspace` / AppKit for application discovery, activation, and launching;
- CoreGraphics/Quartz events for physical mouse, keyboard, drag, and scroll input;
- ScreenCaptureKit for screen/window capture where available and appropriate;
- Vision for OCR fallback;
- CoreGraphics display/window geometry for coordinate normalization.

The helper is a deterministic command service, not a GUI application and not a reasoning engine.

### 4.3 Parent-owned stdio protocol

`chatgpt-system` launches the fixed installed helper with `shell: false` and communicates over parent-owned stdin/stdout pipes using versioned newline-delimited JSON.

No TCP listener and no general Unix socket server are required in v1. Parent-owned stdio provides a smaller attack and lifecycle surface than the historical bridge design.

The helper executable path is startup/operator configuration. MCP arguments cannot choose or replace it.

Requests and responses are schema-validated on both sides. Stderr is diagnostic-only and is never copied verbatim into MCP errors.

### 4.4 One physical-action lane

The Mac has one pointer and keyboard. All physical mutations are serialized through one runtime action mutex.

Read-only observations may be coalesced or cached, but physical mutations never execute concurrently.

`computer_run` and `computer_run_js` hold the action lane for the duration of their current atomic action sequence. They must still observe cancellation/user takeover between individual physical actions.

## 5. Explicit enablement and authority

### 5.1 Disabled by default

Computer Runtime v2 is disabled unless the local operator explicitly enables it at daemon/setup time.

Proposed startup options:

```text
--enable-computer-use
--enable-full-host-js
--computer-helper <fixed local executable path>   // setup/operator only
```

Equivalent config/environment representation may be used internally. The setup tooling should write the fixed helper path; ChatGPT cannot change it through MCP.

### 5.2 Admin-only host control

`computer_health` is lease-free because it returns only categorical readiness.

All other `computer_*` tools require an active **Admin** lease. Project/User authority cannot observe screen/Accessibility state or actuate the host.

### 5.3 Full-host JavaScript is an explicit stronger capability

`computer_run_js` requires both:

- active Admin authority;
- startup `--enable-full-host-js`.

This is intentionally stronger than `terminal_run` and the ordinary scoped filesystem tools.

The JavaScript runner is **not a sandbox**. It may use normal Node.js capabilities such as:

- `require("node:fs")`;
- `await import("node:fs")`;
- `child_process`;
- networking;
- the current user's filesystem permissions;
- ordinary user-level Node packages that are resolvable from the runner environment.

It still runs as the current macOS user. It does not gain root privileges merely because full-host JS is enabled.

Enabling `--enable-full-host-js` is therefore an explicit local-owner trust decision and must be reported by `system_capabilities` / `system_environment` without exposing secrets.

The runner receives a sanitized process environment and must not inherit tunnel credentials, authority secrets, or unrelated daemon-only secret environment variables by default. This is fault/secrets isolation, not a claim that the runner is sandboxed.

## 6. Perception model: fast paths first

The runtime must avoid a full screenshot + OCR cycle for every action.

### 6.1 Layer 1: Accessibility-first observation

`computer_observe` first attempts to obtain a bounded Accessibility representation for the active or requested application/window.

Returned element data may include:

```text
snapshotId
index
role
subrole
label/title/description where available
focused/enabled/selected state
logical bounds: x/y/width/height
supported high-level actions where useful
```

It must not expose raw `AXUIElement` pointers or process IDs.

Editable/secure current values are redacted from observations. This rule protects accidental secret reflection even in full-host mode.

### 6.2 Layer 2: frame/window change detection

The runtime keeps bounded in-memory observation metadata so it can cheaply determine whether the active window, Accessibility tree digest, or requested screen region changed after an action.

This is used for verification and `wait_until_changed` without forcing OCR.

No screenshot pixels are written to disk by default.

### 6.3 Layer 3: screenshot/crop

When Accessibility information is absent, stale, or insufficient, the runtime may capture:

- the active window;
- one display;
- a bounded region/crop.

`computer_screenshot` exposes an explicit capture to ChatGPT. Internal verification may use smaller captures without returning them to the caller.

### 6.4 Layer 4: Vision OCR fallback

Vision OCR is used when text exists visually but is not exposed usefully through Accessibility.

OCR is a fallback, not the primary perception strategy.

The OCR result is bounded and represented as text boxes/geometry. The runtime does not pretend OCR has full semantic understanding.

### 6.5 Model replan boundary

If deterministic local methods cannot identify the intended target with sufficient confidence, the local runtime stops and returns a structured failure such as `COMPUTER_NEEDS_REPLAN` with a bounded final observation and, when useful, an explicit screenshot/crop.

The local runtime does not silently invoke a second model. ChatGPT may then inspect the evidence and issue a new action/program.

## 7. Target model

Actions should prefer semantic targets rather than raw coordinates.

Supported target forms in v1:

```ts
type ComputerTarget =
  | { by: "index"; snapshotId: string; index: number }
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string; exact?: boolean }
  | { by: "ocrText"; text: string; exact?: boolean }
  | { by: "point"; x: number; y: number };
```

Snapshot indices are short-lived hints. A stale `snapshotId` must never be trusted blindly. The runtime revalidates target geometry before mutation.

If a semantic target has zero matches, return/fallback from `COMPUTER_TARGET_NOT_FOUND`. If it has multiple unsafe matches and cannot be disambiguated, return `COMPUTER_TARGET_AMBIGUOUS` rather than guessing.

Raw coordinates remain available because some native/canvas/custom UIs expose no useful semantic tree, but coordinates are bounded to the current display topology and are the least-preferred target form.

## 8. Human-visible fast pointer motion

Pointer movement should be visible and smooth rather than teleporting to every target.

The native helper generates a short smooth trajectory between current pointer position and destination using a distance-aware cubic curve and easing.

The design goal is reliability and visually trackable interaction, not stealth or anti-detection behavior.

Default motion profile:

```text
very short move: roughly 50-90 ms
short move:      roughly 70-130 ms
medium move:     roughly 100-190 ms
long move:       roughly 140-260 ms
```

Exact timing is clamped and may adapt to display distance and drag semantics. The implementation should avoid artificial jitter that reduces targeting reliability.

Supported motion modes may be:

```text
instant   // explicit troubleshooting/speed option
fast      // smooth but short duration; recommended default
natural   // slightly more visible/relaxed
```

The local operator may set a startup default. The model may request `fast` or `natural` per action if enabled by schema, but it cannot disable takeover detection or bounds checking.

Clicks are emitted only after the final pointer position is verified within a small tolerance of the intended target.

## 9. Physical input and takeover

### 9.1 Native actions

The helper supports at minimum:

- move mouse;
- click / double click;
- mouse down/up;
- drag;
- vertical/horizontal scroll;
- type text;
- press one key;
- press a modifier key chord;
- release all held inputs.

### 9.2 User takeover

The user must be able to reclaim physical control immediately.

During a runtime-owned pointer movement or drag, unexpected pointer deviation beyond a conservative tolerance is treated as user takeover. The current action is interrupted, held inputs are released, and the runtime returns `COMPUTER_USER_TAKEOVER`.

The native helper should also provide a fixed local emergency hotkey that cannot be disabled by MCP input. The exact key combination is chosen during implementation based on reliable macOS event-tap behavior and documented in setup/acceptance instructions.

### 9.3 Focus verification

Before focus-sensitive mutations, the runtime confirms the intended application/window is frontmost.

If focus cannot be acquired or changes unexpectedly, the action fails or retries through the bounded recovery policy. It does not keep typing into whichever application happened to become active.

## 10. Verification and recovery

A physical input event is not automatically considered success.

### 10.1 Verification primitives

The local runtime provides deterministic checks such as:

- target disappeared/appeared;
- text appeared;
- Accessibility state changed;
- focused element changed;
- active window changed;
- selected/checked value changed;
- specified screen region changed;
- application became frontmost;
- elapsed bounded wait completed.

### 10.2 Recovery ladder

For operations that opt into automatic recovery, use a bounded ladder such as:

```text
1. re-read current AX state
2. re-resolve the semantic target
3. refocus intended app/window
4. try OCR-backed target resolution when applicable
5. use an explicitly supplied coordinate fallback when present
6. stop and return COMPUTER_NEEDS_REPLAN
```

The runtime never invents an arbitrary coordinate simply because semantic resolution failed.

Default recovery budgets are small. Example defaults:

```text
maxAutomaticRetriesPerAction = 2
maxActionProgramActions = 100
maxActionProgramRuntimeMs = 30000
```

These are operational bounds rather than security sandbox claims.

## 11. MCP surface

### 11.1 Readiness and observation

```text
computer_health
computer_observe
computer_screenshot
```

`computer_health` output is categorical, for example:

```ts
{
  enabled: boolean;
  state: "disabled" | "stopped" | "running" | "unavailable";
  accessibilityTrusted: boolean;
  screenCaptureAuthorized: boolean;
  fullHostJsEnabled: boolean;
}
```

No lease is required for health.

### 11.2 Direct low-level operations

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

These remain useful for debugging, acceptance, and one-off calls.

### 11.3 Fast multi-action path

```text
computer_run
```

Input contains a bounded array of typed actions and optional verification/recovery fields.

Example conceptual request:

```json
{
  "actions": [
    {"type":"focus_app","app":"Xcode"},
    {"type":"click","target":{"by":"role","role":"button","name":"Run"}},
    {"type":"wait_for_text","text":"Build Succeeded","timeoutMs":10000}
  ]
}
```

The runtime executes the sequence locally under one MCP call and returns per-step summaries plus the final bounded observation.

Typed actions are the preferred fast path for routine sequences because they avoid spinning up a Node child.

### 11.4 Full Node.js power path

```text
computer_run_js
```

Conceptual input:

```ts
{
  authorityLeaseId: string;
  source: string;
  timeoutMs?: number;
}
```

`source` executes in a dedicated child Node process owned by `chatgpt-system`, not inside the daemon process.

The child receives a `computer` API that performs native computer operations by private parent-child IPC.

Representative API:

```js
await computer.observe(options)
await computer.screenshot(options)
await computer.find(target)
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
await computer.exists(target)
await computer.releaseInputs()
```

The JS source may also use ordinary Node capabilities. Example:

```js
const fs = require("node:fs");
const files = fs.readdirSync(process.env.HOME);

await computer.focusApp("Xcode");
const run = await computer.find({ by: "role", role: "button", name: "Run" });
if (!run) throw new Error("Run button not found");
await computer.click(run);
await computer.waitUntilChanged({ timeoutMs: 3000 });
return { fileCount: files.length, final: await computer.observe() };
```

The runner supports `require(...)` and dynamic `await import(...)`. It is allowed to spawn ordinary user-level child processes through Node APIs.

The script's returned value must be JSON-serializable and is output-bounded.

### 11.5 JS runner fault containment

Full Node capability must not run inside the main daemon event loop.

The supervisor launches a dedicated runner child with:

- fixed `node` executable resolution;
- fixed runner entrypoint;
- `shell: false`;
- sanitized environment;
- bounded stdout/stderr capture;
- private Node IPC channel for `computer` RPC;
- a separate process group on POSIX where practical;
- execution timeout;
- cancellation;
- process-tree cleanup on timeout/daemon shutdown.

A JS script calling `process.exit()` therefore exits its runner, not the `chatgpt-system` daemon.

No script source, stdout/stderr, returned value, typed text, or screenshot pixels are written to audit logs.

## 12. Plugin, MCP, and skill composition

Computer Runtime v2 does not embed another plugin manager or ChatGPT client.

The intended orchestration remains at the ChatGPT reasoning layer:

```text
ChatGPT
  + GitHub plugin
  + Context7
  + Build macOS Apps skill
  + Build Web Apps skill when relevant
  + other connected MCP/plugins
  + chatgpt-system computer tools
```

A single `computer_run_js` may perform many local computer steps, but it cannot pause mid-script and ask the ChatGPT model to call a separate cloud plugin unless such a capability is explicitly added in a future design.

When a workflow needs external reasoning/plugin data, ChatGPT obtains that data before or after the local computer program.

## 13. Browser-first routing

Browser Runtime remains preferred when the task is naturally expressible with browser semantic tools.

Recommended reasoning policy:

```text
browser semantic tool
    -> if sufficient: use it
    -> if blocked/native/custom UI: computer runtime
```

Computer Runtime may control Chromium physically when necessary, but it must not replace the existing safer Browser Runtime for ordinary web navigation, forms, snapshots, and diagnostics.

## 14. Native-helper protocol

The native helper protocol is versioned NDJSON over stdio.

Example request envelope:

```ts
{
  protocolVersion: 1;
  requestId: string;
  method: string;
  params: object;
}
```

Example response envelope:

```ts
{
  protocolVersion: 1;
  requestId: string;
  ok: boolean;
  result?: object;
  error?: {
    code: string;
    message: string;
    details?: object;
  };
}
```

Protocol requests and responses have byte limits. Unknown fields/methods are rejected.

The native helper never accepts:

- shell source;
- authority lease IDs;
- daemon credentials;
- arbitrary executable paths;
- raw process IDs for actuation;
- requests to disable user takeover or protocol bounds.

Full Node execution stays in the TypeScript/Node layer rather than being implemented by the native helper.

## 15. Errors

Stable error codes should distinguish runtime failure from ordinary target/action failure.

Initial set:

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

Raw AX errors, native exception text, JavaScript stack traces, screen text, absolute secret-bearing command lines, and stderr are not copied blindly into stable MCP error payloads.

`computer_run_js` may return a bounded script failure summary to the caller, but audit remains metadata-only.

## 16. Privacy, redaction, and audit

### 16.1 Observation output

Screen and Accessibility data are sensitive and Admin-only.

The runtime never returns:

- raw process IDs;
- AX pointer identities;
- secure text-field values;
- hidden password values.

Editable field values should be omitted by default from structured observations. Explicit screenshots still contain whatever is visibly on screen because that is the purpose of a screenshot.

### 16.2 Audit

Audit computer operations using categorical metadata only, for example:

```text
action category
duration
success/failure
safe application bundle/name when useful
action count for computer_run
script byte count + SHA-256 digest for computer_run_js
stable error code
```

Audit must not store:

- script source;
- script stdout/stderr;
- script return value;
- typed text;
- screenshot/image bytes;
- OCR text;
- Accessibility document/value text;
- URL query/fragment;
- authority lease IDs;
- raw coordinates when avoidable;
- environment values.

## 17. Configuration and limits

Proposed configuration fields:

```text
computerUse.enabled = false
computerUse.fullHostJsEnabled = false
computerUse.helperPath
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
```

All externally configurable numeric limits are bounded positive integers with sensible upper bounds. The model cannot expand limits beyond startup configuration.

## 18. Lifecycle and shutdown

### 18.1 Lazy startup

The native helper starts lazily on the first enabled `computer_health` probe or authorized computer operation.

A failed helper start moves the runtime to `unavailable` for that call. A later call may attempt a fresh start unless a permanent configuration error is known.

### 18.2 Shutdown order

Clean daemon shutdown order becomes conceptually:

```text
stop accepting new computer programs
-> cancel active JS runner
-> release held mouse/keyboard input
-> terminate JS runner process group
-> close native computer helper
-> existing process supervisor close
-> existing browser close
-> control server / transport close
```

The final exact order should preserve current shutdown tests and avoid leaving held input behind.

No startup sweep kills unrelated system processes.

## 19. macOS permissions and installation

The native helper requires normal macOS user permission appropriate to its capabilities, especially Accessibility and Screen Recording.

The helper must use a stable installed path and signing identity appropriate for the existing project development/deployment model so TCC permission behavior is predictable across daily-driver restarts.

Setup tooling should provide a doctor/readiness command that reports only categorical permission state and remediation guidance.

The implementation must not attempt to bypass or edit the TCC database.

## 20. Performance design goals

These are real-Mac acceptance goals rather than strict CI timing guarantees:

- warm `computer_health`: effectively immediate;
- AX-only `computer_observe`: target median under ~150 ms on ordinary native windows;
- screenshot capture: target under ~250 ms when the OS/capture path is warm;
- semantic target resolution from a current snapshot: target under ~50 ms locally;
- smooth long pointer move: normally under ~260 ms in `fast` mode;
- five simple local actions should execute without five MCP/LLM round trips;
- no OCR or full-screen capture when AX information already suffices.

Performance instrumentation may record durations and counts, never content.

## 21. Testing strategy

### 21.1 TypeScript unit tests

Cover at minimum:

1. disabled-by-default configuration;
2. strict computer tool schemas;
3. `computer_health` lease-free and categorical only;
4. every observation/action tool Admin-only;
5. `computer_run_js` requires explicit full-host-JS startup enablement;
6. native request serialization and timeout behavior;
7. malformed/oversized native responses fail closed;
8. action serialization prevents concurrent physical mutations;
9. typed action program bounds and cancellation;
10. target-not-found / ambiguous / stale snapshot mapping;
11. retry budgets stop deterministically;
12. raw native error text is not leaked;
13. audit excludes observations, typed text, JS source/output, screenshot data, and lease IDs;
14. JS runner timeout kills the owned runner/process group;
15. JS runner crash does not crash the daemon;
16. JS source is delivered without argv/environment leakage;
17. daemon shutdown releases inputs before helper termination;
18. Browser Runtime and ProcessSupervisor behavior remain unchanged.

### 21.2 Native Swift tests

Use protocol/logic tests and simulated host adapters where macOS permissions are unavailable in CI.

Cover at minimum:

1. Accessibility element normalization/redaction;
2. snapshot node/size bounds;
3. target resolution and stale snapshot behavior;
4. coordinate/display bounds;
5. pointer path generation starts/ends exactly at intended coordinates;
6. pointer duration clamps;
7. takeover detection interrupts movement;
8. held-input cleanup on every failure path;
9. focus verification;
10. screenshot bounds/encoding;
11. OCR result bounds;
12. protocol strictness and request correlation;
13. helper shutdown cleanup.

### 21.3 Integration tests

Add a harmless disposable native acceptance fixture app under tests/native or a purpose-built test fixture target. It should expose deterministic controls through Accessibility:

- buttons;
- text field;
- scrollable area;
- checkbox/state change;
- visible status text;
- optional custom-drawn region for visual/OCR fallback testing.

Tests should prove multi-step execution against this fixture without modifying user applications or files.

### 21.4 CI

Existing Node 22, Node 24, and macOS-native jobs remain required.

macOS-native CI additionally builds/tests the new Swift helper. Permission-dependent real capture/input tests remain manual/acceptance unless a safe CI harness is available.

## 22. Real-Mac acceptance

Acceptance is intentionally serious and evidence-driven.

### Phase A: readiness

1. exact `main` SHA and clean tree;
2. all CI green;
3. helper build/install succeeds;
4. `computer_health` reports enabled/readiness correctly;
5. Accessibility and Screen Recording permission state is verified.

### Phase B: deterministic native fixture

Using only a disposable local fixture app:

1. observe active window and semantic elements;
2. physically move pointer to a button and click;
3. verify state change rather than merely event emission;
4. type benign text and verify resulting UI state;
5. scroll and verify changed visible/AX state;
6. drag between known fixture targets;
7. execute a 10+ step `computer_run` in one MCP call;
8. inject one intentional stale target and verify bounded recovery;
9. force semantic lookup failure and verify OCR/explicit-coordinate fallback;
10. trigger user takeover and verify immediate input release.

### Phase C: full Node runner

1. run harmless JavaScript using normal Node `fs` read-only operations;
2. use the injected `computer` API from the same JS program;
3. execute condition + loop + retry logic locally;
4. spawn and clean up a harmless child process;
5. verify `process.exit()` kills only the JS runner;
6. verify timeout kills owned descendants and leaves daemon healthy;
7. verify daemon secrets are not inherited automatically;
8. verify script/output content does not enter audit.

### Phase D: real applications

Test a representative set such as Finder, TextEdit, Xcode, System Settings, and Chromium without destructive settings changes or account mutations.

Measure:

- observation latency;
- target accuracy;
- mouse movement quality;
- multi-step throughput;
- failure/recovery behavior;
- percentage of actions needing OCR/screenshot fallback.

### Phase E: ChatGPT Web E2E

From a fresh ChatGPT Web conversation through the installed plugin/tunnel:

```text
ChatGPT Web
-> chatgpt-system MCP
-> Admin lease
-> computer_observe
-> computer_run / computer_run_js
-> native helper
-> visible Mac action
-> verification result back to ChatGPT
```

Confirm that connected MCP/plugins can still be used by ChatGPT in the surrounding workflow.

## 23. Delivery slices

Implementation should be delivered in reviewable slices rather than one giant PR.

### Slice 1: native host foundation

- Swift helper package;
- protocol types;
- categorical health/readiness;
- app/window discovery;
- AX observation;
- screenshot;
- simulated/test adapters;
- setup/build integration.

### Slice 2: physical input and verification

- focus/open app;
- pointer trajectory;
- click/drag/scroll;
- keyboard/hotkeys;
- takeover/emergency stop;
- release-input cleanup;
- verification primitives.

### Slice 3: TypeScript ComputerRuntime + MCP

- helper supervisor/client;
- Admin policy;
- low-level tools;
- typed `computer_run`;
- output schemas/errors/audit;
- shutdown integration.

### Slice 4: full Node.js runner

- `--enable-full-host-js`;
- child runner supervisor;
- private computer RPC;
- `computer_run_js`;
- process-group timeout/cleanup;
- sanitized environment;
- output/audit limits.

### Slice 5: recovery/performance hardening

- observation cache/digests;
- OCR fallback;
- bounded retry ladder;
- stale target recovery;
- timing instrumentation;
- real-Mac performance tuning.

### Slice 6: acceptance and freeze

- disposable native fixture acceptance;
- Finder/TextEdit/Xcode/System Settings/Chromium smoke suite;
- ChatGPT Web E2E;
- evidence-driven bug fixes only;
- freeze the subsystem if speed/reliability meets acceptance goals.

Each slice uses TDD where practical, full repository verification, exact-head CI, PR review, merge, and post-merge CI before the next slice.

## 24. Definition of done

Computer Runtime v2 is complete when all of the following are true:

- ChatGPT can inspect the active Mac UI through bounded native observation;
- ChatGPT can visibly move the real pointer, click, drag, scroll, and type;
- simple native interactions are AX-first and do not require full screenshots/OCR;
- a single MCP call can execute many local actions;
- actions can verify UI effects and perform bounded local retry/fallback;
- `computer_run_js` can run normal full Node.js under explicit local-owner enablement while using the same computer API;
- a runner crash/timeout does not crash the daemon or leave held inputs;
- user takeover interrupts physical automation;
- full-host JS does not automatically inherit daemon/tunnel secrets;
- Browser Runtime remains the preferred browser semantic path and continues passing its existing tests;
- Node 22, Node 24, macOS-native CI and serious real-Mac acceptance are green;
- the ChatGPT Web -> plugin/tunnel -> local computer -> visible Mac action path is proven end-to-end;
- measured speed and reliability are good enough for daily use. If not, the subsystem is revised or removed rather than kept merely because it was expensive to build.
