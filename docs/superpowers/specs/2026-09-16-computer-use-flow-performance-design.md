# Computer Use Flow Performance Design

**Date:** 2026-09-16  
**Branch:** `design/computer-use-flow-performance`  
**Status:** Approved for implementation planning  
**Target surface:** ChatGPT Web/Desktop using the `chatgpt-system` custom app

## 1. Goal

Make the existing `chatgpt-system` Computer Runtime feel fast and fluid during ordinary reversible desktop work without weakening its verified safety, authority, perception, takeover, or recovery contracts.

The work is measurement-first. It adds a deterministic two-tier benchmark, establishes the current baseline, and admits only optimizations that remove a measured bottleneck while preserving or improving reliability. The intended execution policy is **Optimistic Verified Batching**: execute long safe local sequences when the runtime can keep validating state, and stop at ambiguity, sensitive boundaries, or external precondition failures.

This slice does not consume limited Codex usage for live comparison. A future Codex comparison may use the same scenarios and metrics, but Codex parity is not a completion gate for this slice.

## 2. Current baseline

Published `main@96d76b2810c7442a70dae5502065ff5bd15a2f99` already provides:

- a persistent Swift 6/macOS 14+ helper supervised by TypeScript;
- `computer_health`, bounded observation and screenshot tools;
- AX-first semantic targeting with bounded focused-window Vision OCR;
- physical mouse, keyboard, drag, scroll, wait, and verification primitives;
- typed multi-action `computer_run`;
- separately gated owner-trust `computer_run_js` with a low-level `computer` proxy;
- guarded app/window identity, display topology, stale-target, takeover, and emergency-stop behavior;
- bounded recovery with explicit replan boundaries;
- Admin authority and startup capability gates;
- stable installed-helper identity and fail-closed macOS TCC handling.

The clean design-worktree baseline passed `npm run check`: 117 test files passed, 1 skipped; 735 tests passed, 2 skipped.

## 3. Non-goals

This slice will not:

- copy, import, depend on, or reverse-engineer Codex's internal `@oai/sky` runtime;
- run live Codex Computer Use trials or consume Codex usage;
- add a second model, hidden local planner, or autonomous OODA loop;
- replace the native helper or rewrite the existing Computer Runtime architecture;
- weaken Admin authority, TCC, credential, CAPTCHA, takeover, emergency-stop, or verification boundaries;
- silently restart an already-running normal Chrome process;
- use Browser Runtime or Playwright as a substitute for an explicit Computer Use workflow;
- persist screenshots, OCR text, AX content, typed text, target labels, or raw coordinates in benchmark records;
- introduce a persistent JavaScript REPL or new public MCP tool before a baseline proves the existing tools structurally inadequate;
- push, open a PR, merge, deploy, restart the tunnel, or replace the installed helper without separate authorization and fresh verification.

## 4. Design principles

### 4.1 Preserve the working system

The first deliverable is observational infrastructure. It must not change normal Computer Runtime behavior, tool schemas, or default latency. Benchmark collection is explicit and off by default.

Existing `computer_*` schemas and output meanings remain backwards compatible. Event posting alone never becomes proof of a successful UI mutation. Existing `verified` and `completed_unverified` semantics remain authoritative.

### 4.2 Optimize decision boundaries, not only event speed

Mouse-event dispatch is rarely the dominant end-to-end cost. The benchmark therefore measures model/runtime decision boundaries, observations, screenshots, replans, waits, verification, and workflow duration in addition to native action latency.

### 4.3 Prefer existing execution paths

Routing remains:

1. direct `computer_*` for one operation;
2. typed `computer_run` for a short predetermined sequence;
3. `computer_run_js` for safe branching, repeated local observation, or longer stateful logic inside one bounded call;
4. a model-visible replan only when the runtime reaches a real decision boundary.

### 4.4 Admit complexity only with evidence

Every behavior-changing optimization must name:

- the baseline scenario and metric exposing the bottleneck;
- the intended minimal change;
- the focused RED evidence;
- the expected metric movement;
- the safety invariants that must remain unchanged;
- the post-change benchmark and regression evidence.

A new session API, public tool, cache, or persistent runner is rejected unless the benchmark proves that a smaller change to existing execution paths cannot satisfy the target.

