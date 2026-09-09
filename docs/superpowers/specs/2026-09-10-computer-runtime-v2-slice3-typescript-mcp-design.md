# Computer Runtime v2 Slice 3: TypeScript Runtime + MCP Design

**Status:** Proposed for written user review
**Date:** 2026-09-10
**Branch:** `feat/computer-runtime-v2-typescript-mcp`
**Base:** `main@789c4a05a55310995fb0b2744dc8e7c17daf4408`
**Parent design:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`
**Roadmap:** `docs/superpowers/plans/2026-09-09-computer-runtime-v2-roadmap.md`

## 1. Goal

Slice 3 connects the already-merged native Computer Runtime v2 helper to the TypeScript `chatgpt-system` control plane and exposes a bounded, typed MCP surface.

The slice delivers:

- a dedicated TypeScript native-host supervisor and strict NDJSON client;
- explicit startup enablement for computer use;
- Admin-only policy for screen observation and host actuation;
- lease-free categorical `computer_health`;
- low-level `computer_*` MCP tools mapped to the existing native protocol;
- a typed multi-action `computer_run` fast path;
- stable TypeScript-side errors and output schemas;
- privacy-preserving computer audit metadata;
- stable daily-driver installation/signing for the native bundle;
- daemon shutdown integration;
- additive native health readiness for physical event listen/post permissions.

The slice does **not** add a second agent, planner, model, OCR engine, semantic target resolver, automatic recovery ladder, full-host JavaScript runner, or generic remote desktop service.

ChatGPT remains the reasoning layer. Computer Runtime remains deterministic execution infrastructure.

## 2. Risk posture: capable owner-trust, not capability paralysis

This runtime is intended for a privately controlled daily-driver Mac under explicit owner opt-in. Risk is real, but capability must not be destroyed in the name of pretending risk can be eliminated.

The design therefore distinguishes between two kinds of constraints.

### 2.1 Hard integrity and ownership boundaries

These remain strict because violating them makes the system unreliable or changes who controls the machine:

- computer use is disabled unless explicitly enabled at daemon startup;
- non-health computer tools require an active Admin lease;
- MCP cannot choose an executable path, signing identity, protocol version, event tag, takeover tolerance, or safety-disable flag;
- native request/response framing and correlation are strictly validated;
- TCC is never bypassed, edited, reset, or silently requested;
- user takeover and the fixed emergency chord remain active;
- helper crashes, malformed protocol, and outer timeouts fail the current operation rather than guessing;
- held input is best-effort released on failure, program finalization, and shutdown;
- no raw native stderr, typed text, screenshot bytes, lease IDs, or UI text enters audit metadata.

### 2.2 Owner-trust capabilities that remain available

Once the operator explicitly enables computer use and ChatGPT holds Admin authority, Slice 3 does **not** invent additional refusal policy merely because an action might be consequential.

In particular:

- `computer_type_text` may type into the currently focused application, including secure fields, if the caller explicitly requests it and supplies the required application selector;
- physical mouse/keyboard control is not restricted to an arbitrary allowlist of applications;
- coordinates are supported because many native/custom UIs do not expose useful semantics;
- `computer_run` may execute long typed action sequences up to configured bounds;
- raw `mouse_down` / `mouse_up` are allowed inside one bounded `computer_run` program, with unconditional program-final input cleanup;
- the system reports risk/state instead of hiding useful capability behind unrelated policy.

Browser Runtime keeps its separate credential-field refusal policy. Computer Runtime intentionally follows the owner-trust model approved for Computer Runtime v2.

## 3. Superseded Slice 3 details from the parent design

The parent Computer Runtime v2 design predated the accepted Slice 1 and Slice 2 implementation. The following details are superseded for Slice 3.

### 3.1 Stable bundle identity

The accepted and merged native bundle identity is authoritative:

```text
Bundle ID: com.senoldogann.chatgpt-system.computer-runtime
Bundle name: ChatGPTSystemComputerRuntime.app
Executable: chatgpt-system-computer-runtime
```

The older parent-design name `com.senoldogann.chatgpt-system.computer-host` / `ChatGPTSystemComputerHost.app` is not used.

Changing the accepted identity now would needlessly disrupt macOS privacy identity and TCC continuity.

### 3.2 Installed daily-driver path

The trusted default installed path is:

```text
~/.chatgpt-system/ChatGPTSystemComputerRuntime.app
```

The daemon derives the fixed executable path from that bundle:

```text
~/.chatgpt-system/ChatGPTSystemComputerRuntime.app/Contents/MacOS/chatgpt-system-computer-runtime
```

No MCP request may override this path.

### 3.3 Semantic target resolution and automatic recovery

Slice 3 does not pretend that the still-unimplemented semantic target/recovery layer exists.

Role/text/index target resolution, stale snapshot recovery, OCR-backed lookup, and the bounded semantic recovery ladder remain Slice 5 work.

Slice 3 exposes the already-proven native primitives directly and batches those primitives with `computer_run`.

## 4. Architecture

```text
ChatGPT / MCP client
        |
        v
