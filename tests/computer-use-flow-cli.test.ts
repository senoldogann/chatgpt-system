import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ComputerFlowAssertion,
  ComputerFlowEvent,
  ComputerFlowMetrics,
  ComputerFlowRunRecord,
  ComputerFlowRuntimeBuild,
  ComputerFlowScenarioId,
} from "../benchmarks/computer-use-flow-performance/contract.js";
import { createEvidenceDigest, signComputerFlowRun } from "../benchmarks/computer-use-flow-performance/canonical.js";
import { deriveRuntimeBuildIdentity } from "../benchmarks/computer-use-flow-performance/identity.js";
import { getComputerFlowScenario } from "../benchmarks/computer-use-flow-performance/scenarios.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "benchmarks", "computer-use-flow-performance", "cli.ts");
let emittedRoot = "";
let emittedCliPath = "";
const runbookPath = path.join(repoRoot, "docs", "COMPUTER_USE_FLOW_BENCHMARK.md");
const keyText = "0123456789abcdef0123456789abcdef";
const wrongKeyText = "fedcba9876543210fedcba9876543210";
const key = new TextEncoder().encode(keyText);

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: undefined,
      ...env,
    };
    execFile(
      process.execPath,
      [emittedCliPath, ...args],
      { cwd: repoRoot, env: childEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof (error as NodeJS.ErrnoException & { code?: number | string }).code === "number"
          ? (error as NodeJS.ErrnoException & { code: number }).code
          : error ? 1 : 0;
        resolve({ exitCode: code, stdout, stderr });
      },
    );
  });
}

beforeAll(async () => {
  const cacheRoot = path.join(repoRoot, "node_modules", ".cache");
  await mkdir(cacheRoot, { recursive: true });
  emittedRoot = await mkdtemp(path.join(cacheRoot, "computer-flow-cli-emit-"));
  const configPath = path.join(repoRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    repoRoot,
    {
      noEmit: false,
      rootDir: repoRoot,
      outDir: emittedRoot,
      declaration: false,
      sourceMap: false,
    },
    configPath,
  );
  const program = ts.createProgram({ rootNames: [cliPath], options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => "\n",
    }));
  }
  const emit = program.emit();
  if (emit.emitSkipped) throw new Error("Computer flow CLI test emit was skipped.");
  emittedCliPath = path.join(emittedRoot, "benchmarks", "computer-use-flow-performance", "cli.js");
});

afterAll(async () => {
  if (emittedRoot) await rm(emittedRoot, { recursive: true, force: true });
});

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

function metric(value: number) {
  return { availability: "available", value } as const;
}

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

function requiredAssertions(
  scenarioId: ComputerFlowScenarioId,
  mode: ComputerFlowRunRecord["mode"],
): ComputerFlowAssertion[] {
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

function defaultEvents(mode: ComputerFlowRunRecord["mode"], operation: "observe" | "click" = "observe"): ComputerFlowEvent[] {
  return [
    { sequence: 0, elapsedMs: 0, mode, category: "workflow_start" },
    { sequence: 1, elapsedMs: 80, durationMs: 80, mode, category: "tool_boundary", operation, outcome: "completed" },
    { sequence: 2, elapsedMs: 100, mode, category: "workflow_end", outcome: "verified" },
  ];
}

function makeRun(input: {
  scenarioId?: ComputerFlowScenarioId;
  mode?: ComputerFlowRunRecord["mode"];
  repetition: number;
  runtimeBuild?: ComputerFlowRuntimeBuild;
  failureCategory?: ComputerFlowRunRecord["failureCategory"];
  metrics?: ComputerFlowMetrics;
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
    machineClassId: "m".repeat(64),
    disposition: "eligible_completed",
    failureCategory: input.failureCategory ?? "none",
    events: input.events ?? defaultEvents(mode),
    assertions: requiredAssertions(scenarioId, mode),
    metrics: input.metrics ?? metrics(),
  }, key);
}

