# Computer Use Perception Reliability Design

**Status:** Approved
**Date:** 2026-09-14
**Branch:** `design/computer-use-perception-reliability`
**Base:** `d5a24e469ad0fa948dfdbb52e16c4609e0c017da`
**Parent designs:**
- `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`
- `docs/superpowers/specs/2026-09-12-computer-runtime-v2-slice5-recovery-vision-design.md`

## 1. Goal

Make explicit Computer Use on real macOS applications, especially normal Google Chrome, reliable enough that a simple visible workflow such as `Settings -> Plugins/custom app -> Refresh` completes deterministically instead of degrading into repeated screenshot-coordinate guessing.

This design addresses the product acceptance failure observed after Computer-Use-first routing was already corrected. The routing layer correctly selected real `Google Chrome.app` and `computer_*`, but the local execution/perception layer still failed to navigate a simple ChatGPT Web settings workflow efficiently.

The desired loop is:

```text
observe once with useful capability metadata
-> use AX when semantic web/native UI is available
-> otherwise get bounded focused-window OCR automatically
-> execute semantic physical action
-> verify
-> use at most one explicit visual-point attempt after a fresh replan
-> stop with COMPUTER_NEEDS_REPLAN instead of guessing repeatedly
```

ChatGPT remains the only reasoning agent. The local runtime gains better deterministic perception and contracts, not a hidden planner.

## 2. Root-cause evidence

The failed real-product acceptance established four independent facts.

### 2.1 Screenshot quality was not the main problem

The screenshots were readable enough for a human to identify the relevant ChatGPT Web controls. The long navigation loop therefore cannot be explained primarily by capture resolution or image corruption.

### 2.2 Normal running Chrome exposed browser chrome but not renderer web AX

A direct Accessibility traversal of the real running `com.google.Chrome` process returned:

```text
nodes: 71
maxDepth: 9
AXWebArea: 0
```

The runtime limits were `maxElements=500` and `maxDepth=12`, so the web tree was not lost through truncation. The available AX nodes represented browser chrome such as toolbar, tabs, address field, buttons, and groups, but not the page's semantic web content.

As a result, `computer_observe` could report a non-empty tree while still being semantically blind to the page content.

### 2.3 Real Chrome renderer accessibility works when enabled at launch

An isolated instance of the real installed `Google Chrome.app`, launched with:

```text
--force-renderer-accessibility=complete
```

against a real HTML page exposed `AXWebArea=1` and semantic web roles such as headings and static text. The test used real Google Chrome, not Chrome for Testing and not a temporary automation browser product.

### 2.4 MCP key contract was looser than native runtime capability

`computer_press_key.key` currently accepts an arbitrary bounded string, while native `KeyMapping` accepts a fixed lowercase vocabulary. During acceptance the agent sent `Enter`; the native runtime expects canonical `return`, producing `COMPUTER_PROTOCOL_INVALID` twice.

The MCP schema must prevent or normalize this mismatch before native execution.

## 3. Non-goals

This slice does not:

- replace Computer Runtime with Browser Runtime or CDP;
- use Chrome for Testing for explicit Computer Use;
- silently quit or restart an already-running user Chrome session;
- create a temporary Chrome profile or `--user-data-dir`;
- weaken TCC, takeover monitoring, input safety, CAPTCHA/anti-bot boundaries, SIP, or user authentication;
- run full-screen OCR on every observation;
- infer control roles from OCR text;
- add an LLM or local autonomous planner;
- allow unbounded screenshot-click retry loops;
- persist screenshot pixels, OCR text, or page contents by default.

## 4. High-level architecture

