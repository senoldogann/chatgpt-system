# Computer Runtime v2 Slice 5: Hybrid Perception, Recovery, and Performance Design

**Status:** Approved
**Date:** 2026-09-12
**Branch:** `feat/computer-runtime-v2-slice5-recovery-vision`
**Base:** `baaaeb528646f1329d9114e660ae1e77da9d1a45`
**Parent design:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`

## 1. Goal

Make Computer Runtime v2 fast and reliable enough for daily autonomous use across native macOS applications, custom-drawn interfaces, Electron/WebView surfaces, and browser-adjacent UI without forcing one model/tool round trip per physical action.

Slice 5 turns the existing low-level runtime into a hybrid local execution kernel with four cooperating perception/execution paths:

1. Accessibility (AX) semantic fast path.
2. Visual geometry and Apple Vision OCR fallback.
3. Local multi-step execution through `computer_run` / `computer_run_js`.
4. Bounded verification, stale-target recovery, and model replan only at real decision boundaries.

The central operating rule is:

```text
observe intelligently
-> plan once
-> execute many local steps
-> verify cheaply
-> re-observe only when state requires it
-> return to ChatGPT only when deterministic recovery is exhausted
```

ChatGPT remains the only reasoning agent. Slice 5 must not add a second LLM, hidden planner, or autonomous model loop inside the local runtime.

## 2. Public computer-use behavior used as inspiration

OpenAI's public Computer-Using Agent material describes a universal screenshot + mouse/keyboard interaction loop that can adapt to unexpected UI state. Current OpenAI Responses API references also expose computer actions as a batchable action list, and OpenAI's public model materials report strong computer-use results when screenshot-driven and semantic/DOM-driven interaction are combined.

This design adopts those public behavioral lessons without assuming or attempting to reproduce proprietary OpenAI internals:

- pixels must remain a universal fallback when structured UI metadata is absent;
- semantic/structured state should be preferred when it is reliable;
- multiple deterministic actions should execute locally without one model round trip per click;
- every mutation must be verified or bounded by a clear stopping rule;
- unexpected state should trigger local recovery first and model replan second;
- user takeover and explicit safety boundaries remain first-class.

Our local runtime adds a macOS-specific advantage: AX, ScreenCaptureKit, Vision OCR, CoreGraphics input, and local JavaScript orchestration can run on the same machine at low latency.

## 3. Non-goals

Slice 5 does not:

- replace Browser Runtime for ordinary semantic web automation;
- perform OCR or full-screen capture on every action;
- infer arbitrary GUI meaning from OCR text alone;
- invent coordinates when semantic/visual resolution fails;
- persist screenshots, OCR text, or AX document content by default;
- introduce a second reasoning model;
- turn `computer_run_js` into an unbounded retry loop;
- weaken physical user-takeover behavior;
- treat an input event as success without verification.

## 4. Architecture

```text
ChatGPT
   |
   | one decision / one multi-step local program
   v
TypeScript Computer Runtime control plane
   |
   +--> target/query validation
   +--> retry/action/runtime budgets
   +--> Admin authority + audit metadata
   +--> computer_run / computer_run_js
   |
   v
Native macOS Computer Kernel
   |
   +--> Observation Cache
   |      + AX snapshot + digest
   |      + app/window identity
   |      + display topology
   |      + bounded capture-region digests
   |      + short-lived capability profile
   |
   +--> Semantic Target Resolver
   |      + AX role/name/text/label/index
   |      + geometry validation
   |      + stale-snapshot validation
   |
   +--> Visual Resolver
   |      + ScreenCaptureKit CGImage
   |      + Apple Vision OCR fast pass
   |      + bounded accurate OCR retry
   |      + OCR text geometry
   |
   +--> Recovery State Machine
   |      + fresh observation
   |      + re-resolve
   |      + refocus
   |      + OCR fallback
   |      + explicit point fallback
   |      + COMPUTER_NEEDS_REPLAN
   |
   +--> Physical Action + Verification
          + CoreGraphics input
          + AX/digest/focus/text/region verification