function ten(input: Omit<Parameters<typeof makeRun>[0], "repetition"> = {}): ComputerFlowRunRecord[] {
  return Array.from({ length: 10 }, (_, index) => makeRun({ ...input, repetition: index + 1 }));
}

async function withTempDir<T>(work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "computer-flow-cli-test-"));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeBatch(directory: string, name: string, runs: readonly ComputerFlowRunRecord[]): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(runs), "utf8");
  return filePath;
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout.trim());
}

function expectFailure(result: CliResult, pattern: RegExp): void {
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toMatch(pattern);
}

describe("computer flow benchmark CLI", () => {
  it("lists all declared scenarios without requiring a collector key", async () => {
    const result = await runCli(["list"]);
    expect(result.exitCode).toBe(0);
    const listed = parseJson(result.stdout) as Array<{ id: string; goal: string }>;
    expect(listed).toHaveLength(6);
    expect(listed.map((item) => item.id)).toEqual([
      "open-focus-verify",
      "batched-multi-control-form",
      "scoped-nested-scrolling",
      "stale-dynamic-target-recovery",
      "weak-ax-ocr-visual-point",
      "native-macos-fixture-workflow",
    ]);
    expect(listed.every((item) => item.goal.length > 0)).toBe(true);
  });

  it("accepts the exact batch command shapes but fails before physical input when the collector key is missing", async () => {
    const runtime = await runCli([
      "runtime-batch",
      "--scenario", "open-focus-verify",
      "--runs", "10",
      "--warmups", "1",
      "--output", "benchmarks/computer-use-flow-performance/results",
    ]);
    expectFailure(runtime, /collector key/i);
    expect(runtime.stderr).not.toMatch(/unknown (option|argument)/i);

    const agent = await runCli([
      "agent-batch",
      "--scenario", "batched-multi-control-form",
      "--runs", "10",
      "--warmups", "1",
      "--audit-file", "~/.chatgpt-system/audit.jsonl",
      "--output", "benchmarks/computer-use-flow-performance/results",
    ]);
    expectFailure(agent, /collector key/i);
    expect(agent.stderr).not.toMatch(/unknown (option|argument)/i);
  });

  it("rejects invalid batch counts, unknown scenarios, and result-directory escapes before runtime setup", async () => {
    expectFailure(await runCli([
      "runtime-batch", "--scenario", "open-focus-verify", "--runs", "9", "--warmups", "1",
      "--output", "benchmarks/computer-use-flow-performance/results",
    ]), /--runs.*10/i);
    expectFailure(await runCli([
      "runtime-batch", "--scenario", "open-focus-verify", "--runs", "10", "--warmups", "0",
      "--output", "benchmarks/computer-use-flow-performance/results",
    ]), /--warmups.*1/i);
    expectFailure(await runCli([
      "runtime-batch", "--scenario", "not-a-scenario", "--runs", "10", "--warmups", "1",
      "--output", "benchmarks/computer-use-flow-performance/results",
    ]), /unknown scenario/i);
    expectFailure(await runCli([
      "runtime-batch", "--scenario", "open-focus-verify", "--runs", "10", "--warmups", "1",
      "--output", "benchmarks/computer-use-flow-performance/results/../escape",
    ]), /results directory/i);
  });

  it("evaluates signed records and rejects missing, wrong, or tampered signatures before arithmetic", async () => {
    await withTempDir(async (directory) => {
      const batch = await writeBatch(directory, "runtime.json", ten());
      const success = await runCli(["evaluate", batch], {
        CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText,
      });
      expect(success.exitCode).toBe(0);
      expect(parseJson(success.stdout)).toMatchObject({
        mode: "runtime",
        recordedRunCount: 10,
        fullTierGateStatus: "incomplete",
        scenarios: [{ scenarioId: "open-focus-verify", gateStatus: "pass" }],
      });

      expectFailure(await runCli(["evaluate", batch]), /collector key/i);
      expectFailure(await runCli(["evaluate", batch], {
        CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: wrongKeyText,
      }), /signature/i);

      const tampered = ten();
      tampered[0]!.metrics.runtimeDurationMs = metric(999);
      const tamperedPath = await writeBatch(directory, "tampered.json", tampered);
      expectFailure(await runCli(["evaluate", tamperedPath], {
        CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText,
      }), /signature/i);
    });
  });

  it("requires an explicit known objective before reading comparison artifacts", async () => {
    const missing = await runCli(["compare", "--scenario", "open-focus-verify", "missing-a.json", "missing-b.json"], {
      CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText,
    });
    expectFailure(missing, /objective/i);
    expect(missing.stderr).not.toMatch(/enoent|no such file/i);

    const unknown = await runCli([
      "compare", "--objective", "auto", "--scenario", "open-focus-verify", "missing-a.json", "missing-b.json",
    ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
    expectFailure(unknown, /unknown objective/i);
    expect(unknown.stderr).not.toMatch(/enoent|no such file/i);
  });

  it("constructs flow-boundary comparisons only from Agent Mode signed batches", async () => {
    await withTempDir(async (directory) => {
      const baseline = await writeBatch(directory, "baseline-agent.json", ten({
        mode: "agent",
        runtimeBuild: baselineBuild,
        metrics: metrics({ modelRoundTripCount: metric(3), endToEndDurationMs: metric(100) }),
      }));
      const candidate = await writeBatch(directory, "candidate-agent.json", ten({
        mode: "agent",
        runtimeBuild: candidateBuild,
        metrics: metrics({ modelRoundTripCount: metric(2), endToEndDurationMs: metric(90) }),
      }));
      const result = await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(result.exitCode).toBe(0);
      expect(parseJson(result.stdout)).toMatchObject({
        objectiveRule: "flow_boundary",
        mode: "agent",
        status: "pass",
        validPairCount: 10,
      });

      const flowLatency = await runCli([
        "compare", "--objective", "flow_latency", "--scenario", "open-focus-verify", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(flowLatency.exitCode).toBe(0);
      expect(parseJson(flowLatency.stdout)).toMatchObject({ objectiveRule: "flow_latency", mode: "agent", status: "pass" });

      expectFailure(await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify", baseline, candidate,
      ]), /collector key/i);
      expectFailure(await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: wrongKeyText }), /signature/i);
      const tamperedRuns = ten({ mode: "agent", runtimeBuild: candidateBuild });
      tamperedRuns[0]!.metrics.modelRoundTripCount = metric(99);
      const tamperedCandidate = await writeBatch(directory, "candidate-agent-tampered.json", tamperedRuns);
      expectFailure(await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify", baseline, tamperedCandidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /signature/i);

      const selector = await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify",
        "--selector", "runtime_total", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expectFailure(selector, /selector.*runtime_latency/i);

      const failureCategory = await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify",
        "--failure-category", "stale", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expectFailure(failureCategory, /failure category.*reliability/i);
    });
  });

  it("parses only the closed runtime-latency selector grammar and rejects objective/mode mismatch", async () => {
    await withTempDir(async (directory) => {
      const baseline = await writeBatch(directory, "baseline-runtime.json", ten({
        scenarioId: "weak-ax-ocr-visual-point",
        runtimeBuild: baselineBuild,
        events: defaultEvents("runtime", "click"),
        metrics: metrics({ runtimeDurationMs: metric(100), localActionProgramDurationMs: metric(80) }),
      }));
      const candidate = await writeBatch(directory, "candidate-runtime.json", ten({
        scenarioId: "weak-ax-ocr-visual-point",
        runtimeBuild: candidateBuild,
        events: defaultEvents("runtime", "click").map((event) =>
          event.durationMs === undefined ? event : { ...event, durationMs: 60 }),
        metrics: metrics({ runtimeDurationMs: metric(70), localActionProgramDurationMs: metric(60) }),
      }));

      expectFailure(await runCli([
        "compare", "--objective", "runtime_latency", "--scenario", "weak-ax-ocr-visual-point", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /selector.*required/i);

      expectFailure(await runCli([
        "compare", "--objective", "runtime_latency", "--scenario", "weak-ax-ocr-visual-point",
        "--selector", "operation:not_real", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /unknown.*selector|unknown.*operation/i);

      const runtimeTotal = await runCli([
        "compare", "--objective", "runtime_latency", "--scenario", "weak-ax-ocr-visual-point",
        "--selector", "runtime_total", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(runtimeTotal.exitCode).toBe(0);
      expect(parseJson(runtimeTotal.stdout)).toMatchObject({
        objectiveRule: "runtime_latency",
        mode: "runtime",
        selector: { kind: "runtime_total" },
      });

      const operation = await runCli([
        "compare", "--objective", "runtime_latency", "--scenario", "weak-ax-ocr-visual-point",
        "--selector", "operation:click", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(operation.exitCode).toBe(0);
      expect(parseJson(operation.stdout)).toMatchObject({
        objectiveRule: "runtime_latency",
        selector: { kind: "operation", operation: "click", aggregation: "sum_per_run" },
      });

      const localProgram = await runCli([
        "compare", "--objective", "runtime_latency", "--scenario", "weak-ax-ocr-visual-point",
        "--selector", "local_action_program", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(localProgram.exitCode).toBe(0);
      expect(parseJson(localProgram.stdout)).toMatchObject({
        objectiveRule: "runtime_latency",
        selector: { kind: "local_action_program" },
      });

      const agentBaseline = await writeBatch(directory, "runtime-objective-agent-base.json", ten({
        scenarioId: "weak-ax-ocr-visual-point", mode: "agent", runtimeBuild: baselineBuild,
      }));
      const agentCandidate = await writeBatch(directory, "runtime-objective-agent-candidate.json", ten({
        scenarioId: "weak-ax-ocr-visual-point", mode: "agent", runtimeBuild: candidateBuild,
      }));
      expectFailure(await runCli([
        "compare", "--objective", "runtime_latency", "--scenario", "weak-ax-ocr-visual-point",
        "--selector", "runtime_total", agentBaseline, agentCandidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /objective.*mode|mode.*objective/i);
    });
  });

  it("reports version mismatch as ineligible only after signed verification succeeds", async () => {
    await withTempDir(async (directory) => {
      const baselineRuns = ten({ mode: "agent", runtimeBuild: baselineBuild });
      const candidateRuns = ten({ mode: "agent", runtimeBuild: candidateBuild });
      const { collectorSignature: _signature, ...unsigned } = candidateRuns[0]!;
      candidateRuns[0] = signComputerFlowRun({
        ...unsigned,
        schemaVersion: 2,
      } as unknown as Omit<ComputerFlowRunRecord, "collectorSignature">, key);
      const baseline = await writeBatch(directory, "version-base.json", baselineRuns);
      const candidate = await writeBatch(directory, "version-candidate.json", candidateRuns);
      const result = await runCli([
        "compare", "--objective", "flow_boundary", "--scenario", "open-focus-verify", baseline, candidate,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(result.exitCode).toBe(0);
      expect(parseJson(result.stdout)).toMatchObject({ status: "ineligible", ineligibleReason: "version_mismatch" });
    });
  });

  it("requires reliability failure category and matched unique non-target signed guard batches", async () => {
    await withTempDir(async (directory) => {
      const target = "stale-dynamic-target-recovery" as const;
      const baselineTargetRuns = ten({ scenarioId: target, runtimeBuild: baselineBuild });
      baselineTargetRuns[0] = makeRun({ scenarioId: target, repetition: 1, runtimeBuild: baselineBuild, failureCategory: "stale" });
      baselineTargetRuns[1] = makeRun({ scenarioId: target, repetition: 2, runtimeBuild: baselineBuild, failureCategory: "stale" });
      const baselineTarget = await writeBatch(directory, "baseline-target.json", baselineTargetRuns);
      const candidateTarget = await writeBatch(directory, "candidate-target.json", ten({ scenarioId: target, runtimeBuild: candidateBuild }));
      const guardIds: ComputerFlowScenarioId[] = [
        "open-focus-verify",
        "batched-multi-control-form",
        "scoped-nested-scrolling",
        "weak-ax-ocr-visual-point",
        "native-macos-fixture-workflow",
      ];
      const baselineGuards: string[] = [];
      const candidateGuards: string[] = [];
      for (const scenarioId of guardIds) {
        baselineGuards.push(await writeBatch(directory, `baseline-${scenarioId}.json`, ten({ scenarioId, runtimeBuild: baselineBuild })));
        candidateGuards.push(await writeBatch(directory, `candidate-${scenarioId}.json`, ten({ scenarioId, runtimeBuild: candidateBuild })));
      }
      const guardArgs = baselineGuards.flatMap((file) => ["--baseline-guard", file])
        .concat(candidateGuards.flatMap((file) => ["--candidate-guard", file]));

      expectFailure(await runCli([
        "compare", "--objective", "reliability_defect", "--scenario", target,
        ...guardArgs, baselineTarget, candidateTarget,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /failure category.*required/i);

      expectFailure(await runCli([
        "compare", "--objective", "reliability_defect", "--scenario", target,
        "--failure-category", "none", ...guardArgs, baselineTarget, candidateTarget,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /none.*failure category|failure category.*none/i);

      expectFailure(await runCli([
        "compare", "--objective", "reliability_defect", "--scenario", target,
        "--failure-category", "stale", baselineTarget, candidateTarget,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /guard/i);

      const duplicateGuards = [
        "--baseline-guard", baselineGuards[0]!,
        "--baseline-guard", baselineGuards[0]!,
        ...baselineGuards.slice(1, 4).flatMap((file) => ["--baseline-guard", file]),
        ...candidateGuards.flatMap((file) => ["--candidate-guard", file]),
      ];
      expectFailure(await runCli([
        "compare", "--objective", "reliability_defect", "--scenario", target,
        "--failure-category", "stale", ...duplicateGuards, baselineTarget, candidateTarget,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /duplicate.*guard/i);

      const mismatchedCandidateGuard = await writeBatch(
        directory,
        "candidate-mismatched-guard.json",
        ten({ scenarioId: "open-focus-verify", runtimeBuild: candidateBuild }),
      );
      const mismatchedGuardArgs = baselineGuards.flatMap((file) => ["--baseline-guard", file])
        .concat(candidateGuards.slice(0, 4).flatMap((file) => ["--candidate-guard", file]))
        .concat(["--candidate-guard", mismatchedCandidateGuard]);
      expectFailure(await runCli([
        "compare", "--objective", "reliability_defect", "--scenario", target,
        "--failure-category", "stale", ...mismatchedGuardArgs, baselineTarget, candidateTarget,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText }), /mismatched|duplicate.*scenario/i);

      const result = await runCli([
        "compare", "--objective", "reliability_defect", "--scenario", target,
        "--failure-category", "stale", ...guardArgs, baselineTarget, candidateTarget,
      ], { CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY: keyText });
      expect(result.exitCode).toBe(0);
      expect(parseJson(result.stdout)).toMatchObject({
        objectiveRule: "reliability_defect",
        mode: "runtime",
        failureCategory: "stale",
        baselineFailureCount: 2,
        candidateFailureCount: 0,
        regressionGuardScenarioCount: 5,
      });
    });
  });

  it("documents and ignores the local privacy-safe results boundary", async () => {
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore.split(/\r?\n/)).toContain("benchmarks/computer-use-flow-performance/results/");

    const runbook = await readFile(runbookPath, "utf8");
    for (const required of [
      "Runtime Mode",
      "all six",
      "Agent Mode",
      "S1-S5",
      "best-effort",
      "lossy",
      "browser_runtime_absent",
      "computer_run_js",
      "57/60",
      "exclusive audit window",
      "pre ⊆ post",
      "independent fixture-owned",
      "local/ignored",
      "tampered signatures",
      "regression-guard",
      "Browser Runtime",
      "installed-helper replacement",
      "tunnel restart",
    ]) {
      expect(runbook).toContain(required);
    }
  });
});
