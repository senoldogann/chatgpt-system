import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPUTER_FLOW_SCENARIOS,
  getComputerFlowScenario,
} from "../benchmarks/computer-use-flow-performance/scenarios.js";
import {
  beginAgentCollection,
  COMPUTER_FLOW_MAX_AUDIT_SLICE_BYTES,
  finishAgentCollection,
  type AgentCollectionInput,
} from "../benchmarks/computer-use-flow-performance/agent-collector.js";
import { deriveRuntimeBuildIdentity } from "../benchmarks/computer-use-flow-performance/identity.js";
import { verifyComputerFlowRunSignature } from "../benchmarks/computer-use-flow-performance/canonical.js";
import { startComputerFlowWebFixture, type ComputerFlowWebFixtureHandle } from "../benchmarks/computer-use-flow-performance/web-fixture.js";
import { createComputerFlowNativeFixtureOracleReader } from "../benchmarks/computer-use-flow-performance/native-fixture-oracle.js";
import type { ChromeProcessSnapshotProvider } from "../benchmarks/computer-use-flow-performance/host-oracle.js";

const collectorKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const runtimeBuild = deriveRuntimeBuildIdentity({
  gitCommit: "a".repeat(40),
  workingTreeDigest: "b".repeat(64),
  computerProtocolVersion: 1,
  typeScriptArtifactSha256: "c".repeat(64),
  nativeHelperExecutableSha256: "d".repeat(64),
});
const machineClassId = "e".repeat(64);
const cleanups: string[] = [];
const fixtures: ComputerFlowWebFixtureHandle[] = [];

interface AuditLineInput {
  action: string;
  outcome?: "ok" | "error";
  durationMs?: number;
  metadata?: Record<string, boolean | number | string>;
  target?: string;
}

function auditLine(input: AuditLineInput): string {
  return `${JSON.stringify({
    id: "RAW_AUDIT_ID_CANARY",
    timestamp: "2026-09-16T00:00:00.000Z",
    action: input.action,
    outcome: input.outcome ?? "ok",
    durationMs: input.durationMs ?? 5,
    ...(input.target ? { target: input.target } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })}\n`;
}

async function createAuditFile(): Promise<{ directory: string; auditFile: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "computer-flow-agent-collector-"));
  cleanups.push(directory);
  const auditFile = path.join(directory, "audit.jsonl");
  await writeFile(auditFile, "", "utf8");
  return { directory, auditFile };
}

async function createWebInput(
  scenarioId: Exclude<Parameters<typeof getComputerFlowScenario>[0], "native-macos-fixture-workflow"> = "batched-multi-control-form",
  chromeProcessProvider?: ChromeProcessSnapshotProvider,
): Promise<{ input: AgentCollectionInput; fixture: ComputerFlowWebFixtureHandle }> {
  const { auditFile } = await createAuditFile();
  const fixture = await startComputerFlowWebFixture();
  fixtures.push(fixture);
  const webSession = await fixture.createSession(scenarioId);
  const input: AgentCollectionInput = {
    fixtureKind: "web",
    auditFile,
    scenario: getComputerFlowScenario(scenarioId),
    runtimeBuild,
    machineClassId,
    repetition: 1,
    collectorKey,
    webSession,
    webFixture: fixture,
    ...(chromeProcessProvider ? { chromeProcessProvider } : {}),
  };
  return { input, fixture };
}

