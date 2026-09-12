# Computer Runtime v2 Slice 5 Recovery/Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast hybrid semantic/visual target resolution, stale-target protection, bounded recovery, Apple Vision OCR fallback, and local multi-step execution so Computer Runtime can act reliably without one model round trip per physical action.

**Architecture:** Keep deterministic perception/recovery in the native Swift host: bounded observation cache, AX resolver, Vision OCR, capability hints, stale validation, and a two-retry recovery engine. TypeScript remains the policy/schema/orchestration boundary and exposes the same native resolver to typed `computer_run` and full-host `computer_run_js`; Browser Runtime remains preferred for normal semantic web work.

**Tech Stack:** Swift 6, AppKit/Accessibility, ScreenCaptureKit, Vision, CoreGraphics, TypeScript, Zod, Node.js worker/IPC, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-computer-runtime-v2-slice5-recovery-vision-design.md`

## Global Constraints

- ChatGPT remains the only reasoning agent; no local LLM/planner/OODA loop.
- AX is the preferred fast path but never assumed universal.
- OCR is automatic only after relevant AX failure/weakness or explicit `ocrText`; do not run OCR on ordinary successful AX paths.
- OCR may satisfy only text-addressable targets; it must not invent semantic roles.
- Maximum automatic recovery retries per action is exactly `2`; MCP/JS cannot raise it.
- Never invent a coordinate after failed semantic lookup; only an explicitly supplied point may be used as point fallback.
- Every resolved target is short-lived and must be revalidated before mutation.
- `COMPUTER_USER_TAKEOVER`, cancellation, permission loss, unsafe topology, and exhausted budget stop recovery immediately.
- Screenshots, OCR text, AX document text, typed text, JS source/output, lease IDs, and secrets must not enter audit metadata.
- Existing Browser Runtime remains preferred for ordinary semantic browser work.
- No push and no `main` merge without explicit user authorization.

---

## File Structure

### Native core

- Create `native/macos-computer-runtime/Sources/ComputerRuntimeCore/TargetModels.swift` — public Codable target/query/resolution/OCR models shared by protocol and tests.
- Create `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerObservationCache.swift` — bounded current-window observation cache and capability hints.
- Create `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerTargetResolver.swift` — deterministic AX/text/index/point matching and stale validation.
- Create `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemVisionOCR.swift` — Vision OCR adapter over bounded `CGImage` captures.
- Create `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift` — retry ladder and semantic-to-physical resolution.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift` — focused protocols for capture/OCR/cache dependencies.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift` — factor the existing ScreenCaptureKit path so internal OCR can consume `CGImage` directly without PNG/base64 round trips.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift` — wire cache/resolver/OCR/recovery and protocol methods.
- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift` — accept semantic targets for physical mutations and delegate recovery before actuation.
- Reuse `SystemScreenshot.swift` and `SystemScreenRegionDigest.swift`; do not create a second capture stack.

### TypeScript control plane

- Modify `src/computer-types.ts` — public target types, native methods, semantic action unions.
- Modify `src/config.ts` — fixed bounded retry configuration with default/max `2`.
- Modify `src/computer-runtime.ts` — resolve/resolveMany/exists/refresh observation and semantic target action preparation.
- Modify `src/computer-js-protocol.ts`, `src/computer-js-rpc.ts`, `src/computer-js-runner.ts` — add parent-mediated `resolve`, `resolveMany`, `exists`, `refreshObservation`.
- Modify `src/computer-tool-registration.ts` only where typed MCP schemas need semantic targets; do not expose raw native handles.
- Modify audit tests/metadata only to add content-free `sourceClass`, `recoveryCount`, `ocrInvoked`, and duration/count fields if needed.

### Fixture/tests

- Modify `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureInteractionView.swift` — stale reorder target, duplicate ambiguity, OCR-only custom view, deterministic region change.
- Create focused Swift tests for cache, resolver, OCR, recovery.
- Extend existing TypeScript runtime/JS/MCP/audit tests rather than duplicating full suites.

---

### Task 1: Native target models and bounded observation cache

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/TargetModels.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerObservationCache.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationCacheTests.swift`

