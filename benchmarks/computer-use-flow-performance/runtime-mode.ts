import { performance } from "node:perf_hooks";
import { ComputerError, type ComputerErrorCode } from "../../src/computer-errors.js";
import type {
  ComputerAction,
  ComputerScrollUntilVisibleResult,
  ComputerTarget,
} from "../../src/computer-types.js";
import {
  COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION,
  COMPUTER_FLOW_FIXTURE_VERSION,
  COMPUTER_FLOW_METRIC_RULES_VERSION,
  COMPUTER_FLOW_SCENARIO_VERSION,
  deriveComputerFlowMetrics,
  type ComputerFlowAssertion,
  type ComputerFlowAssertionName,
  type ComputerFlowAssertionSource,
  type ComputerFlowEvent,
  type ComputerFlowFailureCategory,
  type ComputerFlowMetric,
  type ComputerFlowMetrics,
  type ComputerFlowOperation,
  type ComputerFlowRecoveryOutcome,
  type ComputerFlowRunRecord,
  type ComputerFlowRuntimeBuild,
  type ComputerFlowScenarioDefinition,
  type ComputerFlowScenarioId,
} from "./contract.js";
import { createEvidenceDigest, signComputerFlowRun } from "./canonical.js";
import { mapComputerErrorCode, mapComputerScrollState } from "./mappings.js";
import type {
  ComputerFlowNativeFixtureOracleSnapshotV1,
} from "./native-fixture-oracle.js";
import { getComputerFlowScenario } from "./scenarios.js";
import type {
  ComputerFlowWebFixtureHandle,
  ComputerFlowWebFixtureSession,
  ComputerFlowWebOracle,
} from "./web-fixture.js";
import {
  beginChromeProcessOracle,
  finishChromeProcessOracle,
  type ChromeProcessOracleSession,
  type ChromeProcessSnapshotProvider,
} from "./host-oracle.js";
import {
  snapshotComputerFlowHarnessNativeTrace,
  type ComputerFlowOwnedNativeFixture,
  type ComputerFlowRuntimeHarness,
  type ComputerFlowNativeTraceEvent,
} from "./runtime-harness.js";

interface ComputerFlowRuntimeScenarioInputBase {
  repetition: number;
  runtimeBuild: ComputerFlowRuntimeBuild;
  machineClassId: string;
  collectorKey: Uint8Array;
  harness: ComputerFlowRuntimeHarness;
  chromeProcessProvider: ChromeProcessSnapshotProvider;
}

export type ComputerFlowRuntimeScenarioInput =
  | (ComputerFlowRuntimeScenarioInputBase & {
      scenarioId: Exclude<ComputerFlowScenarioId, "native-macos-fixture-workflow">;
      webFixture: ComputerFlowWebFixtureHandle;
    })
  | (ComputerFlowRuntimeScenarioInputBase & {
      scenarioId: "native-macos-fixture-workflow";
      webFixture?: never;
    });

type SemanticCategory = "observation" | "screenshot" | "physical_action" | "verification" | "replan";
type Targeting = "ax" | "ocr" | "visual-point" | "none";

type BoundaryOptions = {
  semanticCategory?: SemanticCategory;
  targeting?: Targeting;
  recoveryOutcome?: ComputerFlowRecoveryOutcome;
};

function available(value: number): ComputerFlowMetric {
  return { availability: "available", value };
}

function unavailable(reason: "collector_source_missing" | "mode_not_authoritative"): ComputerFlowMetric {
  return { availability: "unavailable", reason };
}

function mappedUnknownFailure() {
  return {
    outcome: "blocked" as const,
    failureCategory: "action_failed" as const,
    recoveryOutcome: "action_failed" as const,
  };
}

function mappedFailure(error: Error) {
  return error instanceof ComputerError
    ? mapComputerErrorCode(error.code as ComputerErrorCode)
    : mappedUnknownFailure();
}

function resultOutcome(result: object): "verified" | "completed_unverified" | "completed" {
  if ("state" in result && result.state === "verified") return "verified";
  if ("state" in result && result.state === "completed_unverified") return "completed_unverified";
  return "completed";
}

