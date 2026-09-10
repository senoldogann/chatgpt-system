import { describe, expect, it } from "vitest";
import type { ComputerUseConfig } from "../src/config.js";
import { ComputerError } from "../src/computer-errors.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "../src/computer-runtime.js";
import type { ComputerNativeMethod } from "../src/computer-types.js";

type Call = { method: ComputerNativeMethod; params: Record<string, unknown>; timeoutMs?: number };

const config: ComputerUseConfig = {
  enabled: true,
  fullHostJsEnabled: false,
  hostBundlePath: "/Users/test/.chatgpt-system/ChatGPTSystemComputerRuntime.app",
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
  readonly calls: Call[] = [];
  state: "disabled" | "stopped" | "running" | "unavailable" = "running";
  responder: (call: Call) => Promise<unknown> | unknown = (call) => {
    if (call.method === "health") {
      return {
        state: "running",
        accessibilityTrusted: true,
        screenCaptureAuthorized: true,
        eventListenAuthorized: true,
        eventPostAuthorized: true,
      };
    }
    return { state: "completed" };
  };

  healthState() { return this.state; }

  async request(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const call = { method, params, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
    this.calls.push(call);
    return this.responder(call);
  }

  async close(): Promise<void> {}
}

function runtime(native = new FakeNative(), overrides: Partial<ComputerUseConfig> = {}) {
  return { native, runtime: new ComputerRuntime(native, { ...config, ...overrides }) };
}

describe("ComputerRuntime direct operations", () => {
  it("returns disabled categorical health without touching the native host", async () => {
    const native = new FakeNative();
    native.state = "disabled";
    const subject = new ComputerRuntime(native, { ...config, enabled: false });

    await expect(subject.health()).resolves.toEqual({
      enabled: false,
      state: "disabled",
      accessibilityTrusted: false,
      screenCaptureAuthorized: false,
      eventListenAuthorized: false,
      eventPostAuthorized: false,
      fullHostJsEnabled: false,
    });
    expect(native.calls).toHaveLength(0);
  });

  it("maps enabled native health to the public categorical health shape", async () => {
    const { native, runtime: subject } = runtime();
    await expect(subject.health()).resolves.toEqual({
      enabled: true,
      state: "running",
      accessibilityTrusted: true,
      screenCaptureAuthorized: true,
      eventListenAuthorized: true,
      eventPostAuthorized: true,
      fullHostJsEnabled: false,
    });
    expect(native.calls[0]).toMatchObject({ method: "health", params: {}, timeoutMs: 10_000 });
  });

  it("reports the configured full-host JavaScript gate without asking the native host to decide it", async () => {
    const { runtime: subject } = runtime(new FakeNative(), { fullHostJsEnabled: true });

    await expect(subject.health()).resolves.toMatchObject({
      enabled: true,
      state: "running",
      fullHostJsEnabled: true,
    });
  });

  it("reports unavailable categorical health when the enabled host cannot answer", async () => {
    const { native, runtime: subject } = runtime();
    native.state = "unavailable";
    native.responder = () => { throw new ComputerError("COMPUTER_UNAVAILABLE"); };

    await expect(subject.health()).resolves.toMatchObject({
      enabled: true,
      state: "unavailable",
      accessibilityTrusted: false,
      screenCaptureAuthorized: false,
      eventListenAuthorized: false,
      eventPostAuthorized: false,
    });
  });

  it("maps direct methods to the accepted native protocol without inventing another vocabulary", async () => {
    const { native, runtime: subject } = runtime();

    await subject.pointerPosition();
    await subject.openApp({ bundleIdentifier: "com.example.App", timeoutMs: 900 });
    await subject.focusApp({ name: "Example", timeoutMs: 800 });
    await subject.moveMouse({ x: 10, y: 20, motionMode: "natural" });
    await subject.click({ x: 11, y: 21, count: 2, button: "right", motionMode: "fast" });
    await subject.drag({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, button: "left", motionMode: "fast" });
    await subject.scroll({ vertical: 4, horizontal: -2, x: 100, y: 200, motionMode: "instant" });
    await subject.typeText({ text: "hello", bundleIdentifier: "com.example.App" });
    await subject.pressKey({ key: "k", modifiers: ["command", "shift"], name: "Example" });
    await subject.waitForFrontmost({ bundleIdentifier: "com.example.App", timeoutMs: 700 });
    await subject.waitForText({ text: "Ready", exact: true, timeoutMs: 600 });
    await subject.waitUntilChanged({ baselineDigest: "abc123", timeoutMs: 500 });
    await subject.releaseInputs();

    expect(native.calls.map((call) => call.method)).toEqual([
      "pointer_position", "open_app", "focus_app", "move_mouse", "double_click", "drag", "scroll",
      "type_text", "press_key", "wait_for_frontmost", "wait_for_text", "wait_until_changed", "release_inputs",
    ]);
    expect(native.calls[4]?.params).toEqual({ x: 11, y: 21, button: "right", motionMode: "fast" });
  });

  it("serializes direct physical mutations in one FIFO lane", async () => {
    const { native, runtime: subject } = runtime();
    let releaseMove!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseMove = resolve; });
    native.responder = async (call) => {
      if (call.method === "move_mouse") await blocked;
      return { state: "completed" };
    };

    const first = subject.moveMouse({ x: 1, y: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const second = subject.click({ x: 2, y: 2 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(native.calls.map((call) => call.method)).toEqual(["move_mouse"]);
    releaseMove();
    await Promise.all([first, second]);
    expect(native.calls.map((call) => call.method)).toEqual(["move_mouse", "click"]);
  });

  it("does not make read-only observation wait behind the TypeScript physical lane", async () => {
    const { native, runtime: subject } = runtime();
    let releaseMove!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseMove = resolve; });
    native.responder = async (call) => {
      if (call.method === "move_mouse") {
        await blocked;
        return { state: "completed" };
      }
      if (call.method === "observe") {
        return { snapshotId: "snap", application: { name: "A", frontmost: true }, elements: [], truncated: false };
      }
      return { state: "completed" };
    };

    const moving = subject.moveMouse({ x: 1, y: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const observed = subject.observe();
    await expect(observed).resolves.toMatchObject({ snapshotId: "snap" });
    expect(native.calls.map((call) => call.method)).toEqual(["move_mouse", "observe"]);
    releaseMove();
    await moving;
  });

  it("re-checks screenshot decoded byte limits before returning content", async () => {
    const { native, runtime: subject } = runtime(undefined, { maxScreenshotBytes: 4 });
    native.responder = () => ({ pngBase64: Buffer.from("12345").toString("base64"), width: 1, height: 1 });

    await expect(subject.screenshot()).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
  });

  it("re-checks observation element and serialized-character limits", async () => {
    const native = new FakeNative();
    native.responder = () => ({
      snapshotId: "snap",
      application: { name: "A", frontmost: true },
      elements: [{ index: 0, role: "button" }, { index: 1, role: "button" }],
      truncated: false,
    });
    const elementsRuntime = new ComputerRuntime(native, { ...config, maxObservationElements: 1 });
    await expect(elementsRuntime.observe()).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });

    const charsRuntime = new ComputerRuntime(native, { ...config, maxObservationChars: 20 });
    await expect(charsRuntime.observe()).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
  });

  it("rejects invalid direct input before a native request is made", async () => {
    const { native, runtime: subject } = runtime();
    await expect(subject.moveMouse({ x: Number.NaN, y: 1 })).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    await expect(subject.scroll({ vertical: 10_001, horizontal: 0 })).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    await expect(subject.typeText({ text: "x".repeat(16_385), name: "Example" })).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    expect(native.calls).toHaveLength(0);
  });
});


describe("ComputerRuntime computer_run", () => {
  it("validates every action before any native mutation", async () => {
    const { native, runtime: subject } = runtime();
    await expect(subject.run({
      actions: [
        { type: "move_mouse", x: 10, y: 20 },
        { type: "scroll", vertical: 10_001, horizontal: 0 },
      ],
      finalObservation: "none",
    })).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    expect(native.calls).toHaveLength(0);
  });

  it("holds one physical lane across all steps and final input cleanup", async () => {
    const { native, runtime: subject } = runtime();
    let releaseMove!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseMove = resolve; });
    native.responder = async (call) => {
      if (call.method === "move_mouse") await blocked;
      return { state: "completed" };
    };

    const running = subject.run({
      actions: [
        { type: "move_mouse", x: 1, y: 1 },
        { type: "click", x: 2, y: 2 },
      ],
      finalObservation: "none",
    });
    await new Promise((resolve) => setImmediate(resolve));
    const outside = subject.click({ x: 3, y: 3 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(native.calls.map((call) => call.method)).toEqual(["move_mouse"]);
    releaseMove();
    await running;
    await outside;
    expect(native.calls.map((call) => call.method)).toEqual([
      "move_mouse", "click", "release_inputs", "click",
    ]);
  });

  it("rejects more than configured max actions before native work", async () => {
    const { native, runtime: subject } = runtime(undefined, { maxActionProgramActions: 1 });
    await expect(subject.run({
      actions: [{ type: "pointer_position" }, { type: "pointer_position" }],
      finalObservation: "none",
    })).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
    expect(native.calls).toHaveLength(0);
  });

  it("uses one absolute deadline and does not start another step after expiry", async () => {
    const native = new FakeNative();
    let now = 1_000;
    native.responder = (call) => {
      if (call.method === "pointer_position") now += 81;
      return { x: 1, y: 1 };
    };
    const subject = new ComputerRuntime(native, config, { now: () => now });

    await expect(subject.run({
      actions: [{ type: "pointer_position" }, { type: "pointer_position" }],
      finalObservation: "none",
      timeoutMs: 80,
    })).rejects.toMatchObject({
      code: "COMPUTER_TIMEOUT",
      details: { failedStepIndex: 1, failedActionType: "pointer_position", completedCount: 1, actionCount: 2 },
    });
    expect(native.calls).toHaveLength(1);
  });

  it("clamps each native request timeout to the remaining run deadline", async () => {
    const native = new FakeNative();
    let now = 2_000;
    native.responder = (call) => {
      if (call.method === "pointer_position") now += 30;
      return { x: 1, y: 1 };
    };
    const subject = new ComputerRuntime(native, config, { now: () => now });

    await subject.run({
      actions: [{ type: "pointer_position" }, { type: "pointer_position" }],
      finalObservation: "none",
      timeoutMs: 80,
    });
    expect(native.calls.map((call) => call.timeoutMs)).toEqual([80, 50]);
  });

  it("stops on the first failed step with no automatic retry and safe failure details", async () => {
    const { native, runtime: subject } = runtime();
    native.responder = (call) => {
      if (call.method === "wait_for_text") throw new ComputerError("COMPUTER_TIMEOUT");
      return { x: 1, y: 1 };
    };

    await expect(subject.run({
      actions: [
        { type: "pointer_position" },
        { type: "wait_for_text", text: "secret-ready" },
        { type: "pointer_position" },
      ],
      finalObservation: "none",
    })).rejects.toMatchObject({
      code: "COMPUTER_TIMEOUT",
      details: {
        failedStepIndex: 1,
        failedActionType: "wait_for_text",
        completedCount: 1,
        actionCount: 3,
      },
    });
    expect(native.calls.map((call) => call.method)).toEqual(["pointer_position", "wait_for_text"]);
    expect(JSON.stringify(native.calls)).toContain("secret-ready");
  });

  it("reports completed physical side effects without a rollback claim and releases input after failure", async () => {
    const { native, runtime: subject } = runtime();
    native.responder = (call) => {
      if (call.method === "click") throw new ComputerError("COMPUTER_ACTION_FAILED");
      return { state: "completed" };
    };

    let caught: unknown;
    try {
      await subject.run({
        actions: [
          { type: "move_mouse", x: 1, y: 1 },
          { type: "click", x: 2, y: 2 },
        ],
        finalObservation: "none",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "COMPUTER_ACTION_FAILED",
      details: { failedStepIndex: 1, completedCount: 1, actionCount: 2 },
    });
    expect(JSON.stringify(caught)).not.toContain("rollback");
    expect(native.calls.map((call) => call.method)).toEqual(["move_mouse", "click", "release_inputs"]);
  });

  it("allows raw mouse_down and mouse_up only inside a run and always finalizes with release_inputs", async () => {
    const { native, runtime: subject } = runtime();
    const result = await subject.run({
      actions: [
        { type: "mouse_down", button: "left" },
        { type: "mouse_up", button: "left" },
      ],
      finalObservation: "none",
    });
    expect(result).toMatchObject({ state: "completed", completedCount: 2, actionCount: 2 });
    expect(native.calls.map((call) => call.method)).toEqual(["mouse_down", "mouse_up", "release_inputs"]);
    expect("mouseDown" in subject).toBe(false);
    expect("mouseUp" in subject).toBe(false);
  });

  it("supports finalObservation none active_window and observe", async () => {
    for (const [mode, expected] of [
      ["none", ["pointer_position"]],
      ["active_window", ["pointer_position", "active_window"]],
      ["observe", ["pointer_position", "observe"]],
    ] as const) {
      const { native, runtime: subject } = runtime();
      native.responder = (call) => {
        if (call.method === "pointer_position") return { x: 1, y: 2 };
        if (call.method === "active_window") return { application: { name: "A", frontmost: true }, title: "Window" };
        if (call.method === "observe") return { snapshotId: "s", application: { name: "A", frontmost: true }, elements: [], truncated: false };
        return { state: "completed" };
      };
      const result = await subject.run({ actions: [{ type: "pointer_position" }], finalObservation: mode });
      expect(result.state).toBe("completed");
      expect(native.calls.map((call) => call.method)).toEqual(expected);
      if (mode !== "none") expect(result.finalObservation).toBeDefined();
    }
  });

  it("marks completed_unverified when only final observation fails and never replays mutations", async () => {
    const { native, runtime: subject } = runtime();
    native.responder = (call) => {
      if (call.method === "observe") throw new ComputerError("COMPUTER_UNAVAILABLE");
      return { state: "completed" };
    };

    const result = await subject.run({
      actions: [{ type: "click", x: 1, y: 1 }],
      finalObservation: "observe",
    });
    expect(result).toMatchObject({ state: "completed_unverified", completedCount: 1, actionCount: 1 });
    expect(native.calls.map((call) => call.method)).toEqual(["click", "observe", "release_inputs"]);
  });

  it("never echoes typed text in successful step summaries", async () => {
    const { runtime: subject } = runtime();
    const secretText = "do-not-echo-this-text";
    const result = await subject.run({
      actions: [{ type: "type_text", text: secretText, name: "Example" }],
      finalObservation: "none",
    });
    expect(JSON.stringify(result)).not.toContain(secretText);
    expect(result.steps).toEqual([{ index: 0, type: "type_text", state: "completed" }]);
  });
});


describe("ComputerRuntime shutdown", () => {
  it("does not spawn a stopped native host only to release inputs during shutdown", async () => {
    const events: string[] = [];
    const native: ComputerNativeRequesting = {
      healthState: () => "stopped",
      request: async (method) => {
        events.push(method);
        return { state: "completed" };
      },
      close: async () => { events.push("close"); },
    };
    const subject = new ComputerRuntime(native, config);

    await subject.close();
    expect(events).toEqual(["close"]);
  });

  it("releases inputs before closing a running native host and rejects later calls", async () => {
    const events: string[] = [];
    const native: ComputerNativeRequesting = {
      healthState: () => "running",
      request: async (method) => {
        events.push(method);
        return method === "pointer_position" ? { x: 1, y: 2 } : { state: "completed" };
      },
      close: async () => { events.push("close"); },
    };
    const subject = new ComputerRuntime(native, config);

    await subject.close();
    await subject.close();
    expect(events).toEqual(["release_inputs", "close"]);
    await expect(subject.pointerPosition()).rejects.toMatchObject({ code: "COMPUTER_UNAVAILABLE" });
    expect(events).toEqual(["release_inputs", "close"]);
  });

  it("stops an active computer_run before the next step when shutdown begins", async () => {
    const events: string[] = [];
    let releaseMove!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseMove = resolve; });
    const native: ComputerNativeRequesting = {
      healthState: () => "running",
      request: async (method) => {
        events.push(method);
        if (method === "move_mouse") await blocked;
        return { state: "completed" };
      },
      close: async () => { events.push("close"); },
    };
    const subject = new ComputerRuntime(native, config);
    const running = subject.run({
      actions: [
        { type: "move_mouse", x: 1, y: 1 },
        { type: "click", x: 2, y: 2 },
      ],
      finalObservation: "none",
    });
    await new Promise((resolve) => setImmediate(resolve));
    const closing = subject.close();
    releaseMove();

    await expect(running).rejects.toMatchObject({
      code: "COMPUTER_UNAVAILABLE",
      details: { failedStepIndex: 1, failedActionType: "click", completedCount: 1, actionCount: 2 },
    });
    await closing;
    expect(events).not.toContain("click");
    expect(events.at(-1)).toBe("close");
    expect(events.filter((event) => event === "release_inputs").length).toBeGreaterThanOrEqual(1);
  });
});
