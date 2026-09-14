# Computer Use Agent Reliability v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit Computer Use reliably expose interaction structure, guard pointer/scroll focus, provide bounded semantic scrolling, and report verification evidence so GPT-5.6 Sol can complete real Chrome / ChatGPT Web workflows without blind retries.

**Architecture:** Extend the existing native AX observation and recovery pipeline instead of adding a planner. Preserve semantic target context through mutation, add deterministic bounded scroll orchestration in the TypeScript runtime, and expose richer but bounded MCP contracts. Keep Browser Runtime separate and retain all current takeover/TCC/focus safety invariants.

**Tech Stack:** Swift 6 / AppKit Accessibility / ScreenCaptureKit / Vision; TypeScript; Zod; Vitest; Swift XCTest.

**Spec:** `docs/superpowers/specs/2026-09-14-computer-use-agent-reliability-v2-design.md`

## Global Constraints

- Do not add a local LLM or hidden autonomous planner.
- Explicit Computer Use stays on `computer_*`; do not substitute `browser_*`.
- Do not restart an already-running normal Chrome process.
- Do not weaken TCC, focus, takeover, CAPTCHA/anti-bot, or physical-input safety.
- Keep all retries and scroll loops bounded; maximum semantic scroll steps is 6.
- Do not automatically repeat raw point coordinates against unchanged state.
- Preserve unrelated `scripts/setup-daily-driver.mjs` and `tests/setup-daily-driver.test.ts` changes exactly.
- No push/PR/merge without separate user publication authorization.

---

### Task 1: AX hierarchy, supported actions, and scroll metadata

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemAccessibility.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerVerification.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/PerceptionTests.swift`

**Interfaces:**
- Produces `ComputerElementView.parentIndex: Int?`, `depth: Int`, `actions: [String]`, and `scroll: ComputerScrollCapabilityView`.
- `ComputerScrollCapabilityView` exposes `scrollable: Bool` and `axes: [ComputerScrollAxis]`.

- [ ] **Step 1: Write failing model/observation tests**

Add assertions equivalent to:

```swift
XCTAssertEqual(child.parentIndex, 0)
XCTAssertEqual(child.depth, 1)
XCTAssertTrue(scrollArea.scroll.scrollable)
XCTAssertTrue(scrollArea.scroll.axes.contains(.vertical))
XCTAssertLessThanOrEqual(scrollArea.actions.count, 16)
```

and verify sanitization/digest preserve the new fields.

- [ ] **Step 2: Run focused native tests and confirm RED**

Run:

```bash
swift test --package-path native/macos-computer-runtime --filter ObservationTests
swift test --package-path native/macos-computer-runtime --filter PerceptionTests
```

Expected: compile/test failure because the new fields/types do not exist.

- [ ] **Step 3: Implement bounded metadata**

Introduce:

```swift
public enum ComputerScrollAxis: String, Codable, Equatable, Sendable {
    case vertical
    case horizontal
}

public struct ComputerScrollCapabilityView: Codable, Equatable, Sendable {
    public let scrollable: Bool
    public let axes: [ComputerScrollAxis]
}
```

Extend `ComputerElementView` with the four new fields. In `SystemAccessibilityReader.traverse`, pass `parentIndex` and `depth`, read `AXUIElementCopyActionNames`, cap actions at 16 and each action string at 128 characters, and derive scroll evidence only from AX roles/action names. Never infer scrollability from OCR.

- [ ] **Step 4: Preserve metadata through sanitization/digests**

Update every `ComputerElementView(...)` reconstruction and `ObservationDigest.Payload` serialization path so structural metadata participates in stale/change detection.

- [ ] **Step 5: Run focused tests GREEN**

Run the two commands from Step 2 and require PASS.

- [ ] **Step 6: Commit only Task 1 files**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemAccessibility.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerVerification.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/PerceptionTests.swift
git commit -m "feat: expose computer interaction structure"
```