## 5. Architecture

```text
ChatGPT Web/Desktop
        |
        v
existing computer_* MCP surface
        |
        +-- direct operation
        +-- computer_run typed program
        +-- computer_run_js branching program
        |
        v
existing TypeScript policy/supervisor layer
        |
        v
existing persistent Swift helper
        |
        +-- Accessibility
        +-- bounded Vision OCR
        +-- ScreenCaptureKit
        +-- CoreGraphics input
        +-- verification/takeover/emergency cleanup

explicit benchmark runner/collector (off by default)
        |
        +-- fixture lifecycle
        +-- categorical event timeline
        +-- requirement oracles
        +-- metrics/evaluation
        +-- privacy-safe run record
```

The benchmark is outside the runtime's normal request path and has two explicit modes. Runtime Mode drives public Computer Runtime contracts with a fixed scripted workflow and owns deterministic runtime latency, correctness, recovery, and safety measurements. Agent Mode is driven by ChatGPT through the normal custom-app MCP surface and owns model/runtime decision-boundary and end-to-end flow measurements. Neither mode may self-certify success; a trusted collector consults versioned fixture or real-app oracles.

## 6. Two-tier benchmark

### 6.1 Tier 1: deterministic fixture benchmark

Tier 1 contains five controlled web scenarios opened in normal Google Chrome and one controlled native macOS scenario. Fixture state is deterministic, resettable, local, and contains no user data.

Each scenario supports two distinct executions:

- **Runtime Mode:** a repository-owned scripted driver sends a fixed sequence through the public Computer Runtime API. It does not invoke ChatGPT or another model. It establishes native/supervisor latency, action correctness, recovery, and safety baselines.
- **Agent Mode:** ChatGPT receives only the scenario goal and uses the normal custom-app tools. A trusted external collector records actual MCP calls/results and fixture-oracle evidence. It measures decision boundaries, tool selection, batching, replans, and end-to-end experience. Agent Mode is never run in ordinary CI and is never replaced by a model-authored run record.

Runtime Mode and Agent Mode produce the same versioned record envelope but have different `mode` values and may not be aggregated into one latency distribution. Repository CI tests the protocol, fixtures, evaluator, and scripted Runtime Mode where the platform supports it. Repeated live Agent Mode is a controlled local acceptance activity.

Each scenario declares:

- an initial-state oracle;
- an exact task goal;
- allowed interaction surface;
- forbidden shortcuts and side effects;
- completion oracle;
- safety invariants;
- categorical expected recovery paths;
- metrics collected from observed calls and results.

The six scenarios are:

#### Scenario 1: open, focus, and verify

Open or focus normal Google Chrome, navigate to the local fixture, and prove the expected app/window/content state. An already-running normal Chrome process must not be restarted.

#### Scenario 2: batched multi-control form

Fill three text fields, set one checkbox and one selection control, activate the fixture's local completion control, and prove the resulting fixture state. The efficient path avoids a model boundary after every field.

#### Scenario 3: scoped nested scrolling

Locate a target below the visible region of a modal or side panel, resolve the deterministic scroll container, scroll that container only, activate the target, and prove completion. Unchanged scrolling must stop rather than loop.

#### Scenario 4: stale dynamic target recovery

Observe a control that is deliberately re-rendered or moved before mutation. The stale action must refuse unsafe dispatch. A fresh observation may then resolve the current target and complete the task.

#### Scenario 5: weak AX recovery ladder

Use a controlled weak-accessibility panel to exercise bounded OCR. If semantic resolution remains unavailable, obtain a fresh screenshot and allow at most one verified visual-point attempt. Repeating the same point against unchanged state is forbidden.

#### Scenario 6: native macOS fixture workflow

Open/focus the existing deterministic native fixture, modify multiple controls, enter bounded non-sensitive text, and prove the fixture's final state. If another application becomes frontmost, later physical actions must not be emitted.

### 6.2 Tier 2: real-Mac acceptance

After Tier 1 passes, run safe reversible workflows on the installed artifact:

- five Chrome tasks covering focus/navigation, batched form work, scoped scrolling, dynamic state, and bounded fallback;
- one native macOS task;
- three repetitions per task when external preconditions are available.

