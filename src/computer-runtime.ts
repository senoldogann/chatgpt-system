import type { ComputerUseConfig } from "./config.js";
import { ComputerError } from "./computer-errors.js";
import type { ComputerNativeMethod } from "./computer-types.js";

export type ComputerHostState = "disabled" | "stopped" | "running" | "unavailable";

export interface ComputerNativeRequesting {
  healthState(): ComputerHostState;
  request(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

export interface ComputerHealthResult {
  enabled: boolean;
  state: ComputerHostState;
  accessibilityTrusted: boolean;
  screenCaptureAuthorized: boolean;
  eventListenAuthorized: boolean;
  eventPostAuthorized: boolean;
  fullHostJsEnabled: false;
}

export type PointerMotionMode = "instant" | "fast" | "natural";
export type ComputerMouseButton = "left" | "right" | "middle";
export type ComputerKeyModifier = "control" | "option" | "shift" | "command";

export type ComputerVerification =
  | { kind: "ax_changed"; timeoutMs?: number }
  | { kind: "text_appeared"; text: string; exact?: boolean; timeoutMs?: number }
  | {
      kind: "screen_region_changed";
      x: number;
      y: number;
      width: number;
      height: number;
      timeoutMs?: number;
    };

export interface ComputerApplicationSelector {
  bundleIdentifier?: string;
  name?: string;
}

export interface ComputerPoint {
  x: number;
  y: number;
}

const MAX_SELECTOR_CHARS = 4_096;
const MAX_TYPED_CHARS = 16_384;
const MAX_SCROLL_DELTA = 10_000;
const MOTION_MODES = new Set<PointerMotionMode>(["instant", "fast", "natural"]);
const MOUSE_BUTTONS = new Set<ComputerMouseButton>(["left", "right", "middle"]);
const KEY_MODIFIERS = new Set<ComputerKeyModifier>(["control", "option", "shift", "command"]);

function invalid(): never {
  throw new ComputerError("COMPUTER_PROTOCOL_INVALID");
}

function finite(value: number): number {
  if (!Number.isFinite(value)) invalid();
  return value;
}

function integerInRange(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) invalid();
  return value;
}

function optionalTimeout(value: number | undefined, max: number): number | undefined {
  if (value === undefined) return undefined;
  return integerInRange(value, 50, max);
}

function selectorParams(input: ComputerApplicationSelector): Record<string, unknown> {
  const bundleIdentifier = input.bundleIdentifier;
  const name = input.name;
  if (bundleIdentifier === undefined && name === undefined) invalid();
  const params: Record<string, unknown> = {};
  if (bundleIdentifier !== undefined) {
    if (bundleIdentifier.length === 0 || bundleIdentifier.length > MAX_SELECTOR_CHARS) invalid();
    params.bundleIdentifier = bundleIdentifier;
  }
  if (name !== undefined) {
    if (name.length === 0 || name.length > MAX_SELECTOR_CHARS) invalid();
    params.name = name;
  }
  return params;
}

function motionMode(value: PointerMotionMode | undefined): PointerMotionMode | undefined {
  if (value === undefined) return undefined;
  if (!MOTION_MODES.has(value)) invalid();
  return value;
}

function mouseButton(value: ComputerMouseButton | undefined): ComputerMouseButton | undefined {
  if (value === undefined) return undefined;
  if (!MOUSE_BUTTONS.has(value)) invalid();
  return value;
}

function verification(value: ComputerVerification | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value.kind === "ax_changed") {
    return {
      kind: value.kind,
      ...(value.timeoutMs !== undefined ? { timeoutMs: optionalTimeout(value.timeoutMs, 10_000) } : {}),
    };
  }
  if (value.kind === "text_appeared") {
    if (value.text.length === 0 || value.text.length > MAX_SELECTOR_CHARS) invalid();
    return {
      kind: value.kind,
      text: value.text,
      ...(value.exact !== undefined ? { exact: value.exact } : {}),
      ...(value.timeoutMs !== undefined ? { timeoutMs: optionalTimeout(value.timeoutMs, 10_000) } : {}),
    };
  }
  if (value.kind === "screen_region_changed") {
    finite(value.x);
    finite(value.y);
    finite(value.width);
    finite(value.height);
    if (value.width <= 0 || value.height <= 0) invalid();
    return {
      kind: value.kind,
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      ...(value.timeoutMs !== undefined ? { timeoutMs: optionalTimeout(value.timeoutMs, 10_000) } : {}),
    };
  }
  return invalid();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class PhysicalActionLane {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => gate, () => gate);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export class ComputerRuntime {
  private readonly physicalLane = new PhysicalActionLane();

  constructor(
    private readonly native: ComputerNativeRequesting,
    private readonly config: ComputerUseConfig,
  ) {}

  async health(): Promise<ComputerHealthResult> {
    if (!this.config.enabled) return this.unavailableHealth("disabled", false);
    try {
      const result = await this.native.request("health", {}, this.config.requestTimeoutMs);
      if (!isRecord(result)) return this.unavailableHealth("unavailable", true);
      return {
        enabled: true,
        state: result.state === "running" ? "running" : this.native.healthState(),
        accessibilityTrusted: result.accessibilityTrusted === true,
        screenCaptureAuthorized: result.screenCaptureAuthorized === true,
        eventListenAuthorized: result.eventListenAuthorized === true,
        eventPostAuthorized: result.eventPostAuthorized === true,
        fullHostJsEnabled: false,
      };
    } catch {
      return this.unavailableHealth("unavailable", true);
    }
  }

  pointerPosition(): Promise<unknown> {
    return this.read("pointer_position", {});
  }

  listApps(): Promise<unknown> {
    return this.read("list_apps", {});
  }

  activeWindow(): Promise<unknown> {
    return this.read("active_window", {});
  }

  async observe(): Promise<unknown> {
    const result = await this.read("observe", {});
    if (!isRecord(result)) invalid();
    const elements = result.elements;
    if (!Array.isArray(elements) || elements.length > this.config.maxObservationElements) {
      throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
    }
    if (JSON.stringify(result).length > this.config.maxObservationChars) {
      throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
    }
    return result;
  }

  async screenshot(): Promise<{ pngBase64: string; width: number; height: number }> {
    const result = await this.read("screenshot", {});
    if (!isRecord(result) || typeof result.pngBase64 !== "string" ||
        !Number.isInteger(result.width) || !Number.isInteger(result.height) ||
        (result.width as number) <= 0 || (result.height as number) <= 0) {
      invalid();
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(result.pngBase64 as string, "base64");
    } catch {
      invalid();
    }
    if (bytes.length === 0 || bytes.length > this.config.maxScreenshotBytes) {
      throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
    }
    return {
      pngBase64: result.pngBase64 as string,
      width: result.width as number,
      height: result.height as number,
    };
  }

  async openApp(input: ComputerApplicationSelector & { timeoutMs?: number }): Promise<unknown> {
    const params = selectorParams(input);
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 5_000);
    return this.physical("open_app", params);
  }