```

The resolver/recovery logic belongs in the native host whenever it depends only on deterministic local state. TypeScript owns schemas, authority, budgets, orchestration limits, stable errors, and MCP exposure.

## 5. Perception policy

### 5.1 AX is the preferred fast path, not the only source of truth

AX is normally the cheapest and most deterministic representation for standard macOS controls. It is preferred when the current app/window exposes a useful tree.

AX is not assumed to work everywhere. Known weak classes include custom canvas controls, some Electron/WebView surfaces, games, custom drawing frameworks, and transient system UI.

The runtime therefore tracks an in-memory capability estimate per current app/window generation:

```ts
type PerceptionCapabilityProfile = {
  axQuality: "unknown" | "strong" | "partial" | "weak";
  ocrUseful: "unknown" | "yes" | "no";
  lastObservationMonotonicMs: number;
  windowGeneration: string;
};
```

This profile is a performance hint only. It contains no screen text and is never persisted as user content.

If AX has already been proven weak for the current window generation, retries may skip redundant AX work and move directly to bounded visual/OCR resolution.

### 5.2 Visual observation is a first-class fallback

ScreenCaptureKit remains the capture source. Slice 5 reuses the existing `SCScreenshotManager.captureImage(...)` implementation rather than introducing a competing capture stack.

Visual capture policy:

1. prefer active-window or target-region capture when geometry is known;
2. use one-display capture when a window/region cannot be identified safely;
3. avoid repeated full-display PNG encoding when an internal `CGImage` is sufficient;
4. expose PNG bytes to ChatGPT only for explicit screenshot/replan output;
5. internal OCR/verification may operate on `CGImage` without serializing the whole image through MCP.

### 5.3 Vision OCR is automatic but exceptional

OCR automatically activates only when one of these conditions is true:

- AX provides no useful text/target candidate;
- AX candidate set is insufficient for a requested text-like target;
- a stale semantic target cannot be recovered from fresh AX;
- the caller explicitly requests `ocrText`;
- the current window capability profile is already `axQuality="weak"` and the target is text-addressable.

OCR is not run merely because a screenshot exists.

The OCR pipeline is two-tiered:

```text
CGImage/crop
  -> Vision VNRecognizeTextRequest fast mode
  -> unique high-quality match?
       yes -> candidate
       no  -> bounded tighter crop / accurate mode
  -> unique acceptable match?
       yes -> candidate
       no  -> ambiguous/not-found/replan
```

OCR observations carry bounded geometry and confidence-like evidence but are not promoted to semantic roles that Vision did not actually provide.

OCR may directly satisfy only text-addressable targets (`text` and `ocrText`). It must not satisfy a `role` target by guessing that visible text is a button, checkbox, menu item, or other control. A `label` target may use OCR only when AX already provides a deterministic association between that label geometry and a control; otherwise the resolver stops at ambiguity/replan. When ChatGPT itself visually understands a screenshot and chooses an explicit point, that point is treated as an explicit model decision rather than a local OCR semantic inference.

```ts
type OcrTextCandidate = {
  text: string;
  bounds: ComputerBounds;
  confidence: number | null;
  source: "vision-fast" | "vision-accurate";
  observationId: string;
};
```

Exact numeric confidence thresholds are implementation constants validated against the deterministic fixture and real-Mac measurements. They are not MCP-controlled knobs.

## 6. Observation cache

The native host maintains a bounded in-memory cache for the current UI generation.

```ts
type CachedObservation = {
  observationId: string;
  createdMonotonicMs: number;
  appIdentity: string;
  windowIdentity: string;
  windowGeneration: string;
  axDigest: string;
  elements: ComputerElementView[];
  truncated: boolean;
  displayTopologyDigest: string;
};
```

Properties:

- no raw AX pointers leave the native traversal;
- no OS PID is exposed through MCP;
- cache lifetime is bounded and process-local;
- a window/app transition invalidates incompatible cache entries;
- display topology changes invalidate coordinate-based candidates;
- user takeover/cancellation may invalidate the active action context;
- no screenshot pixels or OCR document text are written to disk by default.

The cache enables current-snapshot resolution without another AX traversal when state has not changed.

## 7. Target contract

The public target vocabulary remains compatible with the parent design:

```ts
type ComputerTarget =
  | { by: "index"; snapshotId: string; index: number }
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string; exact?: boolean }
  | { by: "ocrText"; text: string; exact?: boolean }
  | { by: "point"; x: number; y: number };