```text
ChatGPT
  |
  | explicit Computer Use
  v
TypeScript MCP contract
  + canonical key validation/normalization
  + bounded observation schema
  + stable capability metadata
  |
  v
Native Computer Runtime
  |
  + Application launch policy
  |    + normal app behavior
  |    + stopped com.google.Chrome -> renderer accessibility launch arg
  |    + already-running Chrome -> activate only, never restart
  |
  + Hybrid observation
  |    + AX traversal
  |    + semantic web-content capability detection
  |    + focused-window Vision OCR when AX is weak/incomplete
  |
  + Target resolution
  |    + AX
  |    + OCR text
  |    + explicit model point only after replan
  |
  + Physical action + verification
       + existing takeover/safety lane
       + fail to COMPUTER_NEEDS_REPLAN rather than blind retries
```

Browser Runtime remains a separate semantic Playwright capability. Explicit Computer Use continues to use `computer_*` exclusively.

## 5. Observation contract

### 5.1 Capability metadata becomes explicit

`ComputerObservation` gains a bounded perception summary in addition to the existing AX elements and digest.

Conceptual shape:

```ts
type PerceptionSummary = {
  axQuality: "strong" | "partial" | "weak";
  webContentAccessible: boolean | null;
  ocrUsed: boolean;
  recommendedTargeting: "ax" | "ocr" | "visual-point";
  ocrCandidates: OcrObservationCandidate[];
};

type OcrObservationCandidate = {
  text: string;
  bounds: ComputerBounds;
  confidence: number | null;
  source: "vision-fast" | "vision-accurate";
};
```

`webContentAccessible` is:

- `true` for real Chrome when the current AX observation contains renderer web content such as `AXWebArea`;
- `false` for real Chrome when browser chrome is visible but renderer web content is absent;
- `null` for applications where browser web-content accessibility is not a meaningful concept.

This avoids the current false signal where a non-empty Chrome toolbar tree is treated as generally strong perception.

### 5.2 AX quality rules

AX remains the preferred fast path.

For real Chrome:

- `AXWebArea` present and observation not truncated -> `strong`;
- renderer web tree present but observation truncated -> `partial`;
- browser chrome present but no `AXWebArea` -> `weak`.

For non-Chrome applications:

- empty tree -> `weak`;
- truncated tree -> `partial`;
- otherwise -> `strong` under the existing native UI assumptions.

These categories are capability hints, not persisted content.

## 6. Automatic focused-window OCR

### 6.1 Activation

Observation-level OCR runs automatically only when:

- `axQuality == "weak"`; or
- real Chrome has `webContentAccessible == false`.

It does not run for every healthy AX observation.

### 6.2 Scope

OCR is restricted to the visible focused window. It must not OCR the entire desktop as an automatic fallback.

The capture path uses the current focused-window geometry and the existing ScreenCaptureKit/Vision stack. Dock, menu bar, background windows, and unrelated applications are excluded wherever the focused-window crop can be established safely.

If safe focused-window geometry is unavailable, automatic OCR is skipped rather than broadening silently to full-screen OCR. The observation then recommends `visual-point` replan rather than inventing a wider semantic view.

### 6.3 Bounds

Observation OCR uses fixed implementation bounds that are not caller-controlled:

```text
maximum candidates: 64
maximum text per candidate: 512 characters
maximum aggregate OCR text: 8192 characters
minimum confidence when Vision supplies confidence: 0.5
```

The fast Vision pass runs first. If it yields zero acceptable candidates, one bounded accurate pass may run. If the fast pass yields acceptable candidates, observation does not automatically pay for an accurate pass.

OCR candidates preserve text, screen-space bounds, confidence, and Vision source. OCR never fabricates button/checkbox/menu roles.

### 6.4 Privacy

OCR text remains process-local and is returned only as part of the bounded observation requested by the caller. It is not written to disk or audit logs. Audit records only categorical/count metadata such as `ocrUsed`, candidate count, source class, duration, and error category.

## 7. Real Chrome launch policy

### 7.1 Existing Chrome process

If `com.google.Chrome` is already running, `computer_open_app` / the underlying application controller only activates the existing application. It never silently quits or relaunches Chrome to enable renderer accessibility.

This protects active tabs, downloads, extension state, unsaved browser UI state, and user expectations.