### Task 2: Scoped semantic target resolution

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/TargetModels.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerTargetResolver.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/RecoveryEngineTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/TargetResolverTests.swift`

**Interfaces:**
- Semantic target cases gain optional `within: ComputerTargetScope?`.
- `ComputerTargetScope` supports AX index and role/name forms only.

- [ ] **Step 1: Write RED tests for descendant scoping**

Fixture: two `Refresh` elements, one descendant of modal container index 10 and one background sibling. Assert unscoped target is ambiguous and scoped target resolves modal descendant only.

- [ ] **Step 2: Write RED OCR containment test**

Given two OCR `Refresh` candidates, assert a scoped container bounds filter returns only the candidate geometrically contained by that container.

- [ ] **Step 3: Run resolver/recovery tests and confirm RED**

```bash
swift test --package-path native/macos-computer-runtime --filter TargetResolverTests
swift test --package-path native/macos-computer-runtime --filter RecoveryEngineTests
```

- [ ] **Step 4: Implement ancestry and OCR bounds filtering**

Use `parentIndex` chains from the cached observation. Scope must resolve uniquely before filtering. Preserve fail-closed ambiguity/stale behavior.

- [ ] **Step 5: Update strict native target parsing**

Accept `within` only on semantic targets and reject it for `point` targets or malformed scopes.

- [ ] **Step 6: Run focused tests GREEN and commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeCore \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerTargetResolver.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerRecoveryEngine.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests
git commit -m "feat: scope computer semantic targets"
```

### Task 3: Pointer and scroll focus/window guards

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerInputController.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/MouseActionTests.swift`

**Interfaces:**
- Add `InputContextGuard` with `verifyExpectedContext() async throws`.
- Semantic `moveMouse`, `click`, `doubleClick`, `drag`, and positioned `scroll` preserve a guard until the physical event boundary.

- [ ] **Step 1: Add RED tests for focus changes after resolution**

Arrange semantic target resolution under Chrome, then switch fake frontmost app/window before mouse-down/scroll emission. Assert no mutation event is emitted and response maps to `COMPUTER_FOCUS_FAILED` or stale as specified.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ComputerActionServiceTests
swift test --package-path native/macos-computer-runtime --filter MouseActionTests
```

- [ ] **Step 3: Implement context guard**

Keep resolved app/window/topology context through `resolveActionPoint`; verify before pointer movement and immediately before mouse-down/up/scroll. Preserve takeover checks around every guard.

- [ ] **Step 4: Verify explicit point compatibility**

Explicit point actions use current frontmost app guard only when a caller supplied an app selector; otherwise they retain existing geometry/takeover behavior and never claim semantic stability.

- [ ] **Step 5: Run focused tests GREEN and commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerInputController.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ComputerActionServiceTests.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/MouseActionTests.swift
git commit -m "fix: guard pointer actions against focus drift"
```

### Task 4: Action-aware completion evidence

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/computer-types.ts`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/VerificationTests.swift`
- Test: `tests/computer-mcp.test.ts`
- Test: `tests/computer-runtime.test.ts`

**Interfaces:**
- `ComputerActionResult.state` becomes `verified | completed_unverified` for successful mutations.
- Optional verification evidence is bounded and categorical.

- [ ] **Step 1: Write RED native tests**

Assert no-verification click returns `completed_unverified`; a passing `ax_changed` or screen-region verification returns `verified`; a failed verification still returns the existing timeout/replan error.

- [ ] **Step 2: Write RED TypeScript schema/runtime tests**

Assert output schemas accept both states and reject arbitrary state strings.

- [ ] **Step 3: Implement result/evidence mapping**

Do not infer `verified` from event emission. `executeVerifiedAction` upgrades state only after verification succeeds.

- [ ] **Step 4: Run focused Swift + Vitest tests GREEN**

```bash
swift test --package-path native/macos-computer-runtime --filter VerificationTests
npx vitest run tests/computer-mcp.test.ts tests/computer-runtime.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerActionService.swift \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/VerificationTests.swift \
  src/tool-output-schemas.ts src/computer-types.ts tests/computer-mcp.test.ts tests/computer-runtime.test.ts