Normal Chrome profile/process state is preserved. No account mutation, payment, message sending, destructive file operation, permission change, CAPTCHA handling, or credential entry is included.

If a hosted product surface does not expose a required control, the run is `precondition_blocked`, not a runtime failure or synthetic success. The operator records the missing external precondition without weakening the scenario or changing automation surfaces.

Tier 2 has an explicit artifact gate:

1. build and verify the candidate worktree artifact without changing the installed daily-driver helper;
2. reach `candidate_ready_for_deployment` with all non-deployment gates green;
3. request separate deployment authorization;
4. only after authorization, use the identity-preserving installer for the fixed helper path and perform any required controlled supervisor/tunnel lifecycle action;
5. confirm the installed bundle identity and exact candidate lineage;
6. run Tier 2 against that installed artifact.

Without deployment authorization, Tier 2 remains `deployment_pending`; the candidate may be implementation-complete but the slice cannot claim real-Mac acceptance completion. A currently installed older helper cannot be used as evidence for a native candidate change. If the candidate changes no native helper code, the acceptance record must still bind the running TypeScript/runtime lineage and installed helper identity explicitly.

## 7. Run record and metrics

### 7.1 Privacy-safe event model

The collector records only bounded categorical data:

```ts
type ComputerBenchmarkEvent = {
  sequence: number;
  elapsedMs: number;
  mode: "runtime" | "agent";
  category:
    | "workflow_start"
    | "tool_boundary"
    | "observation"
    | "screenshot"
    | "physical_action"
    | "verification"
    | "replan"
    | "takeover"
    | "workflow_end";
  operation?: ComputerBenchmarkOperation;
  outcome?: ComputerBenchmarkOutcome;
  targeting?: "ax" | "ocr" | "visual-point" | "none";
  verified?: boolean;
};
```

`ComputerBenchmarkOperation` and `ComputerBenchmarkOutcome` are closed enums. Operation values are tool/action categories such as `observe`, `screenshot`, `click`, `scroll`, `type_text`, `wait`, `verify`, and `run`; outcome values are bounded categories such as `completed`, `verified`, `completed_unverified`, `blocked`, `needs_replan`, `timeout`, `unavailable`, and `precondition_blocked`. Raw tool names may be mapped to these enums in memory, but arbitrary strings and error messages are never persisted.

Zero-tolerance gates use explicit trusted-oracle assertions rather than inference from free-form events:

```ts
type ComputerBenchmarkAssertion = {
  assertion:
    | "completion_oracle"
    | "wrong_app_input_absent"
    | "post_takeover_input_absent"
    | "blind_point_repeat_absent"
    | "unchanged_scroll_repeat_absent"
    | "false_verified_absent"
    | "safety_boundary_violation_absent"
    | "browser_runtime_absent"
    | "chrome_process_preserved";
  status: "pass" | "fail" | "unavailable";
  evidenceDigest?: string;
};
```

The scenario definition names the allowed oracle for each assertion. Fixture state, native fixture event counters, typed runtime results, and trusted MCP call traces are valid sources. Model prose is not. An assertion with no permitted observable source is `unavailable`, never assumed to pass.

Exact final field names may follow existing benchmark conventions, but the persisted schema must not contain:

- screenshot bytes or image paths;
- OCR/AX/page text;
- typed text or editable values;
- application document content;
- target names or labels;
- raw pointer coordinates;
- environment secrets, lease IDs, or native pointers.

The trusted collector derives success from fixture oracles and observed results. Model-authored success claims are never accepted as oracle evidence.

### 7.2 Required metrics

Each run derives:

- end-to-end workflow duration;
- time to first usable observation;
- local action-program duration;
- model/runtime decision-boundary count;
- physical action count;
- observation count;
- screenshot count;
- AX, OCR, and visual-point usage counts;
- replan and retry counts;
- verified and completed-unverified counts;
- stale/focus/takeover/permission/precondition failure category;
- wrong-app input count;
- blind repeated point count;
- unchanged-state repeated-scroll count;
- safety-boundary violation count.

Runtime Mode owns local program, RPC, physical action, recovery, verification, and safety metrics. Agent Mode owns model/runtime decision boundaries, tool choice, batching, model-visible replans, and end-to-end duration. Metrics without an authoritative source in a mode are recorded as unavailable and excluded from that mode's acceptance arithmetic.

