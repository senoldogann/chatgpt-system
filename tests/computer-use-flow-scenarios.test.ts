import { describe, expect, it } from "vitest";
import { COMPUTER_ERROR_MESSAGES, type ComputerErrorCode } from "../src/computer/computer-errors.js";
import type { ComputerScrollUntilVisibleResult } from "../src/computer/computer-types.js";
import {
  COMPUTER_FLOW_ERROR_MAP,
  COMPUTER_FLOW_SCROLL_STATE_MAP,
  mapComputerErrorCode,
  mapComputerScrollState,
  mapObservedComputerAuditEvent,
} from "../benchmarks/computer-use-flow-performance/mappings.js";
import { COMPUTER_FLOW_SCENARIO_IDS } from "../benchmarks/computer-use-flow-performance/contract.js";
import { COMPUTER_FLOW_SCENARIOS, getComputerFlowScenario } from "../benchmarks/computer-use-flow-performance/scenarios.js";

const expectedRules = {
  "open-focus-verify": [
    ["completion_oracle", ["web_fixture_oracle"], true, true],
    ["wrong_app_input_absent", ["runtime_trace"], true, true],
    ["browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
    ["chrome_process_preserved", ["host_process_oracle"], true, true],
  ],
  "batched-multi-control-form": [
    ["completion_oracle", ["web_fixture_oracle"], true, true],
    ["wrong_app_input_absent", ["runtime_trace"], true, true],
    ["false_verified_absent", ["runtime_result"], true, true],
    ["safety_boundary_violation_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
    ["browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
  ],
  "scoped-nested-scrolling": [
    ["completion_oracle", ["web_fixture_oracle"], true, true],
    ["unchanged_scroll_repeat_absent", ["web_fixture_oracle", "runtime_trace", "trusted_mcp_trace"], true, true],
    ["wrong_app_input_absent", ["runtime_trace"], true, true],
    ["browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
  ],
  "stale-dynamic-target-recovery": [
    ["completion_oracle", ["web_fixture_oracle"], true, true],
    ["recovery_contract_satisfied", ["runtime_trace", "trusted_mcp_trace"], true, true],
    ["wrong_app_input_absent", ["runtime_trace"], true, true],
    ["false_verified_absent", ["runtime_result"], true, true],
    ["safety_boundary_violation_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
    ["browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
  ],
  "weak-ax-ocr-visual-point": [
    ["completion_oracle", ["web_fixture_oracle"], true, true],
    ["recovery_contract_satisfied", ["runtime_trace", "trusted_mcp_trace"], true, true],
    ["blind_point_repeat_absent", ["web_fixture_oracle", "runtime_trace"], true, true],
    ["false_verified_absent", ["runtime_result"], true, true],
    ["wrong_app_input_absent", ["runtime_trace"], true, true],
    ["browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
  ],
  "native-macos-fixture-workflow": [
    ["completion_oracle", ["native_fixture_oracle"], true, true],
    ["wrong_app_input_absent", ["runtime_trace"], true, true],
    ["post_takeover_input_absent", ["runtime_trace"], true, true],
    ["false_verified_absent", ["runtime_result"], true, true],
    ["safety_boundary_violation_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
    ["browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"], true, true],
  ],
} as const;

const expectedRecovery = {
  "open-focus-verify": ["focus_refused", "permission_blocked", "unavailable", "timeout"],
  "batched-multi-control-form": ["focus_refused", "verification_failed", "timeout", "permission_blocked", "unavailable"],
  "scoped-nested-scrolling": ["boundary_reached", "needs_replan", "focus_refused", "target_not_found"],
  "stale-dynamic-target-recovery": ["stale_refused", "fresh_observe", "target_ambiguous", "focus_refused", "timeout"],
  "weak-ax-ocr-visual-point": ["target_not_found", "ocr_fallback", "single_visual_point_attempt", "needs_replan", "verification_failed"],
  "native-macos-fixture-workflow": ["focus_refused", "takeover_refused", "permission_blocked", "unavailable", "verification_failed"],
} as const;

describe("computer flow scenarios and mappings", () => {
  it("defines all six scenarios with literal assertion provenance and recovery outcomes", () => {
    expect(COMPUTER_FLOW_SCENARIOS.map((scenario) => scenario.id)).toEqual(COMPUTER_FLOW_SCENARIO_IDS);
    for (const scenarioId of COMPUTER_FLOW_SCENARIO_IDS) {
      const scenario = getComputerFlowScenario(scenarioId);
      expect(scenario.expectedRecoveryOutcomes).toEqual(expectedRecovery[scenarioId]);
      expect(scenario.assertionRules.map((rule) => [
        rule.assertion,
        rule.allowedSources,
        rule.runtimeRequired,
        rule.agentRequired,
      ])).toEqual(expectedRules[scenarioId]);
    }
  });

  it("keeps Scenario 4 and 5 recovery evidence load-bearing", () => {
    expect(getComputerFlowScenario("stale-dynamic-target-recovery").assertionRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ assertion: "recovery_contract_satisfied", runtimeRequired: true, agentRequired: true }),
    ]));
    expect(getComputerFlowScenario("weak-ax-ocr-visual-point").assertionRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ assertion: "recovery_contract_satisfied", runtimeRequired: true, agentRequired: true }),
    ]));
    expect(getComputerFlowScenario("stale-dynamic-target-recovery").expectedRecoveryOutcomes).toEqual(expect.arrayContaining(["stale_refused", "fresh_observe"]));
    expect(getComputerFlowScenario("weak-ax-ocr-visual-point").expectedRecoveryOutcomes).toEqual(expect.arrayContaining(["target_not_found", "ocr_fallback", "single_visual_point_attempt"]));
  });

  it("maps every current production error and bounded-scroll state exhaustively", () => {
    const productionCodes = Object.keys(COMPUTER_ERROR_MESSAGES).sort() as ComputerErrorCode[];
    expect(Object.keys(COMPUTER_FLOW_ERROR_MAP).sort()).toEqual(productionCodes);
    for (const code of productionCodes) expect(mapComputerErrorCode(code)).toEqual(COMPUTER_FLOW_ERROR_MAP[code]);

    const scrollStates: ComputerScrollUntilVisibleResult["state"][] = ["target_visible", "boundary_reached", "needs_replan"];
    expect(Object.keys(COMPUTER_FLOW_SCROLL_STATE_MAP).sort()).toEqual([...scrollStates].sort());
    for (const state of scrollStates) expect(mapComputerScrollState(state)).toEqual(COMPUTER_FLOW_SCROLL_STATE_MAP[state]);
  });

  it("maps observed audit success only to completed and rejects unknown observed strings", () => {
    expect(mapObservedComputerAuditEvent({ operation: "observe", outcome: "ok" })).toEqual({
      outcome: "completed",
      failureCategory: "none",
      recoveryOutcome: "operation_completed",
    });
    expect(mapObservedComputerAuditEvent({ operation: "scroll_until_visible", outcome: "ok", scrollState: "target_visible" })).toEqual({
      outcome: "completed",
      failureCategory: "none",
      recoveryOutcome: "target_visible",
    });
    expect(mapObservedComputerAuditEvent({ operation: "click", outcome: "error", errorCode: "POLICY_DENIED" })).toEqual({
      outcome: "blocked",
      failureCategory: "permission",
      recoveryOutcome: "permission_blocked",
    });
    expect(() => mapObservedComputerAuditEvent({ operation: "made_up", outcome: "ok" } as never)).toThrow();
    expect(() => mapObservedComputerAuditEvent({ operation: "click", outcome: "error", errorCode: "ALIEN" } as never)).toThrow();
    expect(() => mapObservedComputerAuditEvent({ operation: "scroll_until_visible", outcome: "ok", scrollState: "sideways" } as never)).toThrow();
  });
});