**Interfaces:**
- Produces `ComputerTarget`, `ResolvedComputerTarget`, `ComputerResolvedTargetView`, `PerceptionCapabilityProfile`, and `CachedComputerObservation`.
- Produces `ComputerObservationCaching` with `store`, `current`, `invalidate`, and `updateCapability`.
- Later tasks consume these exact types; no raw `AXUIElement` or PID appears in them.

- [ ] **Step 1: Write failing cache/model tests**

```swift
func testCacheReturnsOnlyCompatibleWindowGeneration() {
    let cache = ComputerObservationCache(capacity: 4)
    let first = cachedObservation(id: "obs-1", app: "com.example.fixture", window: "window-A", generation: "gen-1")
    cache.store(first)

    XCTAssertEqual(cache.current(appIdentity: "com.example.fixture", windowIdentity: "window-A", windowGeneration: "gen-1")?.observationId, "obs-1")
    XCTAssertNil(cache.current(appIdentity: "com.example.fixture", windowIdentity: "window-A", windowGeneration: "gen-2"))
}

func testCacheCapabilityProfileContainsNoDocumentText() {
    let profile = PerceptionCapabilityProfile(axQuality: .weak, ocrUseful: .yes, windowGeneration: "gen-1")
    let encoded = try! JSONEncoder().encode(profile)
    let json = String(decoding: encoded, as: UTF8.self)
    XCTAssertFalse(json.contains("Fixture Button"))
}
```

- [ ] **Step 2: Run RED test**

Run: `swift test --package-path native/macos-computer-runtime --filter ObservationCacheTests`
Expected: FAIL because the models/cache do not exist.

- [ ] **Step 3: Add target/cache models**

```swift
public enum ComputerTarget: Codable, Equatable, Sendable {
    case index(snapshotId: String, index: Int)
    case role(role: String, name: String?, exact: Bool)
    case text(text: String, exact: Bool)
    case label(label: String, exact: Bool)
    case ocrText(text: String, exact: Bool)
    case point(x: Double, y: Double)
}

public enum ComputerTargetSource: String, Codable, Sendable { case ax, ocr, point }
public enum ComputerTargetConfidence: String, Codable, Sendable { case deterministic, high, explicit }
public enum AXQuality: String, Codable, Sendable { case unknown, strong, partial, weak }
public enum OCRUsefulness: String, Codable, Sendable { case unknown, yes, no }
public enum VisionRecognitionMode: String, Codable, Sendable { case fast, accurate }

public struct OcrTextCandidate: Codable, Equatable, Sendable {
    public let text: String
    public let bounds: ComputerBounds
    public let confidence: Float?
    public let source: VisionRecognitionMode
    public let observationId: String
}

public struct PerceptionCapabilityProfile: Codable, Equatable, Sendable {
    public let axQuality: AXQuality
    public let ocrUseful: OCRUsefulness
    public let windowGeneration: String
}

public struct ResolvedComputerTarget: Equatable, Sendable {
    public let source: ComputerTargetSource
    public let bounds: ComputerBounds
    public let actionPoint: ComputerPoint
    public let observationId: String?
    public let appIdentity: String
    public let windowIdentity: String
    public let windowGeneration: String
    public let displayTopologyDigest: String
    public let confidence: ComputerTargetConfidence
    public let semanticFingerprint: String?
}

public struct ComputerResolvedTargetView: Codable, Equatable, Sendable {
    public let source: ComputerTargetSource
    public let bounds: ComputerBounds
    public let actionPoint: ComputerPoint
    public let observationId: String?
    public let confidence: ComputerTargetConfidence
}

public struct CachedComputerObservation: Equatable, Sendable {
    public let observationId: String
    public let appIdentity: String
    public let windowIdentity: String
    public let windowGeneration: String
    public let displayTopologyDigest: String
    public let observation: ComputerObservation
    public let capability: PerceptionCapabilityProfile
}
```