Timing uses monotonic clocks. Product targets are evaluated statistically and are not converted into brittle per-call CI timeouts.

### 7.3 Baseline and comparison

The first accepted benchmark run establishes the current-system baseline. A subsequent optimization report compares the same benchmark-schema version, metric-rules version, scenario version, fixture version, runtime build, machine class, mode, and run count.

Each comparison uses one unrecorded warm-up followed by ten recorded runs per scenario and candidate. Runs alternate baseline/candidate order when both artifacts can be exercised without violating installed-helper identity. No recorded run is discarded as an outlier. Reports include all values, median, p90, and paired faster-run count where pairing is valid.

Before changing behavior, the optimization plan selects one primary bottleneck and one of these objective completion rules:

- **flow boundary:** at least one fewer model/runtime decision boundary in at least 9 of 10 Agent Mode pairs, with candidate median end-to-end duration no worse than baseline;
- **flow latency:** at least 10% lower Agent Mode median end-to-end duration and at least 7 of 10 paired runs faster, with decision-boundary median no worse;
- **runtime latency:** at least 20% lower Runtime Mode median for the targeted operation/program and at least 10% lower p90, with at least 7 of 10 paired runs faster;
- **reliability defect:** a baseline failure reproduced in at least 2 of 10 runs becomes 0 of 10, while the scenario remains at least 9 of 10 overall and other scenarios do not regress below their gates.

If baseline noise or external product behavior prevents valid pairing, the plan must stop and redesign the measurement rather than declare improvement. Timing-only changes that fail the selected minimum effect do not satisfy this slice, even if their point estimate is positive.

An optimization is acceptable only when:

- its targeted metric improves or the targeted failure disappears;
- scenario success does not decrease;
- decision-boundary count does not increase;
- safety counters remain zero;
- full regression gates remain green.

The metric derivation algorithm, enum mappings, assertion-oracle mappings, warm-up rule, aggregation rule, and gate calculations are versioned together. Historical records are evaluated only by their matching rules version.

## 8. Success gates

### 8.1 Deterministic benchmark

Run each of the six scenarios ten times:

- overall success: at least 57 of 60 runs (95%);
- per-scenario floor: at least 9 of 10 runs;
- wrong-app input: 0;
- input after takeover: 0;
- blind repeated visual points: 0;
- unchanged-state repeated scroll loops: 0;
- false verified results: 0;
- safety-boundary violations: 0.

The 57/60 and per-scenario floors apply separately to Runtime Mode and to any completed Agent Mode batch; the two modes are never pooled to manufacture the threshold.

### 8.2 Real-Mac acceptance

When required external controls are available:

- each selected workflow passes 3 of 3 runs;
- normal Chrome process/profile remains preserved;
- no Browser Runtime calls occur in explicit Computer Use workflows;
- no hidden Chrome restart occurs;
- no blind coordinate or unchanged-scroll retry occurs;
- uncertain successful mutations are followed by fresh evidence rather than duplicate action.

Precondition-blocked tasks remain explicit and do not count as pass or runtime failure.

A selected Tier 2 workflow needs three completed eligible repetitions. `precondition_blocked` and `deployment_pending` runs do not reduce that sample size. If three eligible repetitions cannot be obtained, that workflow remains pending and Tier 2 completion cannot be claimed. The implementation and candidate-ready milestones may still be reported separately with the blocker.

## 9. Optimistic Verified Batching policy

Ordinary reversible work should remain local for as long as deterministic validation succeeds:

```text
fresh state
  -> resolve target
  -> validate app/window/display/takeover
  -> physical action
  -> local verification or bounded wait
  -> next safe action
```

The program returns to ChatGPT when:

- the target is missing or ambiguous;
- the state is stale and cannot be deterministically refreshed locally;
- the expected app/window loses focus;
- display topology becomes incompatible;
- a requested verification fails;
- a bounded scroll reaches a boundary or unchanged state;
- AX and OCR are exhausted and a fresh visual decision is required;
- user takeover or the emergency chord occurs;
- CAPTCHA, credential, permission, or other existing protected state is encountered;
- an external product precondition is missing.

