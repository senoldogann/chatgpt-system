# Computer Runtime v2 Slice 2 Physical Input + Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the accepted Slice 1 native macOS helper with deterministic app focus/open, serialized visible pointer movement, mouse/scroll/keyboard actuation, held-input cleanup, user takeover/emergency-stop safety, and bounded AX/screen verification primitives without adding MCP/TypeScript integration.

**Architecture:** Keep `ComputerRuntimeCore` free of AppKit/CoreGraphics side effects and add only safe Codable request/result types there. Put all physical behavior behind injectable `ComputerRuntimeHostCore` protocols, with one explicit async action lane that remains held across sleeps/awaits, a pure pointer trajectory generator, a runtime-owned CGEvent tag, a listen-only takeover monitor, and a separate verification engine. `ComputerHostService` continues to own strict protocol-v1 dispatch but delegates Slice 2 methods to a focused `ComputerActionService`; the executable remains inherited-stdio only and releases held inputs on EOF/error shutdown.

**Tech Stack:** Swift 6, SwiftPM, macOS 14+, Foundation, AppKit/NSWorkspace/NSRunningApplication, CoreGraphics/Quartz events and display geometry, ScreenCaptureKit, CryptoKit, Carbon key-code constants for centralized mapping, Vitest/Node for bundle-plan tests, GitHub Actions macOS CI.

**Spec:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`

## Global Constraints

- Slice 2 starts from `origin/main@6748ca76303512fd30d86450fcaff2f3c0abe56b` and preserves the accepted Slice 1 protocol/bundle behavior.
- Protocol version remains exactly `1`; new native methods are additive and use the existing strict bounded NDJSON parent-owned stdin/stdout transport.
- Request line remains `262144` bytes; response line remains `12582912` bytes.
- Existing fixed helper bundle identity remains `com.senoldogann.chatgpt-system.computer-runtime`; do not change it.
- No `computer_*` MCP registration, TypeScript ComputerRuntime supervisor, `computer_run`, `computer_run_js`, full Node runner, OCR, semantic recovery ladder, job queue, root/sudo, arbitrary executable path, arbitrary process spawn, shell, TCP listener, or Unix socket is added in this slice.
- ChatGPT remains the only reasoning agent. The native helper implements deterministic PERCEIVE -> RESOLVE -> ACT -> VERIFY primitives only.
- All physical mutations pass through one action lane. Read-only observation/pointer queries may bypass the lane.
- Every action that can leave a mouse button/key/modifier held must release all held inputs after failure, cancellation, takeover, emergency stop, server EOF, or server error.
- Pointer targets are never clamped into range. A point must be finite and contained in at least one current active-display `CGDisplayBounds`; otherwise fail closed.
- Default pointer mode is `fast`; supported modes are `instant`, `fast`, `natural`. `fast` is deterministic smooth motion with exact endpoint and no random anti-bot jitter.
- Own synthetic CGEvents carry one centralized 64-bit `kCGEventSourceUserData` tag. The takeover monitor ignores that tag.
- Takeover tolerance is fixed at 18 logical pixels in Slice 2 and is not request-controlled.
- The emergency chord is fixed at `Control + Option + Command + Escape` and is not request-controlled or disableable.
- No TCC request/prompt API is called by physical methods or monitors. `CGRequestListenEventAccess`, `CGRequestPostEventAccess`, and other permission-request APIs are forbidden.
- Pre-implementation API/TCC evidence on the target Mac: Accessibility trusted=true, `CGPreflightListenEventAccess()`=true, `CGPreflightPostEventAccess()`=true, a listen-only `CGEventTap` can be created, and `RegisterEventHotKey(Control+Option+Command+Escape)` registers/unregisters successfully. Apple DTS documents Accessibility as granting event posting and listening while Input Monitoring grants listening only. If the **packaged helper identity** later cannot create the required listen-only tap without a new TCC grant, stop implementation/acceptance and report the architecture deviation instead of prompting for a new permission.
- Slice 1 privacy invariants remain: zero `kAXValueAttribute`, no PID/raw AX identity/editable current value in public models, no raw native error text in stable protocol errors, and screenshot pixels stay in memory.
- Typed text, key contents, screenshots, AX content, and raw coordinates are never written to stderr/logging by the native helper.

---

## Locked Slice 2 file structure

Existing Slice 1 files remain. Slice 2 adds these focused units:

```text
native/macos-computer-runtime/
  Sources/
    ComputerRuntimeCore/
      InputModels.swift
    ComputerRuntimeHostCore/
      InputProtocols.swift
      PointerTrajectory.swift
      PhysicalActionLane.swift
      ComputerInputController.swift
      ComputerActionService.swift
      SystemDisplayTopology.swift
      SystemInputEvents.swift
      SystemWorkspaceController.swift
      KeyMapping.swift
      InputSafetyCoordinator.swift
      SystemTakeoverMonitor.swift
      ComputerVerification.swift
      SystemScreenRegionDigest.swift
    ComputerRuntimeFixture/
      main.swift
      FixtureAppDelegate.swift
      FixtureInteractionView.swift
  Tests/
    ComputerRuntimeHostCoreTests/
      PointerTrajectoryTests.swift
      InputControllerTests.swift
      AppControlTests.swift
      MouseActionTests.swift
      KeyboardActionTests.swift
      InputSafetyTests.swift
      VerificationTests.swift
      ShutdownInputTests.swift

scripts/
  package-macos-computer-runtime-fixture.mjs

tests/
  macos-computer-runtime-fixture-package.test.ts
