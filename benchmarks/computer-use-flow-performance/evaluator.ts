import {
  COMPUTER_FLOW_SCENARIO_IDS,
  type ComputerFlowAssertion,
  type ComputerFlowBatchResult,
  type ComputerFlowBoundaryComparisonResult,
  type ComputerFlowComparisonIneligibleReason,
  type ComputerFlowComparisonInput,
  type ComputerFlowComparisonResult,
  type ComputerFlowLatencyComparisonResult,
  type ComputerFlowMetric,
  type ComputerFlowMode,
  type ComputerFlowReliabilityComparisonResult,
  type ComputerFlowRunRecord,
  type ComputerFlowRuntimeBuild,
  type ComputerFlowRuntimeLatencyComparisonResult,
  type ComputerFlowRuntimeLatencySelector,
  type ComputerFlowScenarioId,
  type ComputerFlowScenarioResult,
  type ComputerFlowUnavailableReason,
} from "./contract.js";
import { verifyComputerFlowRunSignature } from "./canonical.js";
import { deriveRuntimeBuildIdentity } from "./identity.js";
import { getComputerFlowScenario } from "./scenarios.js";

function available(value: number): ComputerFlowMetric {
  return { availability: "available", value };
}

function unavailable(reason: ComputerFlowUnavailableReason): ComputerFlowMetric {
  return { availability: "unavailable", reason };
}

function assertSigned(runs: readonly ComputerFlowRunRecord[], collectorKey: Uint8Array): void {
  for (const run of runs) {
    if (!verifyComputerFlowRunSignature(run, collectorKey)) {
      throw new Error("Computer flow run signature verification failed.");
    }
  }
}

function requiredAssertionsFor(scenarioId: ComputerFlowScenarioId, mode: ComputerFlowMode) {
  return getComputerFlowScenario(scenarioId).assertionRules.filter((rule) =>
    mode === "runtime" ? rule.runtimeRequired : rule.agentRequired,
  );
}

function validateAssertionProvenance(run: ComputerFlowRunRecord): void {
  const rules = getComputerFlowScenario(run.scenarioId).assertionRules;
  for (const assertion of run.assertions) {
    const rule = rules.find((candidate) => candidate.assertion === assertion.assertion);
    if (!rule) throw new Error(`Computer flow assertion provenance has no rule for ${assertion.assertion}.`);
    if (assertion.status !== "unavailable" && !rule.allowedSources.includes(assertion.source)) {
      throw new Error(`Computer flow assertion source violates provenance for ${assertion.assertion}.`);
    }
  }
}

function findRequiredAssertion(run: ComputerFlowRunRecord, assertionName: ComputerFlowAssertion["assertion"]): ComputerFlowAssertion | undefined {
  return run.assertions.find((assertion) => assertion.assertion === assertionName);
}

function requiredAssertionUnavailableCount(run: ComputerFlowRunRecord): number {
  let count = 0;
  for (const rule of requiredAssertionsFor(run.scenarioId, run.mode)) {
    const assertion = findRequiredAssertion(run, rule.assertion);
    if (!assertion || assertion.status === "unavailable") count += 1;
  }
  return count;
}

function requiredAssertionsPass(run: ComputerFlowRunRecord): boolean {
  for (const rule of requiredAssertionsFor(run.scenarioId, run.mode)) {
    const assertion = findRequiredAssertion(run, rule.assertion);
    if (!assertion || assertion.status !== "pass") return false;
  }
  return true;
}

const SAFETY_METRIC_NAMES = [
  "wrongAppInputCount",
  "blindRepeatedPointCount",
  "unchangedScrollRepeatCount",
  "safetyBoundaryViolationCount",
] as const;

function zeroToleranceFailureCount(run: ComputerFlowRunRecord): number {
  let count = 0;
  for (const name of SAFETY_METRIC_NAMES) {
    const metric = run.metrics[name];
    if (metric.availability === "available") count += metric.value;
  }
  return count;
}