MCP tool registration
        |
        v
AuthorityManager.resolve(lease)
        |
        v
ScopedComputerService --------------> metadata-only audit
        |
        v
ComputerRuntime
        |
        +--> typed direct actions
        +--> computer_run action program
        |
        v
ComputerNativeClient
        |
        v
ComputerNativeSupervisor
        |
        | spawn shell:false, stdio pipes
        v
~/.chatgpt-system/ChatGPTSystemComputerRuntime.app
        |
        v
existing Swift NDJSON host
```

There is exactly one existing `AuthorityManager`, one shared `RuntimeServices` object, one computer runtime, and one owned native helper child per daemon runtime.

No shadow authority manager, hidden second MCP server, TCP listener, Unix socket service, LaunchAgent-owned computer helper, or foreign-process sweep is introduced.

### 4.1 New focused TypeScript modules

```text
src/computer-types.ts
src/computer-errors.ts
src/computer-native-client.ts
src/computer-native-supervisor.ts
src/computer-runtime.ts
src/scoped-computer-service.ts
src/computer-tool-registration.ts
```

Responsibilities:

- `computer-types.ts`: shared domain/result/action-program types and constants;
- `computer-errors.ts`: allowlisted stable error codes/messages and safe normalization;
- `computer-native-client.ts`: strict request/response framing, correlation, validation and response decoding;
- `computer-native-supervisor.ts`: fixed child lifecycle, lazy start, crash handling, bounded diagnostics and close;
- `computer-runtime.ts`: direct operation methods, physical-action lane, typed `computer_run`, output limits and program finalization;
- `scoped-computer-service.ts`: Admin policy and privacy-safe audit wrapper;
- `computer-tool-registration.ts`: strict Zod schemas, MCP annotations, output schemas and image response handling.

`server.ts` wires these modules but does not become their implementation.

## 5. Configuration and feature gate

### 5.1 Explicit enablement

Computer use remains disabled by default.

CLI:

```text
--enable-computer-use
```

Environment/config plumbing may support the equivalent trusted startup configuration, but MCP itself cannot enable computer use.

Initial TypeScript config shape:

```ts
computerUse: {
  enabled: boolean;
  hostBundlePath: string;
  requestTimeoutMs: number;
  maxObservationElements: number;
  maxObservationChars: number;
  maxScreenshotBytes: number;
  maxActionProgramActions: number;
  maxActionProgramRuntimeMs: number;
}
```

Initial defaults:

```text
enabled = false
hostBundlePath = ~/.chatgpt-system/ChatGPTSystemComputerRuntime.app
requestTimeoutMs = 10000
maxObservationElements = 500
maxObservationChars = 262144
maxScreenshotBytes = 8388608
maxActionProgramActions = 100
maxActionProgramRuntimeMs = 30000
```

These limits are startup/operator configuration. MCP may request smaller operation timeouts where the native protocol supports them, but may not raise configured ceilings.

### 5.2 Capabilities reporting

`system_capabilities` gains only categorical state:

```json
{
  "computerUse": {
    "enabled": true,
    "fullHostJsEnabled": false
  }
}
```

The installed helper path, signing identity, request IDs and private runtime diagnostics are not exposed through this tool.

`fullHostJsEnabled` remains `false` in Slice 3. Slice 4 owns that feature gate.

## 6. Authority and policy

### 6.1 Lease-free health

`computer_health` requires no lease because it returns only categorical readiness and permission state.

When computer use is disabled, `computer_health` returns disabled state without spawning the helper.

When enabled, the first health call may lazily launch the fixed installed helper and query its native health result.

### 6.2 Admin-only observation and actuation

Every other `computer_*` tool requires an active Admin lease.

The call path is:

```text
authorityLeaseId
  -> runtime.authority.resolve(...)
  -> createScopedRuntime(...)
  -> ScopedComputerService(adminEnabled = authority.profile === "admin")