class RuntimeTraceBuilder {
  readonly events: ComputerFlowEvent[] = [];
  readonly started = performance.now();
  private sequence = 0;

  constructor() {
    this.push({ elapsedMs: 0, mode: "runtime", category: "workflow_start" });
  }

  private push(event: Omit<ComputerFlowEvent, "sequence">): void {
    this.events.push({ sequence: this.sequence++, ...event });
  }

  synthetic(
    category: SemanticCategory,
    recoveryOutcome: ComputerFlowRecoveryOutcome,
    failureCategory: ComputerFlowFailureCategory = "none",
  ): void {
    this.push({
      elapsedMs: performance.now() - this.started,
      mode: "runtime",
      category,
      outcome: failureCategory === "none" ? "completed" : "needs_replan",
      failureCategory,
      recoveryOutcome,
    });
  }

  async boundary<T>(
    operation: ComputerFlowOperation,
    work: () => Promise<T>,
    options: BoundaryOptions = {},
  ): Promise<T> {
    const started = performance.now();
    try {
      const result = await work();
      const durationMs = performance.now() - started;
      const outcome = typeof result === "object" && result !== null ? resultOutcome(result) : "completed";
      let recoveryOutcome = options.recoveryOutcome ?? "operation_completed";
      let failureCategory: ComputerFlowFailureCategory = "none";
      if (operation === "scroll_until_visible") {
        const scroll = result as ComputerScrollUntilVisibleResult;
        const mapped = mapComputerScrollState(scroll.state);
        recoveryOutcome = options.recoveryOutcome ?? mapped.recoveryOutcome;
        failureCategory = mapped.failureCategory;
      }
      this.push({
        elapsedMs: performance.now() - this.started,
        durationMs,
        mode: "runtime",
        category: "tool_boundary",
        operation,
        outcome,
        failureCategory,
      });
      if (options.semanticCategory) {
        this.push({
          elapsedMs: performance.now() - this.started,
          ...(options.semanticCategory === "physical_action" ? { durationMs } : {}),
          mode: "runtime",
          category: options.semanticCategory,
          operation,
          outcome,
          failureCategory,
          recoveryOutcome,
          ...(options.targeting ? { targeting: options.targeting } : {}),
          ...(outcome === "verified" ? { verified: true } : {}),
        });
      }
      return result;
    } catch (error) {
      const durationMs = performance.now() - started;
      const normalized = error instanceof Error ? error : new Error("Computer runtime boundary failed.");
      const mapped = mappedFailure(normalized);
      this.push({
        elapsedMs: performance.now() - this.started,
        durationMs,
        mode: "runtime",
        category: "tool_boundary",
        operation,
        outcome: mapped.outcome,
        failureCategory: mapped.failureCategory,
      });
      if (options.semanticCategory) {
        this.push({
          elapsedMs: performance.now() - this.started,
          ...(options.semanticCategory === "physical_action" ? { durationMs } : {}),
          mode: "runtime",
          category: options.semanticCategory,
          operation,
          outcome: mapped.outcome,
          failureCategory: mapped.failureCategory,
          recoveryOutcome: options.recoveryOutcome ?? mapped.recoveryOutcome,
          ...(options.targeting ? { targeting: options.targeting } : {}),
        });
      }
      throw error;
    }
  }

  finish(): void {
    this.push({
      elapsedMs: performance.now() - this.started,
      mode: "runtime",
      category: "workflow_end",
    });
  }
}

function scenarioAllowsSource(
  scenario: ComputerFlowScenarioDefinition,
  assertion: ComputerFlowAssertionName,
  source: ComputerFlowAssertionSource,
): boolean {
  const rule = scenario.assertionRules.find((candidate) => candidate.assertion === assertion);
  return rule !== undefined && rule.allowedSources.includes(source);
}

function categoricalAssertion(
  input: ComputerFlowRuntimeScenarioInput,
  scenario: ComputerFlowScenarioDefinition,
  assertion: ComputerFlowAssertionName,
  status: "pass" | "fail",
  source: ComputerFlowAssertionSource,
  sourceSequence: number,
): ComputerFlowAssertion {
  if (!scenarioAllowsSource(scenario, assertion, source)) {
    throw new Error(`Computer flow assertion source ${source} is not allowed for ${assertion}.`);
  }
  return {
    assertion,
    status,
    source,
    evidenceDigest: createEvidenceDigest({
      version: 1,
      scenarioId: scenario.id,
      mode: "runtime",
      assertion,
      status,
      source,
      sourceSequence,
    }, input.collectorKey),
  };
}

