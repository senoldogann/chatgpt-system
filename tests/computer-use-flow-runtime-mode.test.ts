import { describe, expect, it } from "vitest";
import type { ComputerUseConfig } from "../src/config.js";
import { ComputerError } from "../src/computer-errors.js";
import {
  ComputerRuntime,
  type ComputerHealthResult,
  type ComputerNativeRequesting,
  type ComputerScreenshotResult,
} from "../src/computer-runtime.js";
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerNativeMethod,
  ComputerRunResult,
  ComputerScrollUntilVisibleInput,
  ComputerScrollUntilVisibleResult,
} from "../src/computer-types.js";
import { verifyComputerFlowRunSignature } from "../benchmarks/computer-use-flow-performance/canonical.js";
import { deriveRuntimeBuildIdentity } from "../benchmarks/computer-use-flow-performance/identity.js";
import { evaluateComputerFlowBatch } from "../benchmarks/computer-use-flow-performance/evaluator.js";
import type {
  ComputerFlowNativeFixtureOracleReader,
  ComputerFlowNativeFixtureOracleSnapshotV1,
} from "../benchmarks/computer-use-flow-performance/native-fixture-oracle.js";
import type { ComputerFlowWebFixtureHandle, ComputerFlowWebOracle } from "../benchmarks/computer-use-flow-performance/web-fixture.js";
import type { ChromeProcessSnapshotProvider } from "../benchmarks/computer-use-flow-performance/host-oracle.js";
import {
  createComputerFlowNativeTrace,
  type ComputerFlowOwnedNativeFixture,
  type ComputerFlowRuntimeHarness,
} from "../benchmarks/computer-use-flow-performance/runtime-harness.js";
import { runRuntimeScenario } from "../benchmarks/computer-use-flow-performance/runtime-mode.js";
import { COMPUTER_FLOW_SCENARIOS } from "../benchmarks/computer-use-flow-performance/scenarios.js";

const collectorKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const runtimeBuild = deriveRuntimeBuildIdentity({
  gitCommit: "a".repeat(40),
  workingTreeDigest: "b".repeat(64),
  computerProtocolVersion: 1,
  typeScriptArtifactSha256: "c".repeat(64),
  nativeHelperExecutableSha256: "d".repeat(64),
});
const machineClassId = "e".repeat(64);

const computerConfig: ComputerUseConfig = {
  enabled: true,
  fullHostJsEnabled: false,
  hostBundlePath: "/tmp/not-used-by-recording-runtime",
  requestTimeoutMs: 1_000,
  maxObservationElements: 500,
  maxObservationChars: 262_144,
  maxScreenshotBytes: 8_388_608,
  maxActionProgramActions: 100,
  maxActionProgramRuntimeMs: 30_000,
  maxAutomaticRetriesPerAction: 2,
  maxJsSourceBytes: 65_536,
  maxJsRuntimeMs: 10_000,
  maxJsOutputBytes: 1_048_576,
};

class NullNative implements ComputerNativeRequesting {
  healthState() { return "running" as const; }
  async request(): Promise<never> { throw new Error("Recording runtime should override every used method."); }
  async close(): Promise<void> {}
}

type RuntimeCall = { method: string; input?: object };

class RecordingRuntime extends ComputerRuntime {
  readonly calls: RuntimeCall[] = [];
  readonly clickFailures: ComputerError[] = [];
  readonly observations: unknown[] = [];
  waitForFrontmostFailure: ComputerError | undefined;
  screenshotFailure: ComputerError | undefined;
  onWaitForText: (() => void) | undefined;

  constructor() {
    super(new NullNative(), computerConfig);
  }

  override async health(): Promise<ComputerHealthResult> {
    this.calls.push({ method: "health" });
    return {
      enabled: true,
      state: "running",
      accessibilityTrusted: true,
      screenCaptureAuthorized: true,
      eventListenAuthorized: true,
      eventPostAuthorized: true,
      fullHostJsEnabled: false,
    };
  }

