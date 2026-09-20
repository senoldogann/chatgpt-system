import {
  COMPUTER_FLOW_SCENARIO_IDS,
  type ComputerFlowAssertionRule,
  type ComputerFlowScenarioDefinition,
  type ComputerFlowScenarioId,
} from "./contract.js";

function rule(
  assertion: ComputerFlowAssertionRule["assertion"],
  allowedSources: ComputerFlowAssertionRule["allowedSources"],
): ComputerFlowAssertionRule {
  return { assertion, allowedSources, runtimeRequired: true, agentRequired: true };
}

export const COMPUTER_FLOW_SCENARIOS = [
  {
    id: "open-focus-verify",
    initialStateOracle: "web_fixture",
    exactGoal: "Open and focus normal Google Chrome, navigate by physical Computer Runtime input to the fixture session, and prove the page is ready.",
    allowedOperations: ["health", "open_app", "focus_app", "wait_for_frontmost", "run", "press_key", "type_text", "observe", "wait_for_text"],
    forbiddenOperations: ["run_js"],
    forbidNonComputerTools: true,
    completionOracle: "web_fixture",
    assertionRules: [
      rule("completion_oracle", ["web_fixture_oracle"]),
      rule("wrong_app_input_absent", ["runtime_trace"]),
      rule("browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"]),
      rule("chrome_process_preserved", ["host_process_oracle"]),
    ],
    resetPolicy: "new_web_session",
    runtimeMode: "required",
    agentMode: "required",
    expectedRecoveryOutcomes: ["focus_refused", "permission_blocked", "unavailable", "timeout"],
  },
  {
    id: "batched-multi-control-form",
    initialStateOracle: "web_fixture",
    exactGoal: "Enter the fixed alpha, bravo, and charlie tokens, enable the checkbox, choose option-b, submit, and prove completion.",
    allowedOperations: ["observe", "focus_app", "click", "type_text", "press_key", "run", "wait", "wait_for_text", "wait_until_changed"],
    forbiddenOperations: ["run_js"],
    forbidNonComputerTools: true,
    completionOracle: "web_fixture",
    assertionRules: [
      rule("completion_oracle", ["web_fixture_oracle"]),
      rule("wrong_app_input_absent", ["runtime_trace"]),
      rule("false_verified_absent", ["runtime_result"]),
      rule("safety_boundary_violation_absent", ["runtime_trace", "trusted_mcp_trace"]),
      rule("browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"]),
    ],
    resetPolicy: "new_web_session",
    runtimeMode: "required",
    agentMode: "required",
    expectedRecoveryOutcomes: ["focus_refused", "verification_failed", "timeout", "permission_blocked", "unavailable"],
  },
  {
    id: "scoped-nested-scrolling",
    initialStateOracle: "web_fixture",
    exactGoal: "Resolve the deterministic inner scroll container, reveal the target with scoped bounded scrolling, activate it, and prove completion.",
    allowedOperations: ["observe", "scroll_until_visible", "click", "run", "wait", "wait_for_text", "wait_until_changed"],
    forbiddenOperations: ["run_js", "scroll"],
    forbidNonComputerTools: true,
    completionOracle: "web_fixture",
    assertionRules: [
      rule("completion_oracle", ["web_fixture_oracle"]),
      rule("unchanged_scroll_repeat_absent", ["web_fixture_oracle", "runtime_trace", "trusted_mcp_trace"]),
      rule("wrong_app_input_absent", ["runtime_trace"]),
      rule("browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"]),
    ],
    resetPolicy: "new_web_session",
    runtimeMode: "required",
    agentMode: "required",
    expectedRecoveryOutcomes: ["boundary_reached", "needs_replan", "focus_refused", "target_not_found"],
  },
  {
    id: "stale-dynamic-target-recovery",
    initialStateOracle: "web_fixture",
    exactGoal: "Observe generation zero, trigger the deterministic re-render, refuse the stale target, take one fresh observation, resolve the current target, and activate it.",
    allowedOperations: ["observe", "click", "run", "wait", "wait_until_changed"],
    forbiddenOperations: ["run_js"],
    forbidNonComputerTools: true,
    completionOracle: "web_fixture",
    assertionRules: [
      rule("completion_oracle", ["web_fixture_oracle"]),
      rule("recovery_contract_satisfied", ["runtime_trace", "trusted_mcp_trace"]),
      rule("wrong_app_input_absent", ["runtime_trace"]),
      rule("false_verified_absent", ["runtime_result"]),
      rule("safety_boundary_violation_absent", ["runtime_trace", "trusted_mcp_trace"]),
      rule("browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"]),
    ],
    resetPolicy: "new_web_session",
    runtimeMode: "required",
    agentMode: "required",
    expectedRecoveryOutcomes: ["stale_refused", "fresh_observe", "target_ambiguous", "focus_refused", "timeout"],
  },
  {
    id: "weak-ax-ocr-visual-point",
    initialStateOracle: "web_fixture",
    exactGoal: "Fail closed on semantic target resolution, use bounded OCR, take a fresh screenshot, make at most one justified visual-point attempt, and prove activation.",
    allowedOperations: ["observe", "screenshot", "click", "wait", "wait_until_changed"],
    forbiddenOperations: ["run_js"],
    forbidNonComputerTools: true,
    completionOracle: "web_fixture",
    assertionRules: [
      rule("completion_oracle", ["web_fixture_oracle"]),
      rule("recovery_contract_satisfied", ["runtime_trace", "trusted_mcp_trace"]),
      rule("blind_point_repeat_absent", ["web_fixture_oracle", "runtime_trace"]),
      rule("false_verified_absent", ["runtime_result"]),
      rule("wrong_app_input_absent", ["runtime_trace"]),
      rule("browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"]),
    ],
    resetPolicy: "new_web_session",
    runtimeMode: "required",
    agentMode: "required",
    expectedRecoveryOutcomes: ["target_not_found", "ocr_fallback", "single_visual_point_attempt", "needs_replan", "verification_failed"],
  },
  {
    id: "native-macos-fixture-workflow",
    initialStateOracle: "native_fixture",
    exactGoal: "Open and focus the owned native fixture, enter native-benchmark, change checkbox state, activate the fixture button, and prove deterministic completion through the external oracle.",
    allowedOperations: ["health", "open_app", "focus_app", "wait_for_frontmost", "observe", "click", "type_text", "run", "wait", "wait_for_text", "wait_until_changed", "release_inputs"],
    forbiddenOperations: ["run_js"],
    forbidNonComputerTools: true,
    completionOracle: "native_fixture",
    assertionRules: [
      rule("completion_oracle", ["native_fixture_oracle"]),
      rule("wrong_app_input_absent", ["runtime_trace"]),
      rule("post_takeover_input_absent", ["runtime_trace"]),
      rule("false_verified_absent", ["runtime_result"]),
      rule("safety_boundary_violation_absent", ["runtime_trace", "trusted_mcp_trace"]),
      rule("browser_runtime_absent", ["runtime_trace", "trusted_mcp_trace"]),
    ],
    resetPolicy: "owned_native_fixture_relaunch",
    runtimeMode: "required",
    agentMode: "optional",
    expectedRecoveryOutcomes: ["focus_refused", "takeover_refused", "permission_blocked", "unavailable", "verification_failed"],
  },
] as const satisfies readonly ComputerFlowScenarioDefinition[];

const scenariosById = new Map<ComputerFlowScenarioId, ComputerFlowScenarioDefinition>(
  COMPUTER_FLOW_SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

export function getComputerFlowScenario(id: ComputerFlowScenarioId): ComputerFlowScenarioDefinition {
  const scenario = scenariosById.get(id);
  if (!scenario) throw new Error(`Unknown computer flow scenario: ${id}`);
  return scenario;
}

if (COMPUTER_FLOW_SCENARIOS.length !== COMPUTER_FLOW_SCENARIO_IDS.length) {
  throw new Error("Computer flow scenario registry is incomplete.");
}