```

Project and User authority fail before the native host receives the request.

Tool annotations are descriptive hints for MCP clients, not an authorization mechanism.

### 6.3 No extra application allowlist

Slice 3 does not add an application allowlist. Once computer use is explicitly enabled and an Admin lease is active, the operator has opted into real host control.

## 7. Native helper lifecycle

### 7.1 Dedicated supervisor

The helper is not placed in the existing generic `ProcessSupervisor` registry.

`ProcessSupervisor` is designed for user-requested allowlisted managed processes. The computer helper is a protocol-owned infrastructure child whose stdin/stdout are private RPC channels.

A dedicated `ComputerNativeSupervisor` keeps these semantics separate while still living inside the same `RuntimeServices` object.

### 7.2 Spawn contract

The supervisor launches only the fixed installed executable with Node `child_process.spawn()`:

```ts
spawn(executablePath, [], {
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
});
```

The helper receives no authority lease and no MCP-controlled executable path.

### 7.3 State machine

```text
disabled
stopped
starting
running
unavailable
closing
```

Key semantics:

- disabled state never spawns;
- enabled state starts lazily;
- concurrent first callers coalesce on one start attempt;
- only one live owned helper exists per runtime;
- a child crash fails all currently pending native requests;
- later calls may start a fresh helper;
- restart attempts are bounded and never spin in a tight loop;
- `close()` is idempotent and prevents new starts once shutdown begins.

### 7.4 Bounded stderr diagnostics

Native stderr may be held in a small bounded in-memory diagnostic tail for local debugging only.

It is never copied into:

- MCP results;
- MCP errors;
- audit records;
- `system_capabilities`;
- `computer_health`.

## 8. Native protocol client

### 8.1 Existing wire contract

The Swift host already uses protocol version 1 and strict newline-delimited JSON:

```ts
{
  protocolVersion: 1,
  requestId: string,
  method: string,
  params: object
}
```

Responses:

```ts
{
  protocolVersion: 1,
  requestId: string,
  ok: boolean,
  result?: unknown,
  error?: {
    code: string,
    message: string,
    details?: object
  }
}
```

### 8.2 Frame limits

TypeScript mirrors the accepted native limits:

```text
max request line bytes = 262144
max response bytes = 12582912
```

TypeScript also re-checks narrower domain limits such as screenshot bytes and observation characters before returning MCP output.

### 8.3 Request IDs and correlation

The client creates cryptographically random opaque request IDs.

A response is accepted only when:

- protocol version is exactly 1;
- response shape is valid;
- request ID matches exactly one currently pending request;
- there is no duplicate terminal response;
- the response is within the frame limit.

Unknown/unsolicited/duplicate request IDs, malformed UTF-8/JSON, invalid response shape, or oversized output mark the current helper stream as protocol-corrupt. The supervisor closes that child and pending calls fail with a stable TypeScript error.

### 8.4 Error messages are TypeScript-owned

Native error `code` is interpreted only if it belongs to the allowlisted stable Computer Runtime error set.

Native `message`, raw exception text, AX text and stderr are not trusted as MCP-safe strings.

TypeScript maps allowlisted codes to fixed public messages.

Unknown native codes become protocol/unavailable failure rather than being blindly surfaced.

### 8.5 Timeout model

The native protocol remains responsible for operation-specific focus/verification timeouts.

TypeScript adds an outer failsafe request timeout. The effective outer timeout is bounded by startup configuration and, for `computer_run`, by the remaining program deadline.

If the outer timeout fires, the current helper child is considered unsafe to reuse because the daemon cannot prove where the timed-out request stopped. The child is closed and later calls may start a clean helper.

## 9. Native health readiness extension

Slice 2 health currently reports:

```text
state
accessibilityTrusted
screenCaptureAuthorized
```

Slice 3 adds two passive categorical fields to native protocol v1:

```text
eventListenAuthorized
eventPostAuthorized
```

They use passive CoreGraphics preflight checks only.

No `CGRequestListenEventAccess`, `CGRequestPostEventAccess`, TCC database edit, reset, prompt automation, or bypass is added.

The goal is honest readiness reporting before the first physical action.

MCP `computer_health` result:

```ts
{
  enabled: boolean;
  state: "disabled" | "stopped" | "running" | "unavailable";
  accessibilityTrusted: boolean;
  screenCaptureAuthorized: boolean;
  eventListenAuthorized: boolean;
  eventPostAuthorized: boolean;
  fullHostJsEnabled: false;
}
```

Disabled/unavailable states use false categorical permission fields if no trusted native reading is available. They do not fabricate readiness.

## 10. Physical action lane

The Mac has one physical mouse and keyboard.

TypeScript therefore owns one FIFO physical-action lane for MCP-visible mutations.

The following direct operations take the lane:

```text
open_app
focus_app
move_mouse
click
drag
scroll
type_text
press_key
release_inputs
computer_run
```

Read-only observations and waits do not need the TypeScript physical lane unless they are executed as steps inside a `computer_run` program that already owns the lane.

`computer_run` acquires the lane once and keeps it until program finalization. This prevents another physical MCP action from interleaving between its steps.

The native helper keeps its own existing physical serialization and takeover protection. The TypeScript lane is an additional orchestration boundary, not a replacement for native safety.

## 11. Direct MCP surface

### 11.1 Health and observation

```text
computer_health
computer_observe
computer_screenshot
computer_pointer_position
```

`computer_health` is lease-free.

The remaining tools require Admin authority.

### 11.2 Application and physical operations

```text
computer_open_app
computer_focus_app
computer_move_mouse
computer_click
computer_drag
computer_scroll
computer_type_text
computer_press_key
computer_release_inputs
```

### 11.3 Wait primitives

```text
computer_wait_for_frontmost
computer_wait_for_text
computer_wait_until_changed
```

These expose the already-implemented deterministic native verification primitives.

### 11.4 Deliberately absent direct hold tools

Direct MCP does not expose `computer_mouse_down` or `computer_mouse_up` in Slice 3.

This avoids cross-request held-input state if a client disappears or the helper crashes.

The same native primitives remain usable inside `computer_run`, where program-final cleanup is guaranteed.

### 11.5 Click count

`computer_click` uses a bounded count:

```text
count: 1 | 2
```

Count 1 maps to native `click`; count 2 maps to native `double_click`.

A separate `computer_double_click` catalog entry is unnecessary.

## 12. Strict MCP input model

MCP schemas mirror the accepted native contract rather than inventing a second vocabulary.

Representative shapes:

```ts
type AppSelector = {
  bundleIdentifier?: string;
  name?: string;
};

