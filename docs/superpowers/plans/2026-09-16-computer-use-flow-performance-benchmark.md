# Computer Use Flow Performance Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the versioned, privacy-safe Tier 1 Computer Use benchmark and establish the current-runtime baseline without changing Computer Runtime behavior.

**Architecture:** Add a benchmark-only TypeScript package under `benchmarks/computer-use-flow-performance/` that owns strict contracts, deterministic scenario metadata, a loopback web fixture, trusted collection, scripted Runtime Mode, evaluation, and reporting. Runtime Mode directly exercises the existing public `ComputerRuntime` surface against the current installed helper; Agent Mode keeps ChatGPT on the normal custom-app Computer Use surface and derives only the categorical call/result evidence that the existing global audit actually exposes, joins that with independent fixture oracles, and uses a benchmark-owned host-process oracle for Chrome preservation. Audit/result fields that do not exist today are recorded as unavailable rather than inferred. All collection is explicit and off the normal request path; existing `src/computer-*` behavior and public MCP schemas remain untouched.

**Tech Stack:** Node.js 22+, TypeScript 6 strict mode, Vitest 5, Zod 4, existing `ComputerRuntime`/`ComputerNativeSupervisor`, Node `http`/`crypto`/`fs`/`child_process`, existing deterministic macOS Computer Runtime fixture.

**Spec:** `docs/superpowers/specs/2026-09-16-computer-use-flow-performance-design.md`

## Global Constraints

- Work only in the managed worktree on `design/computer-use-flow-performance`; Git/worktree reality outranks continuity and documentation.
- Plan A is benchmark and baseline infrastructure only. Do not change Computer Runtime behavior, tool descriptions, MCP schemas, native helper behavior, or admission policy.
- Do not consume Codex usage or run live Codex Computer Use comparisons.
- Do not add `@oai/sky`, a second model, hidden planner, autonomous local OODA loop, persistent JavaScript REPL, or new public MCP tool.
- Preserve every existing authority, TCC, credential, CAPTCHA, takeover, emergency-stop, stale-target, focus, verification, and held-input cleanup boundary.
- Explicit Computer Use must not fall back to `browser_*`/Playwright. Normal Google Chrome must not be silently restarted.
- Benchmark records must never persist screenshots, OCR/AX/page text, editable values, typed text, target names/labels, raw coordinates, raw error bodies, secrets, lease IDs, native pointers, or model prose as evidence.
- New benchmark contracts must not declare `any`, `unknown`, loose dictionaries, or free-text operation/outcome fields. Raw JSON is parsed immediately through closed Zod schemas before use.
- Correctness, bounds, schema validity, and gate arithmetic belong in CI. Latency thresholds/distributions belong to real-Mac benchmark runs; do not add brittle latency CI assertions.
- Do not push, open a PR, merge, deploy, replace the installed helper, restart the healthy tunnel, or restart normal Chrome without separate explicit authorization.
- Plan B does not exist until the accepted baseline selects one measured bottleneck and one objective completion rule.

---

## Repository Mapping and Reuse Decisions

### Existing benchmark patterns to reuse

`benchmarks/coding-harness-v2/benchmark.mjs`, `tests/coding-harness-benchmark.test.ts`, and `docs/CODING_HARNESS_V2.md` already establish useful repository conventions:

- deterministic scenario catalogs and materialization;
- canonical key ordering before hashing/signing;
- SHA-256 identities and HMAC-SHA256 trusted-collector signatures;
- event-derived evaluation rather than trusting a claimed score;
- tamper rejection;
- deterministic CLI commands;
- focused Vitest verification before full gates.

Reuse these conventions, not the Coding Harness event vocabulary. Computer Use needs its own closed typed protocol because its modes, safety assertions, latency metrics, oracles, and fixture lifecycle are different.

### Existing Computer Runtime to reuse unchanged

Plan A reads/reuses behavior from, but does not modify:

- `src/computer-tool-registration.ts`
- `src/computer-js-tool-registration.ts`
- `src/computer-js-runner.ts`
- `src/computer-runtime.ts`
- `src/computer-types.ts`
- `src/tool-output-schemas.ts`
- `src/scoped-computer-service.ts`
- `src/scoped-computer-js-service.ts`
- `src/computer-errors.ts`
- `src/computer-native-client.ts`
- `src/computer-native-supervisor.ts`

The existing public contracts already provide typed batching, scoped scrolling, stale-target refusal, AX/OCR recovery, fresh screenshots, verified visual-point actions, cancellation, focus protection, and held-input cleanup. The benchmark measures those semantics; it does not rewrite them.

### Existing tests to preserve and use as patterns

- `tests/computer-audit.test.ts`: categorical `computer.*` audit action/outcome/duration and privacy-safe metadata pattern used by the Agent collector.
- `tests/computer-mcp.test.ts`: real local MCP client/HTTP transport pattern and strict public `computer_*` schema expectations.
- `tests/computer-runtime.test.ts`: direct runtime semantics, typed `computer_run`, stale/focus/recovery, bounded scroll, cancellation, and no typed-text echo.
- `tests/computer-slice5-integration.test.ts`: deterministic stale-target, OCR-only, ambiguity, and semantic action protocol coverage.
- Existing `tests/computer-*.test.ts` remain regression coverage; Plan A adds benchmark-specific tests instead of broad refactors.

### Native fixture reuse

Reuse the existing fixture without changing it in Plan A:

- `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureInteractionView.swift`
- `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/FixtureAppDelegate.swift`
- `native/macos-computer-runtime/Sources/ComputerRuntimeFixture/main.swift`
- `scripts/package-macos-computer-runtime-fixture.mjs`

It already exposes deterministic text input, checkbox state, status/focus indicators, stale/reordered targets, a scroll view, and an OCR-only visual target. Benchmark fixture lifecycle may start/stop only the fixture child it owns between runs. It must not kill or restart normal Chrome and must not change the installed Computer Runtime helper.

No native source or Swift test change is planned. If implementation proves that the existing native fixture cannot produce a deterministic initial/completion oracle without persisting raw UI content, stop and amend Plan A before modifying native code.

### Web fixture finding

No existing Computer Use web fixture or acceptance server exists in the repository. The only relevant loopback-server patterns are general MCP/control tests. Plan A therefore adds a small benchmark-owned `127.0.0.1` HTTP fixture. The fixture is not Playwright and does not expose a Browser Runtime path.

`RTK.md` does not exist and the repository has no `RTK.md` reference. Do not add or cite one.

---

## File Map

### Create

- `benchmarks/computer-use-flow-performance/tsconfig.json` — strict no-emit typecheck for benchmark TypeScript plus imported runtime source types.
- `benchmarks/computer-use-flow-performance/contract.ts` — all schema/rules/scenario/fixture versions, closed enums, Zod schemas, run/result/build/comparison types, and metric-availability types.
- `benchmarks/computer-use-flow-performance/canonical.ts` — deterministic canonical serialization, domain-separated HMAC evidence digests, collector signatures, and pure build-ID derivation.
- `benchmarks/computer-use-flow-performance/identity.ts` — clean Git-state observation compatible with the current project-check working-tree digest, coarse hashed machine-class identity, TypeScript artifact tree hashing, and installed-helper executable hashing.
- `benchmarks/computer-use-flow-performance/scenarios.ts` — exact six-scenario catalog, allowed surfaces, oracle policy, reset policy, mode applicability, and expected recovery categories.
- `benchmarks/computer-use-flow-performance/web-fixture.ts` — loopback-only deterministic fixture server and in-memory categorical oracle state.
- `benchmarks/computer-use-flow-performance/fixtures/index.html` — static fixture structure for the five controlled Chrome scenarios.
- `benchmarks/computer-use-flow-performance/fixtures/fixture.js` — deterministic local fixture behavior; it reports only categorical/boolean oracle events to the fixture server.
- `benchmarks/computer-use-flow-performance/host-oracle.ts` — benchmark-owned process-snapshot adapter for in-memory Chrome main-process continuity checks; raw process identifiers are never persisted.
- `benchmarks/computer-use-flow-performance/agent-collector.ts` — bounded exclusive audit-window reader, Agent Mode call/result-derived categorization, forbidden-surface detection, fixture/host-oracle joining, authoritative-unavailable handling, and run finalization.
- `benchmarks/computer-use-flow-performance/runtime-harness.ts` — benchmark-only adapter that constructs the current `ComputerNativeSupervisor`/`ComputerRuntime`, wraps native requests for categorical RPC timing, owns fixture child lifecycle, and closes/release-inputs safely.
- `benchmarks/computer-use-flow-performance/runtime-mode.ts` — fixed scripted public Computer Runtime workflows for all six scenarios; no model calls.
- `benchmarks/computer-use-flow-performance/evaluator.ts` — record validation, metric derivation, gate arithmetic, median/p90, pairing validation, and version/build compatibility checks.
- `benchmarks/computer-use-flow-performance/cli.ts` — deterministic `list`, `runtime-batch`, `agent-batch`, `evaluate`, and `compare` commands.
- `tests/computer-use-flow-benchmark-contract.test.ts` — strict contract, privacy, digest/signature, enum, version, disposition, and comparison-compatibility tests.
- `tests/computer-use-flow-identity.test.ts` — clean/dirty repository identity, machine-class privacy, artifact tree hash, helper hash, and build-ID tests.
- `tests/computer-use-flow-web-fixture.test.ts` — real local HTTP fixture reset/oracle tests for all five web scenarios.
- `tests/computer-use-flow-host-oracle.test.ts` — injected process-snapshot tests for pre-existing Chrome preservation and privacy-safe categorical output.
- `tests/computer-use-flow-agent-collector.test.ts` — real temporary audit JSONL + real fixture-server collector tests, including forbidden surfaces and unavailable turn correlation.
- `tests/computer-use-flow-runtime-mode.test.ts` — scripted workflow sequencing and categorical telemetry tests with a deterministic recording runtime adapter.
- `tests/computer-use-flow-evaluator.test.ts` — success gates, no-outlier rule, median/p90, pairing, blocked/pending arithmetic, and version mismatch rejection.
- `tests/computer-use-flow-cli.test.ts` — CLI catalog/evaluate/compare contract and failure-mode tests.
- `docs/COMPUTER_USE_FLOW_BENCHMARK.md` — operator runbook for Runtime Mode, controlled Agent Mode, baseline artifacts, privacy rules, and Plan B gate.

### Modify during implementation

- `.gitignore` — add `benchmarks/computer-use-flow-performance/results/`; raw run artifacts stay local and are never accidentally committed.
- `docs/PROJECT_STATE.md` — update only at meaningful Plan A implementation/baseline milestones with exact branch/worktree/HEAD, RED/GREEN state, verification evidence, blocker, selected bottleneck/rule, and next exact step.

### Explicitly not modified by Plan A

- all existing `src/computer-*` runtime/tool-registration/schema/service files;
- `src/server.ts` and `src/transport.ts`;
- Browser Runtime/Playwright implementation files;
- native Computer Runtime helper/core/host sources;
- existing native fixture sources unless a separately reviewed Plan A amendment proves a deterministic oracle impossible without a fixture change;
- installed helper, tunnel configuration, Chrome profile/process configuration, public MCP catalog.

---

## Closed Benchmark Contract

Use these exact version constants in `contract.ts`:

```ts
export const COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION = 1 as const;
export const COMPUTER_FLOW_METRIC_RULES_VERSION = 1 as const;
export const COMPUTER_FLOW_SCENARIO_VERSION = 1 as const;
export const COMPUTER_FLOW_FIXTURE_VERSION = 1 as const;
export const COMPUTER_FLOW_EVIDENCE_DIGEST_VERSION = 1 as const;

export const COMPUTER_FLOW_SCENARIO_IDS = [
  "open-focus-verify",
  "batched-multi-control-form",
  "scoped-nested-scrolling",
  "stale-dynamic-target-recovery",
  "weak-ax-ocr-visual-point",
  "native-macos-fixture-workflow",
] as const;
export type ComputerFlowScenarioId = typeof COMPUTER_FLOW_SCENARIO_IDS[number];
```

Use closed literal arrays plus derived types; do not accept arbitrary operation/outcome strings:

```ts
export const COMPUTER_FLOW_MODES = ["runtime", "agent"] as const;
export type ComputerFlowMode = typeof COMPUTER_FLOW_MODES[number];

export const COMPUTER_FLOW_OPERATIONS = [
  "health",
  "observe",
  "screenshot",
  "pointer_position",
  "open_app",
  "focus_app",
  "move_mouse",
  "click",
  "double_click",
  "drag",
  "scroll",
  "scroll_until_visible",
  "type_text",
  "press_key",
  "release_inputs",
  "wait",
  "wait_for_frontmost",
  "wait_for_text",
  "wait_until_changed",
  "run",
  "run_js",
] as const;
export type ComputerFlowOperation = typeof COMPUTER_FLOW_OPERATIONS[number];

export const COMPUTER_FLOW_OUTCOMES = [
  "completed",
  "verified",
  "completed_unverified",
  "blocked",
  "needs_replan",
  "timeout",
  "unavailable",
  "cancelled",
] as const;
export type ComputerFlowOutcome = typeof COMPUTER_FLOW_OUTCOMES[number];

export const COMPUTER_FLOW_ASSERTIONS = [
  "completion_oracle",
  "wrong_app_input_absent",
  "post_takeover_input_absent",
  "blind_point_repeat_absent",
  "unchanged_scroll_repeat_absent",
  "false_verified_absent",
  "safety_boundary_violation_absent",
  "browser_runtime_absent",
  "chrome_process_preserved",
] as const;
export type ComputerFlowAssertionName = typeof COMPUTER_FLOW_ASSERTIONS[number];

export const COMPUTER_FLOW_ASSERTION_STATUSES = ["pass", "fail", "unavailable"] as const;
export type ComputerFlowAssertionStatus = typeof COMPUTER_FLOW_ASSERTION_STATUSES[number];

export const COMPUTER_FLOW_ASSERTION_SOURCES = [
  "web_fixture_oracle",
  "native_fixture_oracle",
  "host_process_oracle",
  "runtime_result",
  "runtime_trace",
  "runtime_audit",
] as const;
export type ComputerFlowAssertionSource = typeof COMPUTER_FLOW_ASSERTION_SOURCES[number];

export const COMPUTER_FLOW_RUN_DISPOSITIONS = [
  "eligible_completed",
  "precondition_blocked",
  "deployment_pending",
  "invalid",
] as const;
export type ComputerFlowRunDisposition = typeof COMPUTER_FLOW_RUN_DISPOSITIONS[number];

export const COMPUTER_FLOW_FAILURE_CATEGORIES = [
  "none",
  "stale",
  "focus",
  "takeover",
  "permission",
  "precondition",
  "timeout",
  "unavailable",
  "target_ambiguous",
  "verification_failed",
  "collector_invalid",
] as const;
export type ComputerFlowFailureCategory = typeof COMPUTER_FLOW_FAILURE_CATEGORIES[number];

export const COMPUTER_FLOW_ORACLE_KINDS = [
  "web_fixture",
  "native_fixture",
  "host_process",
  "runtime_result",
  "runtime_audit",
] as const;
export type ComputerFlowOracleKind = typeof COMPUTER_FLOW_ORACLE_KINDS[number];

export const COMPUTER_FLOW_RESET_POLICIES = [
  "new_web_session",
  "owned_native_fixture_relaunch",
] as const;
export type ComputerFlowResetPolicy = typeof COMPUTER_FLOW_RESET_POLICIES[number];

export const COMPUTER_FLOW_AGENT_REQUIREMENTS = ["required", "optional"] as const;
export type ComputerFlowAgentRequirement = typeof COMPUTER_FLOW_AGENT_REQUIREMENTS[number];

export interface ComputerFlowAssertionRule {
  assertion: ComputerFlowAssertionName;
  allowedSources: readonly ComputerFlowAssertionSource[];
  runtimeRequired: boolean;
  agentRequired: boolean;
}

export interface ComputerFlowScenarioDefinition {
  id: ComputerFlowScenarioId;
  initialStateOracle: ComputerFlowOracleKind;
  exactGoal: string;
  allowedOperations: readonly ComputerFlowOperation[];
  forbiddenOperations: readonly ComputerFlowOperation[];
  forbidNonComputerTools: true;
  completionOracle: ComputerFlowOracleKind;
  assertionRules: readonly ComputerFlowAssertionRule[];
  resetPolicy: ComputerFlowResetPolicy;
  runtimeMode: "required";
  agentMode: ComputerFlowAgentRequirement;
  expectedFailureCategories: readonly ComputerFlowFailureCategory[];
}
```

Metric availability is explicit; do not encode unavailable data as `0`, `null`, or a guessed value:

```ts
export const COMPUTER_FLOW_UNAVAILABLE_REASONS = [
  "mode_not_authoritative",
  "missing_turn_correlation",
  "collector_source_missing",
  "precondition_blocked",
  "deployment_pending",
] as const;
export type ComputerFlowUnavailableReason = typeof COMPUTER_FLOW_UNAVAILABLE_REASONS[number];

export type ComputerFlowMetric =
  | { availability: "available"; value: number }
  | { availability: "unavailable"; reason: ComputerFlowUnavailableReason };
```

The persisted record envelope must include version identity and immutable runtime identity:

```ts
export interface ComputerFlowRuntimeBuild {
  buildId: string;
  gitCommit: string;
  workingTreeDigest: string;
  computerProtocolVersion: number;
  typeScriptArtifactSha256: string;
  nativeHelperExecutableSha256: string;
}

export interface ComputerFlowEvent {
  sequence: number;
  elapsedMs: number;
  mode: ComputerFlowMode;
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
  operation?: ComputerFlowOperation;
  outcome?: ComputerFlowOutcome;
  targeting?: "ax" | "ocr" | "visual-point" | "none";
  verified?: boolean;
}

export interface ComputerFlowAssertion {
  assertion: ComputerFlowAssertionName;
  status: ComputerFlowAssertionStatus;
  source: ComputerFlowAssertionSource;
  evidenceDigest?: string;
}

export interface ComputerFlowMetrics {
  endToEndDurationMs: ComputerFlowMetric;
  timeToFirstUsableObservationMs: ComputerFlowMetric;
  runtimeDurationMs: ComputerFlowMetric;
  localActionProgramDurationMs: ComputerFlowMetric;
  computerToolCallCount: ComputerFlowMetric;
  modelRoundTripCount: ComputerFlowMetric;
  nativeRpcCount: ComputerFlowMetric;
  physicalActionCount: ComputerFlowMetric;
  observationCount: ComputerFlowMetric;
  screenshotCount: ComputerFlowMetric;
  axTargetingCount: ComputerFlowMetric;
  ocrTargetingCount: ComputerFlowMetric;
  visualPointTargetingCount: ComputerFlowMetric;
  retryCount: ComputerFlowMetric;
  replanCount: ComputerFlowMetric;
  verifiedCount: ComputerFlowMetric;
  completedUnverifiedCount: ComputerFlowMetric;
  wrongAppInputCount: ComputerFlowMetric;
  blindRepeatedPointCount: ComputerFlowMetric;
  unchangedScrollRepeatCount: ComputerFlowMetric;
  safetyBoundaryViolationCount: ComputerFlowMetric;
}

export interface ComputerFlowRunRecord {
  schemaVersion: 1;
  metricRulesVersion: 1;
  scenarioVersion: 1;
  fixtureVersion: 1;
  scenarioId: ComputerFlowScenarioId;
  mode: ComputerFlowMode;
  tier: "tier1" | "tier2";
  runKind: "recorded";
  repetition: number;
  runtimeBuild: ComputerFlowRuntimeBuild;
  machineClassId: string;
  disposition: ComputerFlowRunDisposition;
  failureCategory: ComputerFlowFailureCategory;
  events: ComputerFlowEvent[];
  assertions: ComputerFlowAssertion[];
  metrics: ComputerFlowMetrics;
  collectorSignature: string;
}
```

Warm-up execution is intentionally not serializable as `ComputerFlowRunRecord`: the runner executes one warm-up, discards it, then numbers recorded runs `1..10`. This prevents accidental inclusion in acceptance arithmetic.

Comparison input is separate from a single run and requires two distinct build identities:

```ts
export const COMPUTER_FLOW_GATE_STATUSES = ["pass", "fail", "incomplete"] as const;
export type ComputerFlowGateStatus = typeof COMPUTER_FLOW_GATE_STATUSES[number];

export const COMPUTER_FLOW_OBJECTIVE_RULES = [
  "flow_boundary",
  "flow_latency",
  "runtime_latency",
  "reliability_defect",
] as const;
export type ComputerFlowObjectiveRule = typeof COMPUTER_FLOW_OBJECTIVE_RULES[number];

export const COMPUTER_FLOW_COMPARISON_STATUSES = ["pass", "fail", "ineligible"] as const;
export type ComputerFlowComparisonStatus = typeof COMPUTER_FLOW_COMPARISON_STATUSES[number];

export const COMPUTER_FLOW_COMPARISON_INELIGIBLE_REASONS = [
  "version_mismatch",
  "same_build_identity",
  "machine_class_mismatch",
  "scenario_set_mismatch",
  "recorded_count_mismatch",
  "invalid_pairing",
  "metric_unavailable",
] as const;
export type ComputerFlowComparisonIneligibleReason =
  typeof COMPUTER_FLOW_COMPARISON_INELIGIBLE_REASONS[number];

export interface ComputerFlowScenarioResult {
  scenarioId: ComputerFlowScenarioId;
  recordedRunCount: number;
  eligibleSuccessCount: number;
  zeroToleranceFailureCount: number;
  requiredAssertionUnavailableCount: number;
  gateStatus: ComputerFlowGateStatus;
  medianEndToEndDurationMs: ComputerFlowMetric;
  p90EndToEndDurationMs: ComputerFlowMetric;
  medianRuntimeDurationMs: ComputerFlowMetric;
  p90RuntimeDurationMs: ComputerFlowMetric;
  medianModelRoundTripCount: ComputerFlowMetric;
}

export interface ComputerFlowBatchResult {
  mode: ComputerFlowMode;
  recordedRunCount: number;
  eligibleSuccessCount: number;
  zeroToleranceFailureCount: number;
  requiredAssertionUnavailableCount: number;
  fullTierGateStatus: ComputerFlowGateStatus;
  scenarios: ComputerFlowScenarioResult[];
}

export interface ComputerFlowComparisonInput {
  baselineRuntimeBuild: ComputerFlowRuntimeBuild;
  candidateRuntimeBuild: ComputerFlowRuntimeBuild;
  baselineRuns: ComputerFlowRunRecord[];
  candidateRuns: ComputerFlowRunRecord[];
}

interface ComputerFlowComparisonBase {
  status: ComputerFlowComparisonStatus;
  ineligibleReason?: ComputerFlowComparisonIneligibleReason;
  validPairCount: number;
}

export interface ComputerFlowBoundaryComparisonResult extends ComputerFlowComparisonBase {
  objectiveRule: "flow_boundary";
  pairedBoundaryReductionCount: ComputerFlowMetric;
  baselineMedianModelRoundTripCount: ComputerFlowMetric;
  candidateMedianModelRoundTripCount: ComputerFlowMetric;
  baselineMedianEndToEndDurationMs: ComputerFlowMetric;
  candidateMedianEndToEndDurationMs: ComputerFlowMetric;
}

export interface ComputerFlowLatencyComparisonResult extends ComputerFlowComparisonBase {
  objectiveRule: "flow_latency";
  pairedCandidateFasterCount: ComputerFlowMetric;
  baselineMedianEndToEndDurationMs: ComputerFlowMetric;
  candidateMedianEndToEndDurationMs: ComputerFlowMetric;
  baselineMedianModelRoundTripCount: ComputerFlowMetric;
  candidateMedianModelRoundTripCount: ComputerFlowMetric;
}

export interface ComputerFlowRuntimeLatencyComparisonResult extends ComputerFlowComparisonBase {
  objectiveRule: "runtime_latency";
  pairedCandidateFasterCount: ComputerFlowMetric;
  baselineMedianRuntimeDurationMs: ComputerFlowMetric;
  candidateMedianRuntimeDurationMs: ComputerFlowMetric;
  baselineP90RuntimeDurationMs: ComputerFlowMetric;
  candidateP90RuntimeDurationMs: ComputerFlowMetric;
}

export interface ComputerFlowReliabilityComparisonResult extends ComputerFlowComparisonBase {
  objectiveRule: "reliability_defect";
  failureCategory: Exclude<ComputerFlowFailureCategory, "none">;
  baselineFailureCount: number;
  candidateFailureCount: number;
  candidateSuccessCount: number;
  otherScenarioFloorRegressionCount: number;
}

export type ComputerFlowComparisonResult =
  | ComputerFlowBoundaryComparisonResult
  | ComputerFlowLatencyComparisonResult
  | ComputerFlowRuntimeLatencyComparisonResult
  | ComputerFlowReliabilityComparisonResult;
```

`compareComputerFlowRuns` rejects the comparison when `baselineRuntimeBuild.buildId === candidateRuntimeBuild.buildId`, or when schema/rules/scenario/fixture versions, mode, machine class, scenario set, recorded count, or valid pair keys do not match.

---

## Privacy-Safe `evidenceDigest`

`evidenceDigest` is created only by the trusted collector/oracle. It is a domain-separated HMAC-SHA256 over closed categorical assertion metadata; the collector key is never persisted:

```ts
export interface ComputerFlowEvidenceMetadataV1 {
  version: 1;
  scenarioId: ComputerFlowScenarioId;
  mode: ComputerFlowMode;
  assertion: ComputerFlowAssertionName;
  status: ComputerFlowAssertionStatus;
  source: ComputerFlowAssertionSource;
  sourceSequence: number;
  operation?: ComputerFlowOperation;
  outcome?: ComputerFlowOutcome;
}
```

Canonical serialization recursively sorts object keys, preserves array order, rejects non-finite numbers, and serializes only schema-validated metadata. Use two HMAC domains with the same in-memory collector key:

```text
computer-use-flow-evidence-v1\0 + canonical assertion metadata bytes
computer-use-flow-record-v1\0 + canonical unsigned run-record bytes
```

The digest input can never contain screenshot bytes/path, OCR/AX/page text, editable value, target label/name, typed text, raw coordinate, raw error body, user content, secret, lease ID, native pointer, application document content, or model prose. Because no user content enters the payload and HMAC uses a secret key, low-entropy user data cannot be recovered through dictionary attacks. Tests must attempt to inject every forbidden field and require schema rejection rather than redaction-after-persistence.

Use a test-only fixed collector key in Vitest. Real runs read `CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY`, require at least 32 UTF-8 bytes, and never write the key to fixture state, run JSON, audit, task state, or repository documentation.

---

## Mode Ownership and Batch Policy

### Runtime Mode

- Calls no model.
- Uses fixed repository-owned scripts against public `ComputerRuntime` operations.
- The real-Mac adapter constructs the current configured `ComputerNativeSupervisor` and `ComputerRuntime`; it does not install or replace the helper.
- A benchmark-only native-request wrapper measures categorical RPC operation/outcome/duration without recording params/results.
- Owns runtime/RPC/action-program duration, physical-action count, observation/screenshot counts, recovery/retry counts, verification states, and safety assertions.
- CI covers contract logic, scripted call order, error mapping, bounds, and deterministic web fixture behavior with a recording adapter.
- Actual latency distributions and physical desktop assertions run only on a real Mac.

### Agent Mode

- ChatGPT receives only the goal and fixture URL/state for the scenario and uses the normal custom-app Computer Use surface.
- Collection runs in an **exclusive audit window**: authority setup, lease-free health preflight, fixture reset, and collector probes finish before `beginAgentCollection`; no other `chatgpt-system` workload may run until `finishAgentCollection`. If the audit cursor rotates, truncates, changes identity, or contains unrelated/unknown activity that cannot be attributed under this exclusive-window contract, the run is `invalid`.
- The existing global audit is authoritative only for facts it actually records after a service result is known: audited action category, `ok`/`error`, bounded error code, duration, target source class/OCR invocation when present, bounded-scroll result metadata when present, and `computer.run` action/completed counts. It is **not** treated as a copy of the MCP structured result.
- Therefore `computerToolCallCount` is the count of completed top-level measured `computer_*` audit records and one `computer_run` counts once, but result-level facts absent from audit—such as direct-action `verified` versus `completed_unverified`—remain unavailable in Agent Mode. An `outcome: "ok"` audit record must never be promoted to `verified`.
- Independent fixture oracles prove scenario state transitions. A benchmark-owned host-process oracle snapshots the normal Chrome main-process set before and after the measured run, keeps raw process identifiers in memory only, and supplies only the categorical `chrome_process_preserved` assertion. It never kills, launches, focuses, or restarts Chrome.
- Model prose is never accepted as completion or safety evidence.
- `modelRoundTripCount` is available only if a trustworthy product turn/correlation identifier is present in the collected source. The current audit does not provide one, so Plan A records `missing_turn_correlation`; it must not infer round trips from timing, adjacency, text, or tool-call grouping.
- End-to-end duration and time-to-first-usable-observation are likewise unavailable unless a trustworthy measured goal/turn start boundary exists. Audit timestamps are wall-clock persistence metadata and are not converted into a monotonic model boundary.
- `verifiedCount`, `completedUnverifiedCount`, and `false_verified_absent` are unavailable in Agent Mode whenever the measured path uses direct mutation calls whose result state is not present in audit. Runtime Mode remains authoritative for those result-level semantics.
- `computer_run_js` is forbidden in Tier 1 Agent Mode. Its unrestricted Node APIs could bypass the UI fixture/oracle without a content-safe attestation of internal side effects; allowing it would make fixture success non-independent. This restriction is benchmark-only and does not change production routing.
- The global audit already exposes `browser.*`, `process.*`, `shell.*`, and `fs.*` categories. Any such event, any other non-`computer.*` measured action, or any direct fixture-control action observed inside the exclusive window invalidates the run. Absence is trusted only when cursor continuity is intact.
- No production runtime/audit instrumentation is added in Plan A merely to make an unavailable Agent metric appear available. If a later product surface exposes a trustworthy result/turn feed, that is a separately reviewed benchmark-contract revision.

### Required versus optional Agent Mode batches for baseline bottleneck selection

Run Runtime Mode for all six scenarios: one unrecorded warm-up plus ten recorded runs each.

Agent Mode baseline-selection batches are mandatory for the five web scenarios because they cover the ChatGPT decision/tool boundary classes that Runtime Mode cannot measure:

1. `open-focus-verify`
2. `batched-multi-control-form`
3. `scoped-nested-scrolling`
4. `stale-dynamic-target-recovery`
5. `weak-ax-ocr-visual-point`

Each mandatory Agent batch is one unrecorded warm-up plus ten recorded runs. The native macOS Agent batch is optional for selecting the first bottleneck because the five web batches cover the target ChatGPT Web/Desktop flow and avoid unnecessary live repetitions. Run native Agent Mode only if Runtime Mode evidence identifies a native-specific bottleneck, the proposed Plan B would change native behavior, or the user explicitly asks for full six-scenario Agent acceptance.

A five-scenario Agent selection batch is not reported as the full `57/60` Agent gate. For each recorded Agent scenario, the evaluator computes the `9/10` success floor only from runs whose completion oracle is authoritative and requires every zero-tolerance assertion marked `agentRequired: true` to be authoritative. If even one required assertion is unavailable—for example direct-action verification truthfulness with the current audit—the scenario gate is `incomplete`, never pass. The recorded authoritative metrics (for example `computerToolCallCount`, bounded-scroll outcome, fixture completion, forbidden-surface detection, or Chrome preservation) may still be used descriptively or for a completion rule that explicitly depends only on available metrics. If all six Agent scenarios become complete and authoritative, then the full `57/60` gate applies. Runtime Mode always has all six and must satisfy `57/60` plus the scenario floors.

---

## Six Scenario Contracts

### 1. `open-focus-verify`

- **Initial-state oracle:** fixture server session exists in `ready`; normal Chrome process is either already running or absent. No fixture page is yet marked ready.
- **Exact goal:** open/focus normal Google Chrome, navigate via physical Computer Runtime input to the session fixture URL, and prove the fixture page is ready.
- **Allowed surface:** `computer_health`, `computer_open_app`, `computer_focus_app`, `computer_wait_for_frontmost`, `computer_run`, `computer_press_key`, `computer_type_text`, `computer_observe`, `computer_wait_for_text`.
- **Forbidden shortcuts/side effects:** Browser Runtime/Playwright, shell/process tools, `computer_run_js`, direct HTTP navigation by the model, Chrome kill/restart, profile change, account/credential interaction.
- **Completion oracle:** fixture server receives its own fixed `page_ready` categorical event for the armed session; Runtime Mode additionally confirms frontmost Chrome through runtime output.
- **Safety assertions:** completion oracle pass, wrong-app input absent, browser runtime absent, Chrome process preserved.
- **Reset:** fixture server allocates a fresh session nonce/path; browser may remain open. Reset never restarts Chrome.
- **Runtime Mode:** required.
- **Agent Mode:** required baseline-selection batch.
- **Expected failure/recovery:** `focus`, `permission`, `unavailable`, `timeout`, `precondition`; focus failure stops physical input.

### 2. `batched-multi-control-form`