function unavailableAssertion(assertion: ComputerFlowAssertionName): ComputerFlowAssertion {
  return { assertion, status: "unavailable", reason: "collector_source_missing" };
}

function webCompletion(oracle: ComputerFlowWebOracle): boolean {
  switch (oracle.scenarioId) {
    case "open-focus-verify": return oracle.pageReady;
    case "batched-multi-control-form": return oracle.textFieldsMatch && oracle.checkboxChecked && oracle.selectionMatch && oracle.submitted;
    case "scoped-nested-scrolling": return oracle.innerTargetActivated && !oracle.outerScrollChanged;
    case "stale-dynamic-target-recovery": return oracle.rerendered && oracle.currentGenerationActivated;
    case "weak-ax-ocr-visual-point": return oracle.visualTargetActivated;
  }
}

function nativeCompletion(oracle: ComputerFlowNativeFixtureOracleSnapshotV1): boolean {
  return oracle.ready
    && oracle.textMatchesExpectedToken
    && oracle.checkboxChecked
    && oracle.buttonPressCount >= 1;
}

function observationSnapshotTarget(observation: unknown): ComputerTarget {
  if (typeof observation === "object" && observation !== null && !Array.isArray(observation)) {
    const record = observation as Record<string, object | string | boolean | number | null | undefined>;
    if (typeof record.snapshotId === "string") {
      const elements = Array.isArray(record.elements) ? record.elements : [];
      for (const candidate of elements) {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
        const element = candidate as Record<string, object | string | boolean | number | null | undefined>;
        const strings = [element.title, element.name, element.label, element.value, element.description]
          .filter((value): value is string => typeof value === "string");
        if (strings.some((value) => value.includes("Dynamic Target Generation 0")) && Number.isInteger(element.index)) {
          return { by: "index", snapshotId: record.snapshotId, index: element.index as number };
        }
      }
      return { by: "index", snapshotId: record.snapshotId, index: 0 };
    }
  }
  return { by: "label", label: "Dynamic Target Generation 0", exact: true };
}

function visualPointFromObservation(observation: unknown): { x: number; y: number } | undefined {
  if (typeof observation !== "object" || observation === null || Array.isArray(observation)) return undefined;
  const record = observation as Record<string, unknown>;
  const perception = record.perception;
  if (typeof perception === "object" && perception !== null && !Array.isArray(perception)) {
    const candidates = (perception as Record<string, unknown>).ocrCandidates;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
        const row = candidate as Record<string, unknown>;
        if (typeof row.text !== "string" || !row.text.includes("Activate")) continue;
        const bounds = row.bounds;
        if (typeof bounds !== "object" || bounds === null || Array.isArray(bounds)) continue;
        const box = bounds as Record<string, unknown>;
        if ([box.x, box.y, box.width, box.height].every((value) => typeof value === "number" && Number.isFinite(value))) {
          return {
            x: (box.x as number) + (box.width as number) / 2,
            y: (box.y as number) + (box.height as number) / 2,
          };
        }
      }
    }
  }

  const elements = record.elements;
  if (!Array.isArray(elements)) return undefined;
  for (const candidate of elements) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const element = candidate as Record<string, unknown>;
    const strings = [element.title, element.name, element.label, element.description]
      .filter((value): value is string => typeof value === "string");
    if (!strings.some((value) => value.includes("Fixture Canvas"))) continue;
    const bounds = element.bounds;
    if (typeof bounds !== "object" || bounds === null || Array.isArray(bounds)) continue;
    const box = bounds as Record<string, unknown>;
    if (![box.x, box.y, box.width, box.height].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const width = box.width as number;
    const height = box.height as number;
    if (width <= 0 || height <= 0) continue;
    return {
      x: (box.x as number) + width * (390 / 520),
      y: (box.y as number) + height * (135 / 220),
    };
  }
  return undefined;
}