git commit -m "feat: report computer action verification state"
```

### Task 5: Screenshot screen-space metadata

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/computer-runtime.ts`
- Test: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ScreenshotTests.swift`
- Test: `tests/computer-runtime.test.ts`
- Test: `tests/computer-mcp.test.ts`

**Interfaces:**
- Screenshot metadata exposes `captureKind`, `screenBounds`, `scaleX`, `scaleY`.

- [ ] **Step 1: Add RED geometry tests**

For a `1710x1112` image covering known screen bounds, assert scale factors and origin mapping are exact and finite.

- [ ] **Step 2: Add RED TS output validation test**

Require screen bounds and positive scale values.

- [ ] **Step 3: Implement metadata from ScreenCaptureKit display bounds**

Prefer focused display for interactive screenshot capture when deterministically available. Keep a safe fallback and do not capture unrelated desktop content beyond the selected display.

- [ ] **Step 4: Run focused tests GREEN and commit**

```bash
swift test --package-path native/macos-computer-runtime --filter ScreenshotTests
npx vitest run tests/computer-runtime.test.ts tests/computer-mcp.test.ts
git add native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift \
  native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift \
  src/tool-output-schemas.ts src/computer-runtime.ts \
  native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ScreenshotTests.swift \
  tests/computer-runtime.test.ts tests/computer-mcp.test.ts
git commit -m "feat: expose screenshot coordinate metadata"
```

### Task 6: Bounded `computer_scroll_until_visible`

**Files:**
- Modify: `src/computer-types.ts`
- Modify: `src/computer-runtime.ts`
- Modify: `src/scoped-computer-service.ts`
- Modify: `src/computer-tool-registration.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/computer-runtime.test.ts`
- Test: `tests/computer-mcp.test.ts`
- Test: `tests/computer-audit.test.ts`

**Interfaces:**
- New public tool `computer_scroll_until_visible`.
- Inputs: `target`, `within`, `direction`, `amount`, `maxSteps` where `1 <= maxSteps <= 6`.
- Result: `{ state: "target_visible" | "boundary_reached" | "needs_replan", stepsUsed, changed }`.

- [ ] **Step 1: Write RED runtime tests**

Cover: already visible => zero scroll; appears after two scrolls; unchanged digest => boundary after one attempt; maxSteps enforced; takeover/native error propagates without retry.

- [ ] **Step 2: Write RED MCP strict-schema/audit tests**

Reject `maxSteps=7`, invalid direction, and arbitrary fields. Verify audit contains only categorical counts/state, never OCR/page text.

- [ ] **Step 3: Implement deterministic loop in `ComputerRuntime`**

Within one physical lane:

```ts
for (let step = 0; step < maxSteps; step += 1) {
  const observation = await native.request("observe", {});
  if (targetResolvesWithinScope(observation)) return target_visible;
  const container = await native.request("resolve_target", { target: within, retryBudget: 1 });
  await native.request("scroll", boundedScrollParams(container, direction, amount));
  const next = await native.request("observe", {});
  if (sameDigest(next, observation)) return boundary_reached;
}
return needs_replan;
```

Use existing native resolver rather than reimplementing semantic matching in TypeScript. No automatic screenshot/point fallback.

- [ ] **Step 4: Register tool with strong agent guidance**

Tool description must tell GPT to prefer it only when a deterministic scroll container is known, fresh-observe after `needs_replan`, and never convert failure into repeated blind raw scrolling.

- [ ] **Step 5: Run focused tests GREEN and commit**

```bash
npx vitest run tests/computer-runtime.test.ts tests/computer-mcp.test.ts tests/computer-audit.test.ts
git add src/computer-types.ts src/computer-runtime.ts src/scoped-computer-service.ts \
  src/computer-tool-registration.ts src/tool-output-schemas.ts \
  tests/computer-runtime.test.ts tests/computer-mcp.test.ts tests/computer-audit.test.ts