async function completeForm(input: AgentCollectionInput): Promise<void> {
  if (input.fixtureKind !== "web") throw new Error("Expected web input.");
  const response = await fetch(`${input.webSession.url}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "form_submitted",
      textFieldsMatch: true,
      checkboxChecked: true,
      selectionMatch: true,
    }),
  });
  expect(response.status).toBe(204);
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(cleanups.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("computer flow Agent collector", () => {
  it("persists only positive categorical observed events while exact Agent metrics remain unavailable", async () => {
    const { input } = await createWebInput();
    const session = await beginAgentCollection(input);
    await completeForm(input);
    await appendFile(input.auditFile, [
      auditLine({
        action: "computer.observe",
        durationMs: 7,
        target: "RAW_TARGET_CANARY",
        metadata: { applicationBundleId: "RAW_BUNDLE_CANARY", arbitraryText: "RAW_METADATA_CANARY" },
      }),
      auditLine({ action: "computer.run", durationMs: 11, metadata: { actionCount: 3, completedCount: 3 } }),
    ].join(""), "utf8");

    const record = await finishAgentCollection(session);
    expect(record.disposition).toBe("eligible_completed");
    expect(record.failureCategory).toBe("none");
    expect(record.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: "agent", category: "observation", operation: "observe", outcome: "completed" }),
      expect.objectContaining({ mode: "agent", category: "tool_boundary", operation: "run", outcome: "completed" }),
    ]));
    expect(record.metrics.computerToolCallCount).toEqual({ availability: "unavailable", reason: "lossy_audit_source" });
    expect(record.metrics.modelRoundTripCount).toEqual({ availability: "unavailable", reason: "missing_turn_correlation" });
    expect(record.metrics.endToEndDurationMs).toEqual({ availability: "unavailable", reason: "missing_turn_correlation" });
    expect(record.metrics.timeToFirstUsableObservationMs).toEqual({ availability: "unavailable", reason: "missing_turn_correlation" });
    for (const metric of [
      record.metrics.observationCount,
      record.metrics.screenshotCount,
      record.metrics.axTargetingCount,
      record.metrics.ocrTargetingCount,
      record.metrics.visualPointTargetingCount,
      record.metrics.physicalActionCount,
      record.metrics.retryCount,
      record.metrics.replanCount,
    ]) {
      expect(metric).toEqual({ availability: "unavailable", reason: "lossy_audit_source" });
    }
    expect(record.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ assertion: "completion_oracle", status: "pass", source: "web_fixture_oracle" }),
      { assertion: "wrong_app_input_absent", status: "unavailable", reason: "lossy_audit_source" },
      { assertion: "browser_runtime_absent", status: "unavailable", reason: "lossy_audit_source" },
    ]));
    expect(verifyComputerFlowRunSignature(record, collectorKey)).toBe(true);

    const serialized = JSON.stringify(record);
    for (const forbidden of ["RAW_AUDIT_ID_CANARY", "RAW_TARGET_CANARY", "RAW_BUNDLE_CANARY", "RAW_METADATA_CANARY", "2026-09-16T00:00:00.000Z"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("maps observed direct success only to completed and never fabricates verification truth", async () => {
    const { input } = await createWebInput();
    const session = await beginAgentCollection(input);
    await completeForm(input);
    await appendFile(input.auditFile, auditLine({
      action: "computer.click",
      metadata: { sourceClass: "ocr", ocrInvoked: true },
    }), "utf8");

    const record = await finishAgentCollection(session);
    expect(record.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "click", outcome: "completed", targeting: "ocr" }),
    ]));
    expect(record.events.some((event) => event.outcome === "verified" || event.verified === true)).toBe(false);
    expect(record.metrics.verifiedCount).toEqual({ availability: "unavailable", reason: "lossy_audit_source" });
    expect(record.metrics.completedUnverifiedCount).toEqual({ availability: "unavailable", reason: "lossy_audit_source" });
    expect(record.assertions).toContainEqual({
      assertion: "false_verified_absent",
      status: "unavailable",
      reason: "lossy_audit_source",
    });
  });

  it("invalidates any observed forbidden surface including computer.run_js", async () => {
    for (const action of ["browser.navigate", "process.list", "shell.run", "fs.read", "git.status", "computer.run_js"]) {
      const { input } = await createWebInput();
      const session = await beginAgentCollection(input);
      await appendFile(input.auditFile, auditLine({ action }), "utf8");
      const record = await finishAgentCollection(session);
      expect(record).toMatchObject({ disposition: "invalid", failureCategory: "collector_invalid" });
      expect(verifyComputerFlowRunSignature(record, collectorKey)).toBe(true);
    }
  });

  it("fails closed on cursor loss, partial/malformed/oversize slices, unknown errors, and unknown scroll states", async () => {
    const cases: readonly ((input: AgentCollectionInput, directory: string) => Promise<void>)[] = [
      async (input, directory) => {
        const rotated = path.join(directory, "audit-old.jsonl");
        await rename(input.auditFile, rotated);
        await writeFile(input.auditFile, auditLine({ action: "computer.observe" }), "utf8");
      },
      async (input) => { await appendFile(input.auditFile, JSON.stringify({ action: "computer.observe" }), "utf8"); },
      async (input) => { await appendFile(input.auditFile, `${"x".repeat(COMPUTER_FLOW_MAX_AUDIT_SLICE_BYTES + 1)}\n`, "utf8"); },
      async (input) => { await appendFile(input.auditFile, "{not-json}\n", "utf8"); },
      async (input) => { await appendFile(input.auditFile, auditLine({ action: "computer.observe", outcome: "error", metadata: { errorCode: "NOT_A_REAL_ERROR" } }), "utf8"); },
      async (input) => { await appendFile(input.auditFile, auditLine({ action: "computer.scroll_until_visible", metadata: { state: "not_a_scroll_state" } }), "utf8"); },
    ];

    for (const mutate of cases) {
      const { input } = await createWebInput();
      const session = await beginAgentCollection(input);
      await appendFile(input.auditFile, auditLine({ action: "computer.observe" }), "utf8");
      await mutate(input, path.dirname(input.auditFile));
      const record = await finishAgentCollection(session);
      expect(record).toMatchObject({ disposition: "invalid", failureCategory: "collector_invalid" });
    }
  });

  it("invalidates audit truncation below the captured cursor size", async () => {
    const { input } = await createWebInput();
    await appendFile(input.auditFile, auditLine({ action: "computer.observe" }), "utf8");
    const session = await beginAgentCollection(input);
    await writeFile(input.auditFile, "", "utf8");
    const record = await finishAgentCollection(session);
    expect(record).toMatchObject({ disposition: "invalid", failureCategory: "collector_invalid" });
  });

  it("uses the web fixture as the only web completion source and does not join undeclared host evidence", async () => {
    const chromeProcessProvider: ChromeProcessSnapshotProvider = {
      async snapshotMainProcessIds() { return [101]; },
    };
    const { input } = await createWebInput("batched-multi-control-form", chromeProcessProvider);
    const session = await beginAgentCollection(input);
    await completeForm(input);
    const record = await finishAgentCollection(session);

    expect(record.assertions).toContainEqual(expect.objectContaining({
      assertion: "completion_oracle",
      status: "pass",
      source: "web_fixture_oracle",
    }));
    expect(record.assertions.some((assertion) => assertion.assertion === "chrome_process_preserved")).toBe(false);
  });

  it("supports optional native Agent completion only through the independent native fixture oracle", async () => {
    const { auditFile, directory } = await createAuditFile();
    const oraclePath = path.join(directory, "native-oracle.json");
    await writeFile(oraclePath, JSON.stringify({
      version: 1,
      ready: true,
      textMatchesExpectedToken: true,
      checkboxChecked: true,
      buttonPressCount: 1,
      textEditCount: 1,
      checkboxToggleCount: 1,
    }), { encoding: "utf8", mode: 0o600 });
    const input: AgentCollectionInput = {
      fixtureKind: "native",
      auditFile,
      scenario: COMPUTER_FLOW_SCENARIOS[5],
      runtimeBuild,
      machineClassId,
      repetition: 1,
      collectorKey,
      nativeOracle: createComputerFlowNativeFixtureOracleReader(oraclePath),
    };
    const session = await beginAgentCollection(input);
    const record = await finishAgentCollection(session);

    expect(record.assertions).toContainEqual(expect.objectContaining({
      assertion: "completion_oracle",
      status: "pass",
      source: "native_fixture_oracle",
    }));
    expect(record.assertions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "web_fixture_oracle" }),
    ]));
  });

  it("rejects fixture/scenario mismatches before collection begins", async () => {
    const { input } = await createWebInput("open-focus-verify");
    if (input.fixtureKind !== "web") throw new Error("Expected web input.");
    await expect(beginAgentCollection({
      ...input,
      scenario: getComputerFlowScenario("batched-multi-control-form"),
    })).rejects.toThrow(/fixture|scenario/i);
  });
});