  override async openApp(input: Parameters<ComputerRuntime["openApp"]>[0]): Promise<unknown> {
    this.calls.push({ method: "openApp", input });
    return { state: "completed" };
  }

  override async focusApp(input: Parameters<ComputerRuntime["focusApp"]>[0]): Promise<unknown> {
    this.calls.push({ method: "focusApp", input });
    return { state: "completed" };
  }

  override async waitForFrontmost(input: Parameters<ComputerRuntime["waitForFrontmost"]>[0]): Promise<unknown> {
    this.calls.push({ method: "waitForFrontmost", input });
    if (this.waitForFrontmostFailure) throw this.waitForFrontmostFailure;
    return { state: "completed" };
  }

  override async waitForText(input: Parameters<ComputerRuntime["waitForText"]>[0]): Promise<unknown> {
    this.calls.push({ method: "waitForText", input });
    this.onWaitForText?.();
    return { state: "completed" };
  }

  override async observe(): Promise<unknown> {
    this.calls.push({ method: "observe" });
    return this.observations.shift() ?? { snapshotId: `snapshot-${this.calls.length}`, elements: [], truncated: false };
  }

  override async screenshot(): Promise<ComputerScreenshotResult> {
    this.calls.push({ method: "screenshot" });
    if (this.screenshotFailure) throw this.screenshotFailure;
    return {
      pngBase64: "aQ==",
      width: 1,
      height: 1,
      captureKind: "display",
      screenBounds: { x: 0, y: 0, width: 1, height: 1 },
      scaleX: 1,
      scaleY: 1,
    };
  }

  override async click(input: Parameters<ComputerRuntime["click"]>[0]): Promise<ComputerActionResult> {
    this.calls.push({ method: "click", input });
    const failure = this.clickFailures.shift();
    if (failure) throw failure;
    return { state: "verified", changed: true, verification: { kind: "ax", changed: true } };
  }

  override async scroll(input: Parameters<ComputerRuntime["scroll"]>[0]): Promise<ComputerActionResult> {
    this.calls.push({ method: "scroll", input });
    return { state: "completed_unverified" };
  }

  override async scrollUntilVisible(input: ComputerScrollUntilVisibleInput): Promise<ComputerScrollUntilVisibleResult> {
    this.calls.push({ method: "scrollUntilVisible", input });
    return { state: "target_visible", stepsUsed: 1, changed: true };
  }

  override async typeText(input: Parameters<ComputerRuntime["typeText"]>[0]): Promise<ComputerActionResult> {
    this.calls.push({ method: "typeText", input });
    return { state: "completed_unverified" };
  }

  override async pressKey(input: Parameters<ComputerRuntime["pressKey"]>[0]): Promise<ComputerActionResult> {
    this.calls.push({ method: "pressKey", input });
    return { state: "completed_unverified" };
  }

  override async run(input: Parameters<ComputerRuntime["run"]>[0]): Promise<ComputerRunResult> {
    this.calls.push({ method: "run", input });
    return {
      state: "completed",
      completedCount: input.actions.length,
      actionCount: input.actions.length,
      steps: input.actions.map((action, index) => ({ index, type: action.type, state: "completed" as const })),
      stepsTruncated: false,
    };
  }

  override async releaseInputs(): Promise<ComputerActionResult> {
    this.calls.push({ method: "releaseInputs" });
    return { state: "completed_unverified" };
  }
}

function completeWebOracle(scenarioId: Exclude<Parameters<ComputerFlowWebFixtureHandle["createSession"]>[0], never>): ComputerFlowWebOracle {
  switch (scenarioId) {
    case "open-focus-verify": return { scenarioId, pageReady: true };
    case "batched-multi-control-form": return { scenarioId, textFieldsMatch: true, checkboxChecked: true, selectionMatch: true, submitted: true };
    case "scoped-nested-scrolling": return { scenarioId, innerTargetActivated: true, outerScrollChanged: false, unchangedScrollAttemptCount: 0 };
    case "stale-dynamic-target-recovery": return { scenarioId, rerendered: true, currentGenerationActivated: true };
    case "weak-ax-ocr-visual-point": return { scenarioId, visualTargetActivated: true, pointAttemptCount: 1 };
  }
}

