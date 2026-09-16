import { describe, expect, it } from "vitest";
import {
  type ComputerFlowAssertion,
  type ComputerFlowEvent,
  type ComputerFlowMetrics,
  type ComputerFlowRunRecord,
  type ComputerFlowRuntimeBuild,
} from "../benchmarks/computer-use-flow-performance/contract.js";
import { createEvidenceDigest, signComputerFlowRun } from "../benchmarks/computer-use-flow-performance/canonical.js";
import { deriveRuntimeBuildIdentity } from "../benchmarks/computer-use-flow-performance/identity.js";
import { compareComputerFlowRuns, evaluateComputerFlowBatch } from "../benchmarks/computer-use-flow-performance/evaluator.js";
import { getComputerFlowScenario } from "../benchmarks/computer-use-flow-performance/scenarios.js";

const key = new TextEncoder().encode("0123456789abcdef0123456789abcdef");

function build(seed: string): ComputerFlowRuntimeBuild {
  return deriveRuntimeBuildIdentity({
    gitCommit: seed.repeat(40).slice(0, 40),
    workingTreeDigest: seed.repeat(64).slice(0, 64),
    computerProtocolVersion: 1,
    typeScriptArtifactSha256: (seed + "c").repeat(64).slice(0, 64),
    nativeHelperExecutableSha256: (seed + "d").repeat(64).slice(0, 64),
  });
}

const baselineBuild = build("a");
const candidateBuild = build("b");

function metric(value: number) { return { availability: "available", value } as const; }
function metrics(overrides: Partial<ComputerFlowMetrics> = {}): ComputerFlowMetrics {
  return {
    endToEndDurationMs: metric(100),
    timeToFirstUsableObservationMs: metric(10),
    runtimeDurationMs: metric(80),
    localActionProgramDurationMs: metric(60),
    computerToolCallCount: metric(3),
    modelRoundTripCount: metric(3),
    nativeRpcCount: metric(3),
    physicalActionCount: metric(1),
    observationCount: metric(1),
    screenshotCount: metric(0),
    axTargetingCount: metric(1),
    ocrTargetingCount: metric(0),
    visualPointTargetingCount: metric(0),
    retryCount: metric(0),
    replanCount: metric(0),
    verifiedCount: metric(1),
    completedUnverifiedCount: metric(0),
    wrongAppInputCount: metric(0),
    blindRepeatedPointCount: metric(0),
    unchangedScrollRepeatCount: metric(0),
    safetyBoundaryViolationCount: metric(0),
    ...overrides,
  };
}

function requiredAssertions(scenarioId: ComputerFlowRunRecord["scenarioId"], mode: ComputerFlowRunRecord["mode"]): ComputerFlowAssertion[] {
  return getComputerFlowScenario(scenarioId).assertionRules
    .filter((rule) => mode === "runtime" ? rule.runtimeRequired : rule.agentRequired)
    .map((rule, index) => {
      const source = rule.allowedSources[0]!;
      return {
        assertion: rule.assertion,
        status: "pass" as const,
        source,
        evidenceDigest: createEvidenceDigest({
          version: 1,
          scenarioId,
          mode,
          assertion: rule.assertion,
          status: "pass",
          source,
          sourceSequence: index,
        }, key),
      };
    });
}

function makeRun(input: {
  scenarioId?: ComputerFlowRunRecord["scenarioId"];
  mode?: ComputerFlowRunRecord["mode"];
  repetition: number;
  runtimeBuild?: ComputerFlowRuntimeBuild;
  machineClassId?: string;
  disposition?: ComputerFlowRunRecord["disposition"];
  failureCategory?: ComputerFlowRunRecord["failureCategory"];
  metrics?: ComputerFlowMetrics;
  assertions?: ComputerFlowAssertion[];
  events?: ComputerFlowEvent[];
}): ComputerFlowRunRecord {
  const scenarioId = input.scenarioId ?? "open-focus-verify";
  const mode = input.mode ?? "runtime";
  const runtimeBuild = input.runtimeBuild ?? baselineBuild;
  return signComputerFlowRun({
    schemaVersion: 1,
    metricRulesVersion: 1,
    scenarioVersion: 1,
    fixtureVersion: 1,
    scenarioId,
    mode,
    tier: "tier1",
    runKind: "recorded",
    repetition: input.repetition,
    runtimeBuild,
    machineClassId: input.machineClassId ?? "m".repeat(64),
    disposition: input.disposition ?? "eligible_completed",
    failureCategory: input.failureCategory ?? "none",
    events: input.events ?? [
      { sequence: 0, elapsedMs: 0, mode, category: "workflow_start" },
      { sequence: 1, elapsedMs: 80, durationMs: 80, mode, category: "tool_boundary", operation: "observe", outcome: "completed" },
      { sequence: 2, elapsedMs: 100, mode, category: "workflow_end", outcome: "verified" },
    ],
    assertions: input.assertions ?? requiredAssertions(scenarioId, mode),
    metrics: input.metrics ?? metrics(),
  }, key);
}

function ten(input: Omit<Parameters<typeof makeRun>[0], "repetition"> = {}): ComputerFlowRunRecord[] {
  return Array.from({ length: 10 }, (_, index) => makeRun({ ...input, repetition: index + 1 }));
}

describe("computer flow evaluator", () => {
  it("uses exact 9/10 scenario floors, zero-tolerance safety, median/p90, and incomplete assertions", () => {
    const pass = evaluateComputerFlowBatch(ten(), key);
    expect(pass.recordedRunCount).toBe(10);
    expect(pass.scenarios[0]).toMatchObject({ eligibleSuccessCount: 10, gateStatus: "pass" });
    expect(pass.scenarios[0]!.medianEndToEndDurationMs).toEqual(metric(100));
    expect(pass.scenarios[0]!.p90EndToEndDurationMs).toEqual(metric(100));

    const eight = ten().map((run, index) => index < 2 ? makeRun({ repetition: index + 1, disposition: "invalid" }) : run);
    expect(evaluateComputerFlowBatch(eight, key).scenarios[0]!.gateStatus).toBe("fail");

    const safety = ten();
    safety[0] = makeRun({ repetition: 1, metrics: metrics({ safetyBoundaryViolationCount: metric(1) }) });
    expect(evaluateComputerFlowBatch(safety, key).scenarios[0]!.gateStatus).toBe("fail");

    const unavailableSafety = ten();
    unavailableSafety[0] = makeRun({ repetition: 1, metrics: metrics({
      safetyBoundaryViolationCount: { availability: "unavailable", reason: "collector_source_missing" },
    }) });
    expect(evaluateComputerFlowBatch(unavailableSafety, key).scenarios[0]!.gateStatus).toBe("incomplete");

    const unavailable = ten();
    unavailable[0] = makeRun({ repetition: 1, assertions: requiredAssertions("open-focus-verify", "runtime").map((assertion, index) =>
      index === 0 ? { assertion: assertion.assertion, status: "unavailable", reason: "collector_source_missing" } : assertion) });
    expect(evaluateComputerFlowBatch(unavailable, key).scenarios[0]).toMatchObject({ gateStatus: "incomplete", requiredAssertionUnavailableCount: 1 });
  });

  it("keeps all recorded values for median and nearest-rank p90 and treats blocked samples as incomplete", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    const withOutlier = values.map((value, index) => makeRun({
      repetition: index + 1,
      metrics: metrics({ endToEndDurationMs: metric(value) }),
    }));
    expect(evaluateComputerFlowBatch(withOutlier, key).scenarios[0]).toMatchObject({
      medianEndToEndDurationMs: metric(5.5),
      p90EndToEndDurationMs: metric(9),
    });

    for (const disposition of ["precondition_blocked", "deployment_pending"] as const) {
      const runs = ten();
      runs[0] = makeRun({ repetition: 1, disposition });
      expect(evaluateComputerFlowBatch(runs, key).scenarios[0]!.gateStatus).toBe("incomplete");
    }
  });

  it("requires exactly 60 recorded runs for a full six-scenario Runtime gate and enforces 57/60", () => {
    const scenarioIds = [
      "open-focus-verify",
      "batched-multi-control-form",
      "scoped-nested-scrolling",
      "stale-dynamic-target-recovery",
      "weak-ax-ocr-visual-point",
      "native-macos-fixture-workflow",
    ] as const;
    const sixty = scenarioIds.flatMap((scenarioId) => ten({ scenarioId }));
    expect(evaluateComputerFlowBatch(sixty, key).fullTierGateStatus).toBe("pass");

    const fiftySeven = [...sixty];
    for (const index of [0, 10, 20]) {
      const run = fiftySeven[index]!;
      fiftySeven[index] = makeRun({ scenarioId: run.scenarioId, repetition: run.repetition, disposition: "invalid" });
    }
    expect(evaluateComputerFlowBatch(fiftySeven, key)).toMatchObject({
      eligibleSuccessCount: 57,
      fullTierGateStatus: "pass",
    });

    const fiftySix = [...sixty];
    for (const index of [0, 10, 20, 30]) {
      const run = fiftySix[index]!;
      fiftySix[index] = makeRun({ scenarioId: run.scenarioId, repetition: run.repetition, disposition: "invalid" });
    }
    expect(evaluateComputerFlowBatch(fiftySix, key)).toMatchObject({
      eligibleSuccessCount: 56,
      fullTierGateStatus: "fail",
    });
  });

  it("rejects bad signatures before arithmetic", () => {
    const tampered = ten();
    tampered[0]!.metrics.runtimeDurationMs = metric(999);
    expect(() => evaluateComputerFlowBatch(tampered, key)).toThrow(/signature/i);
    expect(() => evaluateComputerFlowBatch(ten(), new TextEncoder().encode("fedcba9876543210fedcba9876543210"))).toThrow(/signature/i);

    const baselineRuns = ten({ mode: "agent", runtimeBuild: baselineBuild });
    const candidateRuns = ten({ mode: "agent", runtimeBuild: candidateBuild });
    candidateRuns[0]!.metrics.modelRoundTripCount = metric(99);
    const comparison = {
      objectiveRule: "flow_boundary" as const,
      mode: "agent" as const,
      scenarioId: "open-focus-verify" as const,
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns,
      candidateRuns,
    };
    expect(() => compareComputerFlowRuns(comparison, key)).toThrow(/signature/i);
    expect(() => compareComputerFlowRuns({ ...comparison, candidateRuns: ten({ mode: "agent", runtimeBuild: candidateBuild }) }, new TextEncoder().encode("fedcba9876543210fedcba9876543210"))).toThrow(/signature/i);
  });

  it("rejects version/build/pairing mismatches and unavailable objective metrics", () => {
    const baselineRuns = ten({ mode: "agent", runtimeBuild: baselineBuild });
    const candidateRuns = ten({ mode: "agent", runtimeBuild: candidateBuild });

    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: baselineBuild,
      baselineRuns,
      candidateRuns: ten({ mode: "agent", runtimeBuild: baselineBuild }),
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "same_build_identity" });

    const badTopLevel = { ...candidateBuild, buildId: "0".repeat(64) };
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: badTopLevel,
      baselineRuns,
      candidateRuns,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "build_identity_mismatch" });

    const embeddedMismatch = [...baselineRuns];
    embeddedMismatch[0] = makeRun({ repetition: 1, mode: "agent", runtimeBuild: build("c") });
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: embeddedMismatch,
      candidateRuns,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "build_identity_mismatch" });

    const versionMismatch = [...candidateRuns];
    const { collectorSignature: _signature, ...unsignedCandidate } = candidateRuns[0]!;
    versionMismatch[0] = signComputerFlowRun({ ...unsignedCandidate, schemaVersion: 2 } as never, key);
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns,
      candidateRuns: versionMismatch,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "version_mismatch" });

    const badPairing = candidateRuns.map((run, index) => index === 0 ? makeRun({ repetition: 99, mode: "agent", runtimeBuild: candidateBuild }) : run);
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns,
      candidateRuns: badPairing,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "invalid_pairing" });

    const duplicateBaseline = [...baselineRuns];
    const duplicateCandidate = [...candidateRuns];
    duplicateBaseline[9] = makeRun({ repetition: 9, mode: "agent", runtimeBuild: baselineBuild });
    duplicateCandidate[9] = makeRun({ repetition: 9, mode: "agent", runtimeBuild: candidateBuild });
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: duplicateBaseline,
      candidateRuns: duplicateCandidate,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "invalid_pairing" });

    const unavailable = ten({ mode: "agent", runtimeBuild: candidateBuild, metrics: metrics({
      endToEndDurationMs: { availability: "unavailable", reason: "missing_turn_correlation" },
      modelRoundTripCount: { availability: "unavailable", reason: "missing_turn_correlation" },
    }) });
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns,
      candidateRuns: unavailable,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "metric_unavailable" });
  });

  it("applies exact flow and runtime latency objective thresholds", () => {
    const agentBaseline = ten({ mode: "agent", runtimeBuild: baselineBuild, metrics: metrics({ endToEndDurationMs: metric(100), modelRoundTripCount: metric(3) }) });
    const agentCandidate = ten({ mode: "agent", runtimeBuild: candidateBuild, metrics: metrics({ endToEndDurationMs: metric(90), modelRoundTripCount: metric(2) }) });
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_boundary",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: agentBaseline,
      candidateRuns: agentCandidate,
    }, key).status).toBe("pass");
    expect(compareComputerFlowRuns({
      objectiveRule: "flow_latency",
      mode: "agent",
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: agentBaseline,
      candidateRuns: agentCandidate,
    }, key).status).toBe("pass");

    const runtimeBaseline = ten({ runtimeBuild: baselineBuild, metrics: metrics({ runtimeDurationMs: metric(100) }) });
    const runtimeCandidate = ten({ runtimeBuild: candidateBuild, metrics: metrics({ runtimeDurationMs: metric(75) }) });
    expect(compareComputerFlowRuns({
      objectiveRule: "runtime_latency",
      mode: "runtime",
      selector: { kind: "runtime_total" },
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: runtimeBaseline,
      candidateRuns: runtimeCandidate,
    }, key).status).toBe("pass");
  });

  it("requires a complete signed non-target reliability regression guard", () => {
    const targetBaseline = ten({ runtimeBuild: baselineBuild }).map((run, index) => index < 2 ? makeRun({ repetition: index + 1, runtimeBuild: baselineBuild, failureCategory: "timeout" }) : run);
    const targetCandidate = ten({ runtimeBuild: candidateBuild });
    const guardScenario = "batched-multi-control-form" as const;
    const guard = {
      baselineOtherScenarioRuns: ten({ scenarioId: guardScenario, runtimeBuild: baselineBuild }),
      candidateOtherScenarioRuns: ten({ scenarioId: guardScenario, runtimeBuild: candidateBuild }),
    };
    expect(compareComputerFlowRuns({
      objectiveRule: "reliability_defect",
      mode: "runtime",
      failureCategory: "timeout",
      regressionGuard: guard,
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: targetBaseline,
      candidateRuns: targetCandidate,
    }, key)).toMatchObject({ status: "pass", baselineFailureCount: 2, candidateFailureCount: 0, otherScenarioFloorRegressionCount: 0 });

    expect(compareComputerFlowRuns({
      objectiveRule: "reliability_defect",
      mode: "runtime",
      failureCategory: "timeout",
      regressionGuard: { ...guard, candidateOtherScenarioRuns: guard.candidateOtherScenarioRuns.slice(0, 9) },
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: targetBaseline,
      candidateRuns: targetCandidate,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "regression_guard_incomplete" });

    expect(compareComputerFlowRuns({
      objectiveRule: "reliability_defect",
      mode: "runtime",
      failureCategory: "timeout",
      regressionGuard: {
        baselineOtherScenarioRuns: guard.baselineOtherScenarioRuns,
        candidateOtherScenarioRuns: ten({ scenarioId: "scoped-nested-scrolling", runtimeBuild: candidateBuild }),
      },
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: targetBaseline,
      candidateRuns: targetCandidate,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "regression_guard_incomplete" });

    const versionGuard = [...guard.candidateOtherScenarioRuns];
    const { collectorSignature: _guardSignature, ...unsignedGuard } = versionGuard[0]!;
    versionGuard[0] = signComputerFlowRun({ ...unsignedGuard, schemaVersion: 2 } as never, key);
    expect(compareComputerFlowRuns({
      objectiveRule: "reliability_defect",
      mode: "runtime",
      failureCategory: "timeout",
      regressionGuard: { ...guard, candidateOtherScenarioRuns: versionGuard },
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: targetBaseline,
      candidateRuns: targetCandidate,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "regression_guard_incomplete" });

    const duplicateRepetitionGuard = [...guard.candidateOtherScenarioRuns];
    duplicateRepetitionGuard[9] = makeRun({ repetition: 9, scenarioId: guardScenario, runtimeBuild: candidateBuild });
    expect(compareComputerFlowRuns({
      objectiveRule: "reliability_defect",
      mode: "runtime",
      failureCategory: "timeout",
      regressionGuard: { ...guard, candidateOtherScenarioRuns: duplicateRepetitionGuard },
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: targetBaseline,
      candidateRuns: targetCandidate,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "regression_guard_incomplete" });

    const wrongMachineGuard = ten({ scenarioId: guardScenario, runtimeBuild: candidateBuild, machineClassId: "n".repeat(64) });
    expect(compareComputerFlowRuns({
      objectiveRule: "reliability_defect",
      mode: "runtime",
      failureCategory: "timeout",
      regressionGuard: { ...guard, candidateOtherScenarioRuns: wrongMachineGuard },
      scenarioId: "open-focus-verify",
      baselineRuntimeBuild: baselineBuild,
      candidateRuntimeBuild: candidateBuild,
      baselineRuns: targetBaseline,
      candidateRuns: targetCandidate,
    }, key)).toMatchObject({ status: "ineligible", ineligibleReason: "machine_class_mismatch" });
  });

  it("rejects assertion evidence from a source not declared by the scenario", () => {
    const invalid = ten();
    const assertions = requiredAssertions("open-focus-verify", "runtime");
    assertions[0] = {
      assertion: "completion_oracle",
      status: "pass",
      source: "runtime_trace",
      evidenceDigest: "f".repeat(64),
    };
    invalid[0] = makeRun({ repetition: 1, assertions });
    expect(() => evaluateComputerFlowBatch(invalid, key)).toThrow(/source|provenance/i);
  });
});