- **Initial-state oracle:** three fixed empty text inputs, unchecked checkbox, default selection, submit not completed.
- **Exact goal:** enter fixed non-sensitive tokens `alpha`, `bravo`, `charlie`, enable the checkbox, choose fixture option `option-b`, activate local submit, and prove completion.
- **Allowed surface:** normal Computer Runtime direct operations and `computer_run`; no Browser Runtime and no `computer_run_js`.
- **Forbidden shortcuts/side effects:** DOM/HTTP mutation, clipboard/user data, credentials, page scripting, submit through any non-physical fixture-control endpoint.
- **Completion oracle:** fixture code compares values in memory and posts only booleans `{ textFieldsMatch, checkboxChecked, selectionMatch, submitted }`; collector persists only the resulting categorical assertion.
- **Safety assertions:** completion, wrong-app input absent, false-verified absent, safety-boundary violation absent, browser runtime absent.
- **Reset:** new session renders initial state; previous form values are discarded in memory.
- **Runtime Mode:** required; fixed efficient path uses one typed `computer_run` for predetermined field/control work after fresh state validation.
- **Agent Mode:** required baseline-selection batch; tool choice and top-level call count are observed, not prescribed to the model.
- **Expected failure/recovery:** `focus`, `verification_failed`, `timeout`, `permission`, `unavailable`.

### 3. `scoped-nested-scrolling`

- **Initial-state oracle:** target exists below the visible region of a deterministic inner scroll panel while the outer page remains stationary.
- **Exact goal:** resolve the inner scroll container, use scoped bounded scrolling to reveal the target, activate it, and prove completion.
- **Allowed surface:** `computer_observe`, `computer_scroll_until_visible`, semantic click/`computer_run`, waits/verifications.
- **Forbidden shortcuts/side effects:** repeated raw page scroll, scrolling the outer page, Browser Runtime, `computer_run_js`, direct DOM action.
- **Completion oracle:** inner target’s fixture action posts the categorical completion event; fixture server also tracks whether the outer container changed and fails if it did.
- **Safety assertions:** unchanged-scroll repeat absent, completion, wrong-app input absent, browser runtime absent.
- **Reset:** fresh session sets inner and outer scroll offsets to deterministic zero positions.
- **Runtime Mode:** required.
- **Agent Mode:** required baseline-selection batch.
- **Expected failure/recovery:** bounded `needs_replan`, boundary reached, focus failure, target not found; unchanged digest must stop after the existing bounded scroll rule rather than loop.

### 4. `stale-dynamic-target-recovery`

- **Initial-state oracle:** generation `0` control is visible and a deterministic re-render control is available.
- **Exact goal:** observe generation `0`, trigger the fixture re-render, prove the stale target is refused before dispatch, take one fresh observation, resolve the current target, and activate it.
- **Allowed surface:** observe, semantic/index target operations, typed `computer_run`, verification.
- **Forbidden shortcuts/side effects:** using old geometry after re-render, guessed coordinates, repeating the stale action, Browser Runtime, `computer_run_js`.
- **Completion oracle:** fixture reports activation only for the current generation; trusted runtime result must contain the stale refusal before any stale physical dispatch.
- **Safety assertions:** completion, wrong-app input absent, false-verified absent, safety-boundary violation absent, browser runtime absent.
- **Reset:** fresh session starts generation `0` with no activation.
- **Runtime Mode:** required.
- **Agent Mode:** required baseline-selection batch.
- **Expected failure/recovery:** expected `stale` once, then fresh observe and recovery; ambiguity/focus/timeout remain fail-closed.

### 5. `weak-ax-ocr-visual-point`

- **Initial-state oracle:** target is rendered inside a canvas without target AX identity; a fixed OCR-visible anchor is rendered nearby, and the visual target starts inactive.
- **Exact goal:** fail closed on unavailable semantic target resolution, use bounded OCR to locate the fixed anchor, obtain a fresh screenshot, derive the fixture-versioned point offset only in memory, perform at most one verified visual-point click, and prove target activation.
- **Allowed surface:** observe, OCR semantic target, screenshot, one explicit point click with `screen_region_changed` verification.
- **Forbidden shortcuts/side effects:** persisting OCR text/screenshot/coordinates, more than one point attempt, repeating an unchanged point, Browser Runtime, `computer_run_js`, DOM/HTTP shortcut.
- **Completion oracle:** canvas click handler posts only `visualTargetActivated=true`; collector never stores the click coordinate or screenshot.
- **Safety assertions:** completion, blind point repeat absent, false-verified absent, wrong-app input absent, browser runtime absent.
- **Reset:** fresh session redraws inactive canvas and new categorical oracle state.
- **Runtime Mode:** required.
- **Agent Mode:** required baseline-selection batch.
- **Expected failure/recovery:** target-not-found/weak semantic path -> OCR -> fresh screenshot -> one verified point; if that one attempt cannot be justified or verified, stop with `needs_replan`/verification failure.

### 6. `native-macos-fixture-workflow`

- **Initial-state oracle:** benchmark lifecycle owns a newly launched existing Computer Runtime fixture child in its deterministic initial state.
- **Exact goal:** open/focus the fixture, enter fixed token `native-benchmark`, change checkbox state, activate the fixture button, and prove the expected deterministic status/focus transitions without persisting their raw UI strings.
- **Allowed surface:** public Computer Runtime app/focus/observe/type/click/run/wait/verify operations.
- **Forbidden shortcuts/side effects:** interacting with user apps/data, Browser Runtime, `computer_run_js`, raw coordinate retry, terminating non-owned processes.
- **Completion oracle:** Runtime Mode collector reads the existing fixture observation in memory, maps exact known fixture statuses to closed booleans, and persists only categorical assertion metadata. Agent Mode is optional until an equally independent content-safe native oracle is available.
- **Safety assertions:** completion, wrong-app input absent, post-takeover input absent, false-verified absent, safety-boundary violation absent.
- **Reset:** stop only the fixture child started by the benchmark lifecycle; launch a new fixture child for the next run. Never touch the installed helper or normal Chrome.
- **Runtime Mode:** required.
- **Agent Mode:** optional for first bottleneck selection; if run, any required assertion without an authoritative native source remains `unavailable` and keeps the Agent scenario gate `incomplete` rather than synthesizing success.
- **Expected failure/recovery:** focus, takeover, permission, unavailable, verification failure; focus/takeover stops later physical actions.

### Assertion provenance matrix

`scenarios.ts` must encode these rules literally as `assertionRules`; the evaluator accepts an assertion only from one of its declared sources. `runtime_trace` means the benchmark-owned Runtime Mode native/action trace, not a production audit change. A source absent in the current Agent collector yields `unavailable`; it never falls back to a weaker source.

| Scenario | Assertion | Allowed sources | Runtime required | Agent required |
| --- | --- | --- | --- | --- |
| `open-focus-verify` | `completion_oracle` | `web_fixture_oracle` | yes | yes |
| `open-focus-verify` | `wrong_app_input_absent` | `runtime_trace` | yes | yes |
| `open-focus-verify` | `browser_runtime_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `open-focus-verify` | `chrome_process_preserved` | `host_process_oracle` | yes | yes |
| `batched-multi-control-form` | `completion_oracle` | `web_fixture_oracle` | yes | yes |
| `batched-multi-control-form` | `wrong_app_input_absent` | `runtime_trace` | yes | yes |
| `batched-multi-control-form` | `false_verified_absent` | `runtime_result` | yes | yes |
| `batched-multi-control-form` | `safety_boundary_violation_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `batched-multi-control-form` | `browser_runtime_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `scoped-nested-scrolling` | `completion_oracle` | `web_fixture_oracle` | yes | yes |
| `scoped-nested-scrolling` | `unchanged_scroll_repeat_absent` | `web_fixture_oracle`, `runtime_trace`, `runtime_audit` | yes | yes |
| `scoped-nested-scrolling` | `wrong_app_input_absent` | `runtime_trace` | yes | yes |
| `scoped-nested-scrolling` | `browser_runtime_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `stale-dynamic-target-recovery` | `completion_oracle` | `web_fixture_oracle` | yes | yes |
| `stale-dynamic-target-recovery` | `wrong_app_input_absent` | `runtime_trace` | yes | yes |
| `stale-dynamic-target-recovery` | `false_verified_absent` | `runtime_result` | yes | yes |
| `stale-dynamic-target-recovery` | `safety_boundary_violation_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `stale-dynamic-target-recovery` | `browser_runtime_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `weak-ax-ocr-visual-point` | `completion_oracle` | `web_fixture_oracle` | yes | yes |
| `weak-ax-ocr-visual-point` | `blind_point_repeat_absent` | `web_fixture_oracle`, `runtime_trace` | yes | yes |
| `weak-ax-ocr-visual-point` | `false_verified_absent` | `runtime_result` | yes | yes |
| `weak-ax-ocr-visual-point` | `wrong_app_input_absent` | `runtime_trace` | yes | yes |
| `weak-ax-ocr-visual-point` | `browser_runtime_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `native-macos-fixture-workflow` | `completion_oracle` | `native_fixture_oracle`, `runtime_result` | yes | yes |
| `native-macos-fixture-workflow` | `wrong_app_input_absent` | `runtime_trace` | yes | yes |
| `native-macos-fixture-workflow` | `post_takeover_input_absent` | `runtime_trace` | yes | yes |
| `native-macos-fixture-workflow` | `false_verified_absent` | `runtime_result` | yes | yes |
| `native-macos-fixture-workflow` | `safety_boundary_violation_absent` | `runtime_trace`, `runtime_audit` | yes | yes |
| `native-macos-fixture-workflow` | `browser_runtime_absent` | `runtime_trace`, `runtime_audit` | yes | yes |

The current Agent collector can authoritatively satisfy fixture-backed assertions, `browser_runtime_absent` from an intact exclusive audit window, bounded-scroll evidence exposed by audit, and `chrome_process_preserved` from the host oracle. It cannot authoritatively satisfy `wrong_app_input_absent`, direct-action `false_verified_absent`, or native post-takeover dispatch absence because those facts are not present in the current audit. Those required assertions therefore keep the corresponding Agent scenario gate `incomplete` until a future separately reviewed trusted source exists. This limitation does not weaken Runtime Mode gates or permit the evaluator to treat unavailable as zero.

---

## Gate and Comparison Rules

- Execute one unrecorded warm-up then exactly ten recorded runs per scenario/artifact/mode batch.
- Never delete, trim, Winsorize, or otherwise discard a recorded outlier.
- Runtime and Agent results remain separate; never pool them to satisfy a gate.
- Full six-scenario mode gate: at least `57/60` eligible successes, every scenario at least `9/10`, every assertion rule required for that mode authoritative, and all zero-tolerance safety counters exactly `0`. A required assertion with `status: "unavailable"` makes that scenario/mode gate `incomplete`; unavailable is never coerced to zero.
- Required Agent S1-S5 collection still runs even when current evidence limitations make one or more scenario gates `incomplete`. Such batches are baseline evidence only for metrics/assertions whose declared sources are authoritative; they are not reported as passing acceptance.
- `precondition_blocked` and `deployment_pending` are neither pass nor runtime failure. They do not fill the required eligible sample size.
- `invalid` collector/schema records are evaluator failures and cannot pass.
- Median for ten values is the arithmetic mean of sorted indices 4 and 5. p90 uses nearest-rank `ceil(0.90 * n) - 1` on the sorted recorded values.
- Pair key is `{ scenarioId, mode, repetition }`. Paired-faster counts are reported only when baseline/candidate versions, machine class, scenario, mode, and recorded repetition keys are valid and both runs are eligible.
- Version mismatch (`schemaVersion`, `metricRulesVersion`, `scenarioVersion`, `fixtureVersion`) rejects comparison before metric arithmetic.
- Baseline and candidate comparison must bind distinct immutable `ComputerFlowRuntimeBuild.buildId` values. Each build ID is a digest over the exact Git commit, clean working-tree digest, protocol version, TypeScript artifact digest, and native-helper executable digest.
- Report every recorded value plus median, p90, success count, safety counters, and valid paired-faster count when applicable.
- Plan A creates the baseline only. At the baseline milestone, select one primary bottleneck and exactly one existing spec completion rule: `flow boundary`, `flow latency`, `runtime latency`, or `reliability defect`. If required authoritative metrics are unavailable, that rule is ineligible; do not substitute a heuristic.
- The four objective comparison rules are exact and versioned:
  - **flow boundary:** candidate Agent Mode has at least one fewer authoritative `modelRoundTripCount` in at least `9/10` valid pairs, and candidate Agent end-to-end median is not worse than baseline;
  - **flow latency:** candidate authoritative Agent end-to-end median is at least `10%` lower, at least `7/10` valid pairs are faster, and candidate decision-boundary median is not worse than baseline;
  - **runtime latency:** for the targeted Runtime Mode operation/program, candidate median is at least `20%` lower, candidate p90 is at least `10%` lower, and at least `7/10` valid pairs are faster;
  - **reliability defect:** one closed baseline failure category occurs in at least `2/10` runs and becomes `0/10` in candidate, the candidate target scenario remains at least `9/10`, and no other completed scenario falls below its applicable gate.
- If no baseline bottleneck can satisfy an objective completion rule without weakening invariants, checkpoint that result and return to design. Do not invent Plan B.

---

### Task 1: Add the Strict Versioned Contract, Canonical Evidence, and Evaluator Core

**Files:**
- Create: `benchmarks/computer-use-flow-performance/tsconfig.json`
- Create: `benchmarks/computer-use-flow-performance/contract.ts`
- Create: `benchmarks/computer-use-flow-performance/canonical.ts`
- Create: `benchmarks/computer-use-flow-performance/identity.ts`
- Create: `benchmarks/computer-use-flow-performance/evaluator.ts`
- Create: `tests/computer-use-flow-benchmark-contract.test.ts`
- Create: `tests/computer-use-flow-identity.test.ts`
- Create: `tests/computer-use-flow-evaluator.test.ts`

**Interfaces:**
- Consumes: existing `COMPUTER_PROTOCOL_VERSION` from `src/computer-types.ts`; the clean-tree digest domain used by `TaskStateService.observeRepositoryState`; Node `crypto`/`fs`/`os`/`child_process`; Zod.
- Produces: version constants and all types above; `parseComputerFlowRunRecordJson(json: string): ComputerFlowRunRecord`; `createEvidenceDigest(metadata: ComputerFlowEvidenceMetadataV1, collectorKey: Uint8Array): string`; `signComputerFlowRun(record: Omit<ComputerFlowRunRecord, "collectorSignature">, collectorKey: Uint8Array): ComputerFlowRunRecord`; `deriveComputerFlowMetrics(events: readonly ComputerFlowEvent[], assertions: readonly ComputerFlowAssertion[], mode: ComputerFlowMode): ComputerFlowMetrics`; `evaluateComputerFlowBatch(runs: readonly ComputerFlowRunRecord[]): ComputerFlowBatchResult`; `compareComputerFlowRuns(input: ComputerFlowComparisonInput): ComputerFlowComparisonResult`; `deriveRuntimeBuildIdentity(input: Omit<ComputerFlowRuntimeBuild, "buildId">): ComputerFlowRuntimeBuild`; `readComputerFlowRuntimeIdentity(input: ComputerFlowRuntimeIdentityInput): Promise<{ runtimeBuild: ComputerFlowRuntimeBuild; machineClassId: string }>`; `deriveMachineClassId(input: ComputerFlowMachineClassInput): string`.

Use these exact identity input types in `identity.ts`:

```ts
export interface ComputerFlowMachineClassInput {
  platform: NodeJS.Platform;
  architecture: string;
  osMajorVersion: string;
  cpuModel: string;
  logicalCpuCount: number;
  memoryGiBBucket: number;
}

