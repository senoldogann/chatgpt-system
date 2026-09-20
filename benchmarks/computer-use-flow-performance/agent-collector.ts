import { open, stat } from "node:fs/promises";
import { z } from "zod";
import {
  COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION,
  COMPUTER_FLOW_FIXTURE_VERSION,
  COMPUTER_FLOW_METRIC_RULES_VERSION,
  COMPUTER_FLOW_OPERATIONS,
  COMPUTER_FLOW_SCENARIO_VERSION,
  deriveComputerFlowMetrics,
  type ComputerFlowAssertion,
  type ComputerFlowAssertionName,
  type ComputerFlowAssertionSource,
  type ComputerFlowEvent,
  type ComputerFlowFailureCategory,
  type ComputerFlowOperation,
  type ComputerFlowOutcome,
  type ComputerFlowRunRecord,
  type ComputerFlowRuntimeBuild,
  type ComputerFlowScenarioDefinition,
} from "./contract.js";
import { createEvidenceDigest, signComputerFlowRun } from "./canonical.js";
import { mapObservedComputerAuditEvent } from "./mappings.js";
import type {
  ComputerFlowNativeFixtureOracleReader,
  ComputerFlowNativeFixtureOracleSnapshotV1,
} from "./native-fixture-oracle.js";
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

export const COMPUTER_FLOW_MAX_AUDIT_SLICE_BYTES = 1_048_576;

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
      recoveryOutcome: ComputerFlowRunRecord["events"][number]["recoveryOutcome"] & string;
    }
  | { kind: "forbidden_observed"; namespace: "browser" | "process" | "shell" | "fs" | "other" };

interface AgentCollectionCommonInput {
  auditFile: string;
  scenario: ComputerFlowScenarioDefinition;
  runtimeBuild: ComputerFlowRuntimeBuild;
  machineClassId: string;
  repetition: number;
  collectorKey: Uint8Array;
  chromeProcessProvider?: ChromeProcessSnapshotProvider;
}

export type AgentCollectionInput =
  | (AgentCollectionCommonInput & {
      fixtureKind: "web";
      webSession: ComputerFlowWebFixtureSession;
      webFixture: ComputerFlowWebFixtureHandle;
      nativeOracle?: never;
    })
  | (AgentCollectionCommonInput & {
      fixtureKind: "native";
      scenario: ComputerFlowScenarioDefinition & { id: "native-macos-fixture-workflow" };
      nativeOracle: ComputerFlowNativeFixtureOracleReader;
      webSession?: never;
      webFixture?: never;
    });

export interface AgentCollectionSession {
  input: AgentCollectionInput;
  auditCursor: ComputerFlowAuditCursor;
  chromeProcessSession?: ChromeProcessOracleSession;
}

const operationSet = new Set<string>(COMPUTER_FLOW_OPERATIONS);
const sourceClassSchema = z.enum(["ax", "ocr", "point"]);
const auditMetadataSchema = z.object({
  errorCode: z.string().min(1).max(64).optional(),
  sourceClass: sourceClassSchema.optional(),
  ocrInvoked: z.boolean().optional(),
  state: z.string().min(1).max(64).optional(),
  stepsUsed: z.number().int().nonnegative().optional(),
  changed: z.boolean().optional(),
  actionCount: z.number().int().nonnegative().optional(),
  completedCount: z.number().int().nonnegative().optional(),
}).strip();
const auditRecordSchema = z.object({
  id: z.string().min(1).max(256),
  timestamp: z.string().min(1).max(128),
  action: z.string().min(1).max(128),
  outcome: z.enum(["ok", "error"]),
  durationMs: z.number().nonnegative(),
  target: z.string().max(4_096).optional(),
  metadata: auditMetadataSchema.optional(),
}).strip();

async function captureAuditCursor(auditFile: string): Promise<ComputerFlowAuditCursor> {
  const information = await stat(auditFile, { bigint: true });
  if (!information.isFile()) throw new Error("Computer flow audit source is not a regular file.");
  if (information.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Computer flow audit source is too large.");
  return {
    device: information.dev,
    inode: information.ino,
    size: Number(information.size),
  };
}

function cursorIdentityMatches(left: ComputerFlowAuditCursor, right: ComputerFlowAuditCursor): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function readAuditSlice(session: AgentCollectionSession): Promise<string> {
  const beforeRead = await captureAuditCursor(session.input.auditFile);
  if (!cursorIdentityMatches(beforeRead, session.auditCursor)) throw new Error("Computer flow audit source rotated during collection.");
  if (beforeRead.size < session.auditCursor.size) throw new Error("Computer flow audit source truncated during collection.");
  const length = beforeRead.size - session.auditCursor.size;
  if (length > COMPUTER_FLOW_MAX_AUDIT_SLICE_BYTES) throw new Error("Computer flow audit slice exceeds its byte limit.");
  if (length === 0) return "";

  const handle = await open(session.input.auditFile, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, session.auditCursor.size);
    if (result.bytesRead !== length) throw new Error("Computer flow audit slice changed while reading.");
    const afterRead = await captureAuditCursor(session.input.auditFile);
    if (!cursorIdentityMatches(afterRead, beforeRead) || afterRead.size !== beforeRead.size) {
      throw new Error("Computer flow audit source changed while reading.");
    }
    const slice = buffer.toString("utf8");
    if (!slice.endsWith("\n")) throw new Error("Computer flow audit slice ended with a partial JSONL record.");
    return slice;
  } finally {
    await handle.close();
  }
}