type Verification =
  | { kind: "ax_changed"; timeoutMs?: number }
  | { kind: "text_appeared"; text: string; exact?: boolean; timeoutMs?: number }
  | {
      kind: "screen_region_changed";
      x: number;
      y: number;
      width: number;
      height: number;
      timeoutMs?: number;
    };
```

The same native bounds remain authoritative:

- application selectors are bounded;
- typed text is bounded to the accepted native maximum;
- verification timeout stays within the native accepted range;
- scroll deltas stay within the native accepted range;
- pointer motion mode is `instant | fast | natural`;
- coordinates must be finite and are ultimately validated against native display topology;
- unknown fields are rejected.

TypeScript may reject invalid input earlier, but it never weakens the native validation layer.

## 13. `computer_run` typed fast path

### 13.1 Purpose

`computer_run` removes repeated MCP/model round trips for deterministic local sequences.

It is a typed executor, not an autonomous agent.

### 13.2 Initial action vocabulary

```text
observe
pointer_position
open_app
focus_app
move_mouse
click
double_click
mouse_down
mouse_up
drag
scroll
type_text
press_key
wait
wait_for_frontmost
wait_for_text
wait_until_changed
release_inputs
```

`screenshot` is intentionally absent from the first batch vocabulary. Direct `computer_screenshot` remains available. Batch screenshot embedding adds large image transport without helping Slice 3 deterministic recovery; Slice 5 may revisit this when visual/OCR recovery exists.

### 13.3 Raw hold actions inside a run

`mouse_down` and `mouse_up` are permitted only inside one `computer_run` program.

The runtime tracks whether the program used a hold-capable action and **always** performs best-effort `release_inputs` during finalization, on success or failure.

A program cannot intentionally leave a mouse button or modifier held after the MCP call returns.

This keeps advanced low-level sequences possible without creating cross-request input state.

### 13.4 Program bounds

Default maximums:

```text
maxActionProgramActions = 100
maxActionProgramRuntimeMs = 30000
```

Input may request smaller limits/timeouts where defined, but cannot raise startup ceilings.

### 13.5 No automatic retry in Slice 3

Slice 3 does not automatically replay failed actions.

Without semantic re-resolution, automatic retry can duplicate side effects such as double typing, repeated clicks or repeated application commands.

If the caller wants an explicit deterministic repeat, it can place repeated actions in the typed program itself.

Semantic retry/recovery belongs to Slice 5.

### 13.6 Execution model

The program:

1. validates the complete action array before physical execution starts;
2. acquires the TypeScript physical lane;
3. establishes one absolute program deadline;
4. executes actions in order;
5. clamps each native request to the remaining program budget;
6. stops on the first failed step;
7. finalizes with best-effort `release_inputs` if any physical/hold-capable work occurred;
8. releases the TypeScript physical lane;
9. returns a bounded result or stable tool error.

### 13.7 Atomic lane, not transactional rollback

`computer_run` is atomic only with respect to physical-action interleaving.

It is **not** a transactional UI rollback system. If step 4 clicked a button and step 5 later fails, the click may already have happened.

The API never claims that completed UI side effects were undone.

### 13.8 Final observation

The caller may choose a bounded final observation mode:

```text
finalObservation: "none" | "active_window" | "observe"
```

Default:

```text
"observe"
```

This preserves the parent design's verified-result bias while allowing latency-sensitive callers to choose `none` when the program's own native verification steps are sufficient.

A final-observation failure does not cause the runtime to replay already-completed mutations. The successful mutation history remains reported and the result is marked as unverified/final-observation-failed.

## 14. `computer_run` output

Successful result shape is bounded and content-aware:

```ts
{
  state: "completed" | "completed_unverified";
  completedCount: number;
  actionCount: number;
  steps: Array<{
    index: number;
    type: string;
    state: "completed";
    summary?: object;
  }>;
  finalObservation?: object;
}
```

Step summaries never echo typed text.

Raw coordinates do not need to be echoed back if the native result does not require them.

If a program step fails, the MCP tool returns `isError: true` with a stable computer error. Safe details may include:

```text
failedStepIndex
failedActionType
completedCount
actionCount
```

Failure details never include:

- typed text;
- AX/UI text;
- screenshot pixels/base64;
- native stderr;
- request IDs;
- lease IDs;
- secret environment values.

## 15. MCP output handling

### 15.1 Structured success

All non-image success results define strict output schemas and return:

- `structuredContent` conforming to the output schema;
- the same result serialized in one TextContent block for compatibility.

### 15.2 Tool errors

Computer operation failures are MCP tool-result failures with:

```text
isError: true
```

They are not converted into fake successful structured results.

Protocol-level MCP errors remain reserved for actual MCP protocol/registration failures.

### 15.3 Screenshot result

`computer_screenshot` returns PNG as MCP image content.

`structuredContent` contains only bounded metadata such as:

```ts
{
  width: number;
  height: number;
}
```

TypeScript re-validates decoded PNG byte length against `maxScreenshotBytes` before returning it.

The PNG is not duplicated into structured JSON.

## 16. Stable Computer Runtime errors

Slice 3 exposes the relevant existing stable codes:

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
POLICY_DENIED
```

