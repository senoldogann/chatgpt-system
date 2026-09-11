import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveBenchmarkMetrics,
  evaluateBenchmarkRun,
  getBenchmarkScenario,
  listBenchmarkScenarios,
  materializeBenchmarkScenario,
  scenarioDigest,
} from "../benchmarks/coding-harness-v2/benchmark.mjs";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

const expectedScenarioIds = [
  "repository-discovery",
  "single-file-fix",
  "cross-file-fix",
  "refactor",
  "failing-test-diagnosis",
  "runtime-browser-debug",
  "resume-after-context-loss",
  "concurrent-modification",
  "transaction-failure",
  "sandbox-escape",
  "stale-verification",
].sort();

describe("Coding Harness v2 benchmark protocol", () => {
  it("defines the complete deterministic scenario catalog without claiming model parity", () => {
    const scenarios = listBenchmarkScenarios();
    expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(expectedScenarioIds);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);

    for (const scenario of scenarios) {
      expect(scenario.task.trim().length).toBeGreaterThan(20);
      expect(scenario.requirements.length).toBeGreaterThan(0);
      expect(new Set(scenario.requirements.map((requirement) => requirement.id)).size).toBe(scenario.requirements.length);
      expect(scenario.fixture.files.length).toBeGreaterThan(0);
      expect(scenario.expectedCapabilities.length).toBeGreaterThan(0);
      expect(scenarioDigest(scenario.id)).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(scenario).toLowerCase()).not.toContain("codex parity");
    }
  });

  it("materializes the same fixture bytes and metadata for repeated runs", async () => {
    const first = await mkdtemp(path.join(tmpdir(), "chatgpt-system-benchmark-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "chatgpt-system-benchmark-b-"));
    cleanups.push(first, second);

    const firstResult = await materializeBenchmarkScenario("cross-file-fix", first);
    const secondResult = await materializeBenchmarkScenario("cross-file-fix", second);

    expect(firstResult.scenarioDigest).toBe(secondResult.scenarioDigest);
    expect(firstResult.fixtureDigest).toBe(secondResult.fixtureDigest);
    expect(firstResult.head).toBe(secondResult.head);
    expect(firstResult.files).toEqual(secondResult.files);
    expect(await readFile(path.join(first, "TASK.md"), "utf8")).toBe(await readFile(path.join(second, "TASK.md"), "utf8"));
    expect(firstResult.head).toMatch(/^[a-f0-9]{40}$/);
  });

  it("derives all required benchmark metrics from events and unified diff instead of trusting a claimed score", () => {
    const scenario = getBenchmarkScenario("single-file-fix");
    const events = [
      { type: "tool_call", tool: "code_query", outcome: "ok" },
      { type: "read", path: "src/math.ts", relevant: true },
      { type: "read", path: "README.md", relevant: false },
      { type: "edit", path: "src/math.ts", expected: true },
      { type: "edit", path: "notes.txt", expected: false },
      { type: "tool_call", tool: "project_check", outcome: "error", retryOf: 1 },
      { type: "check", checkId: "package-script:check", status: "PASS", fresh: true },
      { type: "human_intervention", reason: "benchmark fixture" },
      { type: "completion_claim", verified: false },
      { type: "security_violation", code: "POLICY_DENIED" },
      { type: "regression", name: "unrelated-test" },
      { type: "requirement", requirementId: scenario.requirements[0]!.id, met: true },
    ] as const;
    const diff = [
      "diff --git a/src/math.ts b/src/math.ts",
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -1,2 +1,2 @@",
      "-export const value = 1;",
      "+export const value = 2;",
      " unchanged",
    ].join("\n");

    expect(deriveBenchmarkMetrics(scenario, events, diff)).toEqual({
      requirementsMet: 1,
      requirementsTotal: scenario.requirements.length,
      toolCalls: 2,
      wrongReads: 1,
      wrongEdits: 1,
      retries: 1,
      humanInterventions: 1,
      checksRun: 1,
      evidenceFreshness: "FRESH",
      falseCompletionClaims: 1,
      securityScopeViolations: 1,
      regressions: 1,
      finalDiffSize: { addedLines: 1, removedLines: 1, changedLines: 2 },
    });
  });

  it("exposes deterministic list/prepare/evaluate CLI commands", async () => {
    const cli = path.resolve("benchmarks/coding-harness-v2/benchmark.mjs");
    const listed = JSON.parse(execFileSync(process.execPath, [cli, "list"], { encoding: "utf8" })) as Array<{ id: string; scenarioDigest: string }>;
    expect(listed.map((item) => item.id).sort()).toEqual(expectedScenarioIds);
    expect(listed.every((item) => /^[a-f0-9]{64}$/.test(item.scenarioDigest))).toBe(true);

    const prepared = await mkdtemp(path.join(tmpdir(), "chatgpt-system-benchmark-cli-"));
    const recordDir = await mkdtemp(path.join(tmpdir(), "chatgpt-system-benchmark-record-"));
    cleanups.push(prepared, recordDir);
    const preparedResult = JSON.parse(execFileSync(process.execPath, [cli, "prepare", "single-file-fix", prepared], { encoding: "utf8" })) as { scenarioId: string; head: string; fixtureDigest: string };
    expect(preparedResult.scenarioId).toBe("single-file-fix");
    expect(preparedResult.head).toMatch(/^[a-f0-9]{40}$/);
    expect(preparedResult.fixtureDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path.join(prepared, "TASK.md"), "utf8")).toContain("Single-file fix");

    const scenario = getBenchmarkScenario("single-file-fix");
    const recordPath = path.join(recordDir, "run.json");
    await writeFile(recordPath, `${JSON.stringify({
      scenarioId: scenario.id,
      events: [
        ...scenario.requirements.map((requirement) => ({ type: "requirement", requirementId: requirement.id, met: true })),
        { type: "check", checkId: "package-script:check", status: "PASS", fresh: true },
        { type: "completion_claim", verified: true },
      ],
      finalDiff: "--- a/src/math.ts\n+++ b/src/math.ts\n-old\n+new\n",
    })}\n`, "utf8");
    const evaluated = JSON.parse(execFileSync(process.execPath, [cli, "evaluate", recordPath], { encoding: "utf8" })) as { taskSuccess: boolean; metrics: { evidenceFreshness: string } };
    expect(evaluated.taskSuccess).toBe(true);
    expect(evaluated.metrics.evidenceFreshness).toBe("FRESH");
  });

  it("marks success only when every requirement is met with fresh evidence and no safety/regression/false-completion failures", () => {
    const scenario = getBenchmarkScenario("single-file-fix");
    const requirementEvents = scenario.requirements.map((requirement) => ({
      type: "requirement" as const,
      requirementId: requirement.id,
      met: true,
    }));
    const passingEvents = [
      ...requirementEvents,
      { type: "tool_call" as const, tool: "code_query", outcome: "ok" as const },
      { type: "edit" as const, path: "src/math.ts", expected: true },
      { type: "check" as const, checkId: "package-script:check", status: "PASS" as const, fresh: true },
      { type: "completion_claim" as const, verified: true },
    ];

    const passed = evaluateBenchmarkRun({
      scenarioId: scenario.id,
      events: passingEvents,
      finalDiff: "--- a/src/math.ts\n+++ b/src/math.ts\n-old\n+new\n",
    });
    expect(passed.taskSuccess).toBe(true);
    expect(passed.requirementsSatisfied).toBe(true);
    expect(passed.metrics.evidenceFreshness).toBe("FRESH");

    const stale = evaluateBenchmarkRun({
      scenarioId: scenario.id,
      events: passingEvents.map((event) => event.type === "check" ? { ...event, fresh: false } : event),
      finalDiff: "--- a/src/math.ts\n+++ b/src/math.ts\n-old\n+new\n",
    });
    expect(stale.taskSuccess).toBe(false);
    expect(stale.metrics.evidenceFreshness).toBe("STALE");

    const unsafe = evaluateBenchmarkRun({
      scenarioId: scenario.id,
      events: [...passingEvents, { type: "security_violation" as const, code: "SCOPE_ESCAPE" }],
      finalDiff: "--- a/src/math.ts\n+++ b/src/math.ts\n-old\n+new\n",
    });
    expect(unsafe.taskSuccess).toBe(false);
  });
});
