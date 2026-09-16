import { z } from "zod";

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
  "recovery_contract_satisfied",
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
  "trusted_mcp_trace",
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
  "target_not_found",
  "target_ambiguous",
  "needs_replan",
  "verification_failed",
  "protocol_invalid",
  "action_failed",
  "output_limit",
  "js_forbidden",
  "collector_invalid",
] as const;
export type ComputerFlowFailureCategory = typeof COMPUTER_FLOW_FAILURE_CATEGORIES[number];

export const COMPUTER_FLOW_RECOVERY_OUTCOMES = [
  "operation_completed",
  "target_visible",
  "target_not_found",
  "target_ambiguous",
  "stale_refused",
  "fresh_observe",
  "boundary_reached",
  "needs_replan",
  "focus_refused",
  "takeover_refused",
  "permission_blocked",
  "verification_failed",
  "protocol_invalid",
  "action_failed",
  "output_limit",
  "js_forbidden",
  "ocr_fallback",
  "single_visual_point_attempt",
  "timeout",
  "unavailable",
] as const;
export type ComputerFlowRecoveryOutcome = typeof COMPUTER_FLOW_RECOVERY_OUTCOMES[number];

export const COMPUTER_FLOW_ORACLE_KINDS = [
  "web_fixture",
  "native_fixture",
  "host_process",
  "runtime_result",
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
  expectedRecoveryOutcomes: readonly ComputerFlowRecoveryOutcome[];
}

export const COMPUTER_FLOW_UNAVAILABLE_REASONS = [
  "mode_not_authoritative",
  "missing_turn_correlation",
  "collector_source_missing",
  "lossy_audit_source",
  "precondition_blocked",
  "deployment_pending",
] as const;
export type ComputerFlowUnavailableReason = typeof COMPUTER_FLOW_UNAVAILABLE_REASONS[number];

export type ComputerFlowMetric =
  | { availability: "available"; value: number }
  | { availability: "unavailable"; reason: ComputerFlowUnavailableReason };

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
  durationMs?: number;
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
  failureCategory?: ComputerFlowFailureCategory;
  recoveryOutcome?: ComputerFlowRecoveryOutcome;
  targeting?: "ax" | "ocr" | "visual-point" | "none";
  verified?: boolean;
}

export type ComputerFlowAssertion =
  | {
      assertion: ComputerFlowAssertionName;
      status: "pass" | "fail";
      source: ComputerFlowAssertionSource;
      evidenceDigest: string;
    }
  | {
      assertion: ComputerFlowAssertionName;
      status: "unavailable";
      reason: ComputerFlowUnavailableReason;
    };

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
  "build_identity_mismatch",
  "machine_class_mismatch",
  "scenario_set_mismatch",
  "recorded_count_mismatch",
  "invalid_pairing",
  "regression_guard_incomplete",
  "metric_unavailable",
] as const;
export type ComputerFlowComparisonIneligibleReason = typeof COMPUTER_FLOW_COMPARISON_INELIGIBLE_REASONS[number];

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

interface ComputerFlowComparisonInputBase {
  baselineRuntimeBuild: ComputerFlowRuntimeBuild;
  candidateRuntimeBuild: ComputerFlowRuntimeBuild;
  baselineRuns: ComputerFlowRunRecord[];
  candidateRuns: ComputerFlowRunRecord[];
  scenarioId: ComputerFlowScenarioId;
}

export type ComputerFlowRuntimeLatencySelector =
  | { kind: "runtime_total" }
  | { kind: "local_action_program" }
  | { kind: "operation"; operation: ComputerFlowOperation; aggregation: "sum_per_run" };

export interface ComputerFlowReliabilityRegressionGuard {
  baselineOtherScenarioRuns: ComputerFlowRunRecord[];
  candidateOtherScenarioRuns: ComputerFlowRunRecord[];
}