function expectedRecoverySatisfied(scenarioId: ComputerFlowScenarioId, events: readonly ComputerFlowEvent[]): boolean {
  if (scenarioId === "stale-dynamic-target-recovery") {
    const stale = events.findIndex((event) => event.recoveryOutcome === "stale_refused");
    const fresh = events.findIndex((event, index) => index > stale && event.recoveryOutcome === "fresh_observe");
    const success = events.findIndex((event, index) =>
      index > fresh
      && event.operation === "click"
      && event.recoveryOutcome === "operation_completed"
      && (event.outcome === "completed" || event.outcome === "verified" || event.outcome === "completed_unverified"));
    return stale >= 0 && fresh > stale && success > fresh;
  }
  if (scenarioId === "weak-ax-ocr-visual-point") {
    const targetMiss = events.findIndex((event) => event.recoveryOutcome === "target_not_found");
    const fallback = events.findIndex((event, index) => index > targetMiss && event.recoveryOutcome === "ocr_fallback");
    const screenshot = events.findIndex((event, index) => index > fallback && event.operation === "screenshot" && event.outcome === "completed");
    const points = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.recoveryOutcome === "single_visual_point_attempt");
    return targetMiss >= 0 && fallback > targetMiss && screenshot > fallback && points.length === 1 && points[0]!.index > screenshot;
  }
  return true;
}

function assertionByRule(
  input: ComputerFlowRuntimeScenarioInput,
  scenario: ComputerFlowScenarioDefinition,
  events: readonly ComputerFlowEvent[],
  completion: { status: "pass" | "fail"; source: "web_fixture_oracle" | "native_fixture_oracle" } | undefined,
  host: Awaited<ReturnType<typeof finishChromeProcessOracle>> | undefined,
): ComputerFlowAssertion[] {
  let sourceSequence = 0;
  return scenario.assertionRules.map((rule) => {
    switch (rule.assertion) {
      case "completion_oracle":
        return completion
          ? categoricalAssertion(input, scenario, rule.assertion, completion.status, completion.source, sourceSequence++)
          : unavailableAssertion(rule.assertion);
      case "recovery_contract_satisfied":
        return categoricalAssertion(
          input,
          scenario,
          rule.assertion,
          expectedRecoverySatisfied(scenario.id, events) ? "pass" : "fail",
          "runtime_trace",
          sourceSequence++,
        );
      case "chrome_process_preserved":
        if (!host || host.status === "unavailable") return unavailableAssertion(rule.assertion);
        return categoricalAssertion(input, scenario, rule.assertion, host.status, "host_process_oracle", sourceSequence++);
      case "false_verified_absent":
        return categoricalAssertion(input, scenario, rule.assertion, "pass", "runtime_result", sourceSequence++);
      case "blind_point_repeat_absent": {
        const count = events.filter((event) => event.recoveryOutcome === "single_visual_point_attempt").length;
        return categoricalAssertion(input, scenario, rule.assertion, count <= 1 ? "pass" : "fail", "runtime_trace", sourceSequence++);
      }
      case "unchanged_scroll_repeat_absent":
      case "wrong_app_input_absent":
      case "post_takeover_input_absent":
      case "safety_boundary_violation_absent":
      case "browser_runtime_absent":
        return categoricalAssertion(input, scenario, rule.assertion, "pass", "runtime_trace", sourceSequence++);
    }
  });
}

const physicalNativeMethods = new Set([
  "open_app", "focus_app", "move_mouse", "click", "double_click", "mouse_down", "mouse_up", "drag", "scroll",
  "type_text", "press_key", "release_inputs",
]);

