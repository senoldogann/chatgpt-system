import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ComputerUseConfig } from "../src/config.js";
import { ComputerError } from "../src/computer-errors.js";
import { ComputerJsRuntime } from "../src/computer-js-runtime.js";
import type {
  ComputerJsRunnerRequest,
  ComputerJsRunnerResult,
} from "../src/computer-js-runner-supervisor.js";
import { dispatchComputerJsRpc } from "../src/computer-js-rpc.js";
import {
  ComputerRuntime,
  type ComputerNativeRequesting,
  type ComputerProgramSession,
} from "../src/computer-runtime.js";
import type { ComputerNativeMethod } from "../src/computer-types.js";
import { closeRuntimeResources } from "../src/runtime-shutdown.js";

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
  maxJsSourceBytes: 262_144,
  maxJsRuntimeMs: 30_000,
  maxJsOutputBytes: 1_048_576,
};

class FakeNative implements ComputerNativeRequesting {
  readonly calls: Array<{ method: ComputerNativeMethod; params: Record<string, unknown> }> = [];
  responder: (method: ComputerNativeMethod, params: Record<string, unknown>) => Promise<unknown> | unknown = () => ({ state: "completed" });

  healthState() { return "running" as const; }
  async request(method: ComputerNativeMethod, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    return this.responder(method, params);
  }
  async close(): Promise<void> {}
}

class FakeSupervisor {
  readonly calls: ComputerJsRunnerRequest[] = [];
  closeCalls = 0;
  responder: (request: ComputerJsRunnerRequest) => Promise<ComputerJsRunnerResult> | ComputerJsRunnerResult = () => ({ stdout: "", stderr: "" });

  async run(request: ComputerJsRunnerRequest): Promise<ComputerJsRunnerResult> {
    this.calls.push(request);
    return this.responder(request);
  }
  async close(): Promise<void> { this.closeCalls += 1; }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not reached");
}