If the active Chrome renderer web tree is unavailable, the observation contract reports `webContentAccessible=false` and uses focused-window OCR.

### 7.2 Stopped Chrome process

If no normal Chrome process is running and Computer Runtime is asked to open `com.google.Chrome`, it launches the installed real `Google Chrome.app` with exactly the additional renderer-accessibility argument:

```text
--force-renderer-accessibility=complete
```

No `--user-data-dir`, temporary profile, remote-debugging flag, testing binary, or automation-specific profile is added.

The implementation should use `NSWorkspace.OpenConfiguration.arguments` on the existing `NSWorkspace` launch path if real-Mac tests prove that path reliably passes arguments while preserving the default profile/session. If that Apple API path fails deterministic tests, the implementation plan may introduce a narrow Chrome launch adapter, but it must preserve the same externally visible contract and must not broaden into a generic shell launcher.

Other macOS applications keep their existing launch behavior.

## 8. Canonical key contract

### 8.1 Canonical native vocabulary

The public MCP contract is narrowed to the native-supported key set:

```text
a-z
0-9
return
tab
space
delete
forward_delete
escape
left
right
up
down
home
end
page_up
page_down
f1-f12
```

Modifiers remain a separate fixed enum:

```text
control | option | shift | command
```

### 8.2 Safe normalization

MCP accepts canonical values plus a small explicit alias set and normalizes before native execution.

```text
enter         -> return
esc           -> escape
backspace     -> delete
forwarddelete -> forward_delete
pageup        -> page_up
pagedown      -> page_down
arrowleft     -> left
arrowright    -> right
arrowup       -> up
arrowdown     -> down
F1..F12       -> f1..f12
A..Z          -> a..z
```

Normalization is explicit and bounded; arbitrary fuzzy key-name interpretation is not allowed.

Unknown values fail MCP schema/normalization before native IPC. They must never reach `KeyMapping` and become `COMPUTER_PROTOCOL_INVALID` merely because the public contract was too loose.

The same canonicalization is used by both standalone `computer_press_key` and batched `computer_run` key actions so their behavior cannot drift.

## 9. Targeting and recovery ladder

The runtime follows one deterministic ordering:

```text
1. current compatible AX semantic target
2. fresh AX observation + semantic re-resolution
3. focused-window OCR semantic target when AX is weak/incomplete
4. fresh screenshot/model replan
5. one explicit model-selected visual point with verification
6. COMPUTER_NEEDS_REPLAN
```

### 9.1 No locally invented points

The runtime never converts failed semantic search into an invented coordinate. Point targets remain explicit model/user decisions.

### 9.2 No automatic point retry loop

A point action does not enter an automatic coordinate retry loop. If its requested verification fails or the UI state is incompatible, local recovery stops at `COMPUTER_NEEDS_REPLAN`.

The model may choose another point only after receiving fresh perception/replan evidence. Tool guidance must explicitly discourage repeating coordinates against unchanged state.

### 9.3 Semantic OCR targeting

When observation exposes OCR candidates, the model should prefer `ocrText` instead of translating visible labels into raw coordinates itself.

`ocrText` resolution remains deterministic:

- zero acceptable matches -> not found/replan;
- exactly one acceptable match -> candidate;
- multiple acceptable matches -> ambiguous/replan;
- no fuzzy LLM-like local similarity.

Physical click/mouse/keyboard execution remains unchanged and continues through the existing input lane, takeover monitor, geometry validation, and verification engine.

## 10. Recommendation guidance to the agent

The MCP description for Computer Runtime should teach the intended selection policy directly:

```text
recommendedTargeting=ax
  -> prefer AX role/text/index targets

recommendedTargeting=ocr
  -> prefer ocrText semantic targets from observation candidates

recommendedTargeting=visual-point
  -> request/use a fresh screenshot and choose one explicit point;
     do not repeat blind point clicks after verification failure
```