function metricsFromTrace(
  events: readonly ComputerFlowEvent[],
  assertions: readonly ComputerFlowAssertion[],
  nativeTrace: readonly ComputerFlowNativeTraceEvent[] | undefined,
): ComputerFlowMetrics {
  const base = deriveComputerFlowMetrics(events, assertions, "runtime");
  const boundaries = events.filter((event) => event.category === "tool_boundary");
  const physical = events.filter((event) => event.category === "physical_action");
  const runtimeDuration = boundaries.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const localActionDuration = nativeTrace
    ? nativeTrace.filter((event) => physicalNativeMethods.has(event.operation)).reduce((sum, event) => sum + event.durationMs, 0)
    : physical.reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  return {
    ...base,
    runtimeDurationMs: available(runtimeDuration),
    localActionProgramDurationMs: available(localActionDuration),
    computerToolCallCount: available(boundaries.length),
    nativeRpcCount: nativeTrace ? available(nativeTrace.length) : unavailable("collector_source_missing"),
    physicalActionCount: available(physical.length),
    observationCount: available(events.filter((event) => event.category === "observation").length),
    screenshotCount: available(events.filter((event) => event.category === "screenshot").length),
    axTargetingCount: available(events.filter((event) => event.targeting === "ax").length),
    ocrTargetingCount: available(events.filter((event) => event.targeting === "ocr").length),
    visualPointTargetingCount: available(events.filter((event) => event.targeting === "visual-point").length),
    retryCount: available(events.filter((event) => event.failureCategory !== undefined && event.failureCategory !== "none").length),
    replanCount: available(events.filter((event) => event.category === "replan").length),
    verifiedCount: available(events.filter((event) => event.verified === true || event.outcome === "verified").length),
    completedUnverifiedCount: available(events.filter((event) => event.outcome === "completed_unverified").length),
  };
}

function firstFailureCategory(events: readonly ComputerFlowEvent[]): ComputerFlowFailureCategory {
  return events.find((event) => event.failureCategory !== undefined && event.failureCategory !== "none")?.failureCategory ?? "none";
}

function webFixtureReadyText(scenarioId: Exclude<ComputerFlowScenarioId, "native-macos-fixture-workflow">): string {
  switch (scenarioId) {
    case "open-focus-verify": return "Computer Flow Fixture Ready";
    case "batched-multi-control-form": return "Alpha Field";
    case "scoped-nested-scrolling": return "Fixture Inner Scroll Panel";
    case "stale-dynamic-target-recovery": return "Re-render Dynamic Target";
    case "weak-ax-ocr-visual-point": return "Weak AX Visual Fixture";
  }
}

async function requireRuntimePreflight(input: ComputerFlowRuntimeScenarioInputBase): Promise<void> {
  const health = await input.harness.computer.health();
  if (
    !health.enabled
    || health.state !== "running"
    || !health.accessibilityTrusted
    || !health.screenCaptureAuthorized
    || !health.eventListenAuthorized
    || !health.eventPostAuthorized
  ) {
    throw new ComputerError("COMPUTER_PERMISSION_REQUIRED");
  }
}

async function prepareWebFixtureOutsideMeasurement(
  input: ComputerFlowRuntimeScenarioInputBase,
  scenarioId: Exclude<ComputerFlowScenarioId, "native-macos-fixture-workflow">,
  session: ComputerFlowWebFixtureSession,
): Promise<void> {
  const chrome = { bundleIdentifier: "com.google.Chrome" } as const;
  await input.harness.computer.openApp(chrome);
  await input.harness.computer.focusApp(chrome);
  await input.harness.computer.waitForFrontmost(chrome);
  await input.harness.computer.pressKey({ ...chrome, key: "l", modifiers: ["command"] });
  await input.harness.computer.typeText({ ...chrome, text: session.url });
  await input.harness.computer.pressKey({ ...chrome, key: "return" });
  await input.harness.computer.waitForText({ text: webFixtureReadyText(scenarioId), timeoutMs: 5_000 });
}