The runtime does not infer user intent for payments, deletion, message sending, or other consequential operations. Those remain outside benchmark scenarios and require the existing user/model authorization boundary in real use.

## 10. Error model

Existing stable Computer Runtime error codes remain authoritative. Benchmark evaluation maps them into bounded categories but never replaces or hides the source result.

Rules:

- unavailable helper or permission -> `unavailable`, no alternate automation fallback;
- missing external UI control -> `precondition_blocked`;
- stale/focus/takeover refusal before dispatch -> safe failed attempt, not wrong-app input;
- dispatched mutation without requested proof -> `completed_unverified`, never promoted to verified;
- requested verification failure -> existing timeout/replan error;
- ambiguous target -> fail closed and require scope or replan;
- runner cancellation, timeout, takeover, emergency stop, or shutdown -> stop future steps and release held inputs;
- collector corruption or invalid record -> benchmark evaluation failure, never a pass.

## 11. Candidate optimization areas

The work uses a mandatory two-plan phase gate:

- **Plan A — Benchmark and Baseline:** implement the versioned protocol, fixtures, trusted collector/evaluator, Runtime Mode, Agent Mode collection contract, tests, and baseline procedure. Plan A must not prescribe or implement a speculative runtime optimization.
- **Plan B — Evidence-Selected Optimization:** after Plan A is complete and the baseline is checkpointed, select exactly one primary bottleneck and objective completion rule. Write a second exact implementation plan naming the files, focused RED evidence, minimal change, metric target, regression gates, and rollback boundary. Additional bottlenecks require later plan amendments or separate plans.

Plan B may include an optimization only after its baseline evidence exists. Candidate areas are:

- reduce redundant observe/screenshot boundaries when existing local verification is sufficient;
- prefer `computer_run` or `computer_run_js` for multi-step workflows in tool guidance;
- make recovery recommendations more directly actionable without exposing content;
- remove duplicated fresh-observation work inside one exclusive program when the same safety checks can be retained;
- reduce avoidable process/RPC setup while preserving the persistent helper and cleanup model;
- improve local wait/verify composition so expected UI transitions do not require a model round trip;
- bound payloads more tightly if observation size, not runtime latency, is the measured bottleneck.

This list is not a promise to implement every item. Unmeasured speculative changes remain out of scope. If Plan A finds no bottleneck that can satisfy an objective completion rule without weakening invariants, checkpoint that evidence and return to design rather than inventing Plan B.

## 12. Testing strategy

Follow repository lifecycle gates and the bug/security sequence: evidence -> failing automated test -> minimal fix -> focused verification -> full regression gate.

### 12.1 Benchmark protocol tests

Test:

- deterministic scenario definitions and reset behavior;
- run-record schema bounds;
- monotonic sequence/timing validation;
- metric derivation from events rather than claimed scores;
- oracle provenance and invalid-record rejection;
- privacy rejection for forbidden content fields;
- success-gate calculations, including 57/60 and per-scenario 9/10 floors;
- `precondition_blocked` exclusion from pass/fail arithmetic;
- stable scenario/fixture version matching.

### 12.2 TypeScript integration tests

For each admitted optimization, prove:

- old callers and schemas continue to work;
- direct, typed batch, and JS paths preserve semantic-target parity;
- cancellation stops later actions;
- output details remain bounded and non-sensitive;
- tool descriptions encode the intended batching/replan policy;
- explicit Computer Use remains isolated from Browser Runtime.

### 12.3 Native tests

Run existing native suites for:

- focus/window/display validation;
- stale-target refusal;
- takeover and emergency stop;
- held-input cleanup;
- AX/OCR bounds;
- verification truthfulness;
- bounded scroll and recovery.

Add native coverage only when an admitted measured bottleneck requires native code changes.

### 12.4 Full gates

Before completion:

- focused benchmark tests pass;
- focused changed-subsystem tests pass;
- `git diff --check` passes;
- `npm run check` passes;
- `npm run test:computer:macos` passes;
- `npm audit --omit=dev` reports zero vulnerabilities;
- native/runtime fixture builds and packages pass when touched;
- strict/deep signing and installed-bundle contract checks pass before deployment;
- fresh `project_check` PASS matches exact final HEAD and working-tree digest;
- Git status is clean after committed task-owned changes.

## 13. Delivery sequence

### Phase A — Benchmark and baseline

1. Write and approve Plan A with exact files, tests, commands, commit boundaries, and handoff checkpoints.
2. Add the versioned benchmark protocol, scenario metadata, evaluator, and privacy-safe record schema without changing runtime behavior.
3. Add controlled web fixture states and reuse or minimally extend the existing native fixture.
4. Prove collector/oracle behavior with focused integration tests.
5. Implement scripted Runtime Mode and the trusted Agent Mode collection contract.
6. Run protocol/full regression gates and establish the current runtime baseline.
7. Commit and checkpoint the baseline evidence, exact artifact identity, selected primary bottleneck, and selected objective completion rule.

### Phase B — Evidence-selected optimization

8. Write and approve Plan B for the selected bottleneck; do not continue from a generic placeholder task.
9. Reproduce the bottleneck with focused RED evidence.
10. Implement the smallest backwards-compatible fix.
11. Rerun the focused scenario, repeated comparison, and regression suites.
12. Repeat only through a separately approved plan amendment if another bottleneck is still required.
13. Run Tier 1 repeated acceptance for the exact candidate.
14. Build/package and verify the exact candidate artifact without changing the installed daily-driver helper.
15. Reach and checkpoint `candidate_ready_for_deployment`.
16. Request separate authorization before push, PR creation, merge, deployment, helper replacement, or tunnel restart.
17. If deployment is authorized, install with identity preservation, verify exact lineage, and run Tier 2 when external preconditions allow.
18. Update continuity state after every milestone with exact branch/worktree/HEAD, evidence, blockers, and one concrete next step.

## 14. Rollback and compatibility

Benchmark code is additive and inactive during normal calls. Runtime optimizations must be independently revertible and must not require migration of persisted user data.

If an optimization degrades any safety or success metric:

1. stop acceptance;
2. preserve the failing run record and exact artifact identity;
3. revert only the task-owned optimization on the feature branch;
4. rerun the unchanged benchmark baseline;
5. do not deploy or reinterpret the regression as acceptable variance.

The existing installed helper and healthy tunnel remain untouched until a verified candidate explicitly requires deployment.

## 15. Handoff contract

Another agent must be able to resume without chat history. The task therefore maintains:

- this design spec as the authoritative approved behavior;
- Plan A with exact benchmark/baseline files, tests, commands, expected RED/GREEN states, and commit boundaries;
- after the baseline, a separately approved Plan B with the evidence-selected optimization's exact files, tests, commands, expected RED/GREEN states, metric target, and commit boundaries;
- `docs/PROJECT_STATE.md` with the active worktree, branch, exact HEAD, completed milestone, current evidence, blockers, and one concrete next step;
- Project Continuity checkpoints at each meaningful milestone;
- no secrets, raw UI content, screenshots, OCR/AX text, typed sensitive data, or lease IDs in repository documentation.

Git/worktree reality remains authoritative over continuity records and documents.

## 16. Definition of done

The slice is complete when:

- the deterministic two-tier benchmark exists and does not affect normal runtime behavior;
- baseline and post-change results are reproducible and privacy-safe;
- deterministic acceptance reaches at least 57/60 overall with no scenario below 9/10;
- all safety counters remain zero;
- real-Mac tasks pass 3/3 when their external preconditions are available, with blocked surfaces reported honestly;
- at least one measured flow bottleneck is removed without increasing decision boundaries or weakening verification;
- all repository/native/security/package gates required by the changed files pass on the exact final artifact;
- current `computer_*` callers remain compatible;
- no live Codex usage was consumed;
- publication and deployment remain pending until separately authorized.

Completion is reported in named stages:

- `benchmark_baseline_complete`: Plan A is implemented and the versioned baseline is checkpointed;
- `candidate_ready_for_deployment`: Plan B is implemented, Tier 1 and all non-deployment gates pass on the exact candidate;
- `real_mac_acceptance_complete`: authorized exact-artifact Tier 2 obtains all required eligible repetitions;
- `slice_complete`: all definition-of-done requirements, including real-Mac acceptance, are satisfied.

`deployment_pending` or `precondition_blocked` may legitimately stop progress after candidate readiness, but neither is reported as `slice_complete`.