For real Chrome with `webContentAccessible=false`, the agent should not interpret a toolbar-only AX tree as proof that the web page is semantically observable.

## 11. Verification and safety

Existing safety invariants remain authoritative:

- active Admin authority is required for Computer Runtime actions;
- Accessibility/Screen Recording/TCC permissions are not bypassed;
- physical user takeover immediately interrupts agent input;
- input release remains idempotent;
- coordinates must remain inside current display topology;
- target state is revalidated before mutation;
- CAPTCHA/anti-bot challenges are never automatically solved or bypassed;
- a permission/focus/takeover failure stops recovery rather than widening permissions or suppressing the safety event.

A posted input event is still not success. Existing AX/focus/text/region verification remains the mutation success boundary.

## 12. Errors

Existing stable errors remain the primary surface:

```text
COMPUTER_TARGET_NOT_FOUND
COMPUTER_TARGET_AMBIGUOUS
COMPUTER_STALE_SNAPSHOT
COMPUTER_FOCUS_FAILED
COMPUTER_ACTION_FAILED
COMPUTER_USER_TAKEOVER
COMPUTER_NEEDS_REPLAN
COMPUTER_TIMEOUT
COMPUTER_OUTPUT_LIMIT
COMPUTER_PERMISSION_REQUIRED
```

Invalid public key names should be rejected at TypeScript schema/normalization level rather than producing native protocol errors.

Missing Chrome web AX is not a crash; it is represented through perception capability metadata and OCR fallback.

## 13. Expected implementation boundaries

Native modules expected to change:

```text
ComputerRuntimeCore observation/perception types
SystemAccessibility.swift
ComputerRecoveryEngine.swift
SystemScreenshot / focused-window capture path
SystemWorkspaceController.swift
ComputerHostService.swift
KeyMapping tests only as needed; canonical native mapping remains authoritative
```

TypeScript modules expected to change:

```text
src/computer-tool-registration.ts
computer output schemas/types used by MCP
computer action/batch schema normalization shared by computer_press_key and computer_run
```

Tests and docs expected to change:

```text
native macOS Computer Runtime unit/integration tests
TypeScript MCP/schema tests
real-Mac acceptance/runbook documentation
PROJECT_STATE / Continuity checkpoints
```

Do not centralize the behavior in `server.ts` and do not create a competing perception subsystem.

## 14. TDD strategy

### 14.1 Native tests

Must prove:

1. Chrome observation with toolbar-only AX is classified `webContentAccessible=false` and `axQuality=weak`.
2. Chrome observation containing `AXWebArea` is classified accessible/strong unless normal truncation rules require partial.
3. weak Chrome AX invokes focused-window OCR; strong Chrome AX does not.
4. automatic OCR never broadens to full-screen when focused-window geometry is unavailable.
5. candidate count/text/confidence bounds are enforced.
6. fast OCR success skips accurate OCR; empty fast pass may run exactly one accurate pass.
7. OCR text is not promoted to invented semantic roles.
8. already-running Chrome is activated without restart or extra launch args.
9. stopped real Chrome receives only the renderer accessibility launch argument and preserves the default profile path.
10. non-Chrome applications retain existing launch behavior.
11. takeover, permission loss, unsafe geometry, and focus failure remain fail-closed.
12. point verification failure does not create automatic point retries.

### 14.2 TypeScript tests

Must prove:

1. `computer_press_key` rejects unknown keys before native IPC.
2. canonical keys pass unchanged.
3. approved aliases normalize to canonical native names.
4. standalone and batched key actions use the same normalizer.
5. observation output schema contains bounded perception summary/OCR candidates.
6. agent-facing descriptions explain AX/OCR/visual-point recommendation semantics.
7. Browser Runtime remains separate and explicit Computer Use remains on `computer_*`.
8. audit contract still excludes OCR/page text.

### 14.3 Deterministic fixture

Extend or reuse the native fixture to model:

- strong AX surface;
- toolbar-like partial/weak AX surface;
- OCR-only visible text;
- duplicate OCR labels for ambiguity;
- missing focused-window crop geometry;
- point verification failure.

### 14.4 Real-Mac acceptance

Acceptance uses the installed normal `Google Chrome.app`, not Chrome for Testing.

Required scenarios:

1. with Chrome stopped, open `com.google.Chrome` through Computer Runtime and verify renderer web AX appears on a real harmless page without a temporary profile;
2. with Chrome already running without renderer web AX, verify no restart occurs and `computer_observe` reports the limitation plus focused-window OCR candidates;
3. repeat the ChatGPT Web workflow `Settings -> Plugins/custom app -> Refresh` using physical Computer Runtime only;
4. acceptance audit must show no `browser.*` operations for the explicit Computer Use workflow;
5. no `COMPUTER_PROTOCOL_INVALID` key failures;
6. no repeated blind coordinate-click loop;
7. user takeover still interrupts immediately.

## 15. Performance and acceptance targets

These are real-Mac product targets, not brittle CI deadlines.

```text
healthy AX observe                         no OCR invocation
weak Chrome AX -> fast OCR                target p50 < 400 ms
accurate OCR escalation                   exceptional, bounded target < 900 ms
Settings -> Plugins/custom app -> Refresh complete < 120 s end-to-end
blind repeated point-click attempts       0
protocol-invalid key calls                0
browser.* calls in explicit CU workflow   0
```

For the simple settings workflow, success also requires the runtime to use semantic AX/OCR targeting for the majority of controls rather than raw coordinates.

## 16. Migration and compatibility

Existing `computer_*` tool names remain stable.

Existing canonical native key names remain valid. The change narrows previously misleading arbitrary-string acceptance and adds safe aliases; callers using unsupported arbitrary key names will fail earlier and more clearly.

Existing Browser Runtime behavior remains available for non-explicit-Computer-Use workflows.

Chrome users with an already-running process see no forced restart. The accessibility launch flag only applies when Computer Runtime itself starts a stopped real Chrome process.

Observation consumers must tolerate the additive perception summary/OCR fields. No raw screenshot is added to ordinary observation output.

## 17. Merge gates

Implementation may merge only when all are true:

1. focused native tests for capability classification/OCR/Chrome launch are green;
2. TypeScript key-schema and observation-schema tests are green;
3. full `npm run check` is green on exact publication HEAD;
4. macOS native Computer Runtime suite is green;
5. `npm audit --omit=dev` reports zero vulnerabilities;
6. `git diff --check` is clean;
7. Linux `project_check run/report` is fresh PASS for exact HEAD/digest;
8. real-Mac stopped-Chrome accessibility launch acceptance passes;
9. real-Mac already-running-Chrome no-restart + OCR fallback acceptance passes;
10. ChatGPT Web `Settings -> Plugins/custom app -> Refresh` acceptance completes under the bounded target using `computer_*` only;
11. takeover safety regression passes;
12. push/PR/merge uses the existing verified dual-authority local-first lifecycle;
13. `origin/feat/computer-use-bridge` remains untouched unless separately classified.

## 18. Definition of done

This reliability slice is complete when:

- normal Chrome web AX availability is represented accurately instead of toolbar-only AX being labeled generally strong;
- stopped real Chrome can be launched by Computer Runtime with renderer accessibility while preserving the normal user profile/session;
- already-running Chrome is never silently restarted for this feature;
- weak/missing web AX automatically yields bounded focused-window structured OCR;
- the model receives an explicit recommendation for AX, OCR, or one-shot visual-point targeting;
- MCP key names cannot drift from the native key vocabulary;
- local recovery never invents or repeatedly retries raw coordinates;
- simple ChatGPT Web settings navigation is materially faster and deterministic in real-product acceptance;
- all actions remain physical Computer Runtime actions with existing takeover/TCC/safety boundaries intact;
- Browser Runtime remains available but is not substituted for explicit Computer Use.
