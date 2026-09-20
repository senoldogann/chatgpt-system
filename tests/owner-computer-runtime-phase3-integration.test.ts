import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ComputerUseConfig } from "../src/config.js";
import { ComputerJsRuntime } from "../src/computer-js-runtime.js";
import { ComputerJsRunnerSupervisor } from "../src/computer-js-runner-supervisor.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "../src/computer-runtime.js";
import type { ComputerNativeMethod } from "../src/computer-types.js";

const runnerEntrypoint = fileURLToPath(new URL("../dist/computer-js-runner.js", import.meta.url));
const cleanups: string[] = [];

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

class AcceptanceNative implements ComputerNativeRequesting {
  readonly calls: Array<{ method: ComputerNativeMethod; timeoutMs?: number }> = [];
  nowAdvanceMs = 0;

  healthState() { return "running" as const; }

  async request(
    method: ComputerNativeMethod,
    _params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    this.calls.push({ method, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    return method === "pointer_position" ? { x: 1, y: 1 } : { state: "completed_unverified" };
  }

  async close(): Promise<void> {}
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("Owner Computer Runtime Phase 3 acceptance", () => {
  it("executes more than 100 Owner actions without widening the legacy config cap", async () => {
    const native = new AcceptanceNative();
    const computer = new ComputerRuntime(native, computerConfig);
    const actions = Array.from({ length: 101 }, () => ({ type: "pointer_position" as const }));

    const result = await computer.run({ actions, finalObservation: "none" }, { ownerMode: true });

    expect(computerConfig.maxActionProgramActions).toBe(100);
    expect(result.completedCount).toBe(101);
    expect(result.actionCount).toBe(101);
    expect(native.calls.filter((call) => call.method === "pointer_position")).toHaveLength(101);
  });

  it("keeps an explicit finite Owner timeout authoritative and releases inputs", async () => {
    const native = new AcceptanceNative();
    let now = 1_000;
    const computer = new ComputerRuntime(native, computerConfig, {
      now: () => now,
    });
    const originalRequest = native.request.bind(native);
    native.request = async (method, params, timeoutMs) => {
      const result = await originalRequest(method, params, timeoutMs);
      if (method === "move_mouse") now += 51;
      return result;
    };

    await expect(computer.run({
      actions: [
        { type: "move_mouse", x: 1, y: 1 },
        { type: "click", x: 2, y: 2 },
      ],
      finalObservation: "none",
      timeoutMs: 50,
    }, { ownerMode: true })).rejects.toMatchObject({
      code: "COMPUTER_TIMEOUT",
      details: { completedCount: 1, actionCount: 2 },
    });

    expect(native.calls.map((call) => call.method)).not.toContain("click");
    expect(native.calls.map((call) => call.method)).toContain("release_inputs");
  });

  const longIt = process.env.CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE === "1" ? it : it.skip;

  longIt("runs Owner JavaScript past the legacy 30 second ceiling without an implicit deadline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-phase3-long-"));
    cleanups.push(root);
    const native = new AcceptanceNative();
    const computer = new ComputerRuntime(native, computerConfig);
    const supervisor = new ComputerJsRunnerSupervisor({
      runnerEntrypoint,
      maxSourceBytes: computerConfig.maxJsSourceBytes,
      maxOutputBytes: computerConfig.maxJsOutputBytes,
      processStopGraceMs: 100,
    });
    const runtime = new ComputerJsRuntime(computer, {
      roots: [root],
      ownerRuntime: { enabled: true },
      computerUse: computerConfig,
    }, supervisor);

    const started = performance.now();
    try {
      const result = await runtime.run({
        source: `
          await new Promise((resolve) => setTimeout(resolve, 31_000));
          return { completed: true };
        `,
      });
      expect(performance.now() - started).toBeGreaterThanOrEqual(30_000);
      expect(result.result).toEqual({ completed: true });
    } finally {
      await runtime.close();
      await computer.close();
    }
  }, 45_000);
});