```

Internal resolution returns a richer short-lived object:

```ts
type ResolvedComputerTarget = {
  source: "ax" | "ocr" | "point";
  bounds: ComputerBounds;
  actionPoint: { x: number; y: number };
  observationId: string | null;
  appIdentity: string;
  windowIdentity: string;
  windowGeneration: string;
  displayTopologyDigest: string;
  confidence: "deterministic" | "high" | "explicit";
  semanticFingerprint?: string;
};
```

This resolved object is an internal capability, not a durable handle. It must be revalidated before physical mutation.

## 8. Semantic resolution rules

### 8.1 Current snapshot fast path

For `index`, `role`, `text`, and `label`, the resolver first uses the compatible current cached AX snapshot.

Target matching rules are deterministic:

- zero matches -> `COMPUTER_TARGET_NOT_FOUND`;
- one safe match -> candidate;
- multiple unsafe matches -> `COMPUTER_TARGET_AMBIGUOUS`;
- exact matching is literal after bounded normalization;
- non-exact matching uses explicit normalized containment, not fuzzy language-model similarity;
- disabled/zero-sized/off-display candidates are rejected for mutation unless the action explicitly supports them.

### 8.2 Stale indexed targets

An index target is stale if any of these changed incompatibly:

- snapshot/observation ID;
- app identity;
- window identity/generation;
- semantic fingerprint;
- display topology;
- target geometry validity.

A stale index returns `COMPUTER_STALE_SNAPSHOT` to the recovery engine. The engine may fresh-observe and re-resolve only if enough semantic information exists. It never assumes that old index `17` still means the same control in a new tree.

### 8.3 Point targets

Explicit points remain supported as the universal lowest-level target form.

They must pass current display-topology bounds immediately before mutation. They are never automatically invented from a failed semantic lookup.

## 9. Recovery state machine

Automatic recovery is deterministic and budgeted.

```text
FAST_PATH
  |
  +-- resolved + valid ----------------------> ACT
  |
  +-- stale/not-found/ambiguous
            |
            v
RECOVERY_1: fresh observation + re-resolve
            |
            +-- success ---------------------> ACT
            |
            v
RECOVERY_2: refocus intended app/window when applicable
            + fresh observation
            + semantic re-resolve
            + OCR fallback when relevant
            |
            +-- success ---------------------> ACT
            |
            v
EXPLICIT_POINT_FALLBACK
  only when caller supplied one
            |
            +-- valid -----------------------> ACT
            |
            v
COMPUTER_NEEDS_REPLAN
```

Default automatic recovery budget remains two retries per action.

Recovery must stop early for:

- `COMPUTER_USER_TAKEOVER`;
- permission loss;
- invalid display topology / unsafe point;
- authority cancellation;
- action-program timeout;
- repeated ambiguity without stronger evidence.

`COMPUTER_NEEDS_REPLAN` may include bounded machine-readable failure metadata and a fresh observation. A screenshot/crop may be included only when explicitly useful and within output limits.

## 10. Verification policy

A posted event is not success.

Verification follows the cheapest useful source:

```text
expected AX/focus/text state
  -> use AX/digest

known small visual region
  -> use ScreenCaptureKit region digest

window/app transition
  -> use NSWorkspace + active-window state

semantic target disappearance/appearance
  -> fresh bounded AX/OCR only when needed

no deterministic verification available
  -> return explicit unverified/needs-replan status