```

Responsibilities:

- `InputModels.swift`: safe Codable point/motion/button/key/app selector/action result/verification types only; no PID, CGEvent, AX object, or editable value.
- `InputProtocols.swift`: injectable host-side effects (`InputEventSink`, pointer/display/app/focus readers, sleeper, region digest source) and internal event vocabulary.
- `PointerTrajectory.swift`: pure deterministic geometry/timing generation.
- `PhysicalActionLane.swift`: explicit FIFO async mutex so action exclusivity survives actor/task suspension.
- `ComputerInputController.swift`: serialized pointer/mouse/scroll/keyboard mutations plus held-input state and cleanup.
- `ComputerActionService.swift`: strict method-specific params, stable error mapping, app control, optional verification, and native action dispatch.
- `SystemDisplayTopology.swift`: CoreGraphics pointer position and active display bounds.
- `SystemInputEvents.swift`: CoreGraphics event creation/posting and fixed source tag only.
- `SystemWorkspaceController.swift`: bundle-id-first app resolve/open/activate/frontmost verification through AppKit.
- `KeyMapping.swift`: one centralized macOS virtual-key map and deterministic modifier order.
- `InputSafetyCoordinator.swift`: lock-protected action/takeover/emergency state independent of event-tap implementation.
- `SystemTakeoverMonitor.swift`: one listen-only CGEventTap run-loop monitor; no TCC prompts; ignores runtime-owned events.
- `ComputerVerification.swift`: AX digest/text/focus/frontmost bounded waits without OCR/cache/recovery ladder.
- `SystemScreenRegionDigest.swift`: bounded ScreenCaptureKit region digest for verification only; pixels never leave the helper.
- `ComputerRuntimeFixture/*`: harmless visible AppKit fixture used only for local acceptance.

---

### Task 1: Commit the Slice 2 implementation plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-09-computer-runtime-v2-slice2-physical-input-verification.md`

**Interfaces:**
- Consumes: approved design and roadmap.
- Produces: exact task/file/interface/TDD/acceptance/commit contract for Tasks 2-8.

- [ ] **Step 1: Self-review spec coverage**

Confirm the plan explicitly covers all of these Slice 2 requirements:

```text
open/focus app
pointer position
instant/fast/natural exact-endpoint motion
single physical action lane
display bounds fail-closed
click/double-click/mouse down/up
drag with guaranteed release
vertical/horizontal bounded scroll
Unicode typing
single key + modifier chord
held-input cleanup on error/cancel/EOF/shutdown
tagged synthetic events
user takeover
fixed emergency chord
frontmost/focus/AX/text/screen-region verification
strict protocol v1 params/error redaction
real fixture acceptance
privacy/bundle/CI/exact-head merge gates
```

- [ ] **Step 2: Placeholder/type scan**

Run:

```bash
rg -n 'T[B]D|T[O]DO|implement[ ]later|fill[ ]in|appropriate[ ]error[ ]handling|similar[ ]to[ ]Task' docs/superpowers/plans/2026-09-09-computer-runtime-v2-slice2-physical-input-verification.md
```

Expected: zero matches.

Then read every interface name used by a later task and confirm it is introduced by an earlier task.

- [ ] **Step 3: Verify only the plan changed**

```bash
git status --short
git diff --check
git diff -- docs/superpowers/plans/2026-09-09-computer-runtime-v2-slice2-physical-input-verification.md
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-09-computer-runtime-v2-slice2-physical-input-verification.md
git commit -m "docs: plan Computer Runtime v2 physical input slice"
```

---

### Task 2: Input core, display bounds, physical action lane, and pointer trajectory

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/InputModels.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputProtocols.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/PointerTrajectory.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/PhysicalActionLane.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerInputController.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemDisplayTopology.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemInputEvents.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/PointerTrajectoryTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/InputControllerTests.swift`

**Interfaces:**
- Produces safe protocol types:

```swift
public struct ComputerPoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
}

public enum PointerMotionMode: String, Codable, Equatable, Sendable {
    case instant, fast, natural
}

public enum ComputerMouseButton: String, Codable, Equatable, Sendable {
    case left, right, middle
}

public enum ComputerKeyModifier: String, Codable, Equatable, CaseIterable, Sendable {
    case control, option, shift, command
}

public struct ComputerApplicationSelector: Codable, Equatable, Sendable {
    public let bundleIdentifier: String?
    public let name: String?
}

public struct ComputerActionResult: Codable, Equatable, Sendable {
    public let state: String       // "completed"
    public let pointer: ComputerPoint?
    public let changed: Bool?
}
```

- Produces host event vocabulary:

```swift
enum InputEvent: Equatable, Sendable {
    case mouseMove(point: ComputerPoint, dragButton: ComputerMouseButton?)
    case mouseButton(button: ComputerMouseButton, down: Bool, point: ComputerPoint, clickCount: Int)
    case scroll(vertical: Int32, horizontal: Int32)
    case key(keyCode: UInt16, down: Bool, modifiers: Set<ComputerKeyModifier>)
    case unicode(String)
}

protocol InputEventSink: Sendable {
    func emit(_ event: InputEvent) throws
}

protocol PointerReading: Sendable {
    func currentPointerPosition() throws -> ComputerPoint
}

protocol DisplayTopologyReading: Sendable {
    func activeDisplayBounds() throws -> [ComputerBounds]
}

protocol InputSleeping: Sendable {
    func sleep(nanoseconds: UInt64) async throws
}
```

- Produces `PhysicalActionLane.acquire()/release()` FIFO mutex, `PointerTrajectory.samples(from:to:mode:)`, and `ComputerInputController.pointerPosition()` / `moveMouse(to:mode:)`.
- `ComputerActionService` initially handles only `pointer_position` and `move_mouse`; later tasks extend it.
- `ComputerHostService` gains optional `actions: (any ComputerActionHandling)?`, delegates unknown Slice 1 methods to it, and keeps unknown method => `COMPUTER_PROTOCOL_INVALID`.

- [ ] **Step 1: Write RED trajectory tests**

`PointerTrajectoryTests` must assert:

```swift
func testTrajectoryHasExactStartAndEnd() throws
func testFastDurationUsesDistanceBands() throws
func testTrajectoryDurationIsClampedTo350Milliseconds() throws
func testInstantHasZeroDurationAndExactEndpoint() throws
func testNaturalIsSlowerThanFastWithoutRandomJitter() throws
```

Use exact `fast` duration bands:

```text
distance <= 40 px   -> 70 ms
distance <= 200 px  -> 100 ms
distance <= 700 px  -> 150 ms
distance > 700 px   -> 210 ms
```

`natural` duration is `fast * 1.4`, rounded to nearest millisecond. Generate samples every 8 ms using deterministic smoothstep `t*t*(3 - 2*t)` and always append the exact target as the final sample.
All non-instant computed durations pass through a final `70...350 ms` clamp; current `fast` and `natural` bands remain inside it, and the clamp prevents later profile tuning from creating unbounded motion.

- [ ] **Step 2: Write RED controller/lane/bounds tests**

`InputControllerTests` must prove:

```swift
func testPointerPositionIsReadOnlyAndReturnsCurrentPoint() async throws
func testMoveRejectsPointOutsideEveryActiveDisplayWithoutEmitting() async
func testMoveAllowsNegativeCoordinatesWhenInsideSecondDisplay() async throws
func testMoveEmitsExactEndpoint() async throws
func testConcurrentMovesDoNotInterleaveAcrossSleeps() async throws
func testRuntimeOwnedTagConstantIsSingleStableValue()
```

Use fake displays such as:

```swift
[
  ComputerBounds(x: 0, y: 0, width: 1728, height: 1117),
  ComputerBounds(x: -1920, y: 0, width: 1920, height: 1080),
]
```

The concurrency test starts two `moveMouse` tasks, blocks the first fake sleeper after its first emitted step, and verifies the second action emits nothing until the first releases the lane.

- [ ] **Step 3: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter PointerTrajectoryTests
swift test --package-path native/macos-computer-runtime --filter InputControllerTests
```

Expected: new types/files are missing.

- [ ] **Step 4: Implement safe models and strict param helpers**

Add a host-only helper that requires params to be an object and rejects any key outside an explicit allowed set. Numeric coordinates must be finite `Double`s. `move_mouse` params are exactly:

```json
{
  "x": 100,
  "y": 200,
  "motionMode": "fast"
}
```

Required keys: `x`, `y`. Optional key: `motionMode`. Default: `fast`. Reject every other key/type/value with `COMPUTER_PROTOCOL_INVALID`.

`pointer_position` accepts exactly `{}`.

- [ ] **Step 5: Implement pure trajectory and explicit action lane**

`PhysicalActionLane` is an actor-backed FIFO async mutex with a `busy` flag and queued continuations. Do **not** rely on actor method isolation alone because Swift actors are reentrant across `await`.

`ComputerInputController.moveMouse` performs:

```text
lane.acquire
-> validate current display topology and target
-> read current pointer
-> build trajectory
-> emit samples after the start sample
-> sleep only the delta between sample offsets
-> emit exact target
-> lane.release
```

On cancellation/error it releases the lane before rethrowing. No mouse button state exists yet in this task.

- [ ] **Step 6: Implement CoreGraphics pointer/display adapters**

`SystemDisplayTopology` uses:

```text
CGGetActiveDisplayList
CGDisplayBounds
CGEvent(source: nil)?.location
```

A point is valid only if `CGRect.contains` succeeds for at least one active display. Do not use the union rectangle because multi-display gaps are invalid targets.

`SystemInputEventSink` creates a private `CGEventSource`, creates CoreGraphics events from `InputEvent`, sets `.eventSourceUserData` to one centralized `RuntimeOwnedEventTag.value`, and posts at `.cghidEventTap`. `emit` first checks `CGPreflightPostEventAccess()` and never calls a request API.

Use this fixed tag in one place only:

```swift
enum RuntimeOwnedEventTag {
    static let value: Int64 = 0x4352_5632_494E_5054 // "CRV2INPT"
}
```

- [ ] **Step 7: Implement initial action-service dispatch**

Map internal errors to stable protocol errors only:

```text
invalid params                 -> COMPUTER_PROTOCOL_INVALID / Invalid computer runtime request.
out-of-bounds / post failure   -> COMPUTER_ACTION_FAILED / Computer action failed.
cancellation                   -> COMPUTER_ACTION_FAILED / Computer action was cancelled.
raw native error               -> never copied into details/message
```

- [ ] **Step 8: Run GREEN**

```bash
swift test --package-path native/macos-computer-runtime --filter PointerTrajectoryTests
swift test --package-path native/macos-computer-runtime --filter InputControllerTests
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

Expected: all GREEN, no warnings.

- [ ] **Step 9: Review and commit**

```bash
git diff --check
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime input core and pointer motion"
```

---

### Task 3: Deterministic app resolution, open, focus, and frontmost verification

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemWorkspaceController.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/AppControlTests.swift`

**Interfaces:**

```swift
protocol ApplicationControlling: Sendable {
    func runningApplications() -> [WorkspaceApplication]
    func frontmostApplication() -> WorkspaceApplication?
    func applicationURL(bundleIdentifier: String) -> URL?
    func openApplication(at url: URL) async throws -> WorkspaceApplication
    func activate(_ application: WorkspaceApplication) -> Bool
}
```

`SystemWorkspaceController` uses `NSWorkspace.shared.urlForApplication(withBundleIdentifier:)`, `NSWorkspace.openApplication(at:configuration:)`, `NSRunningApplication(processIdentifier:)`, and `activate(options: [.activateAllWindows])`. Do not use deprecated/effectless macOS 14 `activateIgnoringOtherApps`.

App selector rules:

1. if `bundleIdentifier` exists, it is authoritative;
2. otherwise `name` may select **exactly one currently running** application by exact localized name;
3. multiple name matches => `COMPUTER_TARGET_AMBIGUOUS`;
4. no safe match => `COMPUTER_TARGET_NOT_FOUND`;
5. `open_app` may launch a non-running app only when a bundle identifier resolves through LaunchServices/NSWorkspace; it never accepts a path from protocol input.

- [ ] **Step 1: Write RED app-control tests**

Required tests:

```swift
func testFocusUsesBundleIdentifierBeforeName() async throws
func testNameFallbackRequiresExactlyOneRunningMatch() async
func testAmbiguousNameReturnsStableError() async
func testOpenUsesResolvedBundleURLNotProtocolPath() async throws
func testFocusSuccessRequiresAppToBecomeFrontmost() async throws
func testFocusFailureReturnsComputerFocusFailed() async
func testOpenAndFocusRejectUnknownParams() async
func testNativeWorkspaceErrorDoesNotLeak() async throws
```

Fake controller activation can return `true` while never changing frontmost; the service must still fail after the bounded wait. This proves “activation request accepted” is not success.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter AppControlTests
```

- [ ] **Step 3: Implement app selector parsing and bounded wait**

`open_app` / `focus_app` params allow exactly:

```text
bundleIdentifier?: String (1...4096 chars)
name?: String (1...4096 chars)
timeoutMs?: integer 50...5000 (default 1500)
```

At least one of `bundleIdentifier` or `name` is required.

Poll frontmost state every 20 ms until the selected bundle identifier or the exact unique app identity is frontmost. Return only safe `ApplicationView`; never return PID.

Stable errors:

```text
COMPUTER_TARGET_NOT_FOUND / Computer target was not found.
COMPUTER_TARGET_AMBIGUOUS / Computer target is ambiguous.
COMPUTER_FOCUS_FAILED / Computer focus verification failed.
COMPUTER_ACTION_FAILED / Computer action failed.
```

- [ ] **Step 4: Implement system AppKit adapter**

For `openApplication(at:)`, bridge the completion-handler API with `withCheckedThrowingContinuation`. Keep raw `NSError` internal. For activation, call `NSRunningApplication(processIdentifier:)?.activate(options: [.activateAllWindows])`, then rely on the explicit frontmost wait.

- [ ] **Step 5: Run GREEN/full native**

```bash
swift test --package-path native/macos-computer-runtime --filter AppControlTests
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

- [ ] **Step 6: Review and commit**

```bash
git diff --check
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime app focus control"
```

---

### Task 4: Mouse click, double-click, down/up, drag, and bounded scroll

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerInputController.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemInputEvents.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/MouseActionTests.swift`

**Interfaces:**
- `ComputerInputController` adds:

```swift
func click(at: ComputerPoint, button: ComputerMouseButton, mode: PointerMotionMode) async throws -> ComputerActionResult
func doubleClick(at: ComputerPoint, button: ComputerMouseButton, mode: PointerMotionMode) async throws -> ComputerActionResult
func mouseDown(_ button: ComputerMouseButton) async throws -> ComputerActionResult
func mouseUp(_ button: ComputerMouseButton) async throws -> ComputerActionResult
func drag(from: ComputerPoint, to: ComputerPoint, button: ComputerMouseButton, mode: PointerMotionMode) async throws -> ComputerActionResult
func scroll(vertical: Int32, horizontal: Int32, at point: ComputerPoint?, mode: PointerMotionMode) async throws -> ComputerActionResult
func releaseAllInputs() async throws
```

- Held mouse state is explicit and private to the controller. A successful mouse-down inserts the button only after the sink accepted the down event; mouse-up removes it after posting.

- [ ] **Step 1: Write RED mouse sequencing/cleanup tests**

Required tests:

```swift
func testSingleClickMovesThenPostsDownUpAtExactTarget() async throws
func testDoubleClickUsesClickCountOneThenTwo() async throws
func testMouseDownAndUpTrackHeldButton() async throws
func testDragIsMoveDownDraggedMoveUp() async throws
func testInjectedMidDragFailureReleasesHeldButton() async
func testCancellationDuringDragReleasesHeldButton() async
func testScrollSupportsVerticalAndHorizontalDeltas() async throws
func testScrollRejectsDeltaOutsideBoundWithoutEmitting() async
func testScrollOptionalPointMovesBeforeScrolling() async throws
func testPhysicalActionsRemainSerialized() async throws
```

Scroll bounds are exact:

```text
vertical:   -10000...10000
horizontal: -10000...10000
```

Both zero is valid but emits no scroll event and returns completed. Values outside range are rejected, never clamped.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter MouseActionTests
```

- [ ] **Step 3: Implement deterministic event sequences**

Single click:

```text
move -> assert pointer within 2 px -> down(clickCount=1) -> up(clickCount=1)
```

Double click:

```text
move
-> down(1) -> up(1)
-> 60 ms deterministic inter-click pause
-> down(2) -> up(2)
```

Drag:

```text
move to start
-> down
-> smooth trajectory using drag event type for the held button
-> up at exact end
```

Any error/cancellation after a down enters a best-effort `releaseAllInputs` path before returning the stable error.

- [ ] **Step 4: Add strict protocol methods**

Methods and exact params:

```text
click          {x,y,button?,motionMode?}
double_click   {x,y,button?,motionMode?}
mouse_down     {button?}
mouse_up       {button?}
drag           {from:{x,y},to:{x,y},button?,motionMode?}
scroll         {vertical,horizontal,x?,y?,motionMode?}
```

Defaults: `button=left`, `motionMode=fast`. If either scroll coordinate `x`/`y` is supplied, both are required.

Unknown fields/types/enums => `COMPUTER_PROTOCOL_INVALID`.

- [ ] **Step 5: Run GREEN/full native**

```bash
swift test --package-path native/macos-computer-runtime --filter MouseActionTests
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

- [ ] **Step 6: Review and commit**

```bash
git diff --check
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime mouse actions"
```

---

### Task 5: Keyboard mapping, Unicode typing, modifier chords, release guarantees, and server shutdown cleanup

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/KeyMapping.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerInputController.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/NDJSONHostServer.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/KeyboardActionTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ShutdownInputTests.swift`

**Interfaces:**
- `KeyMapping.keyCode(for:) -> UInt16?` is the **only** named-key map.
- Supported named keys:

```text
a...z
0...9
return, tab, space, delete, forward_delete, escape
left, right, up, down
home, end, page_up, page_down
f1...f12
```

- Modifier virtual keys are centralized for `control`, `option`, `shift`, `command`.
- Deterministic modifier down order: `control -> option -> shift -> command`; release order is the reverse.
- `type_text` requires an expected application selector so typing never blindly continues after focus changes.

- [ ] **Step 1: Write RED keyboard/release tests**

Required tests:

```swift
func testCentralKeyMapHasExpectedLettersNavigationAndFunctionKeys()
func testPressKeyPostsModifiersDownKeyDownKeyUpModifiersUpInOrder() async throws
func testPressKeyRejectsUnknownKeyWithoutEmission() async
func testUnicodeTypingUsesBoundedUtf16Chunks() async throws
func testTypingChecksExpectedFrontmostBeforeEveryChunk() async
func testFocusChangeDuringTypingFailsBeforeNextChunkAndReleasesModifiers() async
func testReleaseAllInputsReleasesKeysModifiersAndMouseButtonsInDeterministicOrder() async throws
func testReleaseAllInputsIsIdempotent() async throws
func testSinkFailureDuringKeyChordStillAttemptsEveryHeldRelease() async
func testCancellationDuringKeyboardActionReleasesHeldInput() async
```

Unicode text bound per protocol request: **16384 Swift characters**. Internally split into chunks of at most **20 UTF-16 code units** before `CGEventKeyboardSetUnicodeString` emission.

- [ ] **Step 2: Write RED shutdown tests**

`ShutdownInputTests` must prove:

```swift
func testServerEOFInvokesActionServiceShutdownRelease() async throws
func testServerFramingErrorInvokesActionServiceShutdownRelease() async
func testShutdownReleaseIsIdempotent() async throws
```

Refactor `NDJSONHostServer.run()` so both normal EOF and thrown run-loop errors call `await service.shutdown()` exactly once before returning/rethrowing. Do not weaken the existing persistent-stdio regression test.

- [ ] **Step 3: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter KeyboardActionTests
swift test --package-path native/macos-computer-runtime --filter ShutdownInputTests
```

- [ ] **Step 4: Implement key mapping and Unicode emission**

Use Carbon/HIToolbox virtual-key constants in `KeyMapping.swift`; no scattered magic keycodes in controller/service code.

`SystemInputEventSink` keyboard behavior:

```text
InputEvent.key -> CGEvent(keyboardEventSource:virtualKey:keyDown:)
InputEvent.unicode -> keyboard event + CGEventKeyboardSetUnicodeString
all -> set runtime-owned source tag -> post to cghidEventTap
```

No typed content is printed/logged.

- [ ] **Step 5: Add strict protocol methods**

```text
type_text {
  text: String,
  bundleIdentifier?: String,
  name?: String
}

press_key {
  key: String,
  modifiers?: ["control"|"option"|"shift"|"command"],
  bundleIdentifier?: String,
  name?: String
}

release_inputs {}
```

For `type_text` and `press_key`, at least one expected app identity (`bundleIdentifier` or exact `name`) is required. Validate it is frontmost immediately before action and before every Unicode chunk/chord stage. Focus mismatch => `COMPUTER_FOCUS_FAILED`; do not auto-type into the new app.

- [ ] **Step 6: Run GREEN/full native**

```bash
swift test --package-path native/macos-computer-runtime --filter KeyboardActionTests
swift test --package-path native/macos-computer-runtime --filter ShutdownInputTests
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

- [ ] **Step 7: Review and commit**

```bash
git diff --check
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime keyboard and input release"
```

---

### Task 6: Runtime-owned event tagging, conservative takeover, and fixed emergency stop

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputSafetyCoordinator.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemTakeoverMonitor.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerInputController.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/InputSafetyTests.swift`

**Interfaces:**

```swift
enum InputSafetyInterruption: Error, Equatable, Sendable {
    case userTakeover
    case emergencyStop
}

struct ObservedPhysicalInput: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case pointerMoved, mouseButton, scroll, key, flagsChanged
    }
    let kind: Kind
    let location: ComputerPoint?
    let sourceTag: Int64
    let emergencyChord: Bool
}

protocol TakeoverMonitoring: Sendable {
    func start() throws
    func stop()
}
```

`InputSafetyCoordinator` is lock-protected and exposes:

```text
beginAction(expectedPointer:)
updateExpectedPointer(_:)
observe(_:)
checkForInterruption() throws
endAction()
triggerEmergencyStop()
```

It contains no CGEvent/run-loop code.

- [ ] **Step 1: Write RED pure safety tests**

Required tests:

```swift
func testOwnedSyntheticEventIsIgnored()
func testUnownedPointerWithinToleranceDoesNotTakeOver()
func testUnownedPointerBeyond18PixelsTriggersTakeover()
func testUnownedMouseButtonScrollOrKeyTriggersTakeoverDuringAction()
func testInputOutsideActiveActionDoesNotPoisonNextAction()
func testEmergencyChordTriggersEmergencyInterruption()
func testEmergencySyntheticChordIsIgnoredBecauseItIsRuntimeOwned()
func testTakeoverDuringDragCausesControllerToReleaseHeldButton() async
func testEmergencyStopDuringHeldInputCausesRelease() async
func testSafetyNativeErrorTextIsNeverProtocolOutput() async throws
```

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter InputSafetyTests
```

- [ ] **Step 3: Implement conservative coordinator integration**

Every physical mutation:

```text
beginAction
-> checkForInterruption before each emitted event/sample
-> update expected pointer after own move sample
-> check again after suspension/event
-> on interruption: best-effort releaseAllInputs
-> endAction
```

Unexpected untagged mouse-button/scroll/key input interrupts immediately. Untagged pointer movement interrupts only when distance from the current expected pointer exceeds **18 logical pixels**. This minimizes false positives.

Map both physical takeover and the fixed emergency chord to:

```text
COMPUTER_USER_TAKEOVER / User took over computer input.
```

No event details/coordinates/key contents enter the response.

- [ ] **Step 4: Implement one listen-only system monitor**

`SystemTakeoverMonitor`:

1. calls `CGPreflightListenEventAccess()` only;
2. if false, returns a fixed internal `monitorUnavailable` error and **never** calls `CGRequestListenEventAccess()`;
3. creates a `.listenOnly` session event tap for mouse move/down/up/drag, scroll, key down/up, and flags-changed;
4. runs the tap source on one owned CoreFoundation run loop thread;
5. reads `.eventSourceUserData` and ignores `RuntimeOwnedEventTag.value`;
6. identifies the emergency chord when untagged Escape key-down has Control+Option+Command set and Shift not set;
7. forwards only categorical input kind/location/tag/emergency state to `InputSafetyCoordinator`;
8. on tap-disabled timeout, attempts `CGEvent.tapEnable` and marks the monitor unavailable if re-enable fails;
9. `stop()` stops the owned run loop and releases the tap; no socket/listener/process is created.

Carbon `RegisterEventHotKey` was verified to accept the exact chord on the target SDK/Mac, but the implementation intentionally uses the already-required listen-only event tap for both takeover and emergency detection so there is one monitoring primitive/run loop and no second global event subsystem. This is within the approved architecture because the fixed chord remains global, immutable, and user-generated events are distinguished from tagged runtime events.

- [ ] **Step 5: TCC checkpoint on packaged helper identity**

After building/staging the helper, run a dedicated protocol-free/local diagnostic entry only if it can be done without changing the production protocol, or exercise the monitor through a safe no-motion acceptance call. Required evidence before real physical acceptance:

```text
Accessibility trusted = true
CGPreflightListenEventAccess = true
CGPreflightPostEventAccess = true
listen-only event tap starts
no permission request API called
```

If the packaged helper reports listen=false/tap creation failure while existing Accessibility remains granted, **STOP**. Do not prompt for Input Monitoring. Report the API, permission implication, and alternatives before continuing.

- [ ] **Step 6: Run GREEN/full native**

```bash
swift test --package-path native/macos-computer-runtime --filter InputSafetyTests
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

- [ ] **Step 7: Review and commit**

```bash
git diff --check
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime takeover and emergency stop"
```

---

### Task 7: Deterministic verification primitives and disposable native fixture

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerVerification.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenRegionDigest.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Modify: `native/macos-computer-runtime/Package.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/main.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureAppDelegate.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureInteractionView.swift`
- Create: `scripts/package-macos-computer-runtime-fixture.mjs`
- Create: `tests/macos-computer-runtime-fixture-package.test.ts`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/VerificationTests.swift`
- Modify tests that construct `ComputerObservation` to account for additive digest default.

**Interfaces:**
- Add to `ComputerObservation`:

```swift
public let digest: String?
```

and add `digest: String? = nil` to its initializer. Digest input deliberately excludes `snapshotId` and `digest` itself.

- `ComputerVerificationEngine` provides:

```swift
func currentAXDigest() throws -> String
func currentFocusedElementIndex() throws -> Int?
func waitForFrontmost(_ selector: ComputerApplicationSelector, timeoutMs: Int) async throws -> ApplicationView
func waitForText(_ text: String, exact: Bool, timeoutMs: Int) async throws
func waitUntilAXChanged(from baselineDigest: String, timeoutMs: Int) async throws -> String
func waitUntilScreenRegionChanged(bounds: ComputerBounds, from baselineDigest: String, timeoutMs: Int) async throws -> String
```

- AX digest is SHA-256 over a stable JSON payload containing safe app/window/elements/truncated state but no snapshot UUID, PID, AX identity, or editable value.
- `SystemScreenRegionDigester` uses ScreenCaptureKit `SCStreamConfiguration.sourceRect`; region must fit wholly inside one active display. Convert global CG coordinates to the selected display’s local logical coordinates by subtracting that display bounds origin. Hash the in-memory PNG with SHA-256 and discard pixels.

- [ ] **Step 1: Write RED verification tests**

Required tests:

```swift
func testObservationDigestIgnoresSnapshotIdButChangesWithAXState() throws
func testDigestIncludesFocusedSelectedAndWindowState() throws
func testWaitForFrontmostSucceedsAfterBoundedPolls() async throws
func testWaitForFrontmostTimesOutWithStableFocusError() async
func testWaitForTextFindsAXTitleOrDescriptionWithoutReadingValue() async throws
func testWaitForTextExactAndSubstringModes() async throws
func testWaitUntilAXChangedReturnsNewDigest() async throws
func testWaitUntilAXChangedTimesOut() async
func testScreenRegionRejectsCrossDisplayOrOutOfBoundsRegion() async
func testScreenRegionChangeUsesDigestOnlyAndReturnsNoPixels() async throws
func testVerificationNativeErrorDoesNotLeak() async throws
```

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter VerificationTests
```

- [ ] **Step 3: Implement additive observation digest**

`observe` responses gain `digest` without changing/removing any Slice 1 field. Existing observation size and 4096/500/depth bounds remain. `kAXValueAttribute` remains forbidden.

- [ ] **Step 4: Add strict verification methods**

Native protocol methods:

```text
wait_for_frontmost {bundleIdentifier?:String,name?:String,timeoutMs?:50...10000}
wait_for_text       {text:String,exact?:Bool,timeoutMs?:50...10000}
wait_until_changed  {baselineDigest:String,timeoutMs?:50...10000}
```

`wait_for_text` searches only safe AX `title` and `description` fields already present in `ComputerObservation`; it never reads editable values.

In addition, mouse/scroll/keyboard action params may gain one optional strict `verify` object:

```json
{"kind":"ax_changed","timeoutMs":2000}
{"kind":"text_appeared","text":"button-clicked","exact":true,"timeoutMs":2000}
{"kind":"screen_region_changed","x":100,"y":100,"width":300,"height":200,"timeoutMs":2000}
```

For `ax_changed` and `screen_region_changed`, capture the baseline digest **before** the physical mutation and wait after it. `text_appeared` waits after mutation. Verification failure returns `COMPUTER_ACTION_FAILED` or `COMPUTER_TIMEOUT` with fixed messages and never rewrites a failed physical action as success.

- [ ] **Step 5: Create the deterministic AppKit fixture**

Add executable product/target:

```text
product: chatgpt-system-computer-runtime-fixture
target: ComputerRuntimeFixture
```

Programmatic visible `800x600` AppKit window titled `Computer Runtime v2 Fixture` with no user data. Required controls/state:

```text
NSButton          accessibility title "Fixture Button" -> status label "button-clicked"
custom double target -> status "double-clicked" when clickCount >= 2
NSTextField       -> status "text:<current fixture text>" on edit change
NSButton checkbox -> status "checkbox:on" / "checkbox:off"
NSScrollView      with deterministic tall content
custom drag view  with visible source/destination rectangles -> status "drag-complete"
status NSTextField label with accessibility title/description
focus indicator label updated when text field becomes/resigns first responder
menu shortcut Command+Shift+K -> status "hotkey-ok"
```

The fixture may echo its own benign test text in status; the runtime still must not read the editable field’s current AX value.

- [ ] **Step 6: Package fixture deterministically**

Create fixed fixture bundle:

```text
ChatGPTSystemComputerRuntimeFixture.app
bundle id: com.senoldogann.chatgpt-system.computer-runtime.fixture
executable: chatgpt-system-computer-runtime-fixture
LSUIElement: false
minimum macOS: 14.0
```

Default output:

```text
native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app
```

The packaging script accepts only `--output`, `--sign`, `--help`, stages via fresh sibling temp directory, rejects symlink/non-directory replacement, and invokes `/usr/bin/codesign` with `shell:false` exactly as the helper packager does.

Add package-plan Vitest asserting fixed identity/executable/default path and protected-identity override rejection.

- [ ] **Step 7: Run GREEN/full suites/package fixture**

```bash
swift test --package-path native/macos-computer-runtime --filter VerificationTests
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
npx vitest run tests/macos-computer-runtime-fixture-package.test.ts
node scripts/package-macos-computer-runtime-fixture.mjs --sign -
```

- [ ] **Step 8: Review and commit**

```bash
git diff --check
git add native/macos-computer-runtime scripts/package-macos-computer-runtime-fixture.mjs tests/macos-computer-runtime-fixture-package.test.ts
git commit -m "feat: add computer runtime verification fixture"
```

---

### Task 8: Real-Mac acceptance, CI/docs hardening, full verification, exact-head PR/merge

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- Produces CI proof for deterministic non-TCC logic and fixture build/package.
- Documents only native Slice 2 capability; MCP integration remains absent until Slice 3.

- [ ] **Step 1: Extend npm scripts and macOS-native CI**

Add:

```json
"build:computer-fixture:macos": "swift build -c release --package-path native/macos-computer-runtime --product chatgpt-system-computer-runtime-fixture",
"package:computer-fixture:macos": "npm run build:computer-fixture:macos && node scripts/package-macos-computer-runtime-fixture.mjs --sign -"
```

macOS-native CI must:

```text
run all Swift tests
build release helper
package/sign fixed helper bundle
build/package/sign fixture bundle
run deterministic protocol tests that use fake event sinks (no real desktop actuation)
retain passive health smoke
```

GitHub Actions must **not** be expected to move/click/type on an arbitrary CI desktop or possess TCC grants.

- [ ] **Step 2: Update docs to implemented Slice 2 state only**

README/integration docs state:

```text
native helper now implements open/focus/pointer/mouse/scroll/keyboard/release/verification primitives
physical mutations are serialized
runtime events are tagged and user takeover/emergency stop are enforced
TCC is never bypassed/requested by the protocol
fixture is local acceptance only
MCP computer_* tools still do not exist
computer_run/computer_run_js still do not exist
TypeScript supervisor still does not exist
OCR/recovery ladder still does not exist
```

- [ ] **Step 3: Fresh full local verification before physical acceptance**

Run exactly:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
npm run test:computer:macos
npm run package:computer:macos
npm run package:computer-fixture:macos
xcrun codesign -v --strict --deep native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app
xcrun codesign -v --strict --deep native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app
git diff --check origin/main...HEAD
```

- [ ] **Step 4: Final privacy/surface review**

```bash
rg -n 'kAXValueAttribute' native/macos-computer-runtime
rg -n 'NWListener|UnixListener|socket\(|Process\(|/bin/sh|child_process|shell' native/macos-computer-runtime/Sources
rg -n 'processIdentifier|\bpid\b|AXUIElement|\bvalue\b' native/macos-computer-runtime/Sources/ComputerRuntimeCore
rg -n 'CGRequestListenEventAccess|CGRequestPostEventAccess' native/macos-computer-runtime
```

Expected:

```text
kAXValueAttribute: zero
listener/socket/arbitrary Process/shell in native sources: zero
PID/raw AX/value in public core models: zero
CGRequestListenEventAccess/PostEventAccess: zero
```

`Process(` may exist only in test code for the inherited-stdio regression, not production native sources.

- [ ] **Step 5: Package-helper TCC/safety preflight**

Before moving the real pointer, verify categorically through safe helper/system diagnostics:

```text
Accessibility=true
Screen Recording=true
listen-event preflight=true
post-event preflight=true
takeover monitor starts without a permission prompt
```

If listen/post requires a new TCC grant for the packaged helper identity, stop here and report. Do not request/grant it automatically.

- [ ] **Step 6: Launch harmless fixture and run real-Mac acceptance**

Use only `ChatGPTSystemComputerRuntimeFixture.app`, no user data/settings.

Required acceptance sequence on one persistent packaged helper process:

```text
A. open_app by fixture bundle id -> verify frontmost
B. focus_app -> verify frontmost
C. pointer_position -> valid current point
D. move_mouse fast to known fixture button -> visibly smooth exact endpoint/tolerance
E. click with text_appeared verification -> fixture status button-clicked
F. double_click -> fixture status double-clicked
G. type_text "computer-runtime-v2-input-ok" into focused fixture field -> status verification
H. press_key Command+Shift+K -> fixture status hotkey-ok
I. vertical and horizontal bounded scroll -> screen-region or AX change verification
J. drag source -> destination -> fixture status drag-complete
K. release_inputs -> no held mouse/key/modifier state
L. injected/non-owned pointer takeover during deliberately natural/slow movement -> action aborts, releases input, COMPUTER_USER_TAKEOVER
M. one true human mouse takeover smoke while movement is active -> same result, if packaged helper monitor uses only existing authorized TCC
N. physically press Control+Option+Command+Escape during a controlled held/slow action -> action aborts, inputs release, runtime remains alive and can answer health afterwards
```

Do not perform acceptance against Finder/TextEdit/Xcode/System Settings in Slice 2; those wider real-app smokes belong to later acceptance slices.

- [ ] **Step 7: Record performance medians on one warm persistent helper**

After one warm-up, record at least 7 samples where meaningful and print timings only, never content:

```text
pointer_position
focus_app
short fast move
medium fast move
long fast move
click
scroll
type short benign fixture text
```

No hard timing gate. Investigate obvious multi-second behavior. Pointer `fast` should remain approximately within the approved 50-260 ms distance bands.

- [ ] **Step 8: Commit CI/docs integration**

After all local + real-Mac acceptance above is GREEN:

```bash
git add .github/workflows/ci.yml package.json README.md docs/CHATGPT_INTEGRATION.md
git commit -m "ci: verify computer runtime physical input slice"
```

Do not mix acceptance-generated `.build` output into the commit.

- [ ] **Step 9: Verification-before-completion and code review**

Use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review` with:

```text
BASE_SHA = 6748ca76303512fd30d86450fcaff2f3c0abe56b
HEAD_SHA = current feature HEAD
```

Review focus:

```text
physical event correctness/order
button/key release guarantees
explicit action-lane non-interleaving across awaits
multi-display geometry and no clamping
synthetic event tag consistency
takeover false positive/negative behavior
emergency chord immutability/TCC implications
Swift concurrency/run-loop lifetime
protocol strictness/bounds/error redaction
no scope leakage into MCP/TypeScript/OCR/recovery
bundle identity continuity
CI reproducibility
```

Critical/Important findings must be fixed with TDD and followed by the full verification sequence again.

- [ ] **Step 10: Push and open exact-scope PR**

Only after local/real-Mac acceptance GREEN:

```text
PR title: feat: add Computer Runtime v2 physical input and verification
```

PR body records:

```text
starting main SHA
plan/task commits
architecture/scope summary
Swift and Node/Vitest counts
pointer trajectory behavior and median timings
focus/open evidence
click/double/drag/scroll/type/hotkey evidence
failure/cancel/EOF release evidence
takeover evidence including true-human smoke
emergency chord evidence
TCC categorical state and whether any new TCC was required
privacy rg results
bundle IDs/signing
SDK/API adaptations
exact feature HEAD
```

- [ ] **Step 11: Exact-head CI lock**

For the exact recorded PR head SHA require:

```text
test (22)    SUCCESS
test (24)    SUCCESS
macos-native SUCCESS
```

Any head change invalidates old CI evidence.

- [ ] **Step 12: Exact-head squash merge and post-merge main CI**

Merge with GitHub expected-head protection. Then fetch `origin/main`, record merge SHA, and require the `main` push CI on that exact SHA:

```text
test (22)    SUCCESS
test (24)    SUCCESS
macos-native SUCCESS
```

Only then may Slice 2 be called PASS.

Do **not** restart the daily driver merely for Slice 2, and do **not** begin Slice 3.

---

## Slice 2 Definition of Done

Slice 2 is PASS only when all are true:

- fresh branch was based on accepted Slice 1 main;
- plan has its own reviewable commit;
- pointer position and exact multi-display bounds work without clamping;
- `instant` / `fast` / `natural` deterministic motion works and fast is default;
- physical mutations never interleave across action awaits;
- open/focus verifies actual frontmost state;
- click/double-click/mouse down/up/drag/vertical+horizontal scroll work;
- Unicode typing, named key, and modifier chord work;
- all failure/cancel/takeover/emergency/EOF/shutdown paths release held input;
- every synthetic CoreGraphics event is tagged with the one runtime-owned tag;
- unowned user input interrupts active actions conservatively;
- fixed Control+Option+Command+Escape interrupts active automation and cannot be disabled by request input;
- no new TCC permission was silently introduced;
- AX/frontmost/text/screen-region verification primitives work without OCR;
- disposable fixture proves real physical behavior without user data;
- `kAXValueAttribute` remains zero-match and public models still contain no PID/raw AX/editable value;
- fixed helper bundle identity/signing remains green;
- Node 22/24 and macOS-native exact-head PR CI are green;
- exact-head merge is verified;
- post-merge `main` CI is green;
- no MCP/TypeScript/OCR/recovery/full-Node/Slice 3 scope leaked into this slice.
