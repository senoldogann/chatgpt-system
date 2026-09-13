# Computer Use Perception Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit Computer Use on real macOS applications—especially normal Google Chrome—semantically observable, key-contract safe, and bounded in recovery so simple workflows do not degrade into blind coordinate-click loops.

**Architecture:** Extend the existing native Computer Runtime rather than adding a new perception subsystem. AX remains the fast path; Chrome web-AX capability is classified explicitly, weak observations are enriched with bounded focused-window Vision OCR, stopped real Chrome is launched with renderer accessibility, and TypeScript narrows/normalizes key names before native IPC. Existing TCC, takeover, Browser-vs-Computer routing, and verification boundaries remain authoritative.

**Tech Stack:** Swift 6 / AppKit / ApplicationServices / ScreenCaptureKit / Vision / CoreGraphics, TypeScript 6, Zod 4, MCP server/client, Vitest 5, existing Project Continuity and Project Check publication gates.

**Spec:** `docs/superpowers/specs/2026-09-14-computer-use-perception-reliability-design.md`

## Global Constraints

- Explicit Computer Use stays on `computer_*`; never substitute `browser_*` / Playwright for this slice.
- Use the installed normal `Google Chrome.app` / `com.google.Chrome`; never Chrome for Testing or a temporary `--user-data-dir`.
- Never silently restart an already-running Chrome process to enable renderer accessibility.
- When Computer Runtime starts a stopped Chrome, add only `--force-renderer-accessibility=complete` and preserve the default profile/session.
- Automatic structured OCR is focused-window-only: max 64 candidates, max 512 characters per candidate, max 8192 aggregate OCR characters, filter confidence below 0.5 when Vision provides confidence.
- Fast Vision OCR runs first; accurate OCR may run once only when the fast pass yields zero acceptable candidates.
- Runtime never invents coordinates or performs automatic repeated point guesses.
- Keep TCC, user takeover, CAPTCHA/anti-bot, input release, geometry, SIP, Keychain, and authority boundaries unchanged.
- Preserve `origin/feat/computer-use-bridge` unless separately classified.
- Work from an isolated implementation worktree; do not implement directly on `main` or the design branch.
- TDD: every behavior change starts with a failing focused test, then minimal implementation, then focused GREEN before the task commit.

---

## File Structure and Responsibility Map

**Native core models**
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`: public observation/perception/OCR view types only.

**Native perception policy**
- Create `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerPerception.swift`: pure Chrome/non-Chrome AX classification, OCR bounding/filtering, recommended-targeting selection, and focused-window bound extraction. No screen capture or input side effects.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift`: orchestrate AX observation, capability classification, focused-window OCR enrichment, cached OCR reuse for `ocrText`, and existing bounded semantic recovery.

**Native capture**
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`: add a focused-window image capture contract.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift`: convert safe screen-space window bounds into a cropped `CGImage`; never silently broaden automatic OCR to full-display OCR.

**Native application launch**
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputProtocols.swift`: allow explicit launch arguments through `ApplicationControlling` while preserving a zero-argument default implementation for existing fakes/callers.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemWorkspaceController.swift`: pass bounded launch arguments via `NSWorkspace.OpenConfiguration.arguments`.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`: add the Chrome-only stopped-process launch policy; existing Chrome returns immediately and is only activated/focused.

**Native output / point behavior**
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`: sanitize/bound the new perception fields while preserving overall observation-size limits.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`: map verification failure for explicit point actions to `COMPUTER_NEEDS_REPLAN` without adding point retries.

**TypeScript contract**
- Create `src/computer-key.ts`: one canonical key vocabulary, explicit alias vocabulary, and `normalizeComputerKey()` shared by direct and batched key actions.
- Modify `src/computer-types.ts`: use `ComputerKeyName` for normalized actions and add typed observation/perception views if needed by runtime boundaries.
- Modify `src/computer-tool-registration.ts`: strict key schema/normalization and agent-facing targeting guidance.
- Modify `src/tool-output-schemas.ts`: additive bounded perception summary and OCR candidates in `computerObservationOutputSchema`.

**Tests**
- Create `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/PerceptionTests.swift`.
- Modify `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ScreenshotTests.swift`.
- Modify `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift`.
- Modify `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationTests.swift`.
- Modify `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/AppControlTests.swift`.
- Modify `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift`.
- Modify `tests/computer-mcp.test.ts`.
- Modify `tests/computer-audit.test.ts`.
- Modify `tests/computer-slice5-integration.test.ts` where end-to-end observation/semantic recovery coverage belongs.

---

### Task 1: Add the perception model and deterministic AX capability classifier

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerPerception.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/PerceptionTests.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationTests.swift`