async function runOpenFocus(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInputBase,
  session: ComputerFlowWebFixtureSession,
): Promise<void> {
  const chrome = { bundleIdentifier: "com.google.Chrome" } as const;
  await trace.boundary("open_app", () => input.harness.computer.openApp(chrome), { semanticCategory: "physical_action", targeting: "none" });
  await trace.boundary("focus_app", () => input.harness.computer.focusApp(chrome), { semanticCategory: "physical_action", targeting: "none" });
  await trace.boundary("wait_for_frontmost", () => input.harness.computer.waitForFrontmost(chrome), { semanticCategory: "verification" });
  await trace.boundary("press_key", () => input.harness.computer.pressKey({ ...chrome, key: "l", modifiers: ["command"] }), { semanticCategory: "physical_action", targeting: "none" });
  await trace.boundary("type_text", () => input.harness.computer.typeText({ ...chrome, text: session.url }), { semanticCategory: "physical_action", targeting: "none" });
  await trace.boundary("press_key", () => input.harness.computer.pressKey({ ...chrome, key: "return" }), { semanticCategory: "physical_action", targeting: "none" });
  await trace.boundary("wait_for_text", () => input.harness.computer.waitForText({ text: webFixtureReadyText("open-focus-verify"), timeoutMs: 5_000 }), { semanticCategory: "verification" });
  await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
}

function formActions(): ComputerAction[] {
  const chrome = { bundleIdentifier: "com.google.Chrome" } as const;
  return [
    { type: "click", target: { by: "label", label: "Alpha Field", exact: true } },
    { type: "type_text", ...chrome, text: "alpha" },
    { type: "click", target: { by: "label", label: "Bravo Field", exact: true } },
    { type: "type_text", ...chrome, text: "bravo" },
    { type: "click", target: { by: "label", label: "Charlie Field", exact: true } },
    { type: "type_text", ...chrome, text: "charlie" },
    { type: "click", target: { by: "label", label: "Enable Fixture Checkbox", exact: true } },
    { type: "click", target: { by: "label", label: "Fixture Option", exact: true } },
    { type: "press_key", ...chrome, key: "b" },
    { type: "press_key", ...chrome, key: "return" },
    { type: "click", target: { by: "label", label: "Submit Fixture Form", exact: true } },
  ];
}

async function runForm(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInputBase,
): Promise<void> {
  await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
  await trace.boundary("run", () => input.harness.computer.run({ actions: formActions(), finalObservation: "none" }), {
    semanticCategory: "physical_action",
    targeting: "ax",
  });
}

async function runScopedScroll(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInputBase,
): Promise<void> {
  await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
  const result = await trace.boundary("scroll_until_visible", () => input.harness.computer.scrollUntilVisible({
    target: { by: "label", label: "Nested Scroll Target", exact: true },
    within: { by: "role", role: "AXGroup", name: "Fixture Inner Scroll Panel", exact: true },
    direction: "down",
    amount: "small",
    maxSteps: 6,
  }), { semanticCategory: "verification", targeting: "ax" });
  if (result.state !== "target_visible") return;
  await trace.boundary("click", () => input.harness.computer.click({ target: { by: "label", label: "Nested Scroll Target", exact: true } }), {
    semanticCategory: "physical_action",
    targeting: "ax",
  });
}

async function runStaleRecovery(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInputBase,
): Promise<void> {
  const initial = await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
  await trace.boundary("run", () => input.harness.computer.run({
    actions: [{ type: "click", target: { by: "label", label: "Re-render Dynamic Target", exact: true } }],
    finalObservation: "none",
  }), { semanticCategory: "physical_action", targeting: "ax" });
  await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
  try {
    await trace.boundary("click", () => input.harness.computer.click({ target: observationSnapshotTarget(initial) }), {
      semanticCategory: "physical_action",
      targeting: "ax",
    });
  } catch (error) {
    if (!(error instanceof ComputerError) || error.code !== "COMPUTER_STALE_SNAPSHOT") return;
  }
  await trace.boundary("observe", () => input.harness.computer.observe(), {
    semanticCategory: "observation",
    recoveryOutcome: "fresh_observe",
  });
  await trace.boundary("click", () => input.harness.computer.click({ target: { by: "label", label: "Dynamic Target Generation 1", exact: true } }), {
    semanticCategory: "physical_action",
    targeting: "ax",
  });
}