async function fixture(overrides: Partial<ComputerUseConfig> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-runtime-"));
  cleanups.push(root);
  const native = new FakeNative();
  const computer = new ComputerRuntime(native, { ...computerConfig, ...overrides });
  const supervisor = new FakeSupervisor();
  const runtime = new ComputerJsRuntime(computer, {
    roots: [root],
    computerUse: { ...computerConfig, ...overrides },
  }, supervisor);
  return { root, native, computer, supervisor, runtime };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("ComputerJsRuntime", () => {
  it("fails closed when full-host JavaScript is disabled without spawning", async () => {
    const { runtime, supervisor } = await fixture({ fullHostJsEnabled: false });
    await expect(runtime.run({ source: "return 1;" })).rejects.toMatchObject({ code: "COMPUTER_JS_DISABLED" });
    expect(supervisor.calls).toHaveLength(0);
  });

  it("rejects oversized UTF-8 source before acquiring the program lane or spawning", async () => {
    const { runtime, supervisor } = await fixture({ maxJsSourceBytes: 8 });
    await expect(runtime.run({ source: "return '€€€';" })).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
    expect(supervisor.calls).toHaveLength(0);
  });

  it("uses root cwd by default, resolves relative cwd from it, allows absolute cwd, and clamps timeout", async () => {
    const { root, runtime, supervisor } = await fixture({ maxJsRuntimeMs: 250 });
    const relative = path.join(root, "nested");
    const absolute = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-absolute-"));
    cleanups.push(absolute);
    await mkdir(relative);

    await runtime.run({ source: "return 1;" });
    await runtime.run({ source: "return 2;", cwd: "nested", timeoutMs: 999 });
    await runtime.run({ source: "return 3;", cwd: absolute, timeoutMs: 125 });

    expect(supervisor.calls.map((call) => ({ cwd: call.cwd, timeoutMs: call.timeoutMs }))).toEqual([
      { cwd: await realpath(root), timeoutMs: 250 },
      { cwd: await realpath(relative), timeoutMs: 250 },
      { cwd: await realpath(absolute), timeoutMs: 125 },
    ]);
  });

  it("rejects nonexistent and non-directory cwd before spawning", async () => {
    const { root, runtime, supervisor } = await fixture();
    const file = path.join(root, "file.txt");
    await (await import("node:fs/promises")).writeFile(file, "x");

    await expect(runtime.run({ source: "return 1;", cwd: "missing" })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });
    await expect(runtime.run({ source: "return 1;", cwd: file })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });
    expect(supervisor.calls).toHaveLength(0);
  });

  it("serializes two JS runs before runner spawn and holds direct physical input behind the JS program", async () => {
    const { runtime, supervisor, computer, native } = await fixture();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    supervisor.responder = async () => {
      await firstBlocked;
      return { stdout: "", stderr: "", result: "done" };
    };

    const first = runtime.run({ source: "return 1;" });
    await waitUntil(() => supervisor.calls.length === 1);
    const second = runtime.run({ source: "return 2;" });
    const direct = computer.click({ x: 1, y: 2 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(supervisor.calls).toHaveLength(1);
    expect(native.calls).toHaveLength(0);
    releaseFirst();
    await first;
    await waitUntil(() => supervisor.calls.length === 2);
    expect(supervisor.calls).toHaveLength(2);
    await second;
    await direct;
    expect(native.calls.map((call) => call.method)).toContain("click");
  });

  it("dispatches strict runner RPC to the existing program session vocabulary", async () => {
    const actions: unknown[] = [];
    const session: ComputerProgramSession = {
      execute: async (action) => { actions.push(action); return { state: "completed" }; },
      listApps: async () => [{ name: "Fixture" }],
      activeWindow: async () => ({ title: "Fixture" }),
      screenshot: async () => ({ pngBase64: "AA==", width: 1, height: 1 }),
    };

    await expect(dispatchComputerJsRpc(session, "click", { x: 4, y: 5, button: "left" })).resolves.toEqual({ state: "completed" });
    expect(actions).toEqual([{ type: "click", x: 4, y: 5, button: "left" }]);
    await expect(dispatchComputerJsRpc(session, "click", { x: 4, y: 5, unexpected: true })).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    await expect(dispatchComputerJsRpc(session, "active_window", {})).resolves.toEqual({ title: "Fixture" });
    await expect(dispatchComputerJsRpc(session, "wait", { durationMs: 25 })).resolves.toEqual({ state: "completed" });
    expect(actions.at(-1)).toEqual({ type: "wait", durationMs: 25 });
  });

  it("shutdown closes JavaScript first so program input cleanup finishes before native computer close", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-shutdown-"));
    cleanups.push(root);
    const events: string[] = [];
    const native: ComputerNativeRequesting = {
      healthState: () => "running",
      request: async (method) => {
        events.push(method);
        return { state: "completed" };
      },
      close: async () => { events.push("native-close"); },
    };
    const computer = new ComputerRuntime(native, computerConfig);
    let rejectRun!: (error: unknown) => void;
    let started = false;
    let fallback: NodeJS.Timeout | undefined;
    const supervisor = {
      run: async () => {
        events.push("runner-start");
        started = true;
        return new Promise<ComputerJsRunnerResult>((_resolve, reject) => {
          rejectRun = reject;
          fallback = setTimeout(() => reject(new ComputerError("COMPUTER_JS_FAILED")), 150);
        });
      },
      close: async () => {
        events.push("runner-close");
        if (fallback) clearTimeout(fallback);
        rejectRun(new ComputerError("COMPUTER_JS_FAILED"));
      },
    };
    const runtime = new ComputerJsRuntime(computer, { roots: [root], computerUse: computerConfig }, supervisor);
    const running = runtime.run({ source: "await new Promise(() => {});" });
    const observedRun = running.catch((error) => error);
    await waitUntil(() => started);

    await closeRuntimeResources({
      runtime: {
        computerJs: runtime,
        computer,
        processSupervisor: { close: async () => { events.push("processes"); } },
        browser: { close: async () => { events.push("browser"); return { closed: true as const }; } },
      } as never,
      closeTransport: async () => { events.push("transport"); },
    });

    await expect(observedRun).resolves.toMatchObject({ code: "COMPUTER_JS_FAILED" });
    expect(events[0]).toBe("runner-start");
    expect(events.indexOf("runner-close")).toBeGreaterThan(0);
    expect(events.indexOf("runner-close")).toBeLessThan(events.indexOf("native-close"));
    expect(events.filter((event) => event === "release_inputs").length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)).toBe("transport");
  });

  it("closes the shared supervisor and refuses later runs", async () => {
    const { runtime, supervisor } = await fixture();
    await runtime.close();
    await runtime.close();
    expect(supervisor.closeCalls).toBe(1);
    await expect(runtime.run({ source: "return 1;" })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });
  });
});