export type ComputerFlowComparisonInput =
  | (ComputerFlowComparisonInputBase & { objectiveRule: "flow_boundary"; mode: "agent" })
  | (ComputerFlowComparisonInputBase & { objectiveRule: "flow_latency"; mode: "agent" })
  | (ComputerFlowComparisonInputBase & {
      objectiveRule: "runtime_latency";
      mode: "runtime";
      selector: ComputerFlowRuntimeLatencySelector;
    })
  | (ComputerFlowComparisonInputBase & {
      objectiveRule: "reliability_defect";
      mode: ComputerFlowMode;
      failureCategory: Exclude<ComputerFlowFailureCategory, "none">;
      regressionGuard: ComputerFlowReliabilityRegressionGuard;
    });

interface ComputerFlowComparisonBase {
  scenarioId: ComputerFlowScenarioId;
  mode: ComputerFlowMode;
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
  selector: ComputerFlowRuntimeLatencySelector;
  pairedCandidateFasterCount: ComputerFlowMetric;
  baselineMedianSelectedDurationMs: ComputerFlowMetric;
  candidateMedianSelectedDurationMs: ComputerFlowMetric;
  baselineP90SelectedDurationMs: ComputerFlowMetric;
  candidateP90SelectedDurationMs: ComputerFlowMetric;
}

export interface ComputerFlowReliabilityComparisonResult extends ComputerFlowComparisonBase {
  objectiveRule: "reliability_defect";
  failureCategory: Exclude<ComputerFlowFailureCategory, "none">;
  baselineFailureCount: number;
  candidateFailureCount: number;
  candidateSuccessCount: number;
  regressionGuardScenarioCount: number;
  otherScenarioFloorRegressionCount: number;
}

export type ComputerFlowComparisonResult =
  | ComputerFlowBoundaryComparisonResult
  | ComputerFlowLatencyComparisonResult
  | ComputerFlowRuntimeLatencyComparisonResult
  | ComputerFlowReliabilityComparisonResult;

export interface ComputerFlowEvidenceMetadataV1 {
  version: 1;
  scenarioId: ComputerFlowScenarioId;
  mode: ComputerFlowMode;
  assertion: ComputerFlowAssertionName;
  status: "pass" | "fail";
  source: ComputerFlowAssertionSource;
  sourceSequence: number;
  operation?: ComputerFlowOperation;
  outcome?: ComputerFlowOutcome;
}

const metricSchema = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("available"), value: z.number().finite().nonnegative() }).strict(),
  z.object({ availability: z.literal("unavailable"), reason: z.enum(COMPUTER_FLOW_UNAVAILABLE_REASONS) }).strict(),
]);

const runtimeBuildSchema = z.object({
  buildId: z.string().min(1),
  gitCommit: z.string().min(1),
  workingTreeDigest: z.string().min(1),
  computerProtocolVersion: z.number().int().nonnegative(),
  typeScriptArtifactSha256: z.string().min(1),
  nativeHelperExecutableSha256: z.string().min(1),
}).strict();

const eventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative().optional(),
  mode: z.enum(COMPUTER_FLOW_MODES),
  category: z.enum([
    "workflow_start",
    "tool_boundary",
    "observation",
    "screenshot",
    "physical_action",
    "verification",
    "replan",
    "takeover",
    "workflow_end",
  ]),
  operation: z.enum(COMPUTER_FLOW_OPERATIONS).optional(),
  outcome: z.enum(COMPUTER_FLOW_OUTCOMES).optional(),
  failureCategory: z.enum(COMPUTER_FLOW_FAILURE_CATEGORIES).optional(),
  recoveryOutcome: z.enum(COMPUTER_FLOW_RECOVERY_OUTCOMES).optional(),
  targeting: z.enum(["ax", "ocr", "visual-point", "none"]).optional(),
  verified: z.boolean().optional(),
}).strict();