```

Common action verification examples:

- click button -> AX digest or relevant region changed;
- toggle checkbox -> selected state changed;
- open/focus app -> intended app became frontmost;
- submit custom canvas form -> bounded region changed or expected OCR text appeared;
- drag -> source/target region change or deterministic fixture state changed.

Verification failures enter the same bounded recovery budget; they do not cause infinite local loops.

Observation is adaptive rather than screenshot-per-action:

```text
compatible cached AX
  -> fresh AX when compatibility/state requires it
  -> region digest/crop when visual verification is enough
  -> full screenshot/OCR only when structured evidence is insufficient
  -> model-visible screenshot only at a real replan boundary
```

The runtime must prefer the cheapest reliable state signal and avoid full-frame capture when a cached/fresh semantic state or bounded region check is sufficient.

## 11. Multi-step execution model

The primary performance strategy is to reduce model/tool yields, not merely make each mouse event faster.

`computer_run_js` is the preferred fast path for long, branching, or stateful workflows because one model decision can compile into many bounded local actions and checks. Typed `computer_run` remains the simpler structured path for short or externally generated action programs. Both use the same resolver, safety, takeover, and verification boundaries.

One `computer_run` or `computer_run_js` call may execute many steps while holding the physical-action lane. A successful multi-step local program should not yield back to the model between ordinary deterministic actions.

Example shape:

```js
const before = await computer.observe();
const submit = await computer.resolve({ by: "text", text: "Submit", exact: true });
await computer.click(submit);
await computer.waitUntilChanged({ from: before.digest, timeoutMs: 1500 });

const next = await computer.resolve({ by: "role", role: "AXTextField", name: "Name" });
await computer.click(next);
await computer.typeText("Senol");

return { completed: true };
```

Local JS may contain bounded loops/conditions, but physical computer RPC still flows through the parent-mediated strict computer API. JS does not receive raw AX pointers, secret daemon environment, or an API that disables takeover.

### 11.1 Slice 5 JS API additions

Add or complete these parent-mediated calls:

```js
await computer.resolve(target, options)
await computer.resolveMany(targets, options)
await computer.exists(target, options)
await computer.refreshObservation(options)
await computer.waitUntilChanged(options)
```

`resolve` returns a bounded JSON-safe target view, not a native pointer.

`resolveMany` performs one compatible observation pass and resolves multiple requested targets against it so a form can be planned from one snapshot.

### 11.2 Typed `computer_run`

Typed action programs should gain semantic-target support and the same native recovery engine. Typed callers do not need to recreate recovery logic action-by-action in TypeScript.

### 11.3 Persistent execution-session state

The full-host JavaScript session should keep reusable process-local objects alive across calls when their owning runtime is still valid. This includes browser page/context objects, native app/window handles represented through safe opaque identities, the current capability profile, current display topology, and the last compatible observation generation.

Persistence is an optimization, never permission to trust stale state. Before mutation, target/window/topology compatibility is revalidated. Browser and native connections should be reused rather than disconnected/recreated between ordinary calls; lifecycle shutdown remains explicit and bounded. Persistent state must not serialize screenshots, OCR text, AX document text, typed content, credentials, or raw native pointers to disk.

## 12. Browser routing

Browser Runtime remains preferred for ordinary web semantic work because DOM/ARIA semantics and browser-specific diagnostics are more precise there.

Routing policy:

```text
normal web content
  -> Browser Runtime

browser chrome / permission dialogs / file picker / native sheet
  -> Computer Runtime

web surface where Browser Runtime is blocked or unavailable
  -> Computer Runtime visual/AX fallback

custom canvas/webgl where DOM semantics are insufficient
  -> Computer Runtime visual/OCR/geometry