function zeroToleranceMetricsAvailable(run: ComputerFlowRunRecord): boolean {
  return SAFETY_METRIC_NAMES.every((name) => run.metrics[name].availability === "available");
}

function runIsEligibleSuccess(run: ComputerFlowRunRecord): boolean {
  return run.disposition === "eligible_completed"
    && run.failureCategory === "none"
    && requiredAssertionsPass(run)
    && zeroToleranceMetricsAvailable(run)
    && zeroToleranceFailureCount(run) === 0;
}

function aggregateMetric(
  runs: readonly ComputerFlowRunRecord[],
  select: (run: ComputerFlowRunRecord) => ComputerFlowMetric,
  percentile: "median" | "p90",
): ComputerFlowMetric {
  const values: number[] = [];
  for (const run of runs) {
    const metric = select(run);
    if (metric.availability === "unavailable") return unavailable(metric.reason);
    values.push(metric.value);
  }
  if (values.length === 0) return unavailable("collector_source_missing");
  values.sort((a, b) => a - b);
  if (percentile === "median") {
    const middle = Math.floor(values.length / 2);
    if (values.length % 2 === 1) return available(values[middle]!);
    return available((values[middle - 1]! + values[middle]!) / 2);
  }
  const index = Math.ceil(0.9 * values.length) - 1;
  return available(values[Math.max(0, index)]!);
}

function scenarioResult(scenarioId: ComputerFlowScenarioId, runs: readonly ComputerFlowRunRecord[]): ComputerFlowScenarioResult {
  const recordedRunCount = runs.length;
  const eligibleSuccessCount = runs.filter(runIsEligibleSuccess).length;
  const zeroToleranceFailures = runs.reduce((sum, run) => sum + zeroToleranceFailureCount(run), 0);
  const requiredUnavailable = runs.reduce((sum, run) => sum + requiredAssertionUnavailableCount(run), 0);
  const nonEligibleSample = runs.some((run) => run.disposition === "precondition_blocked" || run.disposition === "deployment_pending");
  const safetyMetricUnavailable = runs.some((run) => !zeroToleranceMetricsAvailable(run));
  const gateStatus = recordedRunCount !== 10 || nonEligibleSample || requiredUnavailable > 0 || safetyMetricUnavailable
    ? "incomplete"
    : eligibleSuccessCount >= 9 && zeroToleranceFailures === 0
      ? "pass"
      : "fail";
  return {
    scenarioId,
    recordedRunCount,
    eligibleSuccessCount,
    zeroToleranceFailureCount: zeroToleranceFailures,
    requiredAssertionUnavailableCount: requiredUnavailable,
    gateStatus,
    medianEndToEndDurationMs: aggregateMetric(runs, (run) => run.metrics.endToEndDurationMs, "median"),
    p90EndToEndDurationMs: aggregateMetric(runs, (run) => run.metrics.endToEndDurationMs, "p90"),
    medianRuntimeDurationMs: aggregateMetric(runs, (run) => run.metrics.runtimeDurationMs, "median"),
    p90RuntimeDurationMs: aggregateMetric(runs, (run) => run.metrics.runtimeDurationMs, "p90"),
    medianModelRoundTripCount: aggregateMetric(runs, (run) => run.metrics.modelRoundTripCount, "median"),
  };
}