Implement custom `Codable` for `ComputerTarget` so protocol JSON is exactly `{"by":"text",...}` / `{"by":"role",...}` / etc.; do not rely on Swift associated-value enum synthesis. `windowIdentity` is an opaque in-memory digest, never raw window text in audit/output; `windowGeneration` is a process-local generation token refreshed when the focused-window identity changes.

Implement `ComputerObservationCache` as an in-memory bounded actor or lock-protected Sendable type. Store at most 4 current-generation entries; invalidate on app/window/generation/topology mismatch. Capability profile stores only categories/timestamps/generation.

- [ ] **Step 4: Run GREEN cache tests and full native focused tests**

Run: `swift test --package-path native/macos-computer-runtime --filter ObservationCacheTests`
Expected: PASS.

Run: `swift test --package-path native/macos-computer-runtime --filter ObservationTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeCore/TargetModels.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerObservationCache.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationCacheTests.swift
git commit -m "feat: add bounded computer observation cache"
```

---

### Task 2: Deterministic AX resolver and stale-target validation

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerTargetResolver.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/TargetResolverTests.swift`

**Interfaces:**
- Consumes `CachedComputerObservation`, `ComputerTarget`, current display-topology digest.
- Produces `resolve(target:in:) throws -> ResolvedComputerTarget` and `resolveMany(targets:in:) throws -> [ResolvedComputerTarget]`.
- Defines internal errors `notFound`, `ambiguous`, `staleSnapshot`, `unsafeGeometry` mapped later to stable protocol errors.

- [ ] **Step 1: Write RED tests for exact matching, ambiguity, stale index, and unsafe geometry**

```swift
func testRoleTargetResolvesOneExactCandidate() throws {
    let observation = fixtureObservation(elements: [
        element(index: 2, role: "AXButton", title: "Run", bounds: bounds(10, 10, 80, 30)),
    ])
    let resolved = try ComputerTargetResolver().resolve(
        target: .role(role: "AXButton", name: "Run", exact: true),
        in: context(observation)
    )
    XCTAssertEqual(resolved.source, .ax)
    XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 50, y: 25))
}

func testDuplicateTextIsAmbiguous() {
    XCTAssertThrowsError(try resolver.resolve(target: .text(text: "Save", exact: true), in: duplicateContext)) {
        XCTAssertEqual($0 as? ComputerTargetResolutionError, .ambiguous)
    }
}

func testOldIndexSnapshotIsStale() {
    XCTAssertThrowsError(try resolver.resolve(target: .index(snapshotId: "old", index: 3), in: currentContext)) {
        XCTAssertEqual($0 as? ComputerTargetResolutionError, .staleSnapshot)
    }
}
```

- [ ] **Step 2: Verify RED**

Run: `swift test --package-path native/macos-computer-runtime --filter TargetResolverTests`
Expected: FAIL because resolver does not exist.

- [ ] **Step 3: Implement deterministic resolver**

Rules implemented literally:
- index requires matching `snapshotId` plus valid index/fingerprint/geometry;
- role matches exact role and optional normalized title/description name;
- text searches title/description only;
- label uses AX title/description only in this task;
- `ocrText` returns `notFound` here so OCR is a separate path;
- point validates finite coordinates and current display bounds;
- disabled (`enabled == false`), zero-size, non-finite, or off-display semantic candidates cannot mutate;
- non-exact text matching is normalized containment, never fuzzy similarity.

- [ ] **Step 4: Run resolver GREEN and regression suite**

Run: `swift test --package-path native/macos-computer-runtime --filter TargetResolverTests`
Expected: PASS.

Run: `swift test --package-path native/macos-computer-runtime --filter ObservationTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerTargetResolver.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/TargetResolverTests.swift
git commit -m "feat: resolve semantic computer targets"
```

---

### Task 3: Apple Vision OCR adapter with fast/accurate bounded fallback

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemVisionOCR.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/VisionOCRTests.swift`

**Interfaces:**
- Produces `VisionTextRecognizing` protocol:

```swift
protocol VisionTextRecognizing: Sendable {
    func recognizeText(in image: CGImage, mode: VisionRecognitionMode) async throws -> [OcrTextCandidate]
}

protocol ScreenImageCapturing: Sendable {
    func captureMainDisplayImage() async throws -> CGImage
}
```

- `SystemScreenshotCapturer` conforms to `ScreenImageCapturing` and keeps the existing `SCScreenshotManager.captureImage(...)` implementation as the single capture stack. Its public PNG screenshot method encodes the returned `CGImage`; internal OCR consumes that image directly.
- `SystemVisionOCR` uses `VNRecognizeTextRequest` + `VNImageRequestHandler(cgImage:)` for macOS 14 compatibility, with `.fast` and `.accurate` recognition levels.
- OCR candidates are bounded to 256 observations, 4096 chars per string, finite normalized geometry converted to screen/crop geometry by a tested helper.

- [ ] **Step 1: Write RED adapter tests using an injectable fake Vision backend**

```swift
func testOcrBoundsCandidateCountAndTextLength() async throws {
    let backend = FakeVisionBackend(repeating: 400, text: String(repeating: "x", count: 5000))
    let ocr = SystemVisionOCR(backend: backend)
    let results = try await ocr.recognizeText(in: onePixelImage(), mode: .fast)
    XCTAssertEqual(results.count, 256)
    XCTAssertTrue(results.allSatisfy { $0.text.count <= 4096 })
}

func testOcrDoesNotInventControlRoles() async throws {
    let results = try await ocr.recognizeText(in: image(), mode: .accurate)
    let encoded = try JSONEncoder().encode(results)
    XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("AXButton"))
}
```

- [ ] **Step 2: Run RED**

Run: `swift test --package-path native/macos-computer-runtime --filter VisionOCRTests`
Expected: FAIL because OCR protocol/adapter does not exist.

- [ ] **Step 3: Factor direct-CGImage capture and implement Vision adapter**

Factor `SystemScreenshotCapturer` so both explicit screenshots and OCR share one `SCScreenshotManager.captureImage(...)` call path. Use `VNRecognizeTextRequest` over the direct `CGImage`; wrap its completion API in a bounded async helper. Expose only text, bounds, confidence, source mode, and observation ID. Do not PNG/base64 encode for internal OCR. Convert Vision normalized bottom-left coordinates into capture-space bounds in one helper with dedicated tests.

- [ ] **Step 4: Run GREEN and package build**

Run: `swift test --package-path native/macos-computer-runtime --filter VisionOCRTests`
Expected: PASS.

Run: `swift build --package-path native/macos-computer-runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemVisionOCR.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/VisionOCRTests.swift
git commit -m "feat: add bounded Vision OCR fallback"
```

---

### Task 4: Hybrid recovery engine and capability profile

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/HostServiceTests.swift`

**Interfaces:**
- Consumes workspace, AX reader, cache, resolver, screenshot/crop provider, Vision OCR, display topology.
- Produces:

```swift
func resolve(_ target: ComputerTarget, retryBudget: Int = 2) async throws -> ResolvedComputerTarget
func resolveMany(_ targets: [ComputerTarget], retryBudget: Int = 2) async throws -> [ResolvedComputerTarget]
func refreshObservation() throws -> ComputerObservation
```

- Native protocol gains `resolve_target` and `resolve_targets`; `observe` remains the explicit fresh observation operation.

- [ ] **Step 1: Write RED state-machine tests**

```swift
func testAxSuccessNeverInvokesOcr() async throws {
    let ocr = CountingOCR()
    let engine = makeEngine(ax: .oneButton("Run"), ocr: ocr)
    _ = try await engine.resolve(.text(text: "Run", exact: true))
    XCTAssertEqual(await ocr.callCount, 0)
}