  async focusApp(input: ComputerApplicationSelector & { timeoutMs?: number }): Promise<unknown> {
    const params = selectorParams(input);
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 5_000);
    return this.physical("focus_app", params);
  }

  async moveMouse(input: ComputerPoint & { motionMode?: PointerMotionMode; verify?: ComputerVerification }): Promise<unknown> {
    const params: Record<string, unknown> = { x: finite(input.x), y: finite(input.y) };
    const mode = motionMode(input.motionMode);
    const verify = verification(input.verify);
    if (mode !== undefined) params.motionMode = mode;
    if (verify !== undefined) params.verify = verify;
    return this.physical("move_mouse", params);
  }

  async click(input: ComputerPoint & {
    count?: 1 | 2;
    button?: ComputerMouseButton;
    motionMode?: PointerMotionMode;
    verify?: ComputerVerification;
  }): Promise<unknown> {
    const count = input.count ?? 1;
    if (count !== 1 && count !== 2) invalid();
    const params: Record<string, unknown> = { x: finite(input.x), y: finite(input.y) };
    const button = mouseButton(input.button);
    const mode = motionMode(input.motionMode);
    const verify = verification(input.verify);
    if (button !== undefined) params.button = button;
    if (mode !== undefined) params.motionMode = mode;
    if (verify !== undefined) params.verify = verify;
    return this.physical(count === 2 ? "double_click" : "click", params);
  }

  async drag(input: {
    from: ComputerPoint;
    to: ComputerPoint;
    button?: ComputerMouseButton;
    motionMode?: PointerMotionMode;
    verify?: ComputerVerification;
  }): Promise<unknown> {
    const params: Record<string, unknown> = {
      from: { x: finite(input.from.x), y: finite(input.from.y) },
      to: { x: finite(input.to.x), y: finite(input.to.y) },
    };
    const button = mouseButton(input.button);
    const mode = motionMode(input.motionMode);
    const verify = verification(input.verify);
    if (button !== undefined) params.button = button;
    if (mode !== undefined) params.motionMode = mode;
    if (verify !== undefined) params.verify = verify;
    return this.physical("drag", params);
  }

  async scroll(input: {
    vertical: number;
    horizontal: number;
    x?: number;
    y?: number;
    motionMode?: PointerMotionMode;
    verify?: ComputerVerification;
  }): Promise<unknown> {
    integerInRange(input.vertical, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA);
    integerInRange(input.horizontal, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA);
    if ((input.x === undefined) !== (input.y === undefined)) invalid();
    const params: Record<string, unknown> = { vertical: input.vertical, horizontal: input.horizontal };
    if (input.x !== undefined && input.y !== undefined) {
      params.x = finite(input.x);
      params.y = finite(input.y);
    }
    const mode = motionMode(input.motionMode);
    const verify = verification(input.verify);
    if (mode !== undefined) params.motionMode = mode;
    if (verify !== undefined) params.verify = verify;
    return this.physical("scroll", params);
  }

  async typeText(input: ComputerApplicationSelector & { text: string; verify?: ComputerVerification }): Promise<unknown> {
    if (input.text.length > MAX_TYPED_CHARS) invalid();
    const params = selectorParams(input);
    params.text = input.text;
    const verify = verification(input.verify);
    if (verify !== undefined) params.verify = verify;
    return this.physical("type_text", params);
  }

  async pressKey(input: ComputerApplicationSelector & {
    key: string;
    modifiers?: ComputerKeyModifier[];
    verify?: ComputerVerification;
  }): Promise<unknown> {
    if (input.key.length === 0 || input.key.length > 128) invalid();
    const params = selectorParams(input);
    params.key = input.key;
    if (input.modifiers !== undefined) {
      const seen = new Set<ComputerKeyModifier>();
      for (const modifier of input.modifiers) {
        if (!KEY_MODIFIERS.has(modifier) || seen.has(modifier)) invalid();
        seen.add(modifier);
      }
      params.modifiers = input.modifiers;
    }
    const verify = verification(input.verify);
    if (verify !== undefined) params.verify = verify;
    return this.physical("press_key", params);
  }

  async waitForFrontmost(input: ComputerApplicationSelector & { timeoutMs?: number }): Promise<unknown> {
    const params = selectorParams(input);
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 10_000);
    return this.read("wait_for_frontmost", params);
  }

  async waitForText(input: { text: string; exact?: boolean; timeoutMs?: number }): Promise<unknown> {
    if (input.text.length === 0 || input.text.length > MAX_SELECTOR_CHARS) invalid();
    const params: Record<string, unknown> = { text: input.text };
    if (input.exact !== undefined) params.exact = input.exact;
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 10_000);
    return this.read("wait_for_text", params);
  }

  async waitUntilChanged(input: { baselineDigest: string; timeoutMs?: number }): Promise<unknown> {
    if (input.baselineDigest.length === 0 || input.baselineDigest.length > MAX_SELECTOR_CHARS) invalid();
    const params: Record<string, unknown> = { baselineDigest: input.baselineDigest };
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 10_000);
    return this.read("wait_until_changed", params);
  }

  async releaseInputs(): Promise<unknown> {
    return this.physical("release_inputs", {});
  }

  async close(): Promise<void> {
    await this.native.close();
  }

  private read(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs = this.config.requestTimeoutMs): Promise<unknown> {
    this.requireEnabled();
    return this.native.request(method, params, timeoutMs);
  }

  private physical(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs = this.config.requestTimeoutMs): Promise<unknown> {
    this.requireEnabled();
    return this.physicalLane.run(() => this.native.request(method, params, timeoutMs));
  }

  private requireEnabled(): void {
    if (!this.config.enabled) throw new ComputerError("COMPUTER_DISABLED");
  }

  private unavailableHealth(state: "disabled" | "unavailable", enabled: boolean): ComputerHealthResult {
    return {
      enabled,
      state,
      accessibilityTrusted: false,
      screenCaptureAuthorized: false,
      eventListenAuthorized: false,
      eventPostAuthorized: false,
      fullHostJsEnabled: false,
    };
  }
}