type ComputerFlowForbiddenNamespace = Extract<
  ComputerFlowAuditEvent,
  { kind: "forbidden_observed" }
>["namespace"];

function forbiddenNamespace(action: string): ComputerFlowForbiddenNamespace | undefined {
  if (action.startsWith("browser.")) return "browser";
  if (action.startsWith("process.")) return "process";
  if (action.startsWith("shell.")) return "shell";
  if (action.startsWith("fs.")) return "fs";
  if (!action.startsWith("computer.")) return "other";
  return undefined;
}

function parseComputerOperation(action: string): ComputerFlowOperation {
  const operation = action.slice("computer.".length);
  if (!operationSet.has(operation)) throw new Error("Observed computer audit operation is not in the closed benchmark contract.");
  return operation as ComputerFlowOperation;
}

function parseAuditRecord(line: string): ComputerFlowAuditEvent {
  const record = auditRecordSchema.parse(JSON.parse(line));
  if (record.action === "computer.run_js") return { kind: "forbidden_observed", namespace: "other" };
  const namespace = forbiddenNamespace(record.action);
  if (namespace) return { kind: "forbidden_observed", namespace };

  const operation = parseComputerOperation(record.action);
  const mapped = mapObservedComputerAuditEvent({
    operation,
    outcome: record.outcome,
    ...(record.metadata?.errorCode !== undefined ? { errorCode: record.metadata.errorCode } : {}),
    ...(record.metadata?.state !== undefined ? { scrollState: record.metadata.state } : {}),
  });
  return {
    kind: "computer",
    operation,
    outcome: mapped.outcome,
    durationMs: record.durationMs,
    ...(record.metadata?.sourceClass !== undefined ? { sourceClass: record.metadata.sourceClass } : {}),
    ...(record.metadata?.ocrInvoked !== undefined ? { ocrInvoked: record.metadata.ocrInvoked } : {}),
    ...(record.metadata?.state !== undefined
      ? { scrollState: record.metadata.state as "target_visible" | "boundary_reached" | "needs_replan" }
      : {}),
    ...(record.metadata?.stepsUsed !== undefined ? { stepsUsed: record.metadata.stepsUsed } : {}),
    ...(record.metadata?.changed !== undefined ? { changed: record.metadata.changed } : {}),
    ...(record.metadata?.actionCount !== undefined ? { actionCount: record.metadata.actionCount } : {}),
    ...(record.metadata?.completedCount !== undefined ? { completedCount: record.metadata.completedCount } : {}),
    failureCategory: mapped.failureCategory,
    recoveryOutcome: mapped.recoveryOutcome,
  };
}

function parseAuditSlice(slice: string): readonly ComputerFlowAuditEvent[] {
  if (slice.length === 0) return [];
  const lines = slice.split("\n");
  lines.pop();
  if (lines.some((line) => line.length === 0)) throw new Error("Computer flow audit slice contains an empty JSONL record.");
  return lines.map(parseAuditRecord);
}

function eventCategory(event: Extract<ComputerFlowAuditEvent, { kind: "computer" }>): ComputerFlowEvent["category"] {
  if (event.operation === "observe") return "observation";
  if (event.operation === "screenshot") return "screenshot";
  if (event.outcome === "needs_replan") return "replan";
  if (["move_mouse", "click", "double_click", "drag", "scroll", "type_text", "press_key"].includes(event.operation)) {
    return "physical_action";
  }
  if (["wait_for_frontmost", "wait_for_text", "wait_until_changed"].includes(event.operation)) return "verification";
  return "tool_boundary";
}