function fixtureFor(scenarioId: Parameters<ComputerFlowWebFixtureHandle["createSession"]>[0]): ComputerFlowWebFixtureHandle {
  return {
    origin: "http://127.0.0.1:43123",
    async createSession(requested) {
      if (requested !== scenarioId) throw new Error("unexpected scenario");
      return { scenarioId, sessionId: "fixture-session", url: `http://127.0.0.1:43123/session/fixture-session` };
    },
    async readOracle() { return completeWebOracle(scenarioId); },
    async close() {},
  };
}

function fixtureWithOracleSequence(
  scenarioId: Parameters<ComputerFlowWebFixtureHandle["createSession"]>[0],
  oracles: readonly ComputerFlowWebOracle[],
): ComputerFlowWebFixtureHandle & { readCount: number } {
  let readCount = 0;
  return {
    origin: "http://127.0.0.1:43123",
    get readCount() { return readCount; },
    async createSession(requested) {
      if (requested !== scenarioId) throw new Error("unexpected scenario");
      return { scenarioId, sessionId: "fixture-session", url: `http://127.0.0.1:43123/session/fixture-session` };
    },
    async readOracle() {
      const oracle = oracles[Math.min(readCount, oracles.length - 1)];
      readCount += 1;
      if (!oracle) throw new Error("missing oracle");
      return oracle;
    },
    async close() {},
  };
}

function chromeProvider(...snapshots: readonly (readonly number[])[]): ChromeProcessSnapshotProvider {
  let index = 0;
  return { async snapshotMainProcessIds() { return snapshots[index++] ?? []; } };
}

function nativeOracle(...snapshots: readonly ComputerFlowNativeFixtureOracleSnapshotV1[]): ComputerFlowNativeFixtureOracleReader {
  let index = 0;
  return { async read() { return snapshots[Math.min(index++, snapshots.length - 1)]!; } };
}

class RecordingHarness implements ComputerFlowRuntimeHarness {
  readonly computer: RecordingRuntime;
  readonly nativeTrace: readonly { operation: ComputerNativeMethod; durationMs: number; outcome: "completed" | "timeout" | "unavailable" | "blocked" }[];
  readonly ownedFixture: ComputerFlowOwnedNativeFixture | undefined;
  ownedFixtureStarts = 0;
  ownedFixtureCloses = 0;
  closes = 0;
  private nativeTraceSnapshotCount = 0;

  constructor(
    computer = new RecordingRuntime(),
    options: {
      nativeTrace?: readonly { operation: ComputerNativeMethod; durationMs: number; outcome: "completed" | "timeout" | "unavailable" | "blocked" }[];
      nativeOracle?: ComputerFlowNativeFixtureOracleReader;
    } = {},
  ) {
    this.computer = computer;
    this.nativeTrace = options.nativeTrace ?? [];
    this.ownedFixture = options.nativeOracle ? {
      oracle: options.nativeOracle,
      close: async () => { this.ownedFixtureCloses += 1; },
    } : undefined;
  }

  async startOwnedNativeFixture(): Promise<ComputerFlowOwnedNativeFixture> {
    this.ownedFixtureStarts += 1;
    if (!this.ownedFixture) throw new Error("No native fixture configured.");
    return this.ownedFixture;
  }

  snapshotNativeTrace() {
    const snapshot = this.nativeTraceSnapshotCount++ === 0 ? [] : this.nativeTrace;
    return snapshot;
  }

  async close(): Promise<void> { this.closes += 1; }
}

function baseInput(harness: ComputerFlowRuntimeHarness, chromeProcessProvider = chromeProvider([], [])) {
  return {
    repetition: 1,
    runtimeBuild,
    machineClassId,
    collectorKey,
    harness,
    chromeProcessProvider,
  } as const;
}