**Interfaces:**
- Produces `ComputerAXQuality`, `ComputerRecommendedTargeting`, `ComputerOcrCandidateView`, `ComputerPerceptionSummary`.
- Extends `ComputerObservation` with `perception: ComputerPerceptionSummary?` so older construction sites can migrate incrementally while runtime-produced observations always populate it after Task 2.
- Produces `ComputerPerception.classify(observation:) -> ComputerPerceptionSummary` and `ComputerPerception.focusedWindowBounds(in:) -> ComputerBounds?`.

- [ ] **Step 1: Write failing perception-classification tests**

Add tests equivalent to:

```swift
func testChromeToolbarOnlyAXIsWeakAndWebInaccessible() {
    let observation = makeObservation(
        bundleIdentifier: "com.google.Chrome",
        roles: ["AXWindow", "AXToolbar", "AXTextField"],
        truncated: false
    )
    let summary = ComputerPerception.classify(observation: observation)
    XCTAssertEqual(summary.axQuality, .weak)
    XCTAssertEqual(summary.webContentAccessible, false)
    XCTAssertEqual(summary.recommendedTargeting, .ocr)
}

func testChromeAXWebAreaIsStrongAndWebAccessible() {
    let observation = makeObservation(
        bundleIdentifier: "com.google.Chrome",
        roles: ["AXWindow", "AXWebArea", "AXHeading"],
        truncated: false
    )
    let summary = ComputerPerception.classify(observation: observation)
    XCTAssertEqual(summary.axQuality, .strong)
    XCTAssertEqual(summary.webContentAccessible, true)
    XCTAssertEqual(summary.recommendedTargeting, .ax)
}

func testNonChromeEmptyTreeIsWeakButWebCapabilityIsNotApplicable() {
    let observation = makeObservation(bundleIdentifier: "com.apple.TextEdit", roles: [], truncated: false)
    let summary = ComputerPerception.classify(observation: observation)
    XCTAssertEqual(summary.axQuality, .weak)
    XCTAssertNil(summary.webContentAccessible)
}
```

- [ ] **Step 2: Run RED**

Run:

```bash
swift test --package-path native/macos-computer-runtime --filter PerceptionTests
```

Expected: FAIL because `ComputerPerception` and perception model types do not exist.

- [ ] **Step 3: Add the minimal public model**

In `Models.swift`, add:

```swift
public enum ComputerAXQuality: String, Codable, Equatable, Sendable {
    case strong, partial, weak
}

public enum ComputerRecommendedTargeting: String, Codable, Equatable, Sendable {
    case ax, ocr
    case visualPoint = "visual-point"
}

public enum ComputerOcrSource: String, Codable, Equatable, Sendable {
    case visionFast = "vision-fast"
    case visionAccurate = "vision-accurate"
}

public struct ComputerOcrCandidateView: Codable, Equatable, Sendable {
    public let text: String
    public let bounds: ComputerBounds
    public let confidence: Double?
    public let source: ComputerOcrSource
}

public struct ComputerPerceptionSummary: Codable, Equatable, Sendable {
    public let axQuality: ComputerAXQuality
    public let webContentAccessible: Bool?
    public let ocrUsed: Bool
    public let recommendedTargeting: ComputerRecommendedTargeting
    public let ocrCandidates: [ComputerOcrCandidateView]
}
```

Extend `ComputerObservation.init` with `perception: ComputerPerceptionSummary? = nil` and store the property.

- [ ] **Step 4: Add the pure classifier**

Create `ComputerPerception.swift` with deterministic rules:

```swift
enum ComputerPerception {
    static let chromeBundleIdentifier = "com.google.Chrome"

    static func classify(observation: ComputerObservation) -> ComputerPerceptionSummary {
        let isChrome = observation.application.bundleIdentifier == chromeBundleIdentifier
        let hasWebArea = observation.elements.contains { $0.role == "AXWebArea" }
        let quality: ComputerAXQuality
        if isChrome && !hasWebArea {
            quality = .weak
        } else if observation.elements.isEmpty {
            quality = .weak
        } else if observation.truncated {
            quality = .partial
        } else {
            quality = .strong
        }
        let webAccessible: Bool? = isChrome ? hasWebArea : nil
        let targeting: ComputerRecommendedTargeting = quality == .weak ? .ocr : .ax
        return .init(
            axQuality: quality,
            webContentAccessible: webAccessible,
            ocrUsed: false,
            recommendedTargeting: targeting,
            ocrCandidates: []
        )
    }

    static func focusedWindowBounds(in observation: ComputerObservation) -> ComputerBounds? {
        observation.elements.first(where: { $0.role == "AXWindow" && $0.focused != false })?.bounds
            ?? observation.elements.first(where: { $0.role == "AXWindow" })?.bounds
    }
}
```

- [ ] **Step 5: Preserve perception through host sanitization/digesting**

Update `ComputerHostService.sanitizeObservation` and its rebuilt digested observation so the new bounded perception value is not dropped. Add an `ObservationTests` assertion that an input perception summary survives `observe` output.

- [ ] **Step 6: Run GREEN**

Run:

```bash
swift test --package-path native/macos-computer-runtime --filter PerceptionTests
swift test --package-path native/macos-computer-runtime --filter ObservationTests
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerPerception.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/PerceptionTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationTests.swift
git commit -m "feat: classify computer perception capability"
```

---

### Task 2: Add focused-window structured OCR to ordinary observation

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerPerception.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ScreenshotTests.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift`

**Interfaces:**
- Extends `ScreenImageCapturing` with `captureWindowImage(bounds: ComputerBounds) async throws -> ScreenImageCapture`.
- Produces `ComputerPerception.boundedCandidates(_:captureBounds:) -> [ComputerOcrCandidateView]`.
- `ComputerRecoveryEngine.refreshObservation()` returns a `ComputerObservation` with populated `perception`.

- [ ] **Step 1: Write RED tests for focused-window capture and OCR policy**

Required test cases:

```swift
func testWeakChromeObservationRunsFastFocusedWindowOCR() async throws { /* fake AX + fake capture + fake OCR */ }
func testStrongChromeObservationSkipsOCR() async throws { /* AXWebArea present */ }
func testMissingWindowBoundsDoesNotFallBackToFocusedDisplayOCR() async throws { /* capture invocation count == 0 */ }
func testFastCandidatesSkipAccuratePass() async throws { /* fast count > 0, accurate call count == 0 */ }
func testEmptyFastPassAllowsExactlyOneAccuratePass() async throws { /* fast=0, accurate=1 */ }
func testObservationOcrCandidatesAreBounded() async throws { /* 64 candidates, 512 each, <=8192 aggregate */ }
func testLowConfidenceCandidatesAreFiltered() async throws { /* confidence 0.49 absent, 0.5 present */ }
```

For `ScreenshotTests`, add a geometry test proving a screen-space window rectangle becomes the expected cropped image rectangle at Retina/non-1x scale.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ScreenshotTests
swift test --package-path native/macos-computer-runtime --filter RecoveryEngineTests
```

Expected: FAIL because focused-window capture and observation-level OCR enrichment do not exist.

- [ ] **Step 3: Add the focused-window capture contract**

In `HostProtocols.swift`:

```swift
protocol ScreenImageCapturing: Sendable {
    func captureFocusedDisplayImage() async throws -> ScreenImageCapture
    func captureWindowImage(bounds: ComputerBounds) async throws -> ScreenImageCapture
}
```

In `SystemScreenshotCapturer`, implement `captureWindowImage(bounds:)` by capturing the focused display with the existing ScreenCaptureKit path, converting screen coordinates to image coordinates with independent X/Y scale factors, validating containment, and cropping the `CGImage`. Return the cropped image with `screenBounds` equal to the original window bounds. Reject invalid/out-of-display bounds with `ScreenshotCaptureError.unavailable`; never broaden to the full display.

- [ ] **Step 4: Add one bounded OCR candidate function**

In `ComputerPerception.swift`, add constants and filtering:

```swift
static let maxOcrCandidates = 64
static let maxOcrCandidateCharacters = 512
static let maxOcrAggregateCharacters = 8_192
static let minimumOcrConfidence = 0.5
```

Convert native `OcrTextCandidate` into `ComputerOcrCandidateView`, preserving screen-space bounds and source, dropping candidates below confidence 0.5, truncating each text to 512 characters, stopping at 64 candidates or 8192 aggregate characters.

- [ ] **Step 5: Make `ComputerRecoveryEngine.freshContext()` asynchronous and enrich weak observations**

Change calls from `try freshContext()` to `try await freshContext()` and implement this order:

```swift
let rawObservation = try accessibility.observe(for: application, limits: .default)
let basePerception = ComputerPerception.classify(observation: rawObservation)
var enriched = rawObservation.withPerception(basePerception)

if basePerception.axQuality == .weak,
   permissions.screenCaptureAuthorized(),
   let windowBounds = ComputerPerception.focusedWindowBounds(in: rawObservation) {
    let capture = try await screenCapture.captureWindowImage(bounds: windowBounds)
    let fast = try await ocr.recognizeText(in: capture.image, mode: .fast)
    var candidates = ComputerPerception.boundedCandidates(fast, captureBounds: capture.screenBounds)
    if candidates.isEmpty {
        let accurate = try await ocr.recognizeText(in: capture.image, mode: .accurate)
        candidates = ComputerPerception.boundedCandidates(accurate, captureBounds: capture.screenBounds)
    }
    enriched = enriched.withPerception(
        ComputerPerception.summary(base: basePerception, ocrCandidates: candidates)
    )
}
```

If Screen Recording is not authorized or safe focused-window bounds do not exist, do not fail a valid AX observation; return the observation with `ocrUsed=false` and `recommendedTargeting=.visualPoint` when AX is weak.

- [ ] **Step 6: Reuse cached structured OCR for `ocrText` before recapturing**

In `resolveWithOCRIfRelevant`, first inspect `context.cached.observation.perception?.ocrCandidates`. Run deterministic zero/one/multiple matching against those candidates. Only invoke a new OCR capture when the cached observation has no usable OCR set and the existing retry contract allows it. This keeps `computer_observe -> computer_click(target: ocrText)` on one perception generation when possible.

- [ ] **Step 7: Run GREEN**

```bash
swift test --package-path native/macos-computer-runtime --filter ScreenshotTests
swift test --package-path native/macos-computer-runtime --filter RecoveryEngineTests
swift test --package-path native/macos-computer-runtime --filter PerceptionTests
```

Expected: PASS, including call-count assertions proving healthy AX does not invoke OCR and automatic OCR never widens to full-screen.

- [ ] **Step 8: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerPerception.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ScreenshotTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift
git commit -m "feat: add focused window OCR perception"
```

---

### Task 3: Launch stopped real Chrome with renderer accessibility and never restart running Chrome

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemWorkspaceController.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/AppControlTests.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/WorkspaceTests.swift`

**Interfaces:**
- Adds `ApplicationControlling.openApplication(at:arguments:)` with a default implementation that delegates to the existing zero-argument method.
- `SystemWorkspaceController` overrides the argument-aware method and maps arguments into `NSWorkspace.OpenConfiguration.arguments`.

- [ ] **Step 1: Write RED launch-policy tests**

Add tests proving:

```swift
func testOpenRunningChromeDoesNotRelaunchOrPassArguments() async throws {
    // running app = com.google.Chrome
    // call open_app
    // assert openedURLs.isEmpty and openArgumentsLog.isEmpty
}

func testOpenStoppedChromePassesOnlyRendererAccessibilityArgument() async throws {
    // no running app; URL resolves to /Applications/Google Chrome.app
    // assert arguments == ["--force-renderer-accessibility=complete"]
}

func testOpenStoppedNonChromePassesNoArguments() async throws {
    // bundle com.example.fixture
    // assert arguments == []
}
```

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter AppControlTests
swift test --package-path native/macos-computer-runtime --filter WorkspaceTests
```

Expected: FAIL because application launch arguments are not represented.

- [ ] **Step 3: Extend the controller contract without breaking ordinary callers**

In `InputProtocols.swift`:

```swift
protocol ApplicationControlling: Sendable {
    // existing requirements...
    func openApplication(at url: URL) async throws -> WorkspaceApplication
    func openApplication(at url: URL, arguments: [String]) async throws -> WorkspaceApplication
}

extension ApplicationControlling {
    func openApplication(at url: URL, arguments: [String]) async throws -> WorkspaceApplication {
        guard arguments.isEmpty else { return try await openApplication(at: url) }
        return try await openApplication(at: url)
    }
}
```

The default keeps existing test doubles source-compatible; production `SystemWorkspaceController` overrides it so non-empty arguments are not lost.

- [ ] **Step 4: Pass arguments through `NSWorkspace.OpenConfiguration`**

Refactor `openApplicationUsingWorkspace` to accept `[String]` and set:

```swift
configuration.arguments = arguments
```

Keep `createsNewApplicationInstance = false`, activation behavior, and existing no-path/no-shell guarantees.

- [ ] **Step 5: Apply the Chrome-only stopped-process policy in `resolveOrOpen`**

Use one constant:

```swift
private static let chromeBundleIdentifier = "com.google.Chrome"
private static let chromeAccessibilityArguments = ["--force-renderer-accessibility=complete"]
```

When a matching running Chrome exists, return it immediately exactly as today. Only after proving no running match exists, resolve the bundle URL and call:

```swift
let args = bundleIdentifier == Self.chromeBundleIdentifier
    ? Self.chromeAccessibilityArguments
    : []
return try await applicationController.openApplication(at: url, arguments: args)
```

- [ ] **Step 6: Run GREEN**

```bash
swift test --package-path native/macos-computer-runtime --filter AppControlTests
swift test --package-path native/macos-computer-runtime --filter WorkspaceTests
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/InputProtocols.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemWorkspaceController.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/AppControlTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/WorkspaceTests.swift
git commit -m "feat: launch real chrome with renderer accessibility"
```

---

### Task 4: Make the public key contract canonical and alias-safe

**Files:**
- Create: `src/computer-key.ts`
- Modify: `src/computer-types.ts`
- Modify: `src/computer-tool-registration.ts`
- Modify: `tests/computer-mcp.test.ts`

**Interfaces:**
- Produces `ComputerKeyName` and `normalizeComputerKey(value: string): ComputerKeyName | null`.
- Produces one `computerKeyInputSchema` used by both direct `computer_press_key` and the `press_key` action inside `computer_run`.

- [ ] **Step 1: Write RED MCP tests**

Add coverage that:

```ts
expect(keySchema.enum).toContain("return");
expect(keySchema.enum).toContain("enter");
```

and direct tool calls behave as follows:

```ts
await client.callTool({
  name: "computer_press_key",
  arguments: { authorityLeaseId: admin.leaseId, key: "Enter", bundleIdentifier: "com.example.fixture" },
});
expect(fake.calls.at(-1)?.input).toMatchObject({ key: "return" });
```

Also test `Esc -> escape`, `Backspace -> delete`, `ArrowLeft -> left`, `F12 -> f12`, `A -> a`, and rejection of `HyperSuperKey` before the fake runtime is called. Add a batched `computer_run` assertion proving `{type:"press_key", key:"Enter"}` reaches the runtime as canonical `return`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/computer-mcp.test.ts
```

Expected: FAIL because key is still an arbitrary string and no normalization occurs.

- [ ] **Step 3: Create one canonical key module**

Implement `src/computer-key.ts` with a literal canonical tuple and explicit alias map. Required behavior:

```ts
export function normalizeComputerKey(value: string): ComputerKeyName | null {
  const normalized = value.length === 1 ? value.toLowerCase() : value.toLowerCase();
  if (CANONICAL_SET.has(normalized as ComputerKeyName)) return normalized as ComputerKeyName;
  return COMPUTER_KEY_ALIASES[normalized] ?? null;
}
```

Alias map includes exactly:

```ts
{
  enter: "return",
  esc: "escape",
  backspace: "delete",
  forwarddelete: "forward_delete",
  pageup: "page_up",
  pagedown: "page_down",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
}
```

No whitespace trimming, fuzzy matching, keyboard-layout guessing, or arbitrary synonyms.

- [ ] **Step 4: Use one transforming Zod schema in both call paths**

Build `computerKeyInputSchema` from an explicit finite input vocabulary (canonical values, aliases, uppercase A-Z, uppercase F1-F12) and transform with `normalizeComputerKey`. Replace both current `z.string().min(1).max(128)` key fields with this schema.

Update `ComputerAction` to use `ComputerKeyName` for `press_key.key` after parsing.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/computer-mcp.test.ts
npm run build
```

Expected: PASS and generated MCP input schema presents a finite key vocabulary rather than unconstrained string input.

- [ ] **Step 6: Commit**

```bash
git add src/computer-key.ts src/computer-types.ts src/computer-tool-registration.ts tests/computer-mcp.test.ts
git commit -m "feat: normalize computer key contract"
```

---

### Task 5: Enforce bounded point recovery and `COMPUTER_NEEDS_REPLAN`

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift`