function toRunEvents(events: readonly ComputerFlowAuditEvent[]): ComputerFlowEvent[] {
  return events
    .filter((event): event is Extract<ComputerFlowAuditEvent, { kind: "computer" }> => event.kind === "computer")
    .map((event, sequence) => ({
      sequence,
      elapsedMs: 0,
      durationMs: event.durationMs,
      mode: "agent",
      category: eventCategory(event),
      operation: event.operation,
      outcome: event.outcome,
      failureCategory: event.failureCategory,
      recoveryOutcome: event.recoveryOutcome,
      ...(event.sourceClass !== undefined
        ? { targeting: event.sourceClass === "point" ? "visual-point" as const : event.sourceClass }
        : {}),
    }));
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
  input: AgentCollectionInput,
  assertion: ComputerFlowAssertionName,
  status: "pass" | "fail",
  source: ComputerFlowAssertionSource,
  sourceSequence: number,
): ComputerFlowAssertion {
  if (!scenarioAllowsSource(input.scenario, assertion, source)) {
    throw new Error("Computer flow assertion source is not declared by the selected scenario.");
  }
  return {
    assertion,
    status,
    source,
    evidenceDigest: createEvidenceDigest({
      version: 1,
      scenarioId: input.scenario.id,
      mode: "agent",
      assertion,
      status,
      source,
      sourceSequence,
    }, input.collectorKey),
  };
}

function unavailableAssertion(
  assertion: ComputerFlowAssertionName,
  reason: "collector_source_missing" | "lossy_audit_source",
): ComputerFlowAssertion {
  return { assertion, status: "unavailable", reason };
}

function webCompletion(oracle: ComputerFlowWebOracle): boolean {
  switch (oracle.scenarioId) {
    case "open-focus-verify":
      return oracle.pageReady;
    case "batched-multi-control-form":
      return oracle.textFieldsMatch && oracle.checkboxChecked && oracle.selectionMatch && oracle.submitted;
    case "scoped-nested-scrolling":
      return oracle.innerTargetActivated && !oracle.outerScrollChanged;
    case "stale-dynamic-target-recovery":
      return oracle.rerendered && oracle.currentGenerationActivated;
    case "weak-ax-ocr-visual-point":
      return oracle.visualTargetActivated;
  }
}

function nativeCompletion(oracle: ComputerFlowNativeFixtureOracleSnapshotV1): boolean {
  return oracle.ready
    && oracle.textMatchesExpectedToken
    && oracle.checkboxChecked
    && oracle.buttonPressCount >= 1;
}

async function fixtureAssertions(session: AgentCollectionSession): Promise<Map<ComputerFlowAssertionName, ComputerFlowAssertion>> {
  const assertions = new Map<ComputerFlowAssertionName, ComputerFlowAssertion>();
  const input = session.input;
  if (input.fixtureKind === "web") {
    try {
      const oracle = await input.webFixture.readOracle(input.webSession.sessionId);
      if (oracle.scenarioId !== input.scenario.id) throw new Error("Computer flow fixture oracle scenario mismatch.");
      assertions.set(
        "completion_oracle",
        categoricalAssertion(input, "completion_oracle", webCompletion(oracle) ? "pass" : "fail", "web_fixture_oracle", 0),
      );
      if (oracle.scenarioId === "scoped-nested-scrolling") {
        assertions.set(
          "unchanged_scroll_repeat_absent",
          categoricalAssertion(
            input,
            "unchanged_scroll_repeat_absent",
            oracle.unchangedScrollAttemptCount <= 1 ? "pass" : "fail",
            "web_fixture_oracle",
            1,
          ),
        );
      }
      if (oracle.scenarioId === "weak-ax-ocr-visual-point") {
        assertions.set(
          "blind_point_repeat_absent",
          categoricalAssertion(
            input,
            "blind_point_repeat_absent",
            oracle.pointAttemptCount <= 1 ? "pass" : "fail",
            "web_fixture_oracle",
            1,
          ),
        );
      }
    } catch {
      assertions.set("completion_oracle", unavailableAssertion("completion_oracle", "collector_source_missing"));
    }
  } else {
    try {
      const oracle = await input.nativeOracle.read();
      assertions.set(
        "completion_oracle",
        categoricalAssertion(input, "completion_oracle", nativeCompletion(oracle) ? "pass" : "fail", "native_fixture_oracle", 0),
      );
    } catch {
      assertions.set("completion_oracle", unavailableAssertion("completion_oracle", "collector_source_missing"));
    }
  }
  return assertions;
}

async function collectAssertions(session: AgentCollectionSession): Promise<ComputerFlowAssertion[]> {
  const assertions = await fixtureAssertions(session);
  const input = session.input;
  const chromeRule = input.scenario.assertionRules.find((rule) => rule.assertion === "chrome_process_preserved");
  if (chromeRule) {
    if (session.chromeProcessSession && input.chromeProcessProvider) {
      const hostAssertion = await finishChromeProcessOracle(session.chromeProcessSession, input.chromeProcessProvider);
      if (hostAssertion.status === "unavailable") {
        assertions.set("chrome_process_preserved", unavailableAssertion("chrome_process_preserved", hostAssertion.reason));
      } else {
        assertions.set(
          "chrome_process_preserved",
          categoricalAssertion(input, "chrome_process_preserved", hostAssertion.status, hostAssertion.source, 2),
        );
      }
    } else {
      assertions.set("chrome_process_preserved", unavailableAssertion("chrome_process_preserved", "collector_source_missing"));
    }
  }

  for (const rule of input.scenario.assertionRules) {
    if (!assertions.has(rule.assertion)) {
      assertions.set(rule.assertion, unavailableAssertion(rule.assertion, "lossy_audit_source"));
    }
  }
  return input.scenario.assertionRules.map((rule) => assertions.get(rule.assertion)!);
}