describe("computer flow native trace", () => {
  it("records only closed categorical native request evidence", async () => {
    const calls: Array<{ method: ComputerNativeMethod; params: Record<string, unknown> }> = [];
    const native: ComputerNativeRequesting = {
      healthState: () => "running",
      async request(method, params) {
        calls.push({ method, params });
        if (method === "click") throw new ComputerError("COMPUTER_TIMEOUT");
        return { ok: true };
      },
      async close() {},
    };
    const traced = createComputerFlowNativeTrace(native);
    await traced.request("observe", { secret: "RAW_NATIVE_PARAM_CANARY" });
    await expect(traced.request("click", { x: 91827, y: 73645 })).rejects.toMatchObject({ code: "COMPUTER_TIMEOUT" });
    expect(calls).toHaveLength(2);
    expect(traced.snapshotTrace()).toEqual([
      expect.objectContaining({ operation: "observe", outcome: "completed" }),
      expect.objectContaining({ operation: "click", outcome: "timeout" }),
    ]);
    const serialized = JSON.stringify(traced.snapshotTrace());
    expect(serialized).not.toContain("RAW_NATIVE_PARAM_CANARY");
    expect(serialized).not.toContain("91827");
    expect(serialized).not.toContain("73645");
  });
});

describe("scripted Runtime Mode", () => {
  it("opens/focuses Chrome without restart semantics and joins only the host-process preservation oracle", async () => {
    const harness = new RecordingHarness();
    const record = await runRuntimeScenario({
      ...baseInput(harness, chromeProvider([101, 202], [101, 202, 303])),
      scenarioId: "open-focus-verify",
      webFixture: fixtureFor("open-focus-verify"),
    });

    expect(harness.computer.calls.map((call) => call.method)).toEqual(expect.arrayContaining(["openApp", "focusApp", "releaseInputs"]));
    expect(harness.computer.calls.some((call) => /close|kill|restart|terminate/i.test(call.method))).toBe(false);
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "chrome_process_preserved", status: "pass", source: "host_process_oracle" }));
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "completion_oracle", status: "pass", source: "web_fixture_oracle" }));
    expect(verifyComputerFlowRunSignature(record, collectorKey)).toBe(true);
  });

  it("derives every Runtime zero-tolerance counter only from its complete trusted non-applicable action trace", async () => {
    const harness = new RecordingHarness();
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "open-focus-verify",
      webFixture: fixtureFor("open-focus-verify"),
    });
    for (const name of [
      "wrongAppInputCount",
      "blindRepeatedPointCount",
      "unchangedScrollRepeatCount",
      "safetyBoundaryViolationCount",
    ] as const) {
      expect(record.metrics[name], name).toEqual({ availability: "available", value: 0 });
    }
  });

  it("accepts a complete ten-run Runtime S1 batch with all four supported zero safety counters", async () => {
    const runs = [];
    for (let repetition = 1; repetition <= 10; repetition += 1) {
      runs.push(await runRuntimeScenario({
        ...baseInput(new RecordingHarness(), chromeProvider([101], [101])),
        repetition,
        scenarioId: "open-focus-verify",
        webFixture: fixtureFor("open-focus-verify"),
      }));
    }
    const result = evaluateComputerFlowBatch(runs, collectorKey);
    expect(result.scenarios[0]).toMatchObject({
      scenarioId: "open-focus-verify",
      recordedRunCount: 10,
      eligibleSuccessCount: 10,
      gateStatus: "pass",
      zeroToleranceFailureCount: 0,
    });
  });

  it("correlates S1 navigation with the new fixture session before trusting the reused page heading", async () => {
    const fixture = fixtureWithOracleSequence("open-focus-verify", [
      { scenarioId: "open-focus-verify", pageReady: false },
      { scenarioId: "open-focus-verify", pageReady: true },
    ]);
    const runtime = new RecordingRuntime();
    runtime.onWaitForText = () => {
      if (fixture.readCount < 2) throw new ComputerError("COMPUTER_TIMEOUT");
    };
    const harness = new RecordingHarness(runtime);
    const record = await runRuntimeScenario({
      ...baseInput(harness, chromeProvider([101], [101])),
      scenarioId: "open-focus-verify",
      webFixture: fixture,
    });
    expect(fixture.readCount).toBeGreaterThanOrEqual(2);
    expect(record.failureCategory).toBe("none");
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "completion_oracle", status: "pass" }));
  });

  it("prepares each web fixture session in Chrome before scenario-specific work", async () => {
    const cases = [
      ["batched-multi-control-form", "run"],
      ["scoped-nested-scrolling", "scrollUntilVisible"],
      ["stale-dynamic-target-recovery", "run"],
      ["weak-ax-ocr-visual-point", "click"],
    ] as const;

    for (const [scenarioId, scenarioMethod] of cases) {
      const harness = new RecordingHarness();
      await runRuntimeScenario({
        ...baseInput(harness),
        scenarioId,
        webFixture: fixtureFor(scenarioId),
      });
      const focusIndex = harness.computer.calls.findIndex((call) => call.method === "focusApp");
      const navigationIndex = harness.computer.calls.findIndex((call) =>
        call.method === "typeText"
        && "text" in (call.input ?? {})
        && call.input?.text === "http://127.0.0.1:43123/session/fixture-session");
      const scenarioIndex = harness.computer.calls.findIndex((call) => call.method === scenarioMethod);
      expect(focusIndex, `${scenarioId}: focus`).toBeGreaterThanOrEqual(0);
      expect(navigationIndex, `${scenarioId}: fixture navigation`).toBeGreaterThan(focusIndex);
      expect(scenarioIndex, `${scenarioId}: scenario work`).toBeGreaterThan(navigationIndex);
    }
  });

  it("waits for asynchronous web oracle completion before finalizing a successful workflow", async () => {
    const harness = new RecordingHarness();
    const fixture = fixtureWithOracleSequence("batched-multi-control-form", [
      { scenarioId: "batched-multi-control-form", textFieldsMatch: false, checkboxChecked: false, selectionMatch: false, submitted: false },
      completeWebOracle("batched-multi-control-form"),
    ]);
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "batched-multi-control-form",
      webFixture: fixture,
    });
    expect(fixture.readCount).toBeGreaterThanOrEqual(2);
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "completion_oracle", status: "pass" }));
  });

  it("uses the accessible inner scroll panel as the scoped-scroll readiness probe", async () => {
    const harness = new RecordingHarness();
    await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "scoped-nested-scrolling",
      webFixture: fixtureFor("scoped-nested-scrolling"),
    });
    const waits = harness.computer.calls.filter((call) => call.method === "waitForText");
    expect(waits).toContainEqual(expect.objectContaining({ input: expect.objectContaining({ text: "Fixture Inner Scroll Panel" }) }));
  });

  it("refreshes runtime observation after rerender before attempting the stale snapshot target", async () => {
    const runtime = new RecordingRuntime();
    runtime.clickFailures.push(new ComputerError("COMPUTER_STALE_SNAPSHOT"));
    const harness = new RecordingHarness(runtime);
    await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "stale-dynamic-target-recovery",
      webFixture: fixtureFor("stale-dynamic-target-recovery"),
    });
    const methods = runtime.calls.map((call) => call.method);
    const runIndex = methods.indexOf("run");
    const staleClickIndex = methods.indexOf("click", runIndex + 1);
    const refreshIndex = methods.indexOf("observe", runIndex + 1);
    expect(refreshIndex).toBeGreaterThan(runIndex);
    expect(refreshIndex).toBeLessThan(staleClickIndex);
  });

  it("forces the initial weak-AX semantic miss to be target_not_found before fallback", async () => {
    const runtime = new RecordingRuntime();
    runtime.clickFailures.push(new ComputerError("COMPUTER_TARGET_NOT_FOUND"));
    const harness = new RecordingHarness(runtime);
    await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "weak-ax-ocr-visual-point",
      webFixture: fixtureFor("weak-ax-ocr-visual-point"),
    });
    const firstClick = runtime.calls.find((call) => call.method === "click");
    expect(firstClick?.input).toMatchObject({ target: { by: "label", label: "Activate", exact: true }, retryBudget: 0 });
  });

  it("uses a fresh post-screenshot observation to derive the single visual point from fixture-canvas bounds", async () => {
    const runtime = new RecordingRuntime();
    runtime.clickFailures.push(new ComputerError("COMPUTER_TARGET_NOT_FOUND"));
    runtime.observations.push(
      { snapshotId: "initial", elements: [], truncated: false },
      {
        snapshotId: "fresh",
        elements: [{ index: 7, label: "Fixture Canvas", bounds: { x: 100, y: 200, width: 520, height: 220 } }],
        truncated: false,
      },
    );
    const harness = new RecordingHarness(runtime);
    await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "weak-ax-ocr-visual-point",
      webFixture: fixtureFor("weak-ax-ocr-visual-point"),
    });
    const calls = runtime.calls;
    const screenshotIndex = calls.findIndex((call) => call.method === "screenshot");
    const freshObserveIndex = calls.findIndex((call, index) => index > screenshotIndex && call.method === "observe");
    expect(freshObserveIndex).toBeGreaterThan(screenshotIndex);
    const finalClick = calls.filter((call) => call.method === "click").at(-1);
    expect(finalClick?.input).toMatchObject({ x: 490, y: 335 });
  });

  it("waits for the owned native fixture to become frontmost instead of racing a focus request", async () => {
    const ready: ComputerFlowNativeFixtureOracleSnapshotV1 = {
      version: 1,
      ready: true,
      textMatchesExpectedToken: false,
      checkboxChecked: false,
      buttonPressCount: 0,
      textEditCount: 0,
      checkboxToggleCount: 0,
    };
    const runtime = new RecordingRuntime();
    const harness = new RecordingHarness(runtime, { nativeOracle: nativeOracle(ready, ready) });
    await runRuntimeScenario({ ...baseInput(harness), scenarioId: "native-macos-fixture-workflow" });
    const methods = runtime.calls.map((call) => call.method);
    expect(methods).not.toContain("focusApp");
    expect(methods.indexOf("waitForFrontmost")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("waitForFrontmost")).toBeLessThan(methods.indexOf("click"));
  });

  it("keeps measured Runtime events within each scenario's declared operation surface", async () => {
    for (const scenarioId of [
      "batched-multi-control-form",
      "scoped-nested-scrolling",
      "stale-dynamic-target-recovery",
      "weak-ax-ocr-visual-point",
    ] as const) {
      const harness = new RecordingHarness();
      const record = await runRuntimeScenario({
        ...baseInput(harness),
        scenarioId,
        webFixture: fixtureFor(scenarioId),
      });
      const allowed = new Set(COMPUTER_FLOW_SCENARIOS.find((scenario) => scenario.id === scenarioId)!.allowedOperations);
      for (const event of record.events) {
        if (event.operation !== undefined) {
          expect(allowed.has(event.operation), `${scenarioId}: ${event.operation}`).toBe(true);
        }
      }
    }
  });

  it("uses one predetermined action program for the multi-control form rather than one runtime boundary per field", async () => {
    const harness = new RecordingHarness();
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "batched-multi-control-form",
      webFixture: fixtureFor("batched-multi-control-form"),
    });
    const runs = harness.computer.calls.filter((call) => call.method === "run");
    expect(runs).toHaveLength(1);
    const actions = (runs[0]!.input as { actions: ComputerAction[] }).actions;
    expect(actions.filter((action) => action.type === "type_text")).toHaveLength(3);
    const directTypeText = harness.computer.calls.filter((call) => call.method === "typeText");
    expect(directTypeText).toHaveLength(1);
    expect(directTypeText[0]!.input).toMatchObject({ text: "http://127.0.0.1:43123/session/fixture-session" });
    for (const fieldValue of ["alpha", "bravo", "charlie"]) {
      expect(directTypeText.some((call) => call.input?.text === fieldValue)).toBe(false);
    }
    expect(record.events.filter((event) => event.category === "tool_boundary" && event.operation === "run")).toHaveLength(1);
  });

  it("uses scoped scrollUntilVisible and never raw-scroll loops after unchanged state", async () => {
    const harness = new RecordingHarness();
    await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "scoped-nested-scrolling",
      webFixture: fixtureFor("scoped-nested-scrolling"),
    });
    expect(harness.computer.calls.filter((call) => call.method === "scrollUntilVisible")).toHaveLength(1);
    expect(harness.computer.calls.filter((call) => call.method === "scroll")).toHaveLength(0);
  });

  it("records stale refusal -> fresh observation -> successful current-target mutation in order", async () => {
    const runtime = new RecordingRuntime();
    runtime.clickFailures.push(new ComputerError("COMPUTER_STALE_SNAPSHOT"));
    const harness = new RecordingHarness(runtime);
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "stale-dynamic-target-recovery",
      webFixture: fixtureFor("stale-dynamic-target-recovery"),
    });
    const recovery = record.events
      .map((event) => event.recoveryOutcome)
      .filter((value) => value !== undefined);
    expect(recovery).toEqual(expect.arrayContaining(["stale_refused", "fresh_observe", "operation_completed"]));
    expect(recovery.indexOf("stale_refused")).toBeLessThan(recovery.indexOf("fresh_observe"));
    expect(recovery.indexOf("fresh_observe")).toBeLessThan(recovery.lastIndexOf("operation_completed"));
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "recovery_contract_satisfied", status: "pass", source: "runtime_trace" }));
  });

  it("records target_not_found -> OCR fallback -> fresh screenshot -> exactly one visual-point attempt", async () => {
    const runtime = new RecordingRuntime();
    runtime.clickFailures.push(new ComputerError("COMPUTER_TARGET_NOT_FOUND"));
    runtime.observations.push(
      { snapshotId: "initial", elements: [], truncated: false },
      {
        snapshotId: "fresh",
        elements: [{ index: 1, label: "Fixture Canvas", bounds: { x: 100, y: 200, width: 520, height: 220 } }],
        truncated: false,
      },
    );
    const harness = new RecordingHarness(runtime);
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "weak-ax-ocr-visual-point",
      webFixture: fixtureFor("weak-ax-ocr-visual-point"),
    });
    const targetMiss = record.events.findIndex((event) => event.recoveryOutcome === "target_not_found");
    const ocrFallback = record.events.findIndex((event) => event.recoveryOutcome === "ocr_fallback");
    const screenshot = record.events.findIndex((event) => event.operation === "screenshot");
    const pointAttempt = record.events.findIndex((event) => event.recoveryOutcome === "single_visual_point_attempt");
    expect(targetMiss).toBeGreaterThanOrEqual(0);
    expect(targetMiss).toBeLessThan(ocrFallback);
    expect(ocrFallback).toBeLessThan(screenshot);
    expect(screenshot).toBeLessThan(pointAttempt);
    expect(record.events.filter((event) => event.recoveryOutcome === "single_visual_point_attempt")).toHaveLength(1);
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "recovery_contract_satisfied", status: "pass" }));
  });

  it("fails the weak-AX recovery assertion when the fresh screenshot step is missing", async () => {
    const runtime = new RecordingRuntime();
    runtime.clickFailures.push(new ComputerError("COMPUTER_TARGET_NOT_FOUND"));
    runtime.screenshotFailure = new ComputerError("COMPUTER_UNAVAILABLE");
    const harness = new RecordingHarness(runtime);
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "weak-ax-ocr-visual-point",
      webFixture: fixtureFor("weak-ax-ocr-visual-point"),
    });
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "recovery_contract_satisfied", status: "fail", source: "runtime_trace" }));
    expect(harness.computer.calls.at(-1)?.method).toBe("releaseInputs");
  });

  it("uses only the external native fixture oracle for Scenario 6 completion and always closes the owned fixture", async () => {
    const complete: ComputerFlowNativeFixtureOracleSnapshotV1 = {
      version: 1,
      ready: true,
      textMatchesExpectedToken: true,
      checkboxChecked: true,
      buttonPressCount: 1,
      textEditCount: 1,
      checkboxToggleCount: 1,
    };
    const harness = new RecordingHarness(new RecordingRuntime(), { nativeOracle: nativeOracle(complete, complete) });
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "native-macos-fixture-workflow",
    });
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "completion_oracle", status: "pass", source: "native_fixture_oracle" }));
    expect(harness.ownedFixtureStarts).toBe(1);
    expect(harness.ownedFixtureCloses).toBe(1);
    expect(harness.computer.calls.at(-1)?.method).toBe("releaseInputs");
  });

  it("does not let a successful runtime self-certify Scenario 6 when the external native oracle fails", async () => {
    const incomplete: ComputerFlowNativeFixtureOracleSnapshotV1 = {
      version: 1,
      ready: true,
      textMatchesExpectedToken: false,
      checkboxChecked: true,
      buttonPressCount: 1,
      textEditCount: 1,
      checkboxToggleCount: 1,
    };
    const harness = new RecordingHarness(new RecordingRuntime(), { nativeOracle: nativeOracle(incomplete, incomplete) });
    const record = await runRuntimeScenario({ ...baseInput(harness), scenarioId: "native-macos-fixture-workflow" });
    expect(record.assertions).toContainEqual(expect.objectContaining({ assertion: "completion_oracle", status: "fail", source: "native_fixture_oracle" }));
  });

  it("stops later native physical actions after focus/takeover failure while still releasing input and closing the fixture", async () => {
    for (const code of ["COMPUTER_FOCUS_FAILED", "COMPUTER_USER_TAKEOVER"] as const) {
      const runtime = new RecordingRuntime();
      runtime.waitForFrontmostFailure = new ComputerError(code);
      const ready: ComputerFlowNativeFixtureOracleSnapshotV1 = {
        version: 1,
        ready: true,
        textMatchesExpectedToken: false,
        checkboxChecked: false,
        buttonPressCount: 0,
        textEditCount: 0,
        checkboxToggleCount: 0,
      };
      const harness = new RecordingHarness(runtime, { nativeOracle: nativeOracle(ready, ready) });
      const record = await runRuntimeScenario({ ...baseInput(harness), scenarioId: "native-macos-fixture-workflow" });
      const methods = runtime.calls.map((call) => call.method);
      expect(methods).toContain("waitForFrontmost");
      expect(methods).not.toContain("focusApp");
      expect(methods).not.toContain("typeText");
      expect(methods).not.toContain("click");
      expect(methods.at(-1)).toBe("releaseInputs");
      expect(harness.ownedFixtureCloses).toBe(1);
      expect(record.failureCategory).toBe(code === "COMPUTER_FOCUS_FAILED" ? "focus" : "takeover");
    }
  });

  it("derives Runtime metrics from trusted benchmark boundaries/native trace, including operation durations", async () => {
    const harness = new RecordingHarness(new RecordingRuntime(), {
      nativeTrace: [
        { operation: "observe", durationMs: 4, outcome: "completed" },
        { operation: "click", durationMs: 6, outcome: "completed" },
      ],
    });
    const record = await runRuntimeScenario({
      ...baseInput(harness),
      scenarioId: "batched-multi-control-form",
      webFixture: fixtureFor("batched-multi-control-form"),
    });
    expect(record.metrics.computerToolCallCount.availability).toBe("available");
    expect(record.metrics.nativeRpcCount).toEqual({ availability: "available", value: 2 });
    const runEvents = record.events.filter((event) => event.category === "tool_boundary" && event.operation === "run");
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0]!.durationMs).toBeTypeOf("number");
    expect(record.metrics.runtimeDurationMs.availability).toBe("available");
  });
});