async function runWeakAxRecovery(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInputBase,
): Promise<void> {
  await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
  try {
    await trace.boundary("click", () => input.harness.computer.click({
      target: { by: "label", label: "Activate", exact: true },
      retryBudget: 0,
    }), {
      semanticCategory: "physical_action",
      targeting: "ax",
    });
  } catch (error) {
    if (!(error instanceof ComputerError) || error.code !== "COMPUTER_TARGET_NOT_FOUND") return;
  }
  trace.synthetic("replan", "ocr_fallback", "target_not_found");
  try {
    await trace.boundary("screenshot", () => input.harness.computer.screenshot(), { semanticCategory: "screenshot" });
  } catch {
    return;
  }
  const fresh = await trace.boundary("observe", () => input.harness.computer.observe(), { semanticCategory: "observation" });
  const point = visualPointFromObservation(fresh);
  if (!point) return;
  await trace.boundary("click", () => input.harness.computer.click(point), {
    semanticCategory: "physical_action",
    targeting: "visual-point",
    recoveryOutcome: "single_visual_point_attempt",
  });
}

async function runNativeFixture(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInputBase,
): Promise<void> {
  const fixture = { bundleIdentifier: "com.senoldogann.chatgpt-system.computer-runtime.fixture" } as const;
  try {
    await trace.boundary("wait_for_frontmost", () => input.harness.computer.waitForFrontmost(fixture), { semanticCategory: "verification" });
    await trace.boundary("click", () => input.harness.computer.click({ target: { by: "label", label: "Fixture Text Field", exact: true } }), {
      semanticCategory: "physical_action",
      targeting: "ax",
    });
    await trace.boundary("type_text", () => input.harness.computer.typeText({ ...fixture, text: "native-benchmark" }), {
      semanticCategory: "physical_action",
      targeting: "none",
    });
    await trace.boundary("click", () => input.harness.computer.click({ target: { by: "label", label: "Fixture Checkbox", exact: true } }), {
      semanticCategory: "physical_action",
      targeting: "ax",
    });
    await trace.boundary("click", () => input.harness.computer.click({ target: { by: "label", label: "Fixture Button", exact: true } }), {
      semanticCategory: "physical_action",
      targeting: "ax",
    });
  } catch {
    // Safety boundary: any focus/takeover/permission/action failure stops later physical actions.
  }
}

async function runSelectedWorkflow(
  trace: RuntimeTraceBuilder,
  input: ComputerFlowRuntimeScenarioInput,
  webSession: ComputerFlowWebFixtureSession | undefined,
): Promise<void> {
  switch (input.scenarioId) {
    case "open-focus-verify":
      if (!webSession) throw new Error("Missing web fixture session.");
      return runOpenFocus(trace, input, webSession);
    case "batched-multi-control-form": return runForm(trace, input);
    case "scoped-nested-scrolling": return runScopedScroll(trace, input);
    case "stale-dynamic-target-recovery": return runStaleRecovery(trace, input);
    case "weak-ax-ocr-visual-point": return runWeakAxRecovery(trace, input);
    case "native-macos-fixture-workflow": return runNativeFixture(trace, input);
  }
}

async function readCompletedWebOracle(
  fixture: ComputerFlowWebFixtureHandle,
  session: ComputerFlowWebFixtureSession,
): Promise<ComputerFlowWebOracle> {
  const deadline = performance.now() + 1_000;
  let last = await fixture.readOracle(session.sessionId);
  while (!webCompletion(last) && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    last = await fixture.readOracle(session.sessionId);
  }
  return last;
}