function invalidRecord(session: AgentCollectionSession): ComputerFlowRunRecord {
  const assertions = session.input.scenario.assertionRules.map((rule) =>
    unavailableAssertion(rule.assertion, "collector_source_missing"));
  const events: ComputerFlowEvent[] = [];
  return signComputerFlowRun({
    schemaVersion: COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION,
    metricRulesVersion: COMPUTER_FLOW_METRIC_RULES_VERSION,
    scenarioVersion: COMPUTER_FLOW_SCENARIO_VERSION,
    fixtureVersion: COMPUTER_FLOW_FIXTURE_VERSION,
    scenarioId: session.input.scenario.id,
    mode: "agent",
    tier: "tier1",
    runKind: "recorded",
    repetition: session.input.repetition,
    runtimeBuild: session.input.runtimeBuild,
    machineClassId: session.input.machineClassId,
    disposition: "invalid",
    failureCategory: "collector_invalid",
    events,
    assertions,
    metrics: deriveComputerFlowMetrics(events, assertions, "agent"),
  }, session.input.collectorKey);
}

function runFailureCategory(assertions: readonly ComputerFlowAssertion[]): ComputerFlowFailureCategory {
  const completion = assertions.find((assertion) => assertion.assertion === "completion_oracle");
  if (!completion || completion.status === "unavailable") return "none";
  if (completion.status === "fail") return "verification_failed";
  return assertions.some((assertion) => assertion.status === "fail") ? "verification_failed" : "none";
}

export async function beginAgentCollection(input: AgentCollectionInput): Promise<AgentCollectionSession> {
  if (!Number.isInteger(input.repetition) || input.repetition < 1 || input.repetition > 10) {
    throw new Error("Computer flow recorded repetition must be in 1..10.");
  }
  if (input.fixtureKind === "web") {
    if (input.scenario.id === "native-macos-fixture-workflow" || input.webSession.scenarioId !== input.scenario.id) {
      throw new Error("Computer flow web fixture/scenario mismatch.");
    }
  } else if (input.scenario.id !== "native-macos-fixture-workflow") {
    throw new Error("Computer flow native fixture/scenario mismatch.");
  }

  const auditCursor = await captureAuditCursor(input.auditFile);
  let chromeProcessSession: ChromeProcessOracleSession | undefined;
  const needsChromeOracle = input.scenario.assertionRules.some((rule) => rule.assertion === "chrome_process_preserved");
  if (needsChromeOracle && input.chromeProcessProvider) {
    try {
      chromeProcessSession = await beginChromeProcessOracle(input.chromeProcessProvider);
    } catch {
      chromeProcessSession = undefined;
    }
  }
  return {
    input,
    auditCursor,
    ...(chromeProcessSession ? { chromeProcessSession } : {}),
  };
}

export async function finishAgentCollection(session: AgentCollectionSession): Promise<ComputerFlowRunRecord> {
  let observed: readonly ComputerFlowAuditEvent[];
  try {
    observed = parseAuditSlice(await readAuditSlice(session));
  } catch {
    return invalidRecord(session);
  }
  if (observed.some((event) => event.kind === "forbidden_observed")) return invalidRecord(session);

  const events = toRunEvents(observed);
  let assertions: ComputerFlowAssertion[];
  try {
    assertions = await collectAssertions(session);
  } catch {
    return invalidRecord(session);
  }
  return signComputerFlowRun({
    schemaVersion: COMPUTER_FLOW_BENCHMARK_SCHEMA_VERSION,
    metricRulesVersion: COMPUTER_FLOW_METRIC_RULES_VERSION,
    scenarioVersion: COMPUTER_FLOW_SCENARIO_VERSION,
    fixtureVersion: COMPUTER_FLOW_FIXTURE_VERSION,
    scenarioId: session.input.scenario.id,
    mode: "agent",
    tier: "tier1",
    runKind: "recorded",
    repetition: session.input.repetition,
    runtimeBuild: session.input.runtimeBuild,
    machineClassId: session.input.machineClassId,
    disposition: "eligible_completed",
    failureCategory: runFailureCategory(assertions),
    events,
    assertions,
    metrics: deriveComputerFlowMetrics(events, assertions, "agent"),
  }, session.input.collectorKey);
}
