import type { AuditLogger } from "./audit.js";
import type { ComputerRuntime } from "./computer-runtime.js";
import type { ComputerAction, ComputerFinalObservation, ComputerRunResult } from "./computer-types.js";
import { AppError, PolicyError } from "./errors.js";

export type ScopedComputerBackend = Pick<
  ComputerRuntime,
  | "health"
  | "observe"
  | "screenshot"
  | "pointerPosition"
  | "listApps"
  | "activeWindow"
  | "openApp"
  | "focusApp"
  | "moveMouse"
  | "click"
  | "drag"
  | "scroll"
  | "typeText"
  | "pressKey"
  | "waitForFrontmost"
  | "waitForText"
  | "waitUntilChanged"
  | "releaseInputs"
  | "run"
  | "close"
>;

type RunInput = {
  actions: ComputerAction[];
  finalObservation?: ComputerFinalObservation | undefined;
  timeoutMs?: number | undefined;
};

export class ScopedComputerService {
  constructor(
    private readonly service: ScopedComputerBackend,
    private readonly audit: AuditLogger,
    private readonly adminEnabled: boolean,
  ) {}

  health() {
    return this.runAudit("computer.health", () => this.service.health(), undefined, undefined, false);
  }

  observe() {
    return this.runAudit("computer.observe", () => this.service.observe());
  }

  screenshot() {
    return this.runAudit("computer.screenshot", () => this.service.screenshot());
  }

  pointerPosition() {
    return this.runAudit("computer.pointer_position", () => this.service.pointerPosition());
  }

  listApps() {
    return this.runAudit("computer.list_apps", () => this.service.listApps());
  }

  activeWindow() {
    return this.runAudit("computer.active_window", () => this.service.activeWindow());
  }

  openApp(input: Parameters<ComputerRuntime["openApp"]>[0]) {
    return this.runAudit(
      "computer.open_app",
      () => this.service.openApp(input),
      this.applicationMetadata(input),
    );
  }

  focusApp(input: Parameters<ComputerRuntime["focusApp"]>[0]) {
    return this.runAudit(
      "computer.focus_app",
      () => this.service.focusApp(input),
      this.applicationMetadata(input),
    );
  }

  moveMouse(input: Parameters<ComputerRuntime["moveMouse"]>[0]) {
    return this.runAudit("computer.move_mouse", () => this.service.moveMouse(input));
  }

  click(input: Parameters<ComputerRuntime["click"]>[0]) {
    return this.runAudit("computer.click", () => this.service.click(input));
  }

  drag(input: Parameters<ComputerRuntime["drag"]>[0]) {
    return this.runAudit("computer.drag", () => this.service.drag(input));
  }

  scroll(input: Parameters<ComputerRuntime["scroll"]>[0]) {
    return this.runAudit("computer.scroll", () => this.service.scroll(input));
  }

  typeText(input: Parameters<ComputerRuntime["typeText"]>[0]) {
    return this.runAudit(
      "computer.type_text",
      () => this.service.typeText(input),
      this.applicationMetadata(input),
    );
  }

  pressKey(input: Parameters<ComputerRuntime["pressKey"]>[0]) {
    return this.runAudit(
      "computer.press_key",
      () => this.service.pressKey(input),
      this.applicationMetadata(input),
    );
  }

  waitForFrontmost(input: Parameters<ComputerRuntime["waitForFrontmost"]>[0]) {
    return this.runAudit(
      "computer.wait_for_frontmost",
      () => this.service.waitForFrontmost(input),
      this.applicationMetadata(input),
    );
  }

  waitForText(input: Parameters<ComputerRuntime["waitForText"]>[0]) {
    return this.runAudit("computer.wait_for_text", () => this.service.waitForText(input));
  }

  waitUntilChanged(input: Parameters<ComputerRuntime["waitUntilChanged"]>[0]) {
    return this.runAudit("computer.wait_until_changed", () => this.service.waitUntilChanged(input));
  }

  releaseInputs() {
    return this.runAudit("computer.release_inputs", () => this.service.releaseInputs());
  }

  run(input: RunInput): Promise<ComputerRunResult> {
    return this.runAudit(
      "computer.run",
      () => this.service.run(input),
      { actionCount: input.actions.length },
      (result) => ({ completedCount: result.completedCount }),
    );
  }

  private async runAudit<T>(
    action: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>,
    successMetadata?: (result: T) => Record<string, unknown>,
    requireAdmin = true,
  ): Promise<T> {
    const started = performance.now();
    try {
      if (requireAdmin && !this.adminEnabled) {
        throw new PolicyError("Computer Runtime requires an Admin authority lease.");
      }
      const result = await operation();
      await this.safeRecord({
        action,
        outcome: "ok",
        durationMs: performance.now() - started,
        metadata: {
          ...(metadata ?? {}),
          ...(successMetadata?.(result) ?? {}),
        },
      });
      return result;
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
      const runDetails = action === "computer.run" && error instanceof AppError
        ? this.safeRunFailureDetails(error.details)
        : {};
      await this.safeRecord({
        action,
        outcome: "error",
        durationMs: performance.now() - started,
        metadata: {
          ...(metadata ?? {}),
          ...runDetails,
          errorCode,
        },
      });
      throw error;
    }
  }

  private safeRunFailureDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!details) return {};
    const safe: Record<string, unknown> = {};
    if (Number.isInteger(details.completedCount)) safe.completedCount = details.completedCount;
    if (Number.isInteger(details.actionCount)) safe.actionCount = details.actionCount;
    if (Number.isInteger(details.failedStepIndex)) safe.failedStepIndex = details.failedStepIndex;
    if (typeof details.failedActionType === "string" && details.failedActionType.length <= 64) {
      safe.failedActionType = details.failedActionType;
    }
    return safe;
  }

  private applicationMetadata(input: { bundleIdentifier?: string | undefined }): Record<string, unknown> | undefined {
    return input.bundleIdentifier ? { bundleIdentifier: input.bundleIdentifier } : undefined;
  }

  private async safeRecord(event: Parameters<AuditLogger["record"]>[0]): Promise<void> {
    try {
      await this.audit.record(event);
    } catch {
      // Never turn a completed computer side effect into a retryable-looking failure because audit storage failed.
    }
  }
}