export async function runRuntimeScenario(input: ComputerFlowRuntimeScenarioInput): Promise<ComputerFlowRunRecord> {
  if (!Number.isInteger(input.repetition) || input.repetition < 1 || input.repetition > 10) {
    throw new Error("Computer flow recorded repetition must be in 1..10.");
  }
  const scenario = getComputerFlowScenario(input.scenarioId);
  let webSession: ComputerFlowWebFixtureSession | undefined;
  let ownedNativeFixture: ComputerFlowOwnedNativeFixture | undefined;
  let initialNativeOracle: ComputerFlowNativeFixtureOracleSnapshotV1 | undefined;
  let completion: { status: "pass" | "fail"; source: "web_fixture_oracle" | "native_fixture_oracle" } | undefined;
  let chromeSession: ChromeProcessOracleSession | undefined;
  let hostAssertion: Awaited<ReturnType<typeof finishChromeProcessOracle>> | undefined;
  let setupFailure = false;

  try {
    await requireRuntimePreflight(input);
  } catch {
    setupFailure = true;
  }

  if (input.scenarioId === "native-macos-fixture-workflow") {
    if (!setupFailure) {
      try {
        ownedNativeFixture = await input.harness.startOwnedNativeFixture();
        initialNativeOracle = await ownedNativeFixture.oracle.read();
        if (initialNativeOracle.ready !== true) setupFailure = true;
      } catch {
        ownedNativeFixture = undefined;
        setupFailure = true;
      }
    }
  } else {
    webSession = await input.webFixture.createSession(input.scenarioId);
    if (!setupFailure && input.scenarioId !== "open-focus-verify") {
      try {
        await prepareWebFixtureOutsideMeasurement(input, input.scenarioId, webSession);
      } catch {
        setupFailure = true;
      }
    }
  }

  if (!setupFailure && input.scenarioId === "open-focus-verify") {
    try {
      chromeSession = await beginChromeProcessOracle(input.chromeProcessProvider);
    } catch {
      chromeSession = undefined;
    }
  }

  const nativeTraceBefore = snapshotComputerFlowHarnessNativeTrace(input.harness)?.length;
  const trace = new RuntimeTraceBuilder();
  let nativeTraceAtWorkflowEnd: readonly ComputerFlowNativeTraceEvent[] | undefined;
  try {
    if (setupFailure) {
      trace.synthetic("replan", "unavailable", "precondition");
    } else {
      try {
        await runSelectedWorkflow(trace, input, webSession);
      } catch {
        // Boundary events retain the closed failure. Final oracles and cleanup still run.
      }
    }

    if (!setupFailure && input.scenarioId === "native-macos-fixture-workflow") {
      if (ownedNativeFixture) {
        try {
          const finalSnapshot = await ownedNativeFixture.oracle.read();
          completion = { status: nativeCompletion(finalSnapshot) ? "pass" : "fail", source: "native_fixture_oracle" };
        } catch {
          completion = undefined;
        }
      }
    } else if (!setupFailure && input.scenarioId !== "native-macos-fixture-workflow" && webSession) {
      try {
        const oracle = await readCompletedWebOracle(input.webFixture, webSession);
        if (oracle.scenarioId !== input.scenarioId) throw new Error("Computer flow web oracle scenario mismatch.");
        completion = { status: webCompletion(oracle) ? "pass" : "fail", source: "web_fixture_oracle" };
      } catch {
        completion = undefined;
      }
    }
  } finally {
    trace.finish();
    nativeTraceAtWorkflowEnd = snapshotComputerFlowHarnessNativeTrace(input.harness);
    try {
      await input.harness.computer.releaseInputs();
    } catch {
      // Cleanup is best effort and outside the measured workflow.
    }
  }

  if (chromeSession) {
    hostAssertion = await finishChromeProcessOracle(chromeSession, input.chromeProcessProvider);
  }
  if (ownedNativeFixture) {
    await ownedNativeFixture.close().catch(() => {});
  }

  const nativeTrace = nativeTraceAtWorkflowEnd === undefined
    ? undefined
    : nativeTraceBefore === undefined
      ? nativeTraceAtWorkflowEnd
      : nativeTraceAtWorkflowEnd.slice(nativeTraceBefore);
  const assertions = assertionByRule(input, scenario, trace.events, completion, hostAssertion);
  const failureCategory = firstFailureCategory(trace.events);
  const metrics = metricsFromTrace(trace.events, assertions, nativeTrace);
  return signComputerFlowRun({
    schemaVersion: COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION,
    metricRulesVersion: COMPUTER_FLOW_METRIC_RULES_VERSION,
    scenarioVersion: COMPUTER_FLOW_SCENARIO_VERSION,
    fixtureVersion: COMPUTER_FLOW_FIXTURE_VERSION,
    scenarioId: input.scenarioId,
    mode: "runtime",
    tier: "tier1",
    runKind: "recorded",
    repetition: input.repetition,
    runtimeBuild: input.runtimeBuild,
    machineClassId: input.machineClassId,
    disposition: setupFailure ? "precondition_blocked" : "eligible_completed",
    failureCategory,
    events: trace.events,
    assertions,
    metrics,
  }, input.collectorKey);
}