**Interfaces:**
- Adds an internal verification-failure policy (`timeout` vs `needsReplan`) to `executeVerifiedAction`.
- No public new action type and no automatic coordinate-generation API.

- [ ] **Step 1: Write RED tests for explicit-point failure behavior**

Required assertions:

```swift
func testExplicitPointVerificationFailureReturnsNeedsReplan() async throws {
    // direct point click + verification that times out
    XCTAssertEqual(response.error?.code, "COMPUTER_NEEDS_REPLAN")
}

func testSemanticTargetVerificationTimeoutKeepsComputerTimeout() async throws {
    // semantic AX/OCR target + verification timeout
    XCTAssertEqual(response.error?.code, "COMPUTER_TIMEOUT")
}

func testPointFailureDoesNotInvokeRecoveryResolverAgain() async throws {
    // resolver invocation count remains zero for direct coordinates
}
```

Add equivalent drag/scroll coverage when an action is directly coordinate-addressed.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ComputerActionServiceTests
```

Expected: FAIL because verification timeout currently always maps to `COMPUTER_TIMEOUT`.

- [ ] **Step 3: Add the internal policy, not a retry loop**

Add:

```swift
private enum VerificationFailurePolicy {
    case timeout
    case needsReplan
}
```

Pass `.needsReplan` only for actions whose physical target was explicitly supplied as coordinates/point. In `executeVerifiedAction`, map `ComputerVerificationError.timeout` according to that policy. Do not call `recovery.resolve` after a point verification failure.

- [ ] **Step 4: Keep semantic recovery unchanged and deterministic**

Verify `ComputerRecoveryEngine.resolve` still performs cached AX -> fresh AX -> OCR and stops at existing retry budget. Do not add local screenshot-to-coordinate inference. Update tests if needed to assert `point` resolution only validates geometry and returns `.explicit` confidence.

- [ ] **Step 5: Run GREEN**

```bash
swift test --package-path native/macos-computer-runtime --filter ComputerActionServiceTests
swift test --package-path native/macos-computer-runtime --filter RecoveryEngineTests
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift
git commit -m "fix: bound explicit point recovery"
```

---

### Task 6: Expose bounded perception metadata through MCP and protect privacy/audit

**Files:**
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/computer-tool-registration.ts`
- Modify: `tests/computer-mcp.test.ts`
- Modify: `tests/computer-audit.test.ts`
- Modify: `tests/computer-slice5-integration.test.ts`

**Interfaces:**
- `computer_observe` structured output includes `perception` with `axQuality`, `webContentAccessible`, `ocrUsed`, `recommendedTargeting`, and bounded `ocrCandidates`.
- Tool descriptions tell the model how to choose AX vs `ocrText` vs one-shot visual point.

- [ ] **Step 1: Write RED output-schema and guidance tests**

Update the fake observation to include:

```ts
perception: {
  axQuality: "weak",
  webContentAccessible: false,
  ocrUsed: true,
  recommendedTargeting: "ocr",
  ocrCandidates: [{
    text: "Plugins",
    bounds: { x: 100, y: 120, width: 80, height: 24 },
    confidence: 0.93,
    source: "vision-fast",
  }],
}
```

Assert `computer_observe` returns it and the tool description contains all three routing terms `ax`, `ocrText`, and `visual-point`, plus a warning against repeated blind point clicks.

- [ ] **Step 2: Add RED audit privacy test**

Run an observe result containing canary OCR text such as `OCR_PRIVATE_CANARY`, flush/read the audit fixture, and assert the canary is absent while categorical operation metadata remains present.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/computer-mcp.test.ts tests/computer-audit.test.ts tests/computer-slice5-integration.test.ts
```

Expected: FAIL because output schema/guidance does not yet expose perception metadata.

- [ ] **Step 4: Extend the Zod output schema with exact bounds**

Add strict schemas equivalent to:

```ts
const computerOcrCandidateOutputSchema = z.object({
  text: z.string().max(512),
  bounds: computerBoundsOutputSchema,
  confidence: z.number().min(0).max(1).nullable(),
  source: z.enum(["vision-fast", "vision-accurate"]),
}).strict();