func testWeakAxFallsBackFastThenAccurateOcrWithinTwoRetries() async throws {
    let ocr = SequencedOCR(fast: [], accurate: [candidate("Canvas Submit")])
    let engine = makeEngine(ax: .empty, ocr: ocr)
    let result = try await engine.resolve(.ocrText(text: "Canvas Submit", exact: true))
    XCTAssertEqual(result.source, .ocr)
    XCTAssertEqual(await ocr.modes, [.fast, .accurate])
}
```

Also test ambiguity returns `needsReplan`, and takeover/permission errors are terminal with retry count never exceeding 2.

- [ ] **Step 2: Verify RED**

Run: `swift test --package-path native/macos-computer-runtime --filter RecoveryEngineTests`
Expected: FAIL because engine does not exist.

- [ ] **Step 3: Implement recovery ladder**

Implement exactly:
1. compatible cached AX resolve;
2. fresh AX observation + resolve;
3. if applicable refocus intended app/window, fresh AX resolve;
4. for text-addressable targets only: fast OCR; if not uniquely acceptable, bounded accurate OCR;
5. explicit point target only when caller supplied it;
6. throw `needsReplan`.

Capability hints may skip redundant AX after `axQuality == .weak` for the same window generation. They never suppress a permission/takeover check.

- [ ] **Step 4: Wire protocol methods and stable errors**

`ComputerHostService.handle` accepts strict params:

```json
{"target":{"by":"text","text":"Run","exact":true},"retryBudget":2}
```

and:

```json
{"targets":[...],"retryBudget":2}
```

Reject retry budgets outside `0...2`. Map missing/ambiguous/stale/focus/needs-replan to existing stable computer error codes without raw AX/Vision text.

- [ ] **Step 5: Run GREEN**

Run: `swift test --package-path native/macos-computer-runtime --filter RecoveryEngineTests`
Expected: PASS.

Run: `swift test --package-path native/macos-computer-runtime --filter HostServiceTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/HostServiceTests.swift
git commit -m "feat: add bounded computer recovery engine"
```

---

### Task 5: Semantic physical actions with revalidation-before-mutation

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/MouseActionTests.swift`

**Interfaces:**
- Existing `move_mouse`, `click`, `double_click`, `drag`, and positioned `scroll` accept either explicit coordinates or semantic target objects, never both.
- Action service resolves/revalidates target immediately before controller mutation using the shared recovery engine.
- `drag` accepts `from` and `to` as either point or semantic target endpoints.

- [ ] **Step 1: Write RED semantic-action tests**

```swift
func testSemanticClickResolvesImmediatelyBeforeMouseDown() async {
    let recovery = FakeRecoveryEngine(resolved: resolvedButton(centerX: 120, centerY: 80))
    let service = makeActionService(recovery: recovery)
    let response = await service.handleAction(semanticClickRequest)
    XCTAssertTrue(response?.ok == true)
    XCTAssertEqual(recovery.resolveCallCount, 1)
    XCTAssertEqual(eventSink.lastClickPoint, ComputerPoint(x: 120, y: 80))
}

func testSemanticClickNeverFallsBackToOldCoordinateWhenRevalidationFails() async {
    let recovery = FakeRecoveryEngine(error: .needsReplan)
    let response = await service.handleAction(semanticClickRequest)
    XCTAssertEqual(response?.error?.code, "COMPUTER_NEEDS_REPLAN")
    XCTAssertEqual(eventSink.mouseDownCount, 0)
}
```

- [ ] **Step 2: Verify RED**

Run: `swift test --package-path native/macos-computer-runtime --filter ComputerActionServiceTests`
Expected: FAIL on target params.

- [ ] **Step 3: Extend strict parsers and action execution**

For each targeted physical action, parse one of:

```text
{x,y,...}
{target:{...}, retryBudget?:0|1|2,...}
```

Never permit both. Resolve target under the physical-action lane immediately before actuation. Keep existing verification baseline/action/result behavior and takeover cleanup.

- [ ] **Step 4: Run physical-action regression tests**

Run: `swift test --package-path native/macos-computer-runtime --filter ComputerActionServiceTests`
Expected: PASS.

Run: `swift test --package-path native/macos-computer-runtime --filter MouseActionTests`
Expected: PASS.

