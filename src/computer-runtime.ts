import type { ComputerUseConfig } from "./config.js";
import { ComputerError, isComputerErrorCode } from "./computer-errors.js";
import type {
  ComputerAction,
  ComputerFinalObservation,
  ComputerNativeMethod,
  ComputerRunResult,
} from "./computer-types.js";

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
  fullHostJsEnabled: boolean;
}

export type PointerMotionMode = "instant" | "fast" | "natural";
export type ComputerMouseButton = "left" | "right" | "middle";
export type ComputerKeyModifier = "control" | "option" | "shift" | "command";

export type ComputerVerification =
  | { kind: "ax_changed"; timeoutMs?: number | undefined }
  | { kind: "text_appeared"; text: string; exact?: boolean | undefined; timeoutMs?: number | undefined }
  | {
      kind: "screen_region_changed";
      x: number;
      y: number;
      width: number;
      height: number;
      timeoutMs?: number | undefined;
    };

export interface ComputerApplicationSelector {
  bundleIdentifier?: string | undefined;
  name?: string | undefined;
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

interface PreparedComputerAction {
  type: ComputerAction["type"];
  method?: ComputerNativeMethod;
  params: Record<string, unknown>;
  physical: boolean;
  localWaitMs?: number;
}

function preparedAction(action: ComputerAction): PreparedComputerAction {
  switch (action.type) {
    case "observe":
      return { type: action.type, method: "observe", params: {}, physical: false };
    case "pointer_position":
      return { type: action.type, method: "pointer_position", params: {}, physical: false };
    case "open_app":
    case "focus_app": {
      const params = selectorParams(action);
      if (action.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(action.timeoutMs, 5_000);
      return { type: action.type, method: action.type, params, physical: true };
    }
    case "move_mouse": {
      const params: Record<string, unknown> = { x: finite(action.x), y: finite(action.y) };
      const mode = motionMode(action.motionMode);
      const verify = verification(action.verify);
      if (mode !== undefined) params.motionMode = mode;
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: "move_mouse", params, physical: true };
    }
    case "click":
    case "double_click": {
      const params: Record<string, unknown> = { x: finite(action.x), y: finite(action.y) };
      const button = mouseButton(action.button);
      const mode = motionMode(action.motionMode);
      const verify = verification(action.verify);
      if (button !== undefined) params.button = button;
      if (mode !== undefined) params.motionMode = mode;
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: action.type, params, physical: true };
    }
    case "mouse_down":
    case "mouse_up": {
      const params: Record<string, unknown> = {};
      const button = mouseButton(action.button);
      const verify = verification(action.verify);
      if (button !== undefined) params.button = button;
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: action.type, params, physical: true };
    }
    case "drag": {
      const params: Record<string, unknown> = {
        from: { x: finite(action.from.x), y: finite(action.from.y) },
        to: { x: finite(action.to.x), y: finite(action.to.y) },
      };
      const button = mouseButton(action.button);
      const mode = motionMode(action.motionMode);
      const verify = verification(action.verify);
      if (button !== undefined) params.button = button;
      if (mode !== undefined) params.motionMode = mode;
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: "drag", params, physical: true };
    }
    case "scroll": {
      integerInRange(action.vertical, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA);
      integerInRange(action.horizontal, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA);
      if ((action.x === undefined) !== (action.y === undefined)) invalid();
      const params: Record<string, unknown> = { vertical: action.vertical, horizontal: action.horizontal };
      if (action.x !== undefined && action.y !== undefined) {
        params.x = finite(action.x);
        params.y = finite(action.y);
      }
      const mode = motionMode(action.motionMode);
      const verify = verification(action.verify);
      if (mode !== undefined) params.motionMode = mode;
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: "scroll", params, physical: true };
    }
    case "type_text": {
      if (action.text.length > MAX_TYPED_CHARS) invalid();
      const params = selectorParams(action);
      params.text = action.text;
      const verify = verification(action.verify);
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: "type_text", params, physical: true };
    }
    case "press_key": {
      if (action.key.length === 0 || action.key.length > 128) invalid();
      const params = selectorParams(action);
      params.key = action.key;
      if (action.modifiers !== undefined) {
        const seen = new Set<ComputerKeyModifier>();
        for (const modifier of action.modifiers) {
          if (!KEY_MODIFIERS.has(modifier) || seen.has(modifier)) invalid();
          seen.add(modifier);
        }
        params.modifiers = action.modifiers;
      }
      const verify = verification(action.verify);
      if (verify !== undefined) params.verify = verify;
      return { type: action.type, method: "press_key", params, physical: true };
    }
    case "wait":
      if (!Number.isInteger(action.durationMs) || action.durationMs < 0) invalid();
      return { type: action.type, params: {}, physical: false, localWaitMs: action.durationMs };
    case "wait_for_frontmost": {
      const params = selectorParams(action);
      if (action.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(action.timeoutMs, 10_000);
      return { type: action.type, method: "wait_for_frontmost", params, physical: false };
    }
    case "wait_for_text": {
      if (action.text.length === 0 || action.text.length > MAX_SELECTOR_CHARS) invalid();
      const params: Record<string, unknown> = { text: action.text };
      if (action.exact !== undefined) params.exact = action.exact;
      if (action.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(action.timeoutMs, 10_000);
      return { type: action.type, method: "wait_for_text", params, physical: false };
    }
    case "wait_until_changed": {
      if (action.baselineDigest.length === 0 || action.baselineDigest.length > MAX_SELECTOR_CHARS) invalid();
      const params: Record<string, unknown> = { baselineDigest: action.baselineDigest };
      if (action.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(action.timeoutMs, 10_000);
      return { type: action.type, method: "wait_until_changed", params, physical: false };
    }
    case "release_inputs":
      return { type: action.type, method: "release_inputs", params: {}, physical: true };
  }
}

function validateObservationOutput(result: unknown, config: ComputerUseConfig): unknown {
  if (!isRecord(result)) invalid();
  const elements = result.elements;
  if (!Array.isArray(elements) || elements.length > config.maxObservationElements) {
    throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
  }
  if (JSON.stringify(result).length > config.maxObservationChars) {
    throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
  }
  return result;
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
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private closing = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly native: ComputerNativeRequesting,
    private readonly config: ComputerUseConfig,
    deps: { now?: () => number; sleep?: (milliseconds: number) => Promise<void> } = {},
  ) {
    this.now = deps.now ?? (() => performance.now());
    this.sleep = deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

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
        fullHostJsEnabled: this.config.fullHostJsEnabled,
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
    return validateObservationOutput(await this.read("observe", {}), this.config);
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

  async openApp(input: ComputerApplicationSelector & { timeoutMs?: number | undefined }): Promise<unknown> {
    const params = selectorParams(input);
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 5_000);
    return this.physical("open_app", params);
  }

  async focusApp(input: ComputerApplicationSelector & { timeoutMs?: number | undefined }): Promise<unknown> {
    const params = selectorParams(input);
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 5_000);
    return this.physical("focus_app", params);
  }

  async moveMouse(input: ComputerPoint & { motionMode?: PointerMotionMode | undefined; verify?: ComputerVerification | undefined }): Promise<unknown> {
    const params: Record<string, unknown> = { x: finite(input.x), y: finite(input.y) };
    const mode = motionMode(input.motionMode);
    const verify = verification(input.verify);
    if (mode !== undefined) params.motionMode = mode;
    if (verify !== undefined) params.verify = verify;
    return this.physical("move_mouse", params);
  }

  async click(input: ComputerPoint & {
    count?: 1 | 2 | undefined;
    button?: ComputerMouseButton | undefined;
    motionMode?: PointerMotionMode | undefined;
    verify?: ComputerVerification | undefined;
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
    button?: ComputerMouseButton | undefined;
    motionMode?: PointerMotionMode | undefined;
    verify?: ComputerVerification | undefined;
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
    x?: number | undefined;
    y?: number | undefined;
    motionMode?: PointerMotionMode | undefined;
    verify?: ComputerVerification | undefined;
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

  async typeText(input: ComputerApplicationSelector & { text: string; verify?: ComputerVerification | undefined }): Promise<unknown> {
    if (input.text.length > MAX_TYPED_CHARS) invalid();
    const params = selectorParams(input);
    params.text = input.text;
    const verify = verification(input.verify);
    if (verify !== undefined) params.verify = verify;
    return this.physical("type_text", params);
  }

  async pressKey(input: ComputerApplicationSelector & {
    key: string;
    modifiers?: ComputerKeyModifier[] | undefined;
    verify?: ComputerVerification | undefined;
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

  async waitForFrontmost(input: ComputerApplicationSelector & { timeoutMs?: number | undefined }): Promise<unknown> {
    const params = selectorParams(input);
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 10_000);
    return this.read("wait_for_frontmost", params);
  }

  async waitForText(input: { text: string; exact?: boolean | undefined; timeoutMs?: number | undefined }): Promise<unknown> {
    if (input.text.length === 0 || input.text.length > MAX_SELECTOR_CHARS) invalid();
    const params: Record<string, unknown> = { text: input.text };
    if (input.exact !== undefined) params.exact = input.exact;
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 10_000);
    return this.read("wait_for_text", params);
  }

  async waitUntilChanged(input: { baselineDigest: string; timeoutMs?: number | undefined }): Promise<unknown> {
    if (input.baselineDigest.length === 0 || input.baselineDigest.length > MAX_SELECTOR_CHARS) invalid();
    const params: Record<string, unknown> = { baselineDigest: input.baselineDigest };
    if (input.timeoutMs !== undefined) params.timeoutMs = optionalTimeout(input.timeoutMs, 10_000);
    return this.read("wait_until_changed", params);
  }

  async releaseInputs(): Promise<unknown> {
    return this.physical("release_inputs", {});
  }

  async run(input: {
    actions: ComputerAction[];
    finalObservation?: ComputerFinalObservation | undefined;
    timeoutMs?: number | undefined;
  }): Promise<ComputerRunResult> {
    this.requireEnabled();
    if (!Array.isArray(input.actions) || input.actions.length === 0) invalid();
    if (input.actions.length > this.config.maxActionProgramActions) {
      throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
    }

    const finalObservation = input.finalObservation ?? "observe";
    if (finalObservation !== "none" && finalObservation !== "active_window" && finalObservation !== "observe") {
      invalid();
    }

    let boundedRuntimeMs = this.config.maxActionProgramRuntimeMs;
    if (input.timeoutMs !== undefined) {
      if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) invalid();
      boundedRuntimeMs = Math.min(input.timeoutMs, this.config.maxActionProgramRuntimeMs);
    }

    // Validate and canonicalize the entire program before entering the physical lane.
    const prepared = input.actions.map((action) => preparedAction(action));
    const actionCount = prepared.length;
    const holdCapablePresent = prepared.some((action) => action.type === "mouse_down" || action.type === "mouse_up");

    return this.physicalLane.run(async () => {
      this.requireEnabled();
      const deadline = this.now() + boundedRuntimeMs;
      const steps: ComputerRunResult["steps"] = [];
      let needsCleanup = holdCapablePresent;

      try {
        for (let index = 0; index < prepared.length; index += 1) {
          const action = prepared[index]!;
          if (this.closing) {
            throw this.runFailure(
              new ComputerError("COMPUTER_UNAVAILABLE"),
              index,
              action.type,
              steps.length,
              actionCount,
            );
          }
          const remainingMs = Math.floor(deadline - this.now());
          if (remainingMs <= 0) {
            throw this.runFailure(
              new ComputerError("COMPUTER_TIMEOUT"),
              index,
              action.type,
              steps.length,
              actionCount,
            );
          }

          try {
            if (action.localWaitMs !== undefined) {
              if (action.localWaitMs > remainingMs) {
                await this.sleep(remainingMs);
                throw new ComputerError("COMPUTER_TIMEOUT");
              }
              await this.sleep(action.localWaitMs);
            } else {
              if (action.physical) needsCleanup = true;
              const result = await this.native.request(
                action.method!,
                action.params,
                Math.min(this.config.requestTimeoutMs, remainingMs),
              );
              if (action.type === "observe") validateObservationOutput(result, this.config);
            }
          } catch (error) {
            throw this.runFailure(error, index, action.type, steps.length, actionCount);
          }

          steps.push({ index, type: action.type, state: "completed" });
        }

        let state: ComputerRunResult["state"] = "completed";
        let finalResult: unknown;
        if (finalObservation !== "none") {
          try {
            const remainingMs = Math.floor(deadline - this.now());
            if (remainingMs <= 0) throw new ComputerError("COMPUTER_TIMEOUT");
            const method = finalObservation === "observe" ? "observe" : "active_window";
            finalResult = await this.native.request(
              method,
              {},
              Math.min(this.config.requestTimeoutMs, remainingMs),
            );
            if (method === "observe") finalResult = validateObservationOutput(finalResult, this.config);
          } catch {
            state = "completed_unverified";
            finalResult = undefined;
          }
        }

        return {
          state,
          completedCount: steps.length,
          actionCount,
          steps,
          ...(finalResult !== undefined ? { finalObservation: finalResult } : {}),
        };
      } finally {
        if (needsCleanup) {
          try {
            await this.native.request("release_inputs", {}, this.config.requestTimeoutMs);
          } catch {
            // Final input cleanup is best effort and never replaces the primary result/error.
          }
        }
      }
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    await this.physicalLane.run(async () => {
      try {
        if (this.config.enabled && this.native.healthState() === "running") {
          try {
            await this.native.request("release_inputs", {}, this.config.requestTimeoutMs);
          } catch {
            // Input release is best effort; owned-host close must still run.
          }
        }
      } finally {
        await this.native.close();
      }
    });
  }

  private runFailure(
    error: unknown,
    failedStepIndex: number,
    failedActionType: ComputerAction["type"],
    completedCount: number,
    actionCount: number,
  ): ComputerError {
    const code = error instanceof ComputerError && isComputerErrorCode(error.code)
      ? error.code
      : "COMPUTER_ACTION_FAILED";
    return new ComputerError(code, {
      failedStepIndex,
      failedActionType,
      completedCount,
      actionCount,
    });
  }

  private async read(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs = this.config.requestTimeoutMs): Promise<unknown> {
    this.requireEnabled();
    return this.native.request(method, params, timeoutMs);
  }

  private physical(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs = this.config.requestTimeoutMs): Promise<unknown> {
    this.requireEnabled();
    return this.physicalLane.run(() => {
      this.requireEnabled();
      return this.native.request(method, params, timeoutMs);
    });
  }

  private requireEnabled(): void {
    if (!this.config.enabled) throw new ComputerError("COMPUTER_DISABLED");
    if (this.closing) throw new ComputerError("COMPUTER_UNAVAILABLE");
  }

  private unavailableHealth(state: "disabled" | "unavailable", enabled: boolean): ComputerHealthResult {
    return {
      enabled,
      state,
      accessibilityTrusted: false,
      screenCaptureAuthorized: false,
      eventListenAuthorized: false,
      eventPostAuthorized: false,
      fullHostJsEnabled: this.config.fullHostJsEnabled,
    };
  }
}