const assertionSchema = z.discriminatedUnion("status", [
  z.object({
    assertion: z.enum(COMPUTER_FLOW_ASSERTIONS),
    status: z.enum(["pass", "fail"]),
    source: z.enum(COMPUTER_FLOW_ASSERTION_SOURCES),
    evidenceDigest: z.string().min(1),
  }).strict(),
  z.object({
    assertion: z.enum(COMPUTER_FLOW_ASSERTIONS),
    status: z.literal("unavailable"),
    reason: z.enum(COMPUTER_FLOW_UNAVAILABLE_REASONS),
  }).strict(),
]);

const metricsSchema = z.object({
  endToEndDurationMs: metricSchema,
  timeToFirstUsableObservationMs: metricSchema,
  runtimeDurationMs: metricSchema,
  localActionProgramDurationMs: metricSchema,
  computerToolCallCount: metricSchema,
  modelRoundTripCount: metricSchema,
  nativeRpcCount: metricSchema,
  physicalActionCount: metricSchema,
  observationCount: metricSchema,
  screenshotCount: metricSchema,
  axTargetingCount: metricSchema,
  ocrTargetingCount: metricSchema,
  visualPointTargetingCount: metricSchema,
  retryCount: metricSchema,
  replanCount: metricSchema,
  verifiedCount: metricSchema,
  completedUnverifiedCount: metricSchema,
  wrongAppInputCount: metricSchema,
  blindRepeatedPointCount: metricSchema,
  unchangedScrollRepeatCount: metricSchema,
  safetyBoundaryViolationCount: metricSchema,
}).strict();

const runRecordSchema = z.object({
  schemaVersion: z.literal(1),
  metricRulesVersion: z.literal(1),
  scenarioVersion: z.literal(1),
  fixtureVersion: z.literal(1),
  scenarioId: z.enum(COMPUTER_FLOW_SCENARIO_IDS),
  mode: z.enum(COMPUTER_FLOW_MODES),
  tier: z.enum(["tier1", "tier2"]),
  runKind: z.literal("recorded"),
  repetition: z.number().int().positive(),
  runtimeBuild: runtimeBuildSchema,
  machineClassId: z.string().min(1),
  disposition: z.enum(COMPUTER_FLOW_RUN_DISPOSITIONS),
  failureCategory: z.enum(COMPUTER_FLOW_FAILURE_CATEGORIES),
  events: z.array(eventSchema),
  assertions: z.array(assertionSchema),
  metrics: metricsSchema,
  collectorSignature: z.string().min(1),
}).strict();

export function parseComputerFlowRunRecordJson(json: string): ComputerFlowRunRecord {
  return runRecordSchema.parse(JSON.parse(json)) as ComputerFlowRunRecord;
}

function available(value: number): ComputerFlowMetric {
  return { availability: "available", value };
}

function unavailable(reason: ComputerFlowUnavailableReason): ComputerFlowMetric {
  return { availability: "unavailable", reason };
}

function sumDurations(events: readonly ComputerFlowEvent[], category: ComputerFlowEvent["category"]): ComputerFlowMetric {
  const selected = events.filter((event) => event.category === category);
  if (selected.length === 0) return available(0);
  if (selected.some((event) => event.durationMs === undefined)) return unavailable("collector_source_missing");
  return available(selected.reduce((sum, event) => sum + (event.durationMs ?? 0), 0));
}

function assertionFailureCount(assertions: readonly ComputerFlowAssertion[], name: ComputerFlowAssertionName): ComputerFlowMetric {
  const assertion = assertions.find((item) => item.assertion === name);
  if (!assertion) return unavailable("collector_source_missing");
  if (assertion.status === "unavailable") return unavailable(assertion.reason);
  return available(assertion.status === "fail" ? 1 : 0);
}