Run: `swift test --package-path native/macos-computer-runtime --filter InputSafetyTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/MouseActionTests.swift
git commit -m "feat: add semantic native computer actions"
```

---

### Task 6: TypeScript target contract, runtime, and typed `computer_run`

**Files:**
- Modify: `src/computer-types.ts`
- Modify: `src/config.ts`
- Modify: `src/computer-runtime.ts`
- Modify: `src/computer-tool-registration.ts`
- Test: `tests/computer-runtime.test.ts`
- Test: `tests/computer-mcp.test.ts`
- Test: `tests/computer-config.test.ts`

**Interfaces:**

```ts
export type ComputerTarget =
  | { by: "index"; snapshotId: string; index: number }
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string; exact?: boolean }
  | { by: "ocrText"; text: string; exact?: boolean }
  | { by: "point"; x: number; y: number };
```

`ComputerUseConfig.maxAutomaticRetriesPerAction` defaults to and is capped at `2`.

`ComputerRuntime` adds:

```ts
resolve(target: ComputerTarget, options?: { retryBudget?: number }): Promise<ComputerResolvedTargetView>
resolveMany(targets: ComputerTarget[], options?: { retryBudget?: number }): Promise<ComputerResolvedTargetView[]>
exists(target: ComputerTarget, options?: { retryBudget?: number }): Promise<boolean>
refreshObservation(): Promise<unknown>
```

- [ ] **Step 1: Write RED TypeScript tests**

```ts
it("caps semantic recovery budget at two", async () => {
  await expect(runtime.resolve({ by: "text", text: "Run" }, { retryBudget: 3 }))
    .rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
});

it("sends semantic click target without converting it to guessed coordinates", async () => {
  await runtime.run({ actions: [{ type: "click", target: { by: "text", text: "Run", exact: true } }] });
  expect(native.lastRequest).toMatchObject({ method: "click", params: { target: { by: "text", text: "Run", exact: true } } });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/computer-runtime.test.ts tests/computer-config.test.ts tests/computer-mcp.test.ts`
Expected: FAIL because target methods/types/config do not exist.

- [ ] **Step 3: Extend types/config/native method list**

Add `resolve_target` and `resolve_targets` to `COMPUTER_NATIVE_METHODS`. Add strict target canonicalization helper in `computer-runtime.ts`; reject unknown fields, empty strings, invalid index, non-finite point, targets > 100 in `resolveMany`, and retry budget outside `0..2`.

Extend `ComputerAction` point-bearing variants so `move_mouse`, `click`, `double_click`, positioned `scroll`, and drag endpoints accept semantic targets without losing existing coordinate compatibility.

- [ ] **Step 4: Implement runtime methods and typed action preparation**

`resolve`/`resolveMany` call native resolver methods. `exists` returns false only for `COMPUTER_TARGET_NOT_FOUND`; ambiguity/stale/permission/takeover errors propagate. `refreshObservation()` calls ordinary fresh `observe()`.

- [ ] **Step 5: Run GREEN TypeScript focused suite**

Run: `npx vitest run tests/computer-runtime.test.ts tests/computer-config.test.ts tests/computer-mcp.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/computer-types.ts src/config.ts src/computer-runtime.ts src/computer-tool-registration.ts \
  tests/computer-runtime.test.ts tests/computer-config.test.ts tests/computer-mcp.test.ts
git commit -m "feat: expose semantic computer targets"
```

---

### Task 7: Full-host JS semantic resolver fast path

**Files:**
- Modify: `src/computer-js-protocol.ts`
- Modify: `src/computer-js-rpc.ts`
- Modify: `src/computer-js-runner.ts`
- Modify: `src/computer-runtime.ts` (`ComputerProgramSession` only)
- Test: `tests/computer-js-runtime.test.ts`
- Test: `tests/computer-js-runner.test.ts`
- Test: `tests/computer-js-integration.test.ts`

**Interfaces:**
- Add RPC methods `resolve`, `resolve_many`, `exists`, `refresh_observation`.
- JS surface:

```js
await computer.resolve(target, options)
await computer.resolveMany(targets, options)
await computer.exists(target, options)
await computer.refreshObservation()
```

- All calls stay parent-mediated; user JS never receives raw AX pointers or a retry-unbounded primitive.

- [ ] **Step 1: Write RED JS protocol tests**

```ts
it("exposes resolveMany through the fixed computer proxy", async () => {
  const result = await runSource(`
    const targets = await computer.resolveMany([
      { by: "text", text: "Name", exact: true },
      { by: "text", text: "Submit", exact: true }
    ]);
    return targets.length;
  `);
  expect(result.result).toBe(2);
  expect(rpcMethods).toEqual(["resolve_many"]);
});
```

Also test `exists` returns false only for not-found and does not swallow ambiguous/permission/takeover.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/computer-js-runtime.test.ts tests/computer-js-runner.test.ts tests/computer-js-integration.test.ts`
Expected: FAIL because RPC methods do not exist.

- [ ] **Step 3: Extend strict RPC schemas and session**

Add Zod target schema once in `computer-js-rpc.ts`; max 100 targets; retry budget max 2. Extend `ComputerProgramSession` with typed methods that call the same `ComputerRuntime.resolve*` implementation, not duplicated resolver logic.

- [ ] **Step 4: Extend frozen JS proxy**

```js
resolve: (target, options = {}) => rpc("resolve", { target, ...options }),
resolveMany: (targets, options = {}) => rpc("resolve_many", { targets, ...options }),
exists: (target, options = {}) => rpc("exists", { target, ...options }),
refreshObservation: () => rpc("refresh_observation", {}),
```

- [ ] **Step 5: Run GREEN and real-runner integration suite**

Run: `npx vitest run tests/computer-js-runtime.test.ts tests/computer-js-runner.test.ts tests/computer-js-integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/computer-js-protocol.ts src/computer-js-rpc.ts src/computer-js-runner.ts src/computer-runtime.ts \
  tests/computer-js-runtime.test.ts tests/computer-js-runner.test.ts tests/computer-js-integration.test.ts
git commit -m "feat: add semantic computer js fast path"
```

---

### Task 8: Deterministic fixture for stale, ambiguity, OCR-only, and multi-step recovery

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureInteractionView.swift`
- Test/Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryFixtureContractTests.swift`
- Extend: `tests/macos-computer-runtime-fixture-package.test.ts`
- Create: `tests/computer-slice5-integration.test.ts`

**Interfaces:**
- Fixture adds deterministic controls/state only; no network/user data.
- Add custom-drawn OCR-only target text `Fixture Visual Submit` with no useful AX role/title.
- Add duplicate `Duplicate Action` labels to test ambiguity.
- Add `Reorder Targets` control that changes AX element ordering/generation deterministically.
- Add a visual status rectangle whose pixels change after OCR-only target click.

- [ ] **Step 1: Write RED fixture contract tests**

Assert source/package contains OCR-only custom view, deterministic stale reorder trigger, duplicate semantic label pair, and existing standard AX controls.

Run: `npx vitest run tests/macos-computer-runtime-fixture-package.test.ts`
Expected: FAIL on new fixture requirements.

- [ ] **Step 2: Extend fixture minimally**

Custom OCR-only view draws text but deliberately does not set accessibility role/title/label. Its click handler sets `statusLabel` to `visual-submit-clicked` and changes a bounded visual region. Reorder trigger rebuilds two semantic buttons in reverse order and updates a generation status marker.

- [ ] **Step 3: Add integration tests with fake/native protocol boundary**

`tests/computer-slice5-integration.test.ts` must prove:
- semantic AX target action uses no OCR call;
- stale index cannot actuate old geometry;
- text target recovers after reorder from fresh observation;
- duplicate target returns ambiguous/needs-replan without click;
- OCR-only target follows fast/accurate bounded pipeline;
- 5+ semantic actions can execute in one `computer_run_js` with one runner invocation.

- [ ] **Step 4: Run fixture/integration GREEN**

Run: `npx vitest run tests/macos-computer-runtime-fixture-package.test.ts tests/computer-slice5-integration.test.ts`
Expected: PASS.

Run: `swift test --package-path native/macos-computer-runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureInteractionView.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryFixtureContractTests.swift \
  tests/macos-computer-runtime-fixture-package.test.ts tests/computer-slice5-integration.test.ts