git commit -m "feat: add bounded semantic computer scrolling"
```

### Task 7: MCP schema parity, guidance, and recovery details

**Files:**
- Modify: `src/computer-tool-registration.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/computer-types.ts`
- Modify: `src/computer-runtime.ts`
- Modify: `tests/computer-mcp.test.ts`
- Modify: `tests/computer-runtime.test.ts`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- TS schemas expose hierarchy/action/scroll metadata and scoped targets.
- Agent descriptions encode the fixed decision ladder.

- [ ] **Step 1: Add RED schema parity tests**

Assert `parentIndex`, `depth`, `actions`, `scroll`, scoped semantic targets, screenshot metadata, and verification state are validated strictly.

- [ ] **Step 2: Add RED description tests**

Require `computer_observe` guidance to mention semantic AX, scoped container scrolling, OCR fallback, fresh screenshot, one point attempt, and no repeated unchanged point/scroll attempts.

- [ ] **Step 3: Implement canonical TypeScript target/scoping validation**

Standalone calls and `computer_run` must share the same canonicalizer; no divergent target behavior.

- [ ] **Step 4: Update integration documentation**

Document the new observation and scroll/recovery ladder without claiming live acceptance before it runs.

- [ ] **Step 5: Run focused tests GREEN and commit**

```bash
npx vitest run tests/computer-mcp.test.ts tests/computer-runtime.test.ts tests/chatgpt-integration-docs.test.ts
git add src/computer-tool-registration.ts src/tool-output-schemas.ts src/computer-types.ts \
  src/computer-runtime.ts tests/computer-mcp.test.ts tests/computer-runtime.test.ts \
  docs/CHATGPT_INTEGRATION.md
git commit -m "docs: align computer reliability contract"
```

### Task 8: Independent review, full verification, deployment, and real-Mac acceptance

**Files:**
- Modify: `docs/PROJECT_STATE.md`
- Review scope: every task-owned source/test file changed by Tasks 1-7; verified findings may modify only those task-owned files.
- Never modify/stage the unrelated daily-driver pair.

**Interfaces:**
- Exact final HEAD must be the reviewed, tested, built, packaged, and deployed artifact.

- [ ] **Step 1: Run independent review before full gate**

Use the requesting-code-review workflow against the complete diff. Classify every finding as block / fix / non-block with evidence. Apply only verified findings and rerun their focused tests.

- [ ] **Step 2: Verify unrelated diff fingerprint**

Recompute the diff SHA-256 for `scripts/setup-daily-driver.mjs` + `tests/setup-daily-driver.test.ts`; it must remain `47df7fedc5e2f8a98374793c8d6213db2aa6cb0c62358ce863bea76ca52ccc28` unless Git evidence proves the owner changed it independently during this work.

- [ ] **Step 3: Run exact-head full gates**

```bash
git diff --check
npm run check
npm run test:computer:macos
npm audit --omit=dev
npm run build
npm run build:computer:macos
npm run package:computer:macos
```

Require all PASS. Do not describe completion from older runs.

- [ ] **Step 4: Deploy exact artifact locally without restarting normal Chrome**

Use the existing identity-preserving runtime setup/deploy path. Verify installed helper code signature and confirm the MCP child and native helper come from the same final feature HEAD lineage.

- [ ] **Step 5: Real-Mac acceptance**

With a short user hands-off window:

1. confirm Chrome process identity is unchanged;
2. `computer_observe` reports weak/strong AX correctly and new metadata validates;
3. navigate physically to ChatGPT Plugins using `computer_*` only;
4. use semantic scoped target or bounded scroll primitive when possible;
5. open `chatgpt-system-local` detail;
6. trigger Refresh once;
7. after uncertain mutation, fresh-observe rather than repeating the action;
8. inspect tunnel/local health and bounded command evidence;
9. require zero `browser.*`, zero protocol-invalid key calls, zero blind repeated coordinates/unchanged scroll loops.

Acceptance A (Chrome stopped launch flag) remains pending unless Chrome is naturally stopped or the user explicitly authorizes closing it.

- [ ] **Step 6: Update project state and continuity**

Record exact HEAD, review findings, full-gate output summary, deployed artifact identity, live acceptance result, remaining external blocker if any, and one concrete next step.

- [ ] **Step 7: Final verification-before-completion review**

Run the verification-before-completion workflow. If any required gate or acceptance is incomplete, report the precise blocker instead of claiming the system has no problems.

- [ ] **Step 8: Commit task-owned final docs only**

Stage only task-owned spec/plan/docs and source/test paths. Do not stage the unrelated daily-driver pair.