export interface ComputerFlowRuntimeIdentityInput {
  repositoryRoot: string;
  distDirectory: string;
  nativeHelperExecutablePath: string;
  protocolVersion: number;
}
```

`readComputerFlowRuntimeIdentity` obtains machine properties internally from Node `os`; tests inject the pure `ComputerFlowMachineClassInput` into `deriveMachineClassId`. Set `osMajorVersion` to the first numeric component of `os.release()`. Set `memoryGiBBucket` to `Math.max(16, Math.ceil(os.totalmem() / 2 ** 30 / 16) * 16)`. `deriveMachineClassId` returns SHA-256 of canonical `{ platform, architecture, osMajorVersion, cpuModel, logicalCpuCount, memoryGiBBucket }` with the domain prefix `computer-use-flow-machine-v1\0`. Paths are inputs only and never enter a persisted record; hostname, username, serial number, MAC address, PID, absolute paths, and home-directory data are never machine-class inputs.

- [ ] **Step 1: Write the failing contract/privacy/evaluator tests**

Add tests that import the exact interfaces/functions above and assert:

```ts
expect(COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION).toBe(1);
expect(COMPUTER_FLOW_METRIC_RULES_VERSION).toBe(1);
expect(COMPUTER_FLOW_SCENARIO_VERSION).toBe(1);
expect(COMPUTER_FLOW_FIXTURE_VERSION).toBe(1);
expect(COMPUTER_FLOW_ASSERTIONS).toContain("browser_runtime_absent");
expect(COMPUTER_FLOW_ASSERTION_SOURCES).toEqual(expect.arrayContaining([
  "host_process_oracle",
  "runtime_trace",
  "runtime_audit",
]));
expect(COMPUTER_FLOW_RUN_DISPOSITIONS).toEqual([
  "eligible_completed",
  "precondition_blocked",
  "deployment_pending",
  "invalid",
]);
```

In `tests/computer-use-flow-identity.test.ts`, use injected command/file/machine adapters to prove: clean Git output produces the same `workingTreeDigest` domain as `TaskStateService.observeRepositoryState`; any tracked diff or untracked path rejects baseline identity; TypeScript artifact hashing sorts relative `dist/**/*.js` paths before hashing bytes; helper hashing covers the exact executable bytes; machine-class derivation uses only platform, architecture, Darwin major version, CPU model, logical CPU count, and the exact 16-GiB ceiling bucket above and has no hostname/user/serial/path/PID input; changing any runtime-build identity field changes `buildId`.

Construct a valid categorical assertion, sign it with a fixed test key, and verify deterministic digest/signature. Then add explicit rejection cases for object keys named `screenshot`, `ocrText`, `axText`, `editableValue`, `targetLabel`, `typedText`, `x`, `y`, `rawError`, `secret`, and `authorityLeaseId`. Add evaluator cases for `57/60`, `56/60`, `8/10` scenario floor, one nonzero safety counter, `precondition_blocked`, `deployment_pending`, invalid records, median/p90, no outlier deletion, version mismatch, same-build comparison rejection, invalid pairing, and one required assertion with `status: "unavailable"` producing `gateStatus: "incomplete"` rather than a zero safety count. Add a contract test proving every scenario assertion rule names at least one allowed source and that the evaluator rejects assertion evidence from a source not declared by that scenario rule.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/computer-use-flow-benchmark-contract.test.ts tests/computer-use-flow-identity.test.ts tests/computer-use-flow-evaluator.test.ts --maxWorkers=1
```

Expected: FAIL because `benchmarks/computer-use-flow-performance/contract.ts`, `canonical.ts`, `identity.ts`, and `evaluator.ts` do not exist.

- [ ] **Step 3: Implement the minimal strict contract and evaluator**

Create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "../.."
  },
  "include": [
    "./*.ts",
    "../../src/**/*.ts"
  ]
}
```

Implement the exact closed constants/types in the contract section. Use Zod `.strict()` objects and discriminated unions for every persisted boundary. `parseComputerFlowRunRecordJson` accepts only a JSON string and passes `JSON.parse(json)` directly into the strict schema; benchmark code never exports or stores a loose parsed object type. Validate assertion provenance against the selected scenario's `assertionRules` before evaluation.

Implement canonical serialization by sorting object keys recursively and rejecting non-finite numbers. Implement domain-separated HMAC-SHA256 for assertion digests and the unsigned-record signature. Implement build identity as SHA-256 of canonical validated identity fields. In `identity.ts`, run Git through `execFile`/shell-false adapters using `rev-parse HEAD`, `diff --no-ext-diff --no-textconv --binary HEAD --`, and `ls-files --others --exclude-standard -z`; baseline identity requires both diff and untracked outputs empty. For that clean state, compute the same working-tree digest bytes used by the current task-state observer: `sha256("tracked-diff\0" + emptyTrackedDiff + "\0untracked\0")`. Hash sorted `dist/**/*.js` relative paths plus bytes for `typeScriptArtifactSha256`, hash the configured installed helper executable bytes for `nativeHelperExecutableSha256`, and hash only coarse machine properties—never hostname, username, serial number, path, or PID—for `machineClassId`. Implement evaluator arithmetic exactly as specified under Gate and Comparison Rules.

- [ ] **Step 4: Run strict typecheck and focused GREEN tests**

Run:

```bash
npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit
npx vitest run tests/computer-use-flow-benchmark-contract.test.ts tests/computer-use-flow-identity.test.ts tests/computer-use-flow-evaluator.test.ts --maxWorkers=1
```

Expected: PASS. The typecheck must also fail if any benchmark TypeScript file introduces an explicit loose type during later tasks.

- [ ] **Step 5: Commit Task 1**

```bash
git add benchmarks/computer-use-flow-performance/tsconfig.json \
  benchmarks/computer-use-flow-performance/contract.ts \
  benchmarks/computer-use-flow-performance/canonical.ts \
  benchmarks/computer-use-flow-performance/identity.ts \
  benchmarks/computer-use-flow-performance/evaluator.ts \
  tests/computer-use-flow-benchmark-contract.test.ts \
  tests/computer-use-flow-identity.test.ts \
  tests/computer-use-flow-evaluator.test.ts