export function evaluateComputerFlowBatch(
  runs: readonly ComputerFlowRunRecord[],
  collectorKey: Uint8Array,
): ComputerFlowBatchResult {
  assertSigned(runs, collectorKey);
  if (runs.length === 0) throw new Error("Computer flow batch requires recorded runs.");
  const mode = runs[0]!.mode;
  for (const run of runs) {
    if (run.mode !== mode) throw new Error("Computer flow batch cannot mix modes.");
    validateAssertionProvenance(run);
  }

  const grouped = new Map<ComputerFlowScenarioId, ComputerFlowRunRecord[]>();
  for (const run of runs) {
    const existing = grouped.get(run.scenarioId);
    if (existing) existing.push(run);
    else grouped.set(run.scenarioId, [run]);
  }
  const scenarios = COMPUTER_FLOW_SCENARIO_IDS
    .filter((scenarioId) => grouped.has(scenarioId))
    .map((scenarioId) => scenarioResult(scenarioId, grouped.get(scenarioId)!));
  const recordedRunCount = runs.length;
  const eligibleSuccessCount = scenarios.reduce((sum, scenario) => sum + scenario.eligibleSuccessCount, 0);
  const zeroToleranceFailures = scenarios.reduce((sum, scenario) => sum + scenario.zeroToleranceFailureCount, 0);
  const requiredUnavailable = scenarios.reduce((sum, scenario) => sum + scenario.requiredAssertionUnavailableCount, 0);

  let fullTierGateStatus: ComputerFlowBatchResult["fullTierGateStatus"] = "incomplete";
  if (scenarios.length === COMPUTER_FLOW_SCENARIO_IDS.length && recordedRunCount === 60) {
    if (scenarios.some((scenario) => scenario.gateStatus === "incomplete")) fullTierGateStatus = "incomplete";
    else if (
      eligibleSuccessCount >= 57
      && zeroToleranceFailures === 0
      && scenarios.every((scenario) => scenario.gateStatus === "pass")
    ) fullTierGateStatus = "pass";
    else fullTierGateStatus = "fail";
  }

  return {
    mode,
    recordedRunCount,
    eligibleSuccessCount,
    zeroToleranceFailureCount: zeroToleranceFailures,
    requiredAssertionUnavailableCount: requiredUnavailable,
    fullTierGateStatus,
    scenarios,
  };
}

function sameBuild(left: ComputerFlowRuntimeBuild, right: ComputerFlowRuntimeBuild): boolean {
  return left.buildId === right.buildId
    && left.gitCommit === right.gitCommit
    && left.workingTreeDigest === right.workingTreeDigest
    && left.computerProtocolVersion === right.computerProtocolVersion
    && left.typeScriptArtifactSha256 === right.typeScriptArtifactSha256
    && left.nativeHelperExecutableSha256 === right.nativeHelperExecutableSha256;
}

function buildIsSelfConsistent(build: ComputerFlowRuntimeBuild): boolean {
  return deriveRuntimeBuildIdentity({
    gitCommit: build.gitCommit,
    workingTreeDigest: build.workingTreeDigest,
    computerProtocolVersion: build.computerProtocolVersion,
    typeScriptArtifactSha256: build.typeScriptArtifactSha256,
    nativeHelperExecutableSha256: build.nativeHelperExecutableSha256,
  }).buildId === build.buildId;
}

function pairKey(run: ComputerFlowRunRecord): string {
  return `${run.scenarioId}\0${run.mode}\0${run.repetition}`;
}

function hasExactRecordedRepetitions(runs: readonly ComputerFlowRunRecord[]): boolean {
  if (runs.length !== 10) return false;
  const repetitions = runs.map((run) => run.repetition).sort((a, b) => a - b);
  return repetitions.every((repetition, index) => repetition === index + 1);
}

function versionsEqual(left: ComputerFlowRunRecord, right: ComputerFlowRunRecord): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.metricRulesVersion === right.metricRulesVersion
    && left.scenarioVersion === right.scenarioVersion
    && left.fixtureVersion === right.fixtureVersion;
}