const computerPerceptionOutputSchema = z.object({
  axQuality: z.enum(["strong", "partial", "weak"]),
  webContentAccessible: z.boolean().nullable(),
  ocrUsed: z.boolean(),
  recommendedTargeting: z.enum(["ax", "ocr", "visual-point"]),
  ocrCandidates: z.array(computerOcrCandidateOutputSchema).max(64),
}).strict();
```

Make `perception` part of `computerObservationOutputSchema`; keep no screenshot bytes in structured observation JSON.

- [ ] **Step 5: Update agent-facing guidance**

Change `computer_observe` description to state:

```text
Use perception.recommendedTargeting: ax => role/text/index;
ocr => prefer target.by=ocrText from returned candidates;
visual-point => obtain fresh screenshot and make at most one explicit verified point attempt.
Do not repeat blind coordinates after failure.
```

Keep the existing explicit-Computer-Use / `com.google.Chrome` / no-`browser_*` guidance intact.

- [ ] **Step 6: Run GREEN**

```bash
npx vitest run tests/computer-mcp.test.ts tests/computer-audit.test.ts tests/computer-slice5-integration.test.ts
npm run build
```

Expected: PASS, with OCR text absent from audit artifacts.

- [ ] **Step 7: Commit**

```bash
git add src/tool-output-schemas.ts src/computer-tool-registration.ts \
  tests/computer-mcp.test.ts tests/computer-audit.test.ts tests/computer-slice5-integration.test.ts
git commit -m "feat: expose bounded computer perception metadata"
```

---

### Task 7: Complete native regression coverage and deterministic fixture behavior

**Files:**
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryFixtureContractTests.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/InputSafetyTests.swift`
- Modify fixture source under `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/` only where needed to expose deterministic OCR-only/weak-AX states.
- Modify: `tests/macos-computer-runtime-fixture-package.test.ts` only if fixture packaging expectations change.

**Interfaces:**
- No new production public interface; this task hardens deterministic acceptance fixtures for the prior tasks.

- [ ] **Step 1: Add fixture assertions for weak AX -> OCR and duplicate OCR ambiguity**

Create deterministic fixture states where one visible string is OCR-only and another label is duplicated. Assert the unique OCR label resolves to `.ocr` and duplicate labels remain `COMPUTER_TARGET_AMBIGUOUS`/replan rather than choosing a coordinate.

- [ ] **Step 2: Add a takeover regression around the new OCR/replan path**

Assert a takeover signal during or immediately before physical mutation still yields `COMPUTER_USER_TAKEOVER`, releases held inputs, and does not continue with OCR/point fallback.

- [ ] **Step 3: Run focused native fixture tests**

```bash
swift test --package-path native/macos-computer-runtime --filter RecoveryFixtureContractTests
swift test --package-path native/macos-computer-runtime --filter InputSafetyTests
```

Expected: PASS.

- [ ] **Step 4: Run the complete native suite**

```bash
npm run test:computer:macos
```

Expected: all native tests PASS with only pre-existing intentional skips.

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests \
  native/macos-computer-runtime/Sources/ComputerRuntimeFixture \
  tests/macos-computer-runtime-fixture-package.test.ts