git commit -m "test: cover slice 5 recovery fixture"
```

---

### Task 9: Audit/performance metadata, exact-head verification, and real-Mac acceptance

**Files:**
- Modify only if required: `src/computer-tool-registration.ts`, `src/audit.ts`, `tests/computer-audit.test.ts`, `docs/CHATGPT_INTEGRATION.md`
- No feature expansion in this task; evidence-driven fixes only.

**Interfaces:**
- Audit may record content-free fields only: `sourceClass`, `recoveryCount`, `ocrInvoked`, candidate count, action count, duration, stable error.
- Real-Mac acceptance records timing distributions outside user-content logs.

- [ ] **Step 1: Add/adjust RED audit tests before any audit code change**

```ts
expect(auditLine).toContain('"ocrInvoked":true');
expect(auditLine).not.toContain("Fixture Visual Submit");
expect(auditLine).not.toContain("pngBase64");
expect(auditLine).not.toContain("typed secret canary");
```

Run: `npx vitest run tests/computer-audit.test.ts`
Expected: FAIL only if metadata implementation is needed.

- [ ] **Step 2: Implement minimal content-free instrumentation**

Do not persist screenshots/OCR/AX text. Use `performance.now()`/`ContinuousClock` for timings and integer counts only.

- [ ] **Step 3: Run full exact-head automated verification**

Run in this order:

```bash
swift test --package-path native/macos-computer-runtime
npm run check
npm audit --omit=dev
git diff --check
```

Expected: all Swift tests PASS; all default Node/TS tests PASS; audit reports 0 vulnerabilities; diff check exits 0.

- [ ] **Step 4: Install exact-head native bundle identity-preserving**

Run:

```bash
npm run setup:computer:macos
```

Expected: installer reuses existing stable signing identity/designated requirement and reports `tccIdentityStable: true`.

- [ ] **Step 5: Run deterministic real-Mac fixture acceptance**

Prove on the installed exact build:
1. AX target resolve/click without OCR.
2. stale target caused intentionally, old geometry not clicked, fresh semantic recovery succeeds.
3. duplicate semantic target fails closed without physical click.
4. OCR-only custom target resolves and clicks via Vision.
5. region/AX verification confirms effect.
6. one `computer_run_js` performs at least 5 local steps without five ChatGPT/tool round trips.
7. physical user takeover interrupts and releases held input.
8. emergency chord remains functional.

Record only categorical results and timing/count metadata.

- [ ] **Step 6: Run harmless real-app smoke**

Use Calculator/TextEdit/Finder/System Settings/Chromium with no destructive settings/account/purchase actions. Measure warm AX resolve, screenshot, OCR crop, multi-step throughput. If a deterministic failure appears, return to TDD in the smallest owning task; do not patch directly in acceptance code.

- [ ] **Step 7: Update integration documentation and commit**

Document delivered Slice 5 behavior, routing policy, explicit limitations, and acceptance evidence in `docs/CHATGPT_INTEGRATION.md`.

```bash
git add src/audit.ts src/computer-tool-registration.ts tests/computer-audit.test.ts docs/CHATGPT_INTEGRATION.md
git commit -m "docs: finalize computer runtime slice 5"
```

Stage only files that actually changed; omit unchanged paths.

- [ ] **Step 8: Final exact-head gate**

After the final commit, rerun:

```bash
swift test --package-path native/macos-computer-runtime
npm run check
npm audit --omit=dev
git diff --check origin/main...HEAD
git status --short
```

Expected: all tests GREEN, 0 vulnerabilities, diff-check PASS, clean worktree. Do not push or merge `main`.