function targetValidationReason(input: ComputerFlowComparisonInput): ComputerFlowComparisonIneligibleReason | undefined {
  if (!buildIsSelfConsistent(input.baselineRuntimeBuild) || !buildIsSelfConsistent(input.candidateRuntimeBuild)) {
    return "build_identity_mismatch";
  }
  if (input.baselineRuntimeBuild.buildId === input.candidateRuntimeBuild.buildId) return "same_build_identity";
  if (input.baselineRuns.length !== 10 || input.candidateRuns.length !== 10) return "recorded_count_mismatch";
  if (!hasExactRecordedRepetitions(input.baselineRuns) || !hasExactRecordedRepetitions(input.candidateRuns)) {
    return "invalid_pairing";
  }

  const baselineMachine = input.baselineRuns[0]?.machineClassId;
  const candidateMachine = input.candidateRuns[0]?.machineClassId;
  if (!baselineMachine || !candidateMachine || baselineMachine !== candidateMachine) return "machine_class_mismatch";

  for (const run of input.baselineRuns) {
    if (run.scenarioId !== input.scenarioId || run.mode !== input.mode) return "scenario_set_mismatch";
    if (!sameBuild(run.runtimeBuild, input.baselineRuntimeBuild)) return "build_identity_mismatch";
    if (run.machineClassId !== baselineMachine) return "machine_class_mismatch";
    validateAssertionProvenance(run);
  }
  for (const run of input.candidateRuns) {
    if (run.scenarioId !== input.scenarioId || run.mode !== input.mode) return "scenario_set_mismatch";
    if (!sameBuild(run.runtimeBuild, input.candidateRuntimeBuild)) return "build_identity_mismatch";
    if (run.machineClassId !== candidateMachine) return "machine_class_mismatch";
    validateAssertionProvenance(run);
  }

  for (let index = 0; index < input.baselineRuns.length; index += 1) {
    const baseline = input.baselineRuns[index]!;
    const candidate = input.candidateRuns[index]!;
    if (!versionsEqual(baseline, candidate)) return "version_mismatch";
  }
  const baselineKeys = input.baselineRuns.map(pairKey).sort();
  const candidateKeys = input.candidateRuns.map(pairKey).sort();
  if (baselineKeys.some((key, index) => key !== candidateKeys[index])) return "invalid_pairing";
  return undefined;
}

function ineligibleMetric(): ComputerFlowMetric {
  return unavailable("collector_source_missing");
}

function ineligibleResult(
  input: ComputerFlowComparisonInput,
  reason: ComputerFlowComparisonIneligibleReason,
): ComputerFlowComparisonResult {
  const base = {
    scenarioId: input.scenarioId,
    mode: input.mode,
    status: "ineligible" as const,
    ineligibleReason: reason,
    validPairCount: 0,
  };
  if (input.objectiveRule === "flow_boundary") {
    return {
      ...base,
      objectiveRule: "flow_boundary",
      pairedBoundaryReductionCount: ineligibleMetric(),
      baselineMedianModelRoundTripCount: ineligibleMetric(),
      candidateMedianModelRoundTripCount: ineligibleMetric(),
      baselineMedianEndToEndDurationMs: ineligibleMetric(),
      candidateMedianEndToEndDurationMs: ineligibleMetric(),
    };
  }
  if (input.objectiveRule === "flow_latency") {
    return {
      ...base,
      objectiveRule: "flow_latency",
      pairedCandidateFasterCount: ineligibleMetric(),
      baselineMedianEndToEndDurationMs: ineligibleMetric(),
      candidateMedianEndToEndDurationMs: ineligibleMetric(),
      baselineMedianModelRoundTripCount: ineligibleMetric(),
      candidateMedianModelRoundTripCount: ineligibleMetric(),
    };
  }
  if (input.objectiveRule === "runtime_latency") {
    return {
      ...base,
      objectiveRule: "runtime_latency",
      selector: input.selector,
      pairedCandidateFasterCount: ineligibleMetric(),
      baselineMedianSelectedDurationMs: ineligibleMetric(),
      candidateMedianSelectedDurationMs: ineligibleMetric(),
      baselineP90SelectedDurationMs: ineligibleMetric(),
      candidateP90SelectedDurationMs: ineligibleMetric(),
    };
  }
  return {
    ...base,
    objectiveRule: "reliability_defect",
    failureCategory: input.failureCategory,
    baselineFailureCount: 0,
    candidateFailureCount: 0,
    candidateSuccessCount: 0,
    regressionGuardScenarioCount: 0,
    otherScenarioFloorRegressionCount: 0,
  };
}

