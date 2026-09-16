import { describe, expect, it } from "vitest";
import {
  COMPUTER_FLOW_ASSERTIONS,
  COMPUTER_FLOW_ASSERTION_SOURCES,
  COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION,
  COMPUTER_FLOW_FIXTURE_VERSION,
  COMPUTER_FLOW_METRIC_RULES_VERSION,
  COMPUTER_FLOW_RUN_DISPOSITIONS,
  COMPUTER_FLOW_SCENARIO_VERSION,
  parseComputerFlowRunRecordJson,
  type ComputerFlowAssertion,
  type ComputerFlowMetrics,
  type ComputerFlowRunRecord,
} from "../benchmarks/computer-use-flow-performance/contract.js";
import {
  createEvidenceDigest,
  signComputerFlowRun,
  verifyComputerFlowRunSignature,
} from "../benchmarks/computer-use-flow-performance/canonical.js";

const key = new TextEncoder().encode("0123456789abcdef0123456789abcdef");

function zeroMetrics(): ComputerFlowMetrics {
  const available = { availability: "available", value: 0 } as const;
  return {
    endToEndDurationMs: available,
    timeToFirstUsableObservationMs: available,
    runtimeDurationMs: available,
    localActionProgramDurationMs: available,
    computerToolCallCount: available,
    modelRoundTripCount: available,
    nativeRpcCount: available,
    physicalActionCount: available,
    observationCount: available,
    screenshotCount: available,
    axTargetingCount: available,
    ocrTargetingCount: available,
    visualPointTargetingCount: available,
    retryCount: available,
    replanCount: available,
    verifiedCount: available,
    completedUnverifiedCount: available,
    wrongAppInputCount: available,
    blindRepeatedPointCount: available,
    unchangedScrollRepeatCount: available,
    safetyBoundaryViolationCount: available,
  };
}

function unsignedRun(assertions: ComputerFlowAssertion[]): Omit<ComputerFlowRunRecord, "collectorSignature"> {
  return {
    schemaVersion: 1,
    metricRulesVersion: 1,
    scenarioVersion: 1,
    fixtureVersion: 1,
    scenarioId: "open-focus-verify",
    mode: "runtime",
    tier: "tier1",
    runKind: "recorded",
    repetition: 1,
    runtimeBuild: {
      buildId: "build-a",
      gitCommit: "a".repeat(40),
      workingTreeDigest: "b".repeat(64),
      computerProtocolVersion: 1,
      typeScriptArtifactSha256: "c".repeat(64),
      nativeHelperExecutableSha256: "d".repeat(64),
    },
    machineClassId: "e".repeat(64),
    disposition: "eligible_completed",
    failureCategory: "none",
    events: [
      { sequence: 0, elapsedMs: 0, mode: "runtime", category: "workflow_start" },
      { sequence: 1, elapsedMs: 10, durationMs: 10, mode: "runtime", category: "tool_boundary", operation: "observe", outcome: "completed" },
      { sequence: 2, elapsedMs: 20, mode: "runtime", category: "workflow_end", outcome: "verified" },
    ],
    assertions,
    metrics: zeroMetrics(),
  };
}

describe("computer flow benchmark contract", () => {
  it("pins the versioned closed vocabulary", () => {
    expect(COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION).toBe(1);
    expect(COMPUTER_FLOW_METRIC_RULES_VERSION).toBe(1);
    expect(COMPUTER_FLOW_SCENARIO_VERSION).toBe(1);
    expect(COMPUTER_FLOW_FIXTURE_VERSION).toBe(1);
    expect(COMPUTER_FLOW_ASSERTIONS).toEqual(expect.arrayContaining([
      "recovery_contract_satisfied",
      "browser_runtime_absent",
    ]));
    expect(COMPUTER_FLOW_ASSERTION_SOURCES).toEqual(expect.arrayContaining([
      "host_process_oracle",
      "runtime_trace",
      "trusted_mcp_trace",
    ]));
    expect(COMPUTER_FLOW_RUN_DISPOSITIONS).toEqual([
      "eligible_completed",
      "precondition_blocked",
      "deployment_pending",
      "invalid",
    ]);
  });

  it("creates deterministic evidence digests and run signatures and rejects tampering", () => {
    const metadata = {
      version: 1,
      scenarioId: "open-focus-verify",
      mode: "runtime",
      assertion: "completion_oracle",
      status: "pass",
      source: "web_fixture_oracle",
      sourceSequence: 1,
      operation: "observe",
      outcome: "verified",
    } as const;
    expect(createEvidenceDigest(metadata, key)).toBe(createEvidenceDigest({ ...metadata }, key));

    const assertion: ComputerFlowAssertion = {
      assertion: "completion_oracle",
      status: "pass",
      source: "web_fixture_oracle",
      evidenceDigest: createEvidenceDigest(metadata, key),
    };
    const signed = signComputerFlowRun(unsignedRun([assertion]), key);
    expect(verifyComputerFlowRunSignature(signed, key)).toBe(true);
    expect(verifyComputerFlowRunSignature(signed, new TextEncoder().encode("fedcba9876543210fedcba9876543210"))).toBe(false);

    const metricTamper = structuredClone(signed);
    metricTamper.metrics.runtimeDurationMs = { availability: "available", value: 99 };
    expect(verifyComputerFlowRunSignature(metricTamper, key)).toBe(false);

    const eventTamper = structuredClone(signed);
    eventTamper.events[1]!.elapsedMs = 11;
    expect(verifyComputerFlowRunSignature(eventTamper, key)).toBe(false);

    const assertionTamper = structuredClone(signed);
    assertionTamper.assertions[0] = { ...assertionTamper.assertions[0]!, evidenceDigest: "0".repeat(64) } as ComputerFlowAssertion;
    expect(verifyComputerFlowRunSignature(assertionTamper, key)).toBe(false);
  });

  it("strictly rejects unavailable assertions with fabricated evidence and forbidden persisted fields", () => {
    const unavailable: ComputerFlowAssertion = {
      assertion: "browser_runtime_absent",
      status: "unavailable",
      reason: "lossy_audit_source",
    };
    const signed = signComputerFlowRun(unsignedRun([unavailable]), key);
    expect(parseComputerFlowRunRecordJson(JSON.stringify(signed))).toEqual(signed);

    expect(() => parseComputerFlowRunRecordJson(JSON.stringify({
      ...signed,
      assertions: [{ ...unavailable, source: "runtime_trace", evidenceDigest: "a".repeat(64) }],
    }))).toThrow();

    for (const forbidden of [
      "screenshot",
      "ocrText",
      "axText",
      "editableValue",
      "targetLabel",
      "typedText",
      "x",
      "y",
      "rawError",
      "secret",
      "authorityLeaseId",
    ]) {
      expect(() => parseComputerFlowRunRecordJson(JSON.stringify({ ...signed, [forbidden]: "forbidden" })), forbidden).toThrow();
    }
  });
});