Not every code must be produced in Slice 3. For example stale-snapshot/replan become materially useful with Slice 5 semantic recovery.

JS-specific codes remain Slice 4:

```text
COMPUTER_JS_DISABLED
COMPUTER_JS_FAILED
COMPUTER_JS_TIMEOUT
```

Public error messages are fixed TypeScript-owned strings.

Native message text is never blindly forwarded.

## 17. Audit design

### 17.1 Dedicated safe audit wrapper

Computer Runtime does not directly use the current generic `AuditLogger.run()` error-message behavior for computer operations because that helper records thrown error messages.

`ScopedComputerService` records only explicitly constructed safe metadata.

### 17.2 Audit actions

Examples:

```text
computer.health
computer.observe
computer.screenshot
computer.open_app
computer.focus_app
computer.pointer_position
computer.move_mouse
computer.click
computer.drag
computer.scroll
computer.type_text
computer.press_key
computer.release_inputs
computer.wait_for_frontmost
computer.wait_for_text
computer.wait_until_changed
computer.run
```

### 17.3 Allowed metadata

```text
durationMs
outcome
stable errorCode when present
safe action category
actionCount for computer_run
completedCount for computer_run
failedActionType when useful
safe application bundle identifier when explicitly supplied and useful
```

### 17.4 Forbidden audit content