export function deriveComputerFlowMetrics(
  events: readonly ComputerFlowEvent[],
  assertions: readonly ComputerFlowAssertion[],
  mode: ComputerFlowMode,
): ComputerFlowMetrics {
  if (mode === "agent") {
    return {
      endToEndDurationMs: unavailable("missing_turn_correlation"),
      timeToFirstUsableObservationMs: unavailable("missing_turn_correlation"),
      runtimeDurationMs: unavailable("mode_not_authoritative"),
      localActionProgramDurationMs: unavailable("mode_not_authoritative"),
      computerToolCallCount: unavailable("lossy_audit_source"),
      modelRoundTripCount: unavailable("missing_turn_correlation"),
      nativeRpcCount: unavailable("lossy_audit_source"),
      physicalActionCount: unavailable("lossy_audit_source"),
      observationCount: unavailable("lossy_audit_source"),
      screenshotCount: unavailable("lossy_audit_source"),
      axTargetingCount: unavailable("lossy_audit_source"),
      ocrTargetingCount: unavailable("lossy_audit_source"),
      visualPointTargetingCount: unavailable("lossy_audit_source"),
      retryCount: unavailable("lossy_audit_source"),
      replanCount: unavailable("lossy_audit_source"),
      verifiedCount: unavailable("lossy_audit_source"),
      completedUnverifiedCount: unavailable("lossy_audit_source"),
      wrongAppInputCount: assertionFailureCount(assertions, "wrong_app_input_absent"),
      blindRepeatedPointCount: assertionFailureCount(assertions, "blind_point_repeat_absent"),
      unchangedScrollRepeatCount: assertionFailureCount(assertions, "unchanged_scroll_repeat_absent"),
      safetyBoundaryViolationCount: assertionFailureCount(assertions, "safety_boundary_violation_absent"),
    };
  }

  const start = events.find((event) => event.category === "workflow_start");
  const end = [...events].reverse().find((event) => event.category === "workflow_end");
  const firstObservation = events.find((event) => event.category === "observation" || event.category === "screenshot");
  const endToEndDurationMs = start && end && end.elapsedMs >= start.elapsedMs
    ? available(end.elapsedMs - start.elapsedMs)
    : unavailable("collector_source_missing");
  const timeToFirstUsableObservationMs = start && firstObservation && firstObservation.elapsedMs >= start.elapsedMs
    ? available(firstObservation.elapsedMs - start.elapsedMs)
    : unavailable("collector_source_missing");

  return {
    endToEndDurationMs,
    timeToFirstUsableObservationMs,
    runtimeDurationMs: sumDurations(events, "tool_boundary"),
    localActionProgramDurationMs: sumDurations(events, "physical_action"),
    computerToolCallCount: available(events.filter((event) => event.category === "tool_boundary").length),
    modelRoundTripCount: unavailable("mode_not_authoritative"),
    nativeRpcCount: available(events.filter((event) => event.category === "tool_boundary").length),
    physicalActionCount: available(events.filter((event) => event.category === "physical_action").length),
    observationCount: available(events.filter((event) => event.category === "observation").length),
    screenshotCount: available(events.filter((event) => event.category === "screenshot").length),
    axTargetingCount: available(events.filter((event) => event.targeting === "ax").length),
    ocrTargetingCount: available(events.filter((event) => event.targeting === "ocr").length),
    visualPointTargetingCount: available(events.filter((event) => event.targeting === "visual-point").length),
    retryCount: available(events.filter((event) => event.failureCategory !== undefined && event.failureCategory !== "none").length),
    replanCount: available(events.filter((event) => event.category === "replan").length),
    verifiedCount: available(events.filter((event) => event.outcome === "verified" || event.verified === true).length),
    completedUnverifiedCount: available(events.filter((event) => event.outcome === "completed_unverified").length),
    wrongAppInputCount: assertionFailureCount(assertions, "wrong_app_input_absent"),
    blindRepeatedPointCount: assertionFailureCount(assertions, "blind_point_repeat_absent"),
    unchangedScrollRepeatCount: assertionFailureCount(assertions, "unchanged_scroll_repeat_absent"),
    safetyBoundaryViolationCount: assertionFailureCount(assertions, "safety_boundary_violation_absent"),
  };
}
