import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../../src/config.js";
import { COMPUTER_PROTOCOL_VERSION } from "../../src/computer-types.js";
import {
  COMPUTER_FLOW_FAILURE_CATEGORIES,
  COMPUTER_FLOW_OBJECTIVE_RULES,
  COMPUTER_FLOW_OPERATIONS,
  COMPUTER_FLOW_SCENARIO_IDS,
  type ComputerFlowComparisonInput,
  type ComputerFlowFailureCategory,
  type ComputerFlowMode,
  type ComputerFlowObjectiveRule,
  type ComputerFlowOperation,
  type ComputerFlowRunRecord,
  type ComputerFlowRuntimeLatencySelector,
  type ComputerFlowScenarioId,
} from "./contract.js";
import { verifyComputerFlowRunSignature } from "./canonical.js";
import { evaluateComputerFlowBatch, compareComputerFlowRuns } from "./evaluator.js";
import { beginAgentCollection, finishAgentCollection } from "./agent-collector.js";
import { createChromeProcessSnapshotProvider } from "./host-oracle.js";
import { readComputerFlowRuntimeIdentity } from "./identity.js";
import { createComputerFlowRuntimeHarness } from "./runtime-harness.js";
import { runRuntimeScenario } from "./runtime-mode.js";
import { COMPUTER_FLOW_SCENARIOS, getComputerFlowScenario } from "./scenarios.js";
import { startComputerFlowWebFixture } from "./web-fixture.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resultsRoot = path.join(repositoryRoot, "benchmarks", "computer-use-flow-performance", "results");
const scenarioSet = new Set<string>(COMPUTER_FLOW_SCENARIO_IDS);
const objectiveSet = new Set<string>(COMPUTER_FLOW_OBJECTIVE_RULES);
const operationSet = new Set<string>(COMPUTER_FLOW_OPERATIONS);
const failureSet = new Set<string>(COMPUTER_FLOW_FAILURE_CATEGORIES);

interface ParsedTokens {
  flags: Map<string, string[]>;
  positionals: string[];
}

function parseTokens(
  tokens: readonly string[],
  allowedFlags: readonly string[],
  repeatableFlags: readonly string[] = [],
): ParsedTokens {
  const allowed = new Set(allowedFlags);
  const repeatable = new Set(repeatableFlags);
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}.`);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Option --${name} requires a value.`);
    index += 1;
    const existing = flags.get(name) ?? [];
    if (existing.length > 0 && !repeatable.has(name)) throw new Error(`Option --${name} may be supplied only once.`);
    existing.push(value);
    flags.set(name, existing);
  }
  return { flags, positionals };
}

function singleFlag(parsed: ParsedTokens, name: string, required = true): string | undefined {
  const values = parsed.flags.get(name) ?? [];
  if (values.length === 0) {
    if (required) throw new Error(`Option --${name} is required.`);
    return undefined;
  }
  return values[0];
}

function requireScenario(value: string | undefined): ComputerFlowScenarioId {
  if (!value || !scenarioSet.has(value)) throw new Error(`Unknown scenario: ${value ?? "<missing>"}.`);
  return value as ComputerFlowScenarioId;
}

function requireObjective(value: string | undefined): ComputerFlowObjectiveRule {
  if (!value) throw new Error("Comparison objective is required.");
  if (!objectiveSet.has(value)) throw new Error(`Unknown objective: ${value}.`);
  return value as ComputerFlowObjectiveRule;
}

function requireCollectorKey(): Uint8Array {
  const value = process.env.CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY;
  if (!value) throw new Error("Computer flow collector key is required in CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY.");
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength < 32) throw new Error("Computer flow collector key must be at least 32 UTF-8 bytes.");
  return bytes;
}

function resolveResultDirectory(value: string | undefined): string {
  if (!value) throw new Error("Option --output is required.");
  const resolved = path.resolve(repositoryRoot, value);
  const relative = path.relative(resultsRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Computer flow output must remain inside the benchmark results directory.");
  }
  return resolved;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return path.resolve(repositoryRoot, value);
}

function runArtifactName(mode: ComputerFlowMode, scenarioId: ComputerFlowScenarioId, buildId: string): string {
  return `${mode}-${scenarioId}-${buildId}.json`;
}

async function writeRunArtifact(
  outputDirectory: string,
  mode: ComputerFlowMode,
  scenarioId: ComputerFlowScenarioId,
  buildId: string,
  runs: readonly ComputerFlowRunRecord[],
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(outputDirectory, runArtifactName(mode, scenarioId, buildId));
  const relative = path.relative(outputDirectory, artifactPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Computer flow artifact escaped its selected results directory.");
  await writeFile(artifactPath, `${JSON.stringify(runs, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return artifactPath;
}

async function loadRuns(filePath: string): Promise<ComputerFlowRunRecord[]> {
  const parsed: unknown = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Computer flow artifact must contain a non-empty run array.");
  if (parsed.some((value) => typeof value !== "object" || value === null || Array.isArray(value))) {
    throw new Error("Computer flow artifact contains an invalid run record.");
  }
  return parsed as ComputerFlowRunRecord[];
}

function verifyRuns(runs: readonly ComputerFlowRunRecord[], collectorKey: Uint8Array, label: string): void {
  for (const run of runs) {
    let verified = false;
    try {
      verified = verifyComputerFlowRunSignature(run, collectorKey);
    } catch {
      verified = false;
    }
    if (!verified) throw new Error(`${label} signature verification failed.`);
  }
}

async function currentIdentity() {
  const config = await loadConfig({ computerUseEnabled: true });
  return readComputerFlowRuntimeIdentity({
    repositoryRoot,
    distDirectory: path.join(repositoryRoot, "dist"),
    nativeHelperExecutablePath: path.join(
      config.computerUse.hostBundlePath,
      "Contents",
      "MacOS",
      "chatgpt-system-computer-runtime",
    ),
    protocolVersion: COMPUTER_PROTOCOL_VERSION,
  });
}

function parseBatchCommand(tokens: readonly string[], mode: ComputerFlowMode) {
  const allowed = mode === "agent"
    ? ["scenario", "runs", "warmups", "audit-file", "output"]
    : ["scenario", "runs", "warmups", "output"];
  const parsed = parseTokens(tokens, allowed);
  if (parsed.positionals.length !== 0) throw new Error("Batch commands do not accept positional arguments.");
  const scenarioId = requireScenario(singleFlag(parsed, "scenario"));
  const runs = Number(singleFlag(parsed, "runs"));
  const warmups = Number(singleFlag(parsed, "warmups"));
  if (runs !== 10) throw new Error("--runs must be exactly 10.");
  if (warmups !== 1) throw new Error("--warmups must be exactly 1.");
  const outputDirectory = resolveResultDirectory(singleFlag(parsed, "output"));
  const auditFile = mode === "agent" ? singleFlag(parsed, "audit-file") : undefined;
  return { scenarioId, outputDirectory, ...(auditFile ? { auditFile: expandHome(auditFile) } : {}) };
}

async function runRuntimeBatch(tokens: readonly string[]): Promise<void> {
  const parsed = parseBatchCommand(tokens, "runtime");
  const collectorKey = requireCollectorKey();
  const identity = await currentIdentity();
  const chromeProcessProvider = createChromeProcessSnapshotProvider();
  const harness = await createComputerFlowRuntimeHarness();
  const webFixture = parsed.scenarioId === "native-macos-fixture-workflow"
    ? undefined
    : await startComputerFlowWebFixture();
  const recorded: ComputerFlowRunRecord[] = [];
  try {
    const common = {
      runtimeBuild: identity.runtimeBuild,
      machineClassId: identity.machineClassId,
      collectorKey,
      harness,
      chromeProcessProvider,
    } as const;
    if (parsed.scenarioId === "native-macos-fixture-workflow") {
      await runRuntimeScenario({ ...common, scenarioId: parsed.scenarioId, repetition: 1 });
      for (let repetition = 1; repetition <= 10; repetition += 1) {
        recorded.push(await runRuntimeScenario({ ...common, scenarioId: parsed.scenarioId, repetition }));
      }
    } else {
      if (!webFixture) throw new Error("Computer flow web fixture was unavailable.");
      await runRuntimeScenario({ ...common, scenarioId: parsed.scenarioId, repetition: 1, webFixture });
      for (let repetition = 1; repetition <= 10; repetition += 1) {
        recorded.push(await runRuntimeScenario({ ...common, scenarioId: parsed.scenarioId, repetition, webFixture }));
      }
    }
  } finally {
    await webFixture?.close().catch(() => {});
    await harness.close().catch(() => {});
  }
  const artifactPath = await writeRunArtifact(
    parsed.outputDirectory,
    "runtime",
    parsed.scenarioId,
    identity.runtimeBuild.buildId,
    recorded,
  );
  process.stdout.write(`${JSON.stringify({ mode: "runtime", scenarioId: parsed.scenarioId, artifactPath })}\n`);
}

async function waitForOperator(): Promise<void> {
  const readline = createInterface({ input, output });
  try {
    await readline.question("");
  } finally {
    readline.close();
  }
}

function printAgentRun(inputValue: {
  scenarioId: ComputerFlowScenarioId;
  goal: string;
  runOrdinal: string | number;
  fixtureUrl?: string;
}): void {
  process.stdout.write(`${JSON.stringify(inputValue)}\n`);
}

async function runAgentBatch(tokens: readonly string[]): Promise<void> {
  const parsed = parseBatchCommand(tokens, "agent");
  if (!parsed.auditFile) throw new Error("Option --audit-file is required.");
  const collectorKey = requireCollectorKey();
  const identity = await currentIdentity();
  const scenario = getComputerFlowScenario(parsed.scenarioId);
  const chromeProcessProvider = createChromeProcessSnapshotProvider();
  const webFixture = parsed.scenarioId === "native-macos-fixture-workflow"
    ? undefined
    : await startComputerFlowWebFixture();
  const harness = parsed.scenarioId === "native-macos-fixture-workflow"
    ? await createComputerFlowRuntimeHarness()
    : undefined;
  const recorded: ComputerFlowRunRecord[] = [];
  const ordinals: Array<string | number> = ["warmup", ...Array.from({ length: 10 }, (_, index) => index + 1)];
  try {
    for (const ordinal of ordinals) {
      const repetition = typeof ordinal === "number" ? ordinal : 1;
      if (parsed.scenarioId === "native-macos-fixture-workflow") {
        if (!harness) throw new Error("Computer flow native fixture harness was unavailable.");
        const fixture = await harness.startOwnedNativeFixture();
        try {
          const nativeScenario = { ...scenario, id: "native-macos-fixture-workflow" as const };
          const session = await beginAgentCollection({
            auditFile: parsed.auditFile,
            scenario: nativeScenario,
            runtimeBuild: identity.runtimeBuild,
            machineClassId: identity.machineClassId,
            repetition,
            collectorKey,
            fixtureKind: "native",
            nativeOracle: fixture.oracle,
          });
          printAgentRun({ scenarioId: parsed.scenarioId, goal: scenario.exactGoal, runOrdinal: ordinal });
          await waitForOperator();
          const record = await finishAgentCollection(session);
          if (ordinal !== "warmup") recorded.push(record);
        } finally {
          await fixture.close().catch(() => {});
        }
      } else {
        if (!webFixture) throw new Error("Computer flow web fixture was unavailable.");
        const webSession = await webFixture.createSession(parsed.scenarioId);
        const session = await beginAgentCollection({
          auditFile: parsed.auditFile,
          scenario,
          runtimeBuild: identity.runtimeBuild,
          machineClassId: identity.machineClassId,
          repetition,
          collectorKey,
          fixtureKind: "web",
          webSession,
          webFixture,
          chromeProcessProvider,
        });
        printAgentRun({
          scenarioId: parsed.scenarioId,
          goal: scenario.exactGoal,
          fixtureUrl: webSession.url,
          runOrdinal: ordinal,
        });
        await waitForOperator();
        const record = await finishAgentCollection(session);
        if (ordinal !== "warmup") recorded.push(record);
      }
    }
  } finally {
    await webFixture?.close().catch(() => {});
    await harness?.close().catch(() => {});
  }
  const artifactPath = await writeRunArtifact(
    parsed.outputDirectory,
    "agent",
    parsed.scenarioId,
    identity.runtimeBuild.buildId,
    recorded,
  );
  process.stdout.write(`${JSON.stringify({ mode: "agent", scenarioId: parsed.scenarioId, artifactPath })}\n`);
}

function parseSelector(value: string | undefined): ComputerFlowRuntimeLatencySelector {
  if (!value) throw new Error("Runtime latency selector is required.");
  if (value === "runtime_total") return { kind: "runtime_total" };
  if (value === "local_action_program") return { kind: "local_action_program" };
  if (value.startsWith("operation:")) {
    const operation = value.slice("operation:".length);
    if (!operationSet.has(operation)) throw new Error(`Unknown runtime selector operation: ${operation}.`);
    return { kind: "operation", operation: operation as ComputerFlowOperation, aggregation: "sum_per_run" };
  }
  throw new Error(`Unknown runtime selector: ${value}.`);
}

function requireFailureCategory(value: string | undefined): Exclude<ComputerFlowFailureCategory, "none"> {
  if (!value) throw new Error("Reliability failure category is required.");
  if (value === "none") throw new Error("none is not a valid reliability failure category.");
  if (!failureSet.has(value)) throw new Error(`Unknown failure category: ${value}.`);
  return value as Exclude<ComputerFlowFailureCategory, "none">;
}

function requireTargetBatch(
  runs: readonly ComputerFlowRunRecord[],
  scenarioId: ComputerFlowScenarioId,
  mode: ComputerFlowMode,
  label: string,
): void {
  if (runs.some((run) => run.scenarioId !== scenarioId || run.mode !== mode)) {
    throw new Error(`${label} objective/mode mismatch for scenario ${scenarioId}.`);
  }
}

async function loadGuardSide(
  files: readonly string[],
  collectorKey: Uint8Array,
  side: "baseline" | "candidate",
  targetScenarioId: ComputerFlowScenarioId,
  mode: ComputerFlowMode,
): Promise<ComputerFlowRunRecord[]> {
  if (files.length !== 5) throw new Error(`Reliability ${side} guard requires exactly five non-target scenario batches.`);
  if (new Set(files.map((file) => path.resolve(file))).size !== files.length) throw new Error(`Duplicate ${side} guard file.`);
  const expectedIds = new Set(COMPUTER_FLOW_SCENARIO_IDS.filter((scenarioId) => scenarioId !== targetScenarioId));
  const seen = new Set<ComputerFlowScenarioId>();
  const all: ComputerFlowRunRecord[] = [];
  for (const file of files) {
    const runs = await loadRuns(file);
    verifyRuns(runs, collectorKey, `${side} guard`);
    if (runs.length !== 10) throw new Error(`Reliability ${side} guard batches require exactly ten signed runs per scenario.`);
    const scenarioId = runs[0]!.scenarioId;
    if (!expectedIds.has(scenarioId) || seen.has(scenarioId) || runs.some((run) => run.scenarioId !== scenarioId || run.mode !== mode)) {
      throw new Error(`Reliability ${side} guard contains a mismatched or duplicate non-target scenario.`);
    }
    seen.add(scenarioId);
    all.push(...runs);
  }
  if (seen.size !== expectedIds.size || [...expectedIds].some((scenarioId) => !seen.has(scenarioId))) {
    throw new Error(`Reliability ${side} guard scenario set is incomplete.`);
  }
  return all;
}

async function runEvaluate(tokens: readonly string[]): Promise<void> {
  if (tokens.length !== 1) throw new Error("evaluate requires exactly one artifact path.");
  const collectorKey = requireCollectorKey();
  const runs = await loadRuns(tokens[0]!);
  verifyRuns(runs, collectorKey, "Evaluate artifact");
  process.stdout.write(`${JSON.stringify(evaluateComputerFlowBatch(runs, collectorKey))}\n`);
}

async function runCompare(tokens: readonly string[]): Promise<void> {
  const parsed = parseTokens(
    tokens,
    ["objective", "scenario", "selector", "failure-category", "baseline-guard", "candidate-guard"],
    ["baseline-guard", "candidate-guard"],
  );
  const objectiveRule = requireObjective(singleFlag(parsed, "objective"));
  const scenarioId = requireScenario(singleFlag(parsed, "scenario"));
  const selectorValue = singleFlag(parsed, "selector", false);
  const failureCategoryValue = singleFlag(parsed, "failure-category", false);
  const baselineGuardFiles = parsed.flags.get("baseline-guard") ?? [];
  const candidateGuardFiles = parsed.flags.get("candidate-guard") ?? [];

  let selector: ComputerFlowRuntimeLatencySelector | undefined;
  let failureCategory: Exclude<ComputerFlowFailureCategory, "none"> | undefined;
  if (objectiveRule === "runtime_latency") selector = parseSelector(selectorValue);
  else if (selectorValue !== undefined) throw new Error("--selector is accepted only for runtime_latency.");
  if (objectiveRule === "reliability_defect") failureCategory = requireFailureCategory(failureCategoryValue);
  else if (failureCategoryValue !== undefined) throw new Error("Failure category is accepted only for reliability_defect.");
  if (objectiveRule !== "reliability_defect" && (baselineGuardFiles.length > 0 || candidateGuardFiles.length > 0)) {
    throw new Error("Regression guard files are accepted only for reliability_defect.");
  }
  if (parsed.positionals.length !== 2) throw new Error("compare requires baseline and candidate artifact paths.");

  const collectorKey = requireCollectorKey();
  const baselineRuns = await loadRuns(parsed.positionals[0]!);
  const candidateRuns = await loadRuns(parsed.positionals[1]!);
  verifyRuns(baselineRuns, collectorKey, "Baseline artifact");
  verifyRuns(candidateRuns, collectorKey, "Candidate artifact");
  const baselineRuntimeBuild = baselineRuns[0]!.runtimeBuild;
  const candidateRuntimeBuild = candidateRuns[0]!.runtimeBuild;

  let comparison: ComputerFlowComparisonInput;
  if (objectiveRule === "flow_boundary" || objectiveRule === "flow_latency") {
    requireTargetBatch(baselineRuns, scenarioId, "agent", "Baseline");
    requireTargetBatch(candidateRuns, scenarioId, "agent", "Candidate");
    comparison = {
      objectiveRule,
      mode: "agent",
      scenarioId,
      baselineRuntimeBuild,
      candidateRuntimeBuild,
      baselineRuns,
      candidateRuns,
    };
  } else if (objectiveRule === "runtime_latency") {
    requireTargetBatch(baselineRuns, scenarioId, "runtime", "Baseline");
    requireTargetBatch(candidateRuns, scenarioId, "runtime", "Candidate");
    comparison = {
      objectiveRule,
      mode: "runtime",
      scenarioId,
      selector: selector!,
      baselineRuntimeBuild,
      candidateRuntimeBuild,
      baselineRuns,
      candidateRuns,
    };
  } else {
    const mode = baselineRuns[0]!.mode;
    requireTargetBatch(baselineRuns, scenarioId, mode, "Baseline");
    requireTargetBatch(candidateRuns, scenarioId, mode, "Candidate");
    const baselineOtherScenarioRuns = await loadGuardSide(
      baselineGuardFiles,
      collectorKey,
      "baseline",
      scenarioId,
      mode,
    );
    const candidateOtherScenarioRuns = await loadGuardSide(
      candidateGuardFiles,
      collectorKey,
      "candidate",
      scenarioId,
      mode,
    );
    const baselineIds = new Set(baselineOtherScenarioRuns.map((run) => run.scenarioId));
    const candidateIds = new Set(candidateOtherScenarioRuns.map((run) => run.scenarioId));
    if (baselineIds.size !== candidateIds.size || [...baselineIds].some((scenarioIdValue) => !candidateIds.has(scenarioIdValue))) {
      throw new Error("Reliability baseline/candidate guard scenario sets must match.");
    }
    comparison = {
      objectiveRule,
      mode,
      scenarioId,
      failureCategory: failureCategory!,
      regressionGuard: { baselineOtherScenarioRuns, candidateOtherScenarioRuns },
      baselineRuntimeBuild,
      candidateRuntimeBuild,
      baselineRuns,
      candidateRuns,
    };
  }
  process.stdout.write(`${JSON.stringify(compareComputerFlowRuns(comparison, collectorKey))}\n`);
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...tokens] = argv;
  switch (command) {
    case "list":
      if (tokens.length !== 0) throw new Error("list does not accept arguments.");
      process.stdout.write(`${JSON.stringify(COMPUTER_FLOW_SCENARIOS.map((scenario) => ({ id: scenario.id, goal: scenario.exactGoal })))}\n`);
      return;
    case "runtime-batch":
      return runRuntimeBatch(tokens);
    case "agent-batch":
      return runAgentBatch(tokens);
    case "evaluate":
      return runEvaluate(tokens);
    case "compare":
      return runCompare(tokens);
    default:
      throw new Error(`Unknown command: ${command ?? "<missing>"}.`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Computer flow benchmark CLI failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
