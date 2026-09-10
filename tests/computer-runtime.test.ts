import { describe, expect, it } from "vitest";
import type { ComputerUseConfig } from "../src/config.js";
import { ComputerError } from "../src/computer-errors.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "../src/computer-runtime.js";
import type { ComputerNativeMethod } from "../src/computer-types.js";

type Call = { method: ComputerNativeMethod; params: Record<string, unknown>; timeoutMs?: number };

const config: ComputerUseConfig = {
  enabled: true,
  hostBundlePath: "/Users/test/.chatgpt-system/ChatGPTSystemComputerRuntime.app",
  requestTimeoutMs: 10_000,
  maxObservationElements: 500,
  maxObservationChars: 262_144,
  maxScreenshotBytes: 8_388_608,
  maxActionProgramActions: 100,
  maxActionProgramRuntimeMs: 30_000,
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