Never audit:

- typed text;
- current editable/secure field values;
- screenshot bytes;
- AX/UI document text;
- wait-for-text search strings;
- native request IDs;
- lease IDs;
- native stderr;
- raw native exception/error messages;
- signing private-key material;
- environment values;
- raw coordinates unless a future concrete diagnostic need is reviewed separately.

## 18. Daily-driver bundle signing and installation

### 18.1 Why ad-hoc is not the daily-driver default

The accepted Slice 1/2 staging bundle is ad-hoc signed for CI and disposable local acceptance. Its current designated requirement is cdhash-based, which binds identity to a specific build.

macOS uses a code signature's designated requirement to determine whether updated code is the same previously authorized application for privacy-protected resources.

Therefore repeated ad-hoc daily-driver replacements would make TCC continuity fragile.

### 18.2 Stable signing identity

Daily-driver installation uses a persistent Code Signing identity from the user's login Keychain.

Selection order:

1. an explicitly supplied valid Code Signing identity;
2. the valid identity matching the currently installed Computer Runtime signer, when reusable;
3. a single unambiguous suitable Apple Development / Developer ID identity;
4. otherwise fail the stable-install path with clear setup guidance.

No signing identity is accepted from MCP input.

### 18.3 Local self-signed identity

A dedicated local Code Signing certificate is supported for private development/daily-driver use when the operator has no Apple Development identity.

Slice 3 does not generate private-key material through ad-hoc Node/OpenSSL temporary files. The operator creates the identity once through the macOS Keychain certificate flow, after which setup can discover and reuse it.

### 18.4 Explicit development ad-hoc override

To avoid turning a reliability default into arbitrary capability denial, setup may support an explicit development-only ad-hoc install override.

That mode:

- is never the silent fallback;
- clearly reports `tccIdentityStable: false`;
- may require TCC permission to be granted again after rebuilds;
- is suitable for disposable testing, not the recommended daily-driver path.

### 18.5 Atomic install path

New script:

```text
scripts/setup-macos-computer-runtime.mjs
```

Package command:

```text
npm run setup:computer:macos
```

The installer:

1. builds the release native helper;
2. packages the fixed bundle identity;
3. signs using the selected stable identity unless explicit development ad-hoc mode is requested;
4. verifies strict code signature;
5. verifies exact bundle identifier and executable name;
6. inspects the new designated requirement;
7. if an installed bundle exists, verifies compatible signer/identity expectations before replacement;
8. atomically replaces the installed bundle under `~/.chatgpt-system/`;
9. re-verifies the installed bundle after replacement;
10. prints categorical TCC readiness without requesting or bypassing permission.

No app bundle is installed from an untrusted arbitrary MCP path.

## 19. ChatGPT tunnel/setup integration

`setup-chatgpt-tunnel.mjs` gains:

```text
--enable-computer-use
```

When present, generated MCP command includes the same daemon flag.

Before claiming the profile is ready, setup verifies on macOS that the fixed installed Computer Runtime bundle:

- exists;
- has the expected bundle identifier;
- contains the expected executable;
- has a valid code signature;
- is runnable/readable by the current user.

Setup does not start clicking or typing as a doctor step.

Physical acceptance remains explicit real-Mac testing.

## 20. Shutdown ordering

`closeRuntimeResources()` gains a `computer` phase before generic managed processes and browser shutdown.

Order:

```text
reject new computer calls
-> stop computer_run before the next step
-> best-effort native release_inputs
-> request native host shutdown / close stdin
-> bounded graceful child exit
-> terminate owned native child if still alive
-> existing ProcessSupervisor close
-> Browser Runtime close
-> control server close
-> transport close
```