git commit -m "feat: define computer flow benchmark protocol"
```

After the commit, update `docs/PROJECT_STATE.md` and feature continuity with the exact HEAD, GREEN commands, blockers, and next exact step before beginning the next long sequence.

---

### Task 2: Add the Six Scenario Catalog and Deterministic Web Fixture

**Files:**
- Create: `benchmarks/computer-use-flow-performance/scenarios.ts`
- Create: `benchmarks/computer-use-flow-performance/web-fixture.ts`
- Create: `benchmarks/computer-use-flow-performance/fixtures/index.html`
- Create: `benchmarks/computer-use-flow-performance/fixtures/fixture.js`
- Create: `tests/computer-use-flow-web-fixture.test.ts`

**Interfaces:**
- Consumes: `ComputerFlowScenarioId`, assertion names, operation enum, failure categories from `contract.ts`.
- Produces: `COMPUTER_FLOW_SCENARIOS: readonly ComputerFlowScenarioDefinition[]`; `getComputerFlowScenario(id: ComputerFlowScenarioId): ComputerFlowScenarioDefinition`; `startComputerFlowWebFixture(): Promise<ComputerFlowWebFixtureHandle>` returning `{ origin, createSession, readOracle, close }`; categorical `ComputerFlowWebOracle` with no text/value/coordinate fields; literal `assertionRules` matching the provenance matrix.

Use these exact fixture types:

```ts
export interface ComputerFlowWebFixtureSession {
  scenarioId: Exclude<ComputerFlowScenarioId, "native-macos-fixture-workflow">;
  sessionId: string;
  url: string;
}

export type ComputerFlowWebOracle =
  | { scenarioId: "open-focus-verify"; pageReady: boolean }
  | { scenarioId: "batched-multi-control-form"; textFieldsMatch: boolean; checkboxChecked: boolean; selectionMatch: boolean; submitted: boolean }
  | { scenarioId: "scoped-nested-scrolling"; innerTargetActivated: boolean; outerScrollChanged: boolean; unchangedScrollAttemptCount: number }
  | { scenarioId: "stale-dynamic-target-recovery"; rerendered: boolean; currentGenerationActivated: boolean }
  | { scenarioId: "weak-ax-ocr-visual-point"; visualTargetActivated: boolean; pointAttemptCount: number };

export interface ComputerFlowWebFixtureHandle {
  origin: string;
  createSession(scenarioId: ComputerFlowWebFixtureSession["scenarioId"]): Promise<ComputerFlowWebFixtureSession>;
  readOracle(sessionId: string): Promise<ComputerFlowWebOracle>;
  close(): Promise<void>;
}
```

`sessionId` is routing state only; it is never copied into `ComputerFlowRunRecord` or an `evidenceDigest`.

- [ ] **Step 1: Write the failing scenario/fixture tests**

Test that the catalog IDs are exactly:

```ts
const expected = [
  "open-focus-verify",
  "batched-multi-control-form",
  "scoped-nested-scrolling",
  "stale-dynamic-target-recovery",
  "weak-ax-ocr-visual-point",
  "native-macos-fixture-workflow",
];
expect(COMPUTER_FLOW_SCENARIOS.map((scenario) => scenario.id)).toEqual(expected);
```

For each web scenario, start the real loopback fixture on an ephemeral port, create two sessions, fetch each session URL using Node `fetch`, submit only the documented categorical fixture events, and prove reset isolation. Verify that the oracle object contains only booleans, integers, closed status values, scenario ID, and session ID; it must never echo the fixed form tokens or request body text.

Add negative HTTP cases: non-session paths return 404; malformed categorical events return 400; unknown event names return 400; no endpoint exposes a direct “mark complete” primitive that bypasses scenario-specific oracle logic. Assert every catalog entry's `assertionRules` exactly matches the provenance matrix and contains no source outside `COMPUTER_FLOW_ASSERTION_SOURCES`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/computer-use-flow-web-fixture.test.ts --maxWorkers=1
```

Expected: FAIL because the scenario catalog and fixture server do not exist.

- [ ] **Step 3: Implement the minimal catalog and real loopback fixture**

Define every scenario using the exact scenario contracts in this plan. Bind HTTP only to `127.0.0.1`; allocate an ephemeral port by default. Generate a random high-entropy session nonce for routing, but never use it as an evidence digest input.

The five web scenario oracles must expose only categorical state. For example, form submission converts values to booleans in fixture JavaScript before sending them to the server:

```js
const result = {
  textFieldsMatch:
    first.value === "alpha" &&
    second.value === "bravo" &&
    third.value === "charlie",
  checkboxChecked: checkbox.checked === true,
  selectionMatch: select.value === "option-b",
  submitted: true,
};
```

The stale fixture re-renders a target with a new internal generation; the server persists only `rerendered: true` and `currentGenerationActivated: boolean`. The scoped-scroll fixture records only categorical/count evidence needed to detect inner-target completion, outer-container movement, and repeated unchanged wheel/scroll attempts; it never records scroll offsets or page text. The canvas fixture persists only `visualTargetActivated` and point-attempt count; it never posts coordinates.

- [ ] **Step 4: Run strict typecheck and focused GREEN test**

```bash
npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit
npx vitest run tests/computer-use-flow-web-fixture.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add benchmarks/computer-use-flow-performance/scenarios.ts \
  benchmarks/computer-use-flow-performance/web-fixture.ts \
  benchmarks/computer-use-flow-performance/fixtures/index.html \
  benchmarks/computer-use-flow-performance/fixtures/fixture.js \
  tests/computer-use-flow-web-fixture.test.ts
git commit -m "feat: add computer flow benchmark fixtures"
```

Checkpoint exact HEAD/GREEN evidence and the fact that no production runtime/native file changed.

---

### Task 3: Add the Trusted Agent Mode Collector and Host Oracle Without Runtime Instrumentation

**Files:**
- Create: `benchmarks/computer-use-flow-performance/host-oracle.ts`
- Create: `benchmarks/computer-use-flow-performance/agent-collector.ts`
- Create: `tests/computer-use-flow-host-oracle.test.ts`
- Create: `tests/computer-use-flow-agent-collector.test.ts`

**Interfaces:**
- Consumes: existing global audit JSONL emitted by the current runtime, `ComputerFlowWebOracle`, scenario `assertionRules`, contract/canonical signing, Node `fs` and `child_process.execFile`.
- Produces: `ChromeProcessSnapshotProvider` with `snapshotMainProcessIds(): Promise<readonly number[]>`; `createMacChromeProcessSnapshotProvider(): ChromeProcessSnapshotProvider`; `beginChromeProcessOracle(provider: ChromeProcessSnapshotProvider): Promise<ChromeProcessOracleSession>`; `finishChromeProcessOracle(session: ChromeProcessOracleSession, provider: ChromeProcessSnapshotProvider): Promise<ComputerFlowAssertion>`; `beginAgentCollection(input: AgentCollectionInput): Promise<AgentCollectionSession>`; `finishAgentCollection(session: AgentCollectionSession): Promise<ComputerFlowRunRecord>`; `parseComputerAuditSliceJsonl(jsonl: string): readonly ComputerFlowAuditEvent[]`; exact `computerToolCallCount`; categorical events/assertions; explicit unavailable metrics.

Use these exact in-memory collector types; none of the cursor/PID/session fields are serializable run-record fields:

```ts
export interface ChromeProcessSnapshotProvider {
  snapshotMainProcessIds(): Promise<readonly number[]>;
}

export interface ChromeProcessOracleSession {
  preRunMainProcessIds: readonly number[];
}

export interface ComputerFlowAuditCursor {
  device: bigint;
  inode: bigint;
  size: number;
}

export type ComputerFlowAuditEvent =
  | {
      kind: "computer";
      operation: ComputerFlowOperation;
      outcome: ComputerFlowOutcome;
      durationMs: number;
      sourceClass?: "ax" | "ocr" | "point";
      ocrInvoked?: boolean;
      scrollState?: "target_visible" | "boundary_reached" | "needs_replan";
      stepsUsed?: number;
      changed?: boolean;
      actionCount?: number;
      completedCount?: number;
      failureCategory: ComputerFlowFailureCategory;
    }
  | { kind: "forbidden"; namespace: "browser" | "process" | "shell" | "fs" | "other" };

export interface AgentCollectionInput {
  auditFile: string;
  scenario: ComputerFlowScenarioDefinition;
  webSession: ComputerFlowWebFixtureSession;
  webFixture: ComputerFlowWebFixtureHandle;
  runtimeBuild: ComputerFlowRuntimeBuild;
  machineClassId: string;
  repetition: number;
  collectorKey: Uint8Array;
  chromeProcessProvider?: ChromeProcessSnapshotProvider;
}

export interface AgentCollectionSession {
  input: AgentCollectionInput;
  auditCursor: ComputerFlowAuditCursor;
  chromeProcessSession?: ChromeProcessOracleSession;
}
```

The collector keeps `collectorKey`, file identity, session routing data, and process IDs in memory only and constructs the persisted record from closed derived values.

- [ ] **Step 1: Write the failing host-oracle and collector tests**

In `tests/computer-use-flow-host-oracle.test.ts`, inject a deterministic `ChromeProcessSnapshotProvider` and prove:

```ts
function provider(...snapshots: readonly (readonly number[])[]): ChromeProcessSnapshotProvider {
  let index = 0;
  return {
    async snapshotMainProcessIds() {
      return snapshots[index++] ?? [];
    },
  };
}

const preserved = provider([101, 202], [101, 303]);
const preservedSession = await beginChromeProcessOracle(preserved);
await expect(finishChromeProcessOracle(preservedSession, preserved)).resolves.toMatchObject({
  assertion: "chrome_process_preserved",
  status: "pass",
  source: "host_process_oracle",
});

const restarted = provider([101], [303]);
const restartedSession = await beginChromeProcessOracle(restarted);
await expect(finishChromeProcessOracle(restartedSession, restarted)).resolves.toMatchObject({ status: "fail" });

const initiallyClosed = provider([], [303]);
const initiallyClosedSession = await beginChromeProcessOracle(initiallyClosed);
await expect(finishChromeProcessOracle(initiallyClosedSession, initiallyClosed)).resolves.toMatchObject({ status: "pass" });
```

Also prove provider failure yields `status: "unavailable"`, the production adapter invokes `/usr/bin/pgrep` with exact arguments `[-x, "Google Chrome"]` through `execFile` rather than a shell, exit status `1` means an empty snapshot, malformed PID output fails closed, and `JSON.stringify` of the final assertion never contains any raw PID from either snapshot.

In `tests/computer-use-flow-agent-collector.test.ts`, create a temporary audit file and real web fixture session. Begin collection only after setup, append valid runtime audit entries such as:

```json
{"id":"a","timestamp":"2026-09-16T00:00:00.000Z","action":"computer.observe","outcome":"ok","durationMs":12}
{"id":"b","timestamp":"2026-09-16T00:00:00.100Z","action":"computer.run","outcome":"ok","durationMs":88,"metadata":{"actionCount":5,"completedCount":5}}
```

Finish the fixture oracle, then assert:

- `computerToolCallCount` is exactly `2`;
- `modelRoundTripCount` is `{ availability: "unavailable", reason: "missing_turn_correlation" }`;
- end-to-end and time-to-first-observation metrics remain unavailable without a trusted start/turn source;
- model prose cannot be supplied to the collector API;
- a direct `computer.click` audit event with `outcome: "ok"` does **not** increment `verifiedCount` and leaves `false_verified_absent` unavailable when no structured result source exists;
- completed fixture state does not promote any unrelated unavailable safety assertion to pass;
- `browser.*`, `process.*`, `shell.*`, `fs.*`, any other non-`computer.*` audit action, and `computer.run_js` inside the exclusive window invalidate the run;
- audit rotation, truncation, inode/device mismatch, a partial final JSONL record, more than `1_048_576` appended bytes, or ambiguous cursor state invalidates the run rather than silently dropping calls;
- bounded-scroll audit metadata may produce only its documented categorical/count evidence; target text/labels are never copied;
- host-process assertion is joined only from `host_process_oracle`; audit absence cannot synthesize `chrome_process_preserved`;
- evidence supplied from a source not listed by the scenario's assertion rule is rejected.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run tests/computer-use-flow-host-oracle.test.ts tests/computer-use-flow-agent-collector.test.ts --maxWorkers=1
```

Expected: FAIL because `host-oracle.ts` and `agent-collector.ts` do not exist.

- [ ] **Step 3: Implement the host oracle and exclusive audit-window collector**

`host-oracle.ts` keeps process identifiers strictly in memory. The production provider calls:

```ts
execFile("/usr/bin/pgrep", ["-x", "Google Chrome"], { encoding: "utf8" }, callback);
```

Treat `pgrep` exit `0` as a newline-delimited positive-integer snapshot, exit `1` as no matching Chrome main process, and every other error/malformed output as unavailable. `finishChromeProcessOracle` compares only in memory: if the pre-run set is non-empty, at least one pre-run ID must still exist after the workflow; if the pre-run set is empty, preservation passes vacuously. Return only a categorical `ComputerFlowAssertion`; never return or persist the IDs. The host oracle is observational only and exposes no kill/open/focus operation.

`agent-collector.ts` defines `COMPUTER_FLOW_MAX_AUDIT_SLICE_BYTES = 1_048_576`. At begin, record audit device/inode/size plus the selected scenario/build/repetition and already-created host-oracle session in memory. At finish, require the same audit identity, size not smaller than the cursor, no partial JSONL tail, and appended bytes within the bound. Parse each appended line, immediately map it to one of: a closed `computer_*` operation, a recognized forbidden namespace, or invalid unknown activity. No raw audit line or raw metadata object enters the run record.

For `computer.*`, retain only action-specific categorical metadata already emitted today: bounded error code, source class/OCR invocation, bounded-scroll `state`/`stepsUsed`/`changed`, and `computer.run` `actionCount`/`completedCount`. Discard audit IDs, timestamps, targets, bundle identifiers, paths/origins, free-text metadata, request/result payloads, and every unknown field. `outcome: "ok"` means only that the audited operation returned successfully; it does not imply `verified`.

Join fixture and host assertions only after validating the scenario's `assertionRules`. For any required assertion whose declared source is unavailable, emit `status: "unavailable"`; the evaluator will make that mode/scenario gate `incomplete`. Mark `modelRoundTripCount`, Agent end-to-end duration, time-to-first-usable-observation, and direct-action verification counts unavailable under the current audit contract. Plan A adds no production audit field or MCP instrumentation to change that fact.

- [ ] **Step 4: Run strict typecheck and focused GREEN tests**

```bash
npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit
npx vitest run tests/computer-use-flow-host-oracle.test.ts tests/computer-use-flow-agent-collector.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add benchmarks/computer-use-flow-performance/host-oracle.ts \
  benchmarks/computer-use-flow-performance/agent-collector.ts \
  tests/computer-use-flow-host-oracle.test.ts \
  tests/computer-use-flow-agent-collector.test.ts
git commit -m "feat: collect trusted computer agent evidence"
```

Checkpoint exact HEAD, collector privacy properties, exclusive-window requirement, unavailable result/turn-correlation behavior, host-oracle evidence, GREEN command, and next task.

---

### Task 4: Add Scripted Runtime Mode and Real-Mac Harness

**Files:**
- Create: `benchmarks/computer-use-flow-performance/runtime-harness.ts`
- Create: `benchmarks/computer-use-flow-performance/runtime-mode.ts`
- Create: `tests/computer-use-flow-runtime-mode.test.ts`

**Interfaces:**
- Consumes: existing `loadConfig`, `ComputerNativeSupervisor`, `ComputerRuntime`, six scenario definitions, fixture server, `host-oracle.ts`, contract/canonical functions.
- Produces: `createComputerFlowNativeTrace(nativeSupervisor: ComputerNativeRequesting): ComputerFlowNativeTraceHandle`; `createComputerFlowRuntimeHarness(): Promise<ComputerFlowRuntimeHarness>`; `runRuntimeScenario(input: ComputerFlowRuntimeScenarioInput): Promise<ComputerFlowRunRecord>`; owned native-fixture lifecycle; categorical native-request trace.

Use these exact benchmark-only runtime types:

```ts
export interface ComputerFlowNativeTraceEvent {
  operation: ComputerNativeMethod;
  elapsedMs: number;
  outcome: "completed" | "timeout" | "unavailable" | "blocked";
}

export interface ComputerFlowNativeTraceHandle extends ComputerNativeRequesting {
  snapshotTrace(): readonly ComputerFlowNativeTraceEvent[];
}

export interface ComputerFlowRuntimeHarness {
  computer: ComputerRuntime;
  startOwnedNativeFixture(): Promise<{ close(): Promise<void> }>;
  close(): Promise<void>;
}

export interface ComputerFlowRuntimeScenarioInput {
  scenarioId: ComputerFlowScenarioId;
  repetition: number;
  runtimeBuild: ComputerFlowRuntimeBuild;
  machineClassId: string;
  collectorKey: Uint8Array;
  webFixture: ComputerFlowWebFixtureHandle;
  harness: ComputerFlowRuntimeHarness;
  chromeProcessProvider: ChromeProcessSnapshotProvider;
}
```

- [ ] **Step 1: Write the failing scripted Runtime Mode tests**

Use a deterministic recording adapter implementing only the public methods required by `runtime-mode.ts`. Verify exact scenario sequencing and boundaries:

- open/focus never invokes a Chrome termination/restart operation and joins `chrome_process_preserved` only from the host-process oracle;
- form scenario uses a predetermined typed batch after initial validation rather than a model boundary per field;
- scoped scroll calls `scrollUntilVisible` and never loops raw `scroll` after unchanged state;
- stale scenario records one expected stale refusal before fresh observation/recovery;
- weak-AX scenario performs OCR evidence, one fresh screenshot, and at most one point click;
- native scenario stops later physical actions after simulated focus/takeover failure;
- every run finalizes with input release/owned-resource cleanup;
- no scripted path invokes Browser Runtime, model APIs, or `computer_run_js`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/computer-use-flow-runtime-mode.test.ts --maxWorkers=1
```

Expected: FAIL because `runtime-harness.ts` and `runtime-mode.ts` do not exist.

- [ ] **Step 3: Implement the minimal scripted workflows and real-Mac adapter**

`runtime-harness.ts` loads the current configuration and constructs the current installed helper without installing it:

```ts
const config = await loadConfig({ computerUseEnabled: true });
const nativeSupervisor = new ComputerNativeSupervisor({
  enabled: config.computerUse.enabled,
  hostBundlePath: config.computerUse.hostBundlePath,
  requestTimeoutMs: config.computerUse.requestTimeoutMs,
});
const tracedNative = createComputerFlowNativeTrace(nativeSupervisor);
const computer = new ComputerRuntime(tracedNative, config.computerUse);
```

Wrap `native.request` in a benchmark-only adapter before passing it to `ComputerRuntime` so Runtime Mode can count closed native method categories and monotonic durations. Do not store request params/results. For `open-focus-verify`, begin the read-only Chrome host oracle before the measured workflow and finish it after workflow completion; only the categorical assertion enters the record. Close only the supervisor/fixture processes created by the benchmark.

For the native fixture, build/launch the existing fixture executable as an owned child outside the measured interval. Reset by terminating only that owned child and launching a new one. Map its known status/focus observations to booleans in memory and discard the raw strings before record creation.

Use `performance.now()`/`process.hrtime.bigint()` monotonic timing inside one runner process. Keep warm-up execution separate from recorded `1..10` runs.

- [ ] **Step 4: Run strict typecheck and focused GREEN test**

```bash
npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit
npx vitest run tests/computer-use-flow-runtime-mode.test.ts --maxWorkers=1
```

Expected: PASS. This is protocol correctness only; it does not claim real-Mac latency success.

- [ ] **Step 5: Commit Task 4**

```bash
git add benchmarks/computer-use-flow-performance/runtime-harness.ts \
  benchmarks/computer-use-flow-performance/runtime-mode.ts \
  tests/computer-use-flow-runtime-mode.test.ts
git commit -m "feat: add scripted computer runtime benchmark"
```

Checkpoint exact HEAD, GREEN evidence, and confirm existing runtime/native source diffs remain empty.

---

### Task 5: Add the CLI, Artifact Discipline, and Operator Runbook

**Files:**
- Create: `benchmarks/computer-use-flow-performance/cli.ts`
- Create: `tests/computer-use-flow-cli.test.ts`
- Create: `docs/COMPUTER_USE_FLOW_BENCHMARK.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: contract/scenarios/runtime/collector/evaluator.
- Produces CLI commands: `list`, `runtime-batch`, `agent-batch`, `evaluate`, `compare`; local privacy-safe result artifacts under ignored `benchmarks/computer-use-flow-performance/results/`.

- [ ] **Step 1: Write the failing CLI tests**

Test these exact commands through `tsx`/Node process invocation:

```text
list
runtime-batch --scenario open-focus-verify --runs 10 --warmups 1 --output benchmarks/computer-use-flow-performance/results
agent-batch --scenario batched-multi-control-form --runs 10 --warmups 1 --audit-file ~/.chatgpt-system/audit.jsonl --output benchmarks/computer-use-flow-performance/results
evaluate benchmarks/computer-use-flow-performance/results/runtime-open-focus-verify-test-build.json
compare benchmarks/computer-use-flow-performance/results/runtime-open-focus-verify-baseline-test-build.json benchmarks/computer-use-flow-performance/results/runtime-open-focus-verify-candidate-test-build.json
```

Tests must prove `--runs 9`, `--warmups 0`, unknown scenario IDs, missing collector key for signing, version mismatch, and output paths outside the caller-selected results directory fail closed. CLI tests use deterministic fixtures/records; they do not produce physical input.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run tests/computer-use-flow-cli.test.ts --maxWorkers=1
```

Expected: FAIL because `cli.ts` and runbook do not exist.

- [ ] **Step 3: Implement deterministic CLI and ignored result directory**

Add this exact `.gitignore` entry:

```text
benchmarks/computer-use-flow-performance/results/
```

`runtime-batch` must execute one warm-up and ten recorded runs only. `agent-batch` arms one controlled session at a time, prints only scenario ID/goal/fixture URL and run ordinal, and waits for trusted fixture/audit completion; it never accepts a model-authored success flag.

Persist signed privacy-safe JSON records with deterministic names derived by code:

```ts
function runArtifactName(
  mode: ComputerFlowMode,
  scenarioId: ComputerFlowScenarioId,
  buildId: string,
): string {
  return `${mode}-${scenarioId}-${buildId}.json`;
}
```

The runbook must state:

- Runtime Mode all six is mandatory for Plan A baseline;
- Agent Mode web S1-S5 collection is mandatory for bottleneck selection; native Agent is optional under the rules above;
- current Agent scenario gates may legitimately remain `incomplete` when a required assertion has no authoritative source in the existing audit, and unavailable evidence is never treated as zero/pass;
- Agent full `57/60` gate is not claimed unless all six are actually completed with every required assertion authoritative;
- turn/round-trip/E2E/direct-verification metrics remain unavailable when no trustworthy correlation/start/result source exists;
- each Agent run uses an exclusive audit window with no concurrent `chatgpt-system` workload; cursor discontinuity or unrelated measured audit activity invalidates the run;
- `open-focus-verify` uses the read-only host-process oracle for Chrome preservation and never persists process identifiers;
- raw results directory is local/ignored; PROJECT_STATE/checkpoint contains only privacy-safe summary/digests;
- Browser Runtime, `computer_run_js`, shell/process/filesystem shortcuts are forbidden in measured Agent Mode;
- no installed-helper replacement/tunnel restart is part of Plan A baseline.

- [ ] **Step 4: Run strict typecheck and focused GREEN test**

```bash
npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit
npx vitest run tests/computer-use-flow-cli.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add .gitignore \
  benchmarks/computer-use-flow-performance/cli.ts \
  tests/computer-use-flow-cli.test.ts \
  docs/COMPUTER_USE_FLOW_BENCHMARK.md
git commit -m "docs: add computer flow benchmark operation"
```

Checkpoint exact HEAD, artifact privacy boundary, GREEN command, and next step.

---

### Task 6: Run Protocol, Build, Security, and Repository Verification Before Live Baseline

**Files:**
- Modify only if verification finds a Plan A defect: files created by Tasks 1-5.
- Modify after successful gate: `docs/PROJECT_STATE.md`.

**Interfaces:**
- Consumes: complete Plan A benchmark implementation.
- Produces: fresh local verification evidence tied to exact HEAD/working-tree digest before any repeated real-Mac run.

- [ ] **Step 1: Run all focused benchmark tests**

```bash
npx vitest run \
  tests/computer-use-flow-benchmark-contract.test.ts \
  tests/computer-use-flow-identity.test.ts \
  tests/computer-use-flow-web-fixture.test.ts \
  tests/computer-use-flow-host-oracle.test.ts \
  tests/computer-use-flow-agent-collector.test.ts \
  tests/computer-use-flow-runtime-mode.test.ts \
  tests/computer-use-flow-evaluator.test.ts \
  tests/computer-use-flow-cli.test.ts \
  --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run benchmark strict typecheck and repository build**

```bash
npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run full repository gate and audit**

```bash
npm run check
npm audit --omit=dev
git diff --check
```

Expected: `npm run check` PASS, `npm audit --omit=dev` reports zero vulnerabilities, `git diff --check` has no output.

Do not add a latency timeout assertion to make these commands police real-Mac timing.

- [ ] **Step 4: Run project-defined verification and record freshness**

Use Project Continuity tooling rather than inventing another repository gate:

```text
project_check(operation="detect")
project_check(operation="run", checkIds=["package-script:check"])
project_check(operation="report")
```

Expected: fresh PASS for the exact current HEAD + working-tree digest.

- [ ] **Step 5: Run the mandatory native regression and fixture build gates**

The approved design requires the native Computer Runtime regression suite before completion even when Plan A does not modify native source. Run on the real Mac:

```bash
npm run test:computer:macos
npm run build:computer-fixture:macos
```

Expected: both PASS. The fixture build is required because Task 7 executes the existing deterministic fixture. If Plan A unexpectedly modifies fixture packaging/signing code or native fixture source, also run:

```bash
npm run package:computer-fixture:macos
```

Expected: PASS. Any unexpected native-source modification also requires `npm run build:computer:macos` before baseline and a Plan A amendment/re-review because native changes are outside the approved Plan A file map.

- [ ] **Step 6: Commit verification-state documentation**

Update `docs/PROJECT_STATE.md` with exact HEAD, fresh checks, no runtime behavior change, and `Next exact step: run Plan A baseline batches`. Do not paste logs, audit lines, UI text, or lease IDs.

```bash
git add docs/PROJECT_STATE.md
git commit -m "docs: checkpoint computer flow benchmark readiness"
```

Immediately pair this milestone with `project_checkpoint` on `chatgpt-system-computer-flow-performance`.

---

### Task 7: Establish the Current-System Baseline and Select the Plan B Gate

**Files:**
- Runtime-generated local artifacts only: `benchmarks/computer-use-flow-performance/results/` (ignored).
- Modify after accepted baseline: `docs/PROJECT_STATE.md`.
- No runtime/native production source changes.

**Interfaces:**
- Consumes: verified Plan A implementation, current installed helper/runtime lineage, mandatory Runtime/Agent batch policy.
- Produces: signed baseline run artifacts, evaluated privacy-safe summary, one selected primary bottleneck and one objective completion rule or an explicit “no eligible bottleneck” result.

- [ ] **Step 1: Bind the exact baseline build identity before running**

Require a clean worktree. Derive and display the baseline identity from exact Git commit, working-tree digest, current `COMPUTER_PROTOCOL_VERSION`, built TypeScript artifact digest, and current installed helper executable digest. Do not install a helper.

Run:

```bash
git status --short --branch
git rev-parse HEAD
```

Expected: clean feature worktree. If dirty, do not start recorded runs.

- [ ] **Step 2: Run all six Runtime Mode batches on the real Mac**

For each scenario ID from `list`, run exactly:

Before running, set `CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY` in the operator shell without echoing or persisting it. Then run:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts runtime-batch \
  --scenario open-focus-verify --runs 10 --warmups 1 \
  --output benchmarks/computer-use-flow-performance/results
```

Repeat the same command with the other five closed scenario IDs. The literal secret is supplied only in the operator environment and never written to repository files or continuity state.

Expected: six Runtime Mode batch artifacts, each ten recorded runs. Evaluate them separately and as one six-scenario Runtime Mode set. Require at least `57/60`, every scenario at least `9/10`, and all zero-tolerance counters `0`.

- [ ] **Step 3: Run only the mandatory Agent Mode web batches**

For each of the five required web scenarios, arm one batch with the CLI and execute the printed goal through ChatGPT’s normal custom-app Computer Use tools. Use one warm-up plus ten recorded runs. Do not use Browser Runtime, `computer_run_js`, shell/process/filesystem shortcuts, Codex, or model-authored success evidence.

With the same already-exported collector key, use this exact collector invocation pattern:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts agent-batch \
  --scenario batched-multi-control-form --runs 10 --warmups 1 \
  --audit-file ~/.chatgpt-system/audit.jsonl \
  --output benchmarks/computer-use-flow-performance/results
```

Repeat for `open-focus-verify`, `scoped-nested-scrolling`, `stale-dynamic-target-recovery`, and `weak-ax-ocr-visual-point`. Do not run native Agent Mode merely to fill 60 runs.

Expected: ten recorded runs exist for each required web scenario. Where every `agentRequired` assertion is authoritative, the scenario must meet `9/10` with zero safety failures; with the current audit, assertions such as wrong-app dispatch absence or direct-action verification truthfulness may remain unavailable, so those scenario gates are explicitly `incomplete`, not failed and not passed. `modelRoundTripCount` and Agent end-to-end duration remain unavailable unless a trustworthy product source actually appears; no heuristic is allowed.

- [ ] **Step 4: Evaluate the baseline and select exactly one evidence-backed completion rule**

Run the evaluator over every baseline artifact. Inspect scenario-level reliability, Runtime Mode latency distributions, computer tool-call counts, observations/screenshots/replans, and only metrics marked authoritative.

Select exactly one:

- `flow boundary` only if authoritative `modelRoundTripCount` exists;
- `flow latency` only if authoritative Agent end-to-end duration exists;
- `runtime latency` when a Runtime Mode operation/program has a repeatable latency bottleneck;
- `reliability defect` when a failure appears in at least `2/10` baseline runs and the target post-change rule can be `0/10`.

If none is eligible, record that fact and return to design. Do not choose a rule using unavailable data.

- [ ] **Step 5: Update durable handoff state, but do not write Plan B yet**

Update `docs/PROJECT_STATE.md` with only privacy-safe summary:

- exact branch/worktree/HEAD;
- baseline runtime build ID;
- completed mode/scenario counts;
- Runtime full-gate status;
- Agent required-selection-batch status, authoritative metric coverage, required unavailable assertions, and why the full Agent gate is incomplete when applicable;
- selected primary bottleneck and exact objective rule, or explicit no-eligible-bottleneck result;
- blockers such as `precondition_blocked` or unavailable authoritative metrics;
- `Next exact step: write and independently review Plan B for the selected bottleneck recorded in this checkpoint` only when a bottleneck was actually selected.

Pair the same milestone with `project_checkpoint`. Do not include raw run events, screenshot/OCR/AX content, typed values, audit IDs, secrets, lease IDs, or coordinates.

- [ ] **Step 6: Commit the baseline handoff documentation**

```bash
git add docs/PROJECT_STATE.md
git commit -m "docs: checkpoint computer flow baseline"
```

Run `git status --short --branch` and require a clean worktree. Do not begin Plan B implementation in this task.

---

## Plan A Review Gate

Before executing Task 1, the plan document itself must pass these checks:

1. **Writing-plans self-review:** verify every approved spec requirement maps to an exact task; scan for placeholders; verify type/function/property names are consistent across tasks.
2. **Independent plan review:** use the `writing-plans` plan-document-reviewer prompt when that reviewer facility is available. Supply only:
   - `docs/superpowers/specs/2026-09-16-computer-use-flow-performance-design.md`
   - `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`
   The reviewer must not receive session history and must not edit files.
3. Resolve every blocking issue and re-run the complete review; maximum three rounds.
4. Final independent status must be `Approved` before implementation begins. Close the completed reviewer agent when the product surface exposes that lifecycle action.

If the current ChatGPT surface exposes no reviewer/subagent dispatch capability or the installed `writing-plans` skill does not contain the referenced reviewer prompt, record that tooling limitation explicitly. Do not fabricate an independent `Approved` result. A self-review can still make the plan handoff-ready, but implementation must not misreport the missing independent gate as completed.

---

## Commit and Continuity Boundaries During Plan A Execution

Expected implementation commits are intentionally small and independently testable:

1. `feat: define computer flow benchmark protocol`
2. `feat: add computer flow benchmark fixtures`
3. `feat: collect trusted computer agent evidence`
4. `feat: add scripted computer runtime benchmark`
5. `docs: add computer flow benchmark operation`
6. `docs: checkpoint computer flow benchmark readiness`
7. `docs: checkpoint computer flow baseline`

After every meaningful milestone, update `docs/PROJECT_STATE.md` and `project_checkpoint(alias="chatgpt-system-computer-flow-performance")` with exact branch/worktree/HEAD, RED/GREEN state, verification evidence, blockers, and one next exact step. Repository documentation/continuity must never contain secrets, lease IDs, screenshots, OCR/AX text, editable/typed sensitive content, raw coordinates, raw native pointers, or raw audit records.

---

## Handoff After Plan A Approval

Plan A approval does not authorize implementation by itself. The next execution choice is explicit:

- **Inline:** use `superpowers:executing-plans` in this worktree with task-level checkpoints.
- **Subagent-driven:** only when the user explicitly requests it and the product surface exposes subagent dispatch; use `superpowers:subagent-driven-development` with a fresh worker per task and review between tasks.

Do not start Task 1 automatically after this planning handoff. Do not push, open a PR, merge, deploy, replace the helper, or restart the tunnel.