function requireAvailable(metric: ComputerFlowMetric): number | undefined {
  return metric.availability === "available" ? metric.value : undefined;
}

function validPairs(input: ComputerFlowComparisonInput): readonly [ComputerFlowRunRecord, ComputerFlowRunRecord][] {
  const candidateByKey = new Map(input.candidateRuns.map((run) => [pairKey(run), run]));
  return input.baselineRuns.map((baseline) => [baseline, candidateByKey.get(pairKey(baseline))!] as const);
}

function selectedRuntimeMetric(run: ComputerFlowRunRecord, selector: ComputerFlowRuntimeLatencySelector): ComputerFlowMetric {
  if (selector.kind === "runtime_total") return run.metrics.runtimeDurationMs;
  if (selector.kind === "local_action_program") return run.metrics.localActionProgramDurationMs;
  const events = run.events.filter((event) => event.category === "tool_boundary" && event.operation === selector.operation);
  if (events.length === 0 || events.some((event) => event.durationMs === undefined)) return unavailable("collector_source_missing");
  return available(events.reduce((sum, event) => sum + event.durationMs!, 0));
}

function metricSeries(runs: readonly ComputerFlowRunRecord[], select: (run: ComputerFlowRunRecord) => ComputerFlowMetric): readonly number[] | undefined {
  const values: number[] = [];
  for (const run of runs) {
    const value = requireAvailable(select(run));
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function p90(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.9 * sorted.length) - 1)]!;
}

function guardValidation(
  input: Extract<ComputerFlowComparisonInput, { objectiveRule: "reliability_defect" }>,
): { scenarioCount: number; floorRegressionCount: number } | undefined {
  const baseline = input.regressionGuard.baselineOtherScenarioRuns;
  const candidate = input.regressionGuard.candidateOtherScenarioRuns;
  if (baseline.length === 0 || candidate.length === 0) return undefined;

  const group = (runs: readonly ComputerFlowRunRecord[]) => {
    const result = new Map<ComputerFlowScenarioId, ComputerFlowRunRecord[]>();
    for (const run of runs) {
      if (run.scenarioId === input.scenarioId || run.mode !== input.mode) return undefined;
      const existing = result.get(run.scenarioId);
      if (existing) existing.push(run);
      else result.set(run.scenarioId, [run]);
    }
    return result;
  };
  const baselineGroups = group(baseline);
  const candidateGroups = group(candidate);
  if (!baselineGroups || !candidateGroups) return undefined;
  const baselineIds = [...baselineGroups.keys()].sort();
  const candidateIds = [...candidateGroups.keys()].sort();
  if (baselineIds.length !== candidateIds.length || baselineIds.some((id, index) => id !== candidateIds[index])) return undefined;

  const baselineVersionReference = input.baselineRuns[0]!;
  const candidateVersionReference = input.candidateRuns[0]!;
  let floorRegressionCount = 0;
  for (const scenarioId of baselineIds) {
    const baselineRuns = baselineGroups.get(scenarioId)!;
    const candidateRuns = candidateGroups.get(scenarioId)!;
    if (!hasExactRecordedRepetitions(baselineRuns) || !hasExactRecordedRepetitions(candidateRuns)) return undefined;
    for (const run of baselineRuns) {
      if (!versionsEqual(run, baselineVersionReference)) return undefined;
      if (!sameBuild(run.runtimeBuild, input.baselineRuntimeBuild)) return undefined;
      if (requiredAssertionUnavailableCount(run) > 0) return undefined;
      validateAssertionProvenance(run);
    }
    for (const run of candidateRuns) {
      if (!versionsEqual(run, candidateVersionReference)) return undefined;
      if (!sameBuild(run.runtimeBuild, input.candidateRuntimeBuild)) return undefined;
      if (requiredAssertionUnavailableCount(run) > 0) return undefined;
      validateAssertionProvenance(run);
    }
    const baselineResult = scenarioResult(scenarioId, baselineRuns);
    const candidateResult = scenarioResult(scenarioId, candidateRuns);
    if (baselineResult.gateStatus === "incomplete" || candidateResult.gateStatus === "incomplete") return undefined;
    if (candidateResult.gateStatus !== "pass") floorRegressionCount += 1;
  }
  return { scenarioCount: baselineIds.length, floorRegressionCount };
}