```

A workflow may use both runtimes. They are complementary, not mutually exclusive.

## 13. OpenAI-like behavior without copying proprietary internals

The user-visible behavior should feel similar to a high-quality modern computer-use agent:

- visual fallback works even when AX/DOM is poor;
- the cursor and keyboard can operate any ordinary visible UI;
- multiple actions can be carried out before returning to the model;
- state is rechecked after meaningful mutations;
- unexpected UI is handled locally when the recovery is obvious;
- difficult ambiguity returns a fresh visual/structured state to ChatGPT for replan;
- the user can interrupt at any time.

The implementation remains intentionally different where local determinism gives us an advantage: semantic AX resolution, native OCR, region digests, strict stale-target checks, and local JS execution reduce screenshot/model round trips.

## 14. Errors

Existing stable errors remain. Slice 5 must use them consistently:

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

OCR/native errors never leak raw Vision/AX exception text to MCP.

`COMPUTER_NEEDS_REPLAN` is not treated as a crash. It means deterministic local recovery has correctly reached its boundary.

## 15. Privacy and audit

Audit only bounded metadata:

- source class used: AX/OCR/point;
- action category;
- recovery step count;
- durations;
- success/failure/stable error code;
- OCR invoked yes/no;
- observation/candidate counts;
- content-free capability-quality category.

Never audit:

- screenshot pixels;
- OCR text;
- AX document text;
- typed text;
- raw JS source/stdout/stderr/return value;
- passwords/tokens;
- lease IDs;
- raw coordinates when not needed for a safety event.

OCR results and screenshots are memory-bounded and not persisted by default.

## 16. Performance targets

Real-Mac targets, measured after warm-up:

```text
cached semantic resolve p50                 < 20 ms target
fresh AX resolve p50                        < 150 ms target
small-region change verification            < 150 ms target
warm screenshot                              < 250 ms target
fast Vision OCR bounded crop p50             < 250 ms target
accurate OCR fallback                        exceptional; bounded < 800 ms target
local 5-step simple action sequence          no model round trips between steps
10-step deterministic fixture sequence       ~3 s target excluding deliberate waits
```

These are optimization targets, not flaky CI deadlines. CI verifies correctness and bounds; real-Mac acceptance records latency distributions.

Instrumentation contains timing/count metadata only.

In addition to latency distributions, acceptance records workflow-efficiency counters because fewer decision/tool boundaries are the primary speed objective:

```text
model turns per workflow
native IPC calls per workflow
screenshots per workflow
OCR invocations per workflow
local actions per computer_run_js invocation
cold session start latency
warm semantic resolve latency
recovery latency
end-to-end workflow latency
```

A key acceptance target is at least five deterministic semantic actions in one `computer_run_js` invocation with zero intermediate model turns.

## 17. Implementation boundaries

Expected focused native modules:

```text
SystemAccessibility.swift              existing, AX normalization
ComputerObservationCache.swift         new
ComputerTargetResolver.swift           new
SystemVisionOCR.swift                   new
ComputerRecoveryEngine.swift           new
ComputerVerification.swift             extend
SystemScreenshot.swift                 reuse ScreenCaptureKit capture
SystemScreenRegionDigest.swift         reuse cheap visual verification
```

Expected TypeScript modules:

```text
src/computer-types.ts                  extend target/resolution types
src/computer-runtime.ts                expose resolve/recovery calls
src/computer-action-runner.ts          semantic actions + budgets
src/computer-js-runtime.ts             parent RPC surface additions
src/computer-tool-registration.ts      schema additions only as needed
src/computer-errors.ts                 stable mapping additions only if required
```

Do not centralize Slice 5 implementation in `server.ts`.

## 18. TDD and test strategy

### 18.1 Swift unit tests

Must prove:

1. exact/non-exact AX target matching;
2. zero/one/multiple candidate behavior;
3. stale observation ID rejection;
4. app/window generation invalidation;
5. topology invalidation for point/geometry targets;
6. disabled/zero-size candidate rejection;
7. OCR result bounds/normalization;
8. fast OCR -> accurate OCR bounded fallback;
9. ambiguity remains fail-closed;
10. capability-profile transitions strong/partial/weak;
11. retry ladder stops after configured budget;
12. takeover/permission loss stops recovery immediately;
13. cache eviction/bounds;
14. no secure/editable values introduced by new observation paths.

### 18.2 TypeScript tests

Must prove:

1. strict semantic target schemas;
2. Admin authority before screen/target work;
3. typed actions use one bounded recovery engine;
4. JS `resolve/resolveMany` proxy validation;
5. retry/runtime/action budgets cannot be raised by JS/MCP;
6. `COMPUTER_NEEDS_REPLAN` stable output;
7. OCR/AX text absent from audit;
8. screenshots/OCR results remain output-bounded;
9. existing Browser/Process/Continuity/Harness behavior remains green.

### 18.3 Deterministic fixture

Extend the disposable native fixture with:

- AX-addressable button;
- duplicate labels for ambiguity;
- a target that moves/reorders to create a stale index;
- checkbox state verification;
- custom-drawn OCR-only text/action target;
- visual region with deterministic state change;
- window generation change;
- optional transient AX readiness delay.

Acceptance must intentionally cause semantic failure/staleness and prove bounded recovery.

### 18.4 Real-Mac smoke

Use harmless workflows in Calculator/TextEdit/Finder/System Settings/Chromium. Include at least one custom/non-AX surface if available.

Do not perform purchases, account mutation, secret extraction, or destructive settings changes.

## 19. Slice 5 merge gates

Slice 5 may merge only when all of these are true:

1. Native Swift tests green on exact HEAD.
2. Full repository `npm run check` green.
3. `npm audit --omit=dev` green.
4. `git diff --check` green.
5. Deterministic fixture proves stale-target recovery.
6. Deterministic fixture proves OCR-only target resolution.
7. AX-only fixture path proves OCR was not invoked.
8. Retry budget deterministically stops and returns `COMPUTER_NEEDS_REPLAN`.
9. Real-Mac semantic action sequence executes multiple steps locally without one model/tool round trip per step.
10. User takeover still interrupts immediately and releases inputs.
11. Daily-driver runs the exact tested build/bundle.
12. No push or `main` merge without explicit user authorization.

## 20. Definition of done for Slice 5

Slice 5 is complete when:

- standard native UI uses fast AX semantic resolution;
- weak/non-AX UI has a real visual/OCR fallback;
- screenshot pixels remain the universal replan path;
- semantic/index targets cannot silently act on stale geometry;
- one observation can support multiple local actions;
- `computer_run_js` is the preferred fast path for long/stateful workflows and can execute at least five deterministic semantic actions without intermediate model turns;
- `computer_run` and `computer_run_js` can resolve and act locally with bounded recovery;
- compatible browser/native connections and safe session objects are reused across ordinary calls instead of being recreated unnecessarily;
- deterministic recovery stops rather than guessing;
- verification uses the cheapest reliable signal;
- Browser Runtime stays preferred for ordinary semantic browser work;
- real-Mac performance is fast enough that the model is involved at decision boundaries rather than every click;
- the only reasoning agent remains ChatGPT.

## 21. Public references reviewed

The design was cross-checked against public OpenAI computer-use behavior and current Apple platform APIs. These are references for behavioral/technical direction, not proprietary implementation specifications.

- OpenAI, "Computer-Using Agent" — screenshot-driven perception, reasoning, mouse/keyboard action, adaptation to unexpected UI.
  https://openai.com/index/computer-using-agent/
- OpenAI, GPT-5.4 computer use and vision — public evidence for combining semantic/DOM and screenshot-driven interaction.
  https://openai.com/index/introducing-gpt-5-4/
- OpenAI Computer Use guide — screenshot/custom-harness loops, code-execution harnesses, persistent browser objects, and multi-action execution guidance.
  https://developers.openai.com/api/docs/guides/tools-computer-use
- OpenAI Responses API reference — computer action vocabulary, screenshots, batched computer action list, safety-check output contract.
  https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses
- Apple Vision `VNRecognizeTextRequest` — macOS 14-compatible native text recognition over `CGImage`, with fast/accurate recognition levels.
  https://developer.apple.com/documentation/vision/vnrecognizetextrequest
- Apple ScreenCaptureKit / `SCScreenshotManager` — native screenshot capture already used by Computer Runtime v2.
  https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager
