import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ComputerError } from "../src/computer-errors.js";
import { ComputerJsRuntime } from "../src/computer-js-runtime.js";
import { ComputerJsRunnerSupervisor } from "../src/computer-js-runner-supervisor.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "../src/computer-runtime.js";
import type { ComputerUseConfig } from "../src/config.js";
import type { ComputerNativeMethod } from "../src/computer-types.js";

const runnerEntrypoint = fileURLToPath(new URL("../dist/computer-js-runner.js", import.meta.url));
const cleanups: string[] = [];
const closeables: Array<{ close(): Promise<void> }> = [];

const computerConfig: ComputerUseConfig = {
  enabled: true,
  fullHostJsEnabled: true,
  hostBundlePath: "/tmp/fixture.app",
  requestTimeoutMs: 10_000,
  maxObservationElements: 500,
  maxObservationChars: 262_144,
  maxScreenshotBytes: 8_388_608,
  maxActionProgramActions: 100,
  maxActionProgramRuntimeMs: 30_000,
  maxAutomaticRetriesPerAction: 2,
  maxJsSourceBytes: 262_144,
  maxJsRuntimeMs: 30_000,
  maxJsOutputBytes: 1_048_576,
};

const PHYSICAL_METHODS = new Set<ComputerNativeMethod>([
  "move_mouse",
  "click",
  "drag",
  "scroll",
  "type_text",
  "press_key",
]);

interface ResolvedView {
  source: "ax" | "ocr";
  bounds: { x: number; y: number; width: number; height: number };
  actionPoint: { x: number; y: number };
  observationId: string;
  confidence: "deterministic" | "high";
}

// Models the deterministic Task 8 fixture surface at the native protocol boundary.
class FixtureNative implements ComputerNativeRequesting {
  readonly calls: Array<{ method: ComputerNativeMethod; params: Record<string, unknown> }> = [];
  readonly ocrPasses: string[] = [];
  private readonly actuated: ComputerNativeMethod[] = [];
  private observationGeneration = 0;

  healthState() { return "running" as const; }

  get observationId(): string {
    return `fixture-obs-${this.observationGeneration}`;
  }

  private axView(label: string): ResolvedView {
    const reordered = this.observationGeneration > 0;
    const alphaFirst = label === "Reorder Alpha" ? !reordered : reordered;
    return {
      source: "ax",
      bounds: { x: alphaFirst ? 30 : 205, y: 282, width: 165, height: 32 },
      actionPoint: { x: alphaFirst ? 112 : 287, y: 298 },
      observationId: this.observationId,
      confidence: "deterministic",
    };
  }

  private resolveOne(target: Record<string, unknown>, retryBudget: number): ResolvedView {
    const by = target.by as string;
    const label = (target.label ?? target.text ?? "") as string;

    if (by === "index") {
      if (target.snapshotId !== this.observationId) {
        throw new ComputerError("COMPUTER_STALE_SNAPSHOT");
      }
      return this.axView("Reorder Alpha");
    }
    if (label === "Duplicate Action") {
      throw new ComputerError("COMPUTER_TARGET_AMBIGUOUS");
    }
    if (by === "ocrText") {
      if (label !== "Fixture Visual Submit") throw new ComputerError("COMPUTER_TARGET_NOT_FOUND");
      // The OCR-only target has no accessibility identity, so the host runs the
      // bounded fast pass and only then the accurate pass.
      this.ocrPasses.push("fast");
      if (retryBudget > 0) this.ocrPasses.push("accurate");
      return {
        source: "ocr",
        bounds: { x: 400, y: 236, width: 340, height: 52 },
        actionPoint: { x: 570, y: 262 },
        observationId: this.observationId,
        confidence: "high",
      };
    }
    return this.axView(label);
  }

  async request(method: ComputerNativeMethod, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    const retryBudget = typeof params.retryBudget === "number" ? params.retryBudget : 0;

    if (method === "resolve_target") {
      return this.resolveOne(params.target as Record<string, unknown>, retryBudget);
    }
    if (method === "resolve_targets") {
      return (params.targets as Array<Record<string, unknown>>)
        .map((target) => this.resolveOne(target, retryBudget));
    }
    if (method === "observe") {
      this.observationGeneration += 1;
      return {
        snapshotId: this.observationId,
        application: { name: "Fixture", bundleIdentifier: "com.example.fixture", processIdentifier: 1 },
        windowTitle: "Computer Runtime v2 Fixture",
        elements: [],
        truncated: false,
      };
    }
    if (PHYSICAL_METHODS.has(method)) {
      // The host resolves a semantic target before it actuates anything.
      if (params.target !== undefined) {
        this.resolveOne(params.target as Record<string, unknown>, retryBudget);
      }
      this.actuated.push(method);
    }
    return { state: "completed" };
  }

  async close(): Promise<void> {}

  actuatedCalls(): ComputerNativeMethod[] {
    return [...this.actuated];
  }
}

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "chatgpt-system-slice5-"));
  cleanups.push(directory);
  return directory;
}

function createRuntime(): { native: FixtureNative; computer: ComputerRuntime } {
  const native = new FixtureNative();
  const computer = new ComputerRuntime(native, computerConfig);
  closeables.push(computer);
  return { native, computer };
}

afterEach(async () => {
  for (const closeable of closeables.splice(0).reverse()) {
    try { await closeable.close(); } catch { /* cleanup-only */ }
  }
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("computer runtime v2 slice 5 recovery integration", () => {
  it("actuates a semantic accessibility target without an OCR pass", async () => {
    const { native, computer } = createRuntime();

    const resolved = await computer.resolve({ by: "label", label: "Fixture Button" }, {});
    await computer.run({
      actions: [{ type: "click", target: { by: "label", label: "Fixture Button" } }],
      finalObservation: "none",
    });

    expect(resolved.source).toBe("ax");
    expect(native.ocrPasses).toEqual([]);
    expect(native.actuatedCalls()).toEqual(["click"]);
  });

  it("refuses to actuate a stale index target instead of using old geometry", async () => {
    const { native, computer } = createRuntime();
    const staleSnapshotId = "fixture-obs-0";
    await computer.refreshObservation();

    await expect(
      computer.run({
        actions: [{ type: "click", target: { by: "index", snapshotId: staleSnapshotId, index: 0 } }],
        finalObservation: "none",
      }),
    ).rejects.toMatchObject({ code: "COMPUTER_STALE_SNAPSHOT" });
    expect(native.actuatedCalls()).toEqual([]);
  });

  it("recovers a text target from a fresh observation after a reorder", async () => {
    const { native, computer } = createRuntime();

    const before = await computer.resolve({ by: "text", text: "Reorder Alpha" }, {});
    await computer.refreshObservation();
    const after = await computer.resolve({ by: "text", text: "Reorder Alpha" }, {});

    expect(before.observationId).toBe("fixture-obs-0");
    expect(after.observationId).toBe("fixture-obs-1");
    expect(after.actionPoint).not.toEqual(before.actionPoint);
    expect(native.actuatedCalls()).toEqual([]);
  });

  it("closes a duplicate target as ambiguous without any physical click", async () => {
    const { native, computer } = createRuntime();

    await expect(
      computer.run({
        actions: [{ type: "click", target: { by: "label", label: "Duplicate Action" } }],
        finalObservation: "none",
      }),
    ).rejects.toMatchObject({ code: "COMPUTER_TARGET_AMBIGUOUS" });
    await expect(
      computer.exists({ by: "label", label: "Duplicate Action" }, {}),
    ).rejects.toBeInstanceOf(ComputerError);
    expect(native.actuatedCalls()).toEqual([]);
  });

  it("resolves the OCR-only fixture target through the bounded fast then accurate pipeline", async () => {
    const { native, computer } = createRuntime();

    const resolved = await computer.resolve(
      { by: "ocrText", text: "Fixture Visual Submit" },
      { retryBudget: 2 },
    );
    await computer.run({
      actions: [{ type: "click", target: { by: "ocrText", text: "Fixture Visual Submit" }, retryBudget: 2 }],
      finalObservation: "none",
    });

    expect(resolved.source).toBe("ocr");
    // One bounded pipeline for the explicit resolve, one for the click's own resolution.
    expect(native.ocrPasses).toEqual(["fast", "accurate", "fast", "accurate"]);
    expect(native.actuatedCalls()).toEqual(["click"]);
    const resolveCall = native.calls.find((call) => call.method === "resolve_target");
    expect(resolveCall?.params.retryBudget).toBe(2);
  });

  it("completes five semantic actions inside one computer_run_js invocation", async () => {
    const root = await tempDir();
    const { native, computer } = createRuntime();
    let spawnCount = 0;
    const supervisor = new ComputerJsRunnerSupervisor({
      runnerEntrypoint,
      maxSourceBytes: computerConfig.maxJsSourceBytes,
      maxOutputBytes: computerConfig.maxJsOutputBytes,
      processStopGraceMs: 100,
      spawnProcess: (command, args, options): ChildProcess => {
        spawnCount += 1;
        return spawn(command, [...args], options);
      },
    });
    const runtime = new ComputerJsRuntime(computer, { roots: [root], computerUse: computerConfig }, supervisor);
    closeables.push(runtime, supervisor);

    const result = await runtime.run({
      timeoutMs: 8_000,
      source: `
        const targets = [
          { by: "label", label: "Fixture Button" },
          { by: "label", label: "Fixture Checkbox" },
          { by: "text", text: "Reorder Alpha" },
          { by: "text", text: "Reorder Beta" },
          { by: "ocrText", text: "Fixture Visual Submit" },
        ];
        const resolved = await computer.resolveMany(targets, { retryBudget: 2 });
        for (const target of targets) {
          await computer.click({ target, retryBudget: 2 });
        }
        return { resolved: resolved.length, actions: targets.length };
      `,
    });

    expect(result.result).toEqual({ resolved: 5, actions: 5 });
    expect(spawnCount).toBe(1);
    expect(native.actuatedCalls()).toEqual(["click", "click", "click", "click", "click"]);
    expect(native.calls.filter((call) => call.method === "resolve_targets")).toHaveLength(1);
    expect(
      native.calls
        .filter((call) => call.method === "click")
        .every((call) => "target" in call.params),
    ).toBe(true);
  });
});