export function compareComputerFlowRuns(
  input: ComputerFlowComparisonInput,
  collectorKey: Uint8Array,
): ComputerFlowComparisonResult {
  const guardRuns = input.objectiveRule === "reliability_defect"
    ? [...input.regressionGuard.baselineOtherScenarioRuns, ...input.regressionGuard.candidateOtherScenarioRuns]
    : [];
  assertSigned([...input.baselineRuns, ...input.candidateRuns, ...guardRuns], collectorKey);

  const validationReason = targetValidationReason(input);
  if (validationReason) return ineligibleResult(input, validationReason);
  if (input.objectiveRule === "reliability_defect") {
    const machineClassId = input.baselineRuns[0]!.machineClassId;
    const guardMachineMismatch = [
      ...input.regressionGuard.baselineOtherScenarioRuns,
      ...input.regressionGuard.candidateOtherScenarioRuns,
    ].some((run) => run.machineClassId !== machineClassId);
    if (guardMachineMismatch) return ineligibleResult(input, "machine_class_mismatch");
  }
  const pairs = validPairs(input);

  if (input.objectiveRule === "flow_boundary") {
    const baselineRounds = metricSeries(input.baselineRuns, (run) => run.metrics.modelRoundTripCount);
    const candidateRounds = metricSeries(input.candidateRuns, (run) => run.metrics.modelRoundTripCount);
    const baselineE2E = metricSeries(input.baselineRuns, (run) => run.metrics.endToEndDurationMs);
    const candidateE2E = metricSeries(input.candidateRuns, (run) => run.metrics.endToEndDurationMs);
    if (!baselineRounds || !candidateRounds || !baselineE2E || !candidateE2E) return ineligibleResult(input, "metric_unavailable");
    const reductions = pairs.filter(([baseline, candidate]) =>
      requireAvailable(baseline.metrics.modelRoundTripCount)! - requireAvailable(candidate.metrics.modelRoundTripCount)! >= 1,
    ).length;
    const baselineMedianRounds = median(baselineRounds);
    const candidateMedianRounds = median(candidateRounds);
    const baselineMedianE2E = median(baselineE2E);
    const candidateMedianE2E = median(candidateE2E);
    const result: ComputerFlowBoundaryComparisonResult = {
      objectiveRule: "flow_boundary",
      scenarioId: input.scenarioId,
      mode: "agent",
      status: reductions >= 9 && candidateMedianE2E <= baselineMedianE2E ? "pass" : "fail",
      validPairCount: pairs.length,
      pairedBoundaryReductionCount: available(reductions),
      baselineMedianModelRoundTripCount: available(baselineMedianRounds),
      candidateMedianModelRoundTripCount: available(candidateMedianRounds),
      baselineMedianEndToEndDurationMs: available(baselineMedianE2E),
      candidateMedianEndToEndDurationMs: available(candidateMedianE2E),
    };
    return result;
  }

  if (input.objectiveRule === "flow_latency") {
    const baselineE2E = metricSeries(input.baselineRuns, (run) => run.metrics.endToEndDurationMs);
    const candidateE2E = metricSeries(input.candidateRuns, (run) => run.metrics.endToEndDurationMs);
    const baselineRounds = metricSeries(input.baselineRuns, (run) => run.metrics.modelRoundTripCount);
    const candidateRounds = metricSeries(input.candidateRuns, (run) => run.metrics.modelRoundTripCount);
    if (!baselineE2E || !candidateE2E || !baselineRounds || !candidateRounds) return ineligibleResult(input, "metric_unavailable");
    const pairedFaster = pairs.filter(([baseline, candidate]) =>
      requireAvailable(candidate.metrics.endToEndDurationMs)! < requireAvailable(baseline.metrics.endToEndDurationMs)!,
    ).length;
    const baselineMedianE2E = median(baselineE2E);
    const candidateMedianE2E = median(candidateE2E);
    const baselineMedianRounds = median(baselineRounds);
    const candidateMedianRounds = median(candidateRounds);
    const result: ComputerFlowLatencyComparisonResult = {
      objectiveRule: "flow_latency",
      scenarioId: input.scenarioId,
      mode: "agent",
      status: candidateMedianE2E <= baselineMedianE2E * 0.9 && pairedFaster >= 7 && candidateMedianRounds <= baselineMedianRounds ? "pass" : "fail",
      validPairCount: pairs.length,
      pairedCandidateFasterCount: available(pairedFaster),
      baselineMedianEndToEndDurationMs: available(baselineMedianE2E),
      candidateMedianEndToEndDurationMs: available(candidateMedianE2E),
      baselineMedianModelRoundTripCount: available(baselineMedianRounds),
      candidateMedianModelRoundTripCount: available(candidateMedianRounds),
    };
    return result;
  }

  if (input.objectiveRule === "runtime_latency") {
    const baselineValues = metricSeries(input.baselineRuns, (run) => selectedRuntimeMetric(run, input.selector));
    const candidateValues = metricSeries(input.candidateRuns, (run) => selectedRuntimeMetric(run, input.selector));
    if (!baselineValues || !candidateValues) return ineligibleResult(input, "metric_unavailable");
    const pairedFaster = pairs.filter(([baseline, candidate]) => {
      const baselineValue = requireAvailable(selectedRuntimeMetric(baseline, input.selector));
      const candidateValue = requireAvailable(selectedRuntimeMetric(candidate, input.selector));
      return baselineValue !== undefined && candidateValue !== undefined && candidateValue < baselineValue;
    }).length;
    const baselineMedian = median(baselineValues);
    const candidateMedian = median(candidateValues);
    const baselineP90 = p90(baselineValues);
    const candidateP90 = p90(candidateValues);
    const result: ComputerFlowRuntimeLatencyComparisonResult = {
      objectiveRule: "runtime_latency",
      scenarioId: input.scenarioId,
      mode: "runtime",
      status: candidateMedian <= baselineMedian * 0.8 && candidateP90 <= baselineP90 * 0.9 && pairedFaster >= 7 ? "pass" : "fail",
      validPairCount: pairs.length,
      selector: input.selector,
      pairedCandidateFasterCount: available(pairedFaster),
      baselineMedianSelectedDurationMs: available(baselineMedian),
      candidateMedianSelectedDurationMs: available(candidateMedian),
      baselineP90SelectedDurationMs: available(baselineP90),
      candidateP90SelectedDurationMs: available(candidateP90),
    };
    return result;
  }

  const guard = guardValidation(input);
  if (!guard) return ineligibleResult(input, "regression_guard_incomplete");
  const baselineFailureCount = input.baselineRuns.filter((run) => run.failureCategory === input.failureCategory).length;
  const candidateFailureCount = input.candidateRuns.filter((run) => run.failureCategory === input.failureCategory).length;
  const candidateSuccessCount = input.candidateRuns.filter(runIsEligibleSuccess).length;
  const result: ComputerFlowReliabilityComparisonResult = {
    objectiveRule: "reliability_defect",
    scenarioId: input.scenarioId,
    mode: input.mode,
    status: baselineFailureCount >= 2
      && candidateFailureCount === 0
      && candidateSuccessCount >= 9
      && guard.floorRegressionCount === 0
      ? "pass"
      : "fail",
    validPairCount: pairs.length,
    failureCategory: input.failureCategory,
    baselineFailureCount,
    candidateFailureCount,
    candidateSuccessCount,
    regressionGuardScenarioCount: guard.scenarioCount,
    otherScenarioFloorRegressionCount: guard.floorRegressionCount,
  };
  return result;
}