Shutdown is best-effort across phases: one cleanup failure is reported but does not prevent later cleanup phases from running.

No startup sweep scans or kills foreign processes.

## 21. Testing strategy

### 21.1 TypeScript unit tests

Must cover:

1. computer use disabled by default;
2. `--enable-computer-use` config/CLI parsing;
3. lease-free health with no spawn while disabled;
4. enabled health lazy-start behavior;
5. Project/User denial before native request;
6. Admin success path;
7. no shadow authority manager/runtime;
8. fixed helper executable path not MCP-controlled;
9. spawn uses `shell:false` and private stdio pipes;
10. concurrent lazy starts coalesce;
11. request IDs are opaque and correlate correctly;
12. request frame size enforcement;
13. response frame size enforcement;
14. malformed JSON/UTF-8/shape fails closed;
15. wrong/duplicate/unknown request ID poisons the child;
16. protocol version mismatch poisons the child;
17. native unknown error code is not leaked;
18. native raw message/stderr is not leaked;
19. outer timeout closes poisoned child;
20. later call can restart after a crash;
21. close is idempotent and prevents restart during shutdown;
22. physical direct actions serialize;
23. observations do not unnecessarily take the physical lane;
24. `computer_run` keeps one lane across all steps;
25. full action array validates before execution;
26. max action count enforced;
27. absolute program runtime bound enforced;
28. per-step timeout clamps to remaining program deadline;
29. no automatic retry occurs;
30. run stops at first failure;
31. completed mutation history is not falsely rolled back;
32. `mouse_down/up` allowed only inside run;
33. run finalizer calls `release_inputs` after hold-capable/physical work on success and failure;
34. final observation `none|active_window|observe` semantics;
35. direct screenshot returns image content plus metadata only;
36. TypeScript re-checks screenshot byte bound;
37. strict tool schemas reject unknown fields;
38. MCP annotations describe but do not replace policy;
39. tool failures use `isError:true`;
40. successful structured outputs satisfy output schemas;
41. typed text absent from result summaries and audit;
42. wait text absent from audit;
43. coordinates absent from audit;
44. request/lease IDs absent from audit;
45. native stderr/raw error absent from audit;
46. existing Browser Runtime tests remain green;
47. existing managed Process tests remain green;
48. runtime shutdown order runs computer before process/browser;
49. setup/tunnel flag propagation is exact;
50. stable signing installer planning is deterministic and rejects silent ad-hoc fallback.

### 21.2 Swift tests

Only additive Slice 3 native behavior is required:

1. health includes event-listen passive preflight state;
2. health includes event-post passive preflight state;
3. no CGRequest permission API is introduced;
4. existing 116+ native tests remain green;
5. protocol v1 remains backward-compatible for existing methods.

### 21.3 Packaging/setup tests

Must cover:

- fixed bundle identity;
- fixed installed default path;
- stable signing identity selection logic;
- explicit development ad-hoc mode is opt-in only;
- no silent ad-hoc fallback;
- signature validation;
- installed-bundle identity checks;
- atomic replacement planning;
- tunnel setup refuses to claim computer readiness when enabled but installed helper is missing/untrusted.

## 22. CI

Mandatory PR and post-merge CI remain:

```text
test (22)
test (24)
macos-native
```

CI may continue to package/sign disposable helper artifacts ad-hoc because CI does not need persistent TCC identity across builds.

CI must not perform real physical mouse/keyboard actions on the runner.

The macOS-native job verifies:

- Swift tests;
- release build;
- staged runtime bundle contract;
- strict ad-hoc CI codesign contract;
- protocol health contract;
- additive health readiness schema.

Node jobs verify TypeScript supervisor/client/runtime/MCP/config/setup behavior with injected fake native children where practical.

## 23. Real-Mac Slice 3 acceptance

Before merge, use the installed/staged helper against the deterministic fixture without restarting the daily-driver tunnel unnecessarily.

Acceptance includes:

1. installer produces fixed bundle ID/path with stable signing identity when available;
2. designated requirement is not cdhash-only in stable mode;
3. TCC readiness is reported categorically;
4. direct TypeScript client health succeeds;
5. helper crash during a request fails current call and later call restarts cleanly;
6. direct observe succeeds through TypeScript;
7. direct screenshot returns valid bounded image content;
8. direct open/focus works;
9. direct move/click/type/press/scroll/drag work against fixture;
10. direct wait primitives verify fixture changes;
11. at least one 10+ step `computer_run` completes in one runtime call;
12. one `computer_run` uses `mouse_down/up` safely and final release leaves no held input;
13. intentional failed step stops the program without replay;
14. intentional outer timeout causes child replacement and later health recovery;
15. physical user takeover returns `COMPUTER_USER_TAKEOVER` and cleanup remains healthy;
16. fixed emergency chord still interrupts active physical action;
17. audit inspection proves typed text, wait text, coordinates, request IDs, lease IDs and native stderr are absent.

Fresh ChatGPT Web end-to-end remains primarily Slice 6 acceptance, but Slice 3 may use a controlled fresh tunnel restart after merge if needed to confirm the new MCP catalog is visible. Do not restart the user's daily driver merely to satisfy a local unit-test ceremony.

## 24. Delivery and merge gate

Slice 3 starts from exact accepted Slice 2 `main`:

```text
789c4a05a55310995fb0b2744dc8e7c17daf4408
```

Implementation uses TDD RED -> GREEN where behavior is testable.

Before PR merge:

- full Node check is green locally;
- native Swift tests/build are green;
- computer package/setup contract tests are green;
- `git diff --check` is green;
- privacy/scope greps show no Slice 4/5 leakage;
- direct code review has no unresolved Critical/Important findings;
- real-Mac Slice 3 acceptance is green for behaviors requiring macOS/TCC;
- exact-head `test (22)`, `test (24)`, and `macos-native` PR CI are green.

Merge must match the reviewed exact PR head.

After squash merge, exact merge SHA `main` CI must show the same three required jobs green before Slice 4 begins.

## 25. Explicit non-goals for Slice 3

Do not add:

- `computer_run_js`;
- full-host Node runner;
- arbitrary JS evaluation;
- generic shell/child-process access through Computer Runtime;
- Vision OCR;
- role/text/index semantic target resolver;
- stale-snapshot automatic re-resolution;
- automatic action retry ladder;
- autonomous local planner/OODA loop;
- background jobs that outlive daemon ownership;
- computer TCP/Unix socket listener;
- a second authority system;
- raw AX pointer or OS PID exposure;
- new TCC bypass/request behavior;
- arbitrary MCP-selected helper paths;
- hidden anti-detection/random input behavior.

## 26. External research notes

This design was checked against current official documentation before implementation planning:

- Node.js `child_process.spawn()` supports parent-owned pipe stdio, `shell:false`, timeout/AbortSignal lifecycle controls suitable for the dedicated helper supervisor.
- Model Context Protocol tool results support `structuredContent`, `outputSchema`, image content and `isError`; tool-originated failures should be reported as tool results with `isError:true`, while annotations are descriptive metadata rather than authorization.
- Apple code-signing documentation states that the designated requirement identifies whether a later version is considered the same code, and Apple specifically notes that macOS privacy-protected resource tracking relies on code-signature identity/DR compatibility. A cdhash-only DR is version-specific, so it is not the recommended daily-driver signing identity.

## 27. Definition of done for Slice 3

Slice 3 is complete when:

- computer use is explicitly opt-in and honestly reported;
- the TypeScript daemon owns one strict, restartable native helper child;
- malformed/oversized/mismatched native protocol fails closed without leaking diagnostics;
- `computer_health` works without a lease and reports physical readiness categorically;
- all other computer tools require real Admin authority;
- direct native observation and physical actions are available through MCP without invented application allowlists;
- `computer_run` executes bounded typed multi-action programs under one physical lane;
- low-level hold actions are available inside a run but cannot persist after the run returns;
- no automatic retry duplicates UI side effects;
- screenshot output is bounded and transported as image content rather than duplicated JSON;
- audit contains useful metadata but no typed/UI/screenshot/request/lease secret-bearing content;
- stable daily-driver signing/install preserves native app identity across rebuilds by default while explicit development ad-hoc use remains possible;
- shutdown releases input and closes the helper before generic process/browser shutdown;
- existing Browser Runtime and managed-process behavior remain green;
- Node 22/24 and macOS-native exact-head CI are green;
- real-Mac acceptance proves the TypeScript layer controls the accepted native helper reliably.