git commit -m "test: harden computer perception recovery fixtures"
```

Only stage fixture source/test paths that actually changed; do not stage untouched directories wholesale during execution.

---

### Task 8: Real-Mac acceptance, documentation, and publication gates

**Files:**
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `README.md` only where user-facing Computer Use behavior needs concise synchronization.
- Modify: `docs/PROJECT_STATE.md`
- Update Continuity `chatgpt-system-desktop` after each material acceptance milestone.

**Interfaces:**
- No new runtime interface; this task proves the exact implementation and records operational behavior.

- [ ] **Step 1: Run exact implementation full local gates before changing live runtime**

```bash
git diff --check
npm run check
npm run test:computer:macos
npm audit --omit=dev
```

Expected: all PASS; audit reports `0 vulnerabilities`.

- [ ] **Step 2: Build/package the exact tested native/runtime artifacts**

```bash
npm run build:computer:macos
npm run package:computer:macos
npm run build
```

Install/restart only through the repository's existing daily-driver/setup path; do not manually replace bundle contents or bypass signature/TCC identity.

- [ ] **Step 3: Acceptance A — stopped normal Chrome**

Precondition: user confirms Chrome may be closed for this reversible acceptance, or the test is performed at a naturally stopped Chrome state. Then:

1. open `com.google.Chrome` via `computer_open_app`;
2. verify the process is normal Google Chrome and default profile/session is used;
3. navigate to a harmless real HTML page;
4. `computer_observe` must report `webContentAccessible=true`, `axQuality=strong|partial`, and contain `AXWebArea`-derived semantics;
5. audit must contain no `browser.*` operations.

If Chrome is already running and cannot be closed safely, do not force this scenario; record it as pending and continue Acceptance B.

- [ ] **Step 4: Acceptance B — already-running Chrome with missing web AX**

With normal Chrome already running without renderer web AX:

1. record the current Chrome process identity/session state;
2. call `computer_open_app(com.google.Chrome)` and prove no restart/process replacement occurred;
3. `computer_observe` must return `webContentAccessible=false`, `axQuality=weak`, `ocrUsed=true`, and focused-window OCR candidates;
4. use one returned `ocrText` target for a harmless click and verify state change;
5. prove there was no full-screen OCR broadening and no `browser.*` call.

- [ ] **Step 5: Acceptance C — ChatGPT Web Settings -> Plugins/custom app -> Refresh**

Run the exact simple workflow through physical Computer Runtime only. Pass conditions:

```text
end-to-end duration < 120 s
browser.* operations = 0
COMPUTER_PROTOCOL_INVALID key failures = 0
blind repeated point-click attempts = 0
semantic AX/OCR targets used for the majority of controls
user takeover remains immediately effective
```

Do not interact with CAPTCHA/anti-bot challenges; stop and record the challenge if one appears.

- [ ] **Step 6: Update docs and project state from measured behavior**

Document the final observation fields, Chrome launch behavior, key aliases, and recovery ladder. `PROJECT_STATE.md` must include exact HEAD, focused/native/full-gate evidence, the two Chrome acceptance outcomes, Settings/Refresh duration, audit operation counts, and the next publication step.

- [ ] **Step 7: Commit acceptance/docs state**

```bash
git add docs/CHATGPT_INTEGRATION.md README.md docs/PROJECT_STATE.md
git commit -m "docs: record computer perception reliability acceptance"
```

Stage `README.md` only if it actually changed.

- [ ] **Step 8: Re-run exact-final-HEAD verification**

```bash
git diff --check
npm run check
npm run test:computer:macos
npm audit --omit=dev
```

Then update Continuity, obtain a fresh `project_resume`, run Linux `project_check run` and independent `project_check report`, and require PASS on the exact clean HEAD + working-tree digest.

- [ ] **Step 9: Publish only through the existing verified lifecycle**

After all local/real-Mac gates are green:

1. fresh Admin authority + exact resumed Project authority;
2. typed dual-authority `git_push`;
3. open PR;
4. verify PR exact head SHA;
5. require hosted Node 22, Node 24, and macOS native checks GREEN with merge state CLEAN;
6. squash merge with exact-head guard;
7. fast-forward local `main` to `origin/main` only;
8. rerun post-merge `npm run check` + `npm audit --omit=dev`;
9. clean only proven-merged implementation worktree/branch refs;
10. preserve `origin/feat/computer-use-bridge`;
11. checkpoint Continuity `completed` only after repository, runtime, and product acceptance evidence agree.

---

## Plan Self-Review Checklist

Before execution begins, verify all of the following against the approved spec:

- Chrome toolbar-only AX classification is covered by Task 1.
- Focused-window bounded OCR, confidence/text/candidate limits, fast/accurate policy, and no full-screen broadening are covered by Task 2.
- Existing-Chrome no-restart and stopped-Chrome renderer-accessibility launch are covered by Task 3.
- Canonical key vocabulary and aliases are covered by Task 4.
- One-shot explicit point / `COMPUTER_NEEDS_REPLAN` behavior is covered by Task 5.
- MCP output contract, agent guidance, and OCR privacy are covered by Task 6.
- Ambiguity and takeover regressions are covered by Task 7.
- Exact real-Mac acceptance, full local gates, Linux Project Check, hosted CI, merge, sync, and cleanup are covered by Task 8.
- No task introduces Browser Runtime fallback, hidden planning, Chrome for Testing, temporary profiles, silent Chrome restart, full-screen automatic OCR, or safety-boundary relaxation.
