import type { ComputerKeyName } from "./computer-key.js";

export const COMPUTER_PROTOCOL_VERSION = 1 as const;
export const COMPUTER_MAX_REQUEST_LINE_BYTES = 262_144;
export const COMPUTER_MAX_RESPONSE_BYTES = 12_582_912;

export const COMPUTER_NATIVE_METHODS = [
  "health",
  "list_apps",
  "active_window",
  "observe",
  "screenshot",
  "resolve_target",
  "resolve_targets",
  "pointer_position",
  "move_mouse",
  "click",
  "double_click",
  "mouse_down",
  "mouse_up",
  "drag",
  "scroll",
  "type_text",
  "press_key",
  "wait_for_frontmost",
  "wait_for_text",
  "wait_until_changed",
  "release_inputs",
  "focus_app",
  "open_app",
] as const;

export type ComputerNativeMethod = typeof COMPUTER_NATIVE_METHODS[number];

export type ComputerTargetScope =
  | { by: "index"; snapshotId: string; index: number }
  | { by: "role"; role: string; name?: string; exact?: boolean };

export type ComputerUnscopedSemanticTarget =
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean }
  | { by: "label"; label: string; exact?: boolean }
  | { by: "ocrText"; text: string; exact?: boolean };

export type ComputerSemanticTarget =
  | ({ by: "role"; role: string; name?: string; exact?: boolean } & { within?: ComputerTargetScope })
  | ({ by: "text"; text: string; exact?: boolean } & { within?: ComputerTargetScope })
  | ({ by: "label"; label: string; exact?: boolean } & { within?: ComputerTargetScope })
  | ({ by: "ocrText"; text: string; exact?: boolean } & { within?: ComputerTargetScope });

export type ComputerTarget =
  | { by: "index"; snapshotId: string; index: number }
  | ComputerSemanticTarget
  | { by: "point"; x: number; y: number };

export type ComputerScrollDirection = "up" | "down" | "left" | "right";
export type ComputerScrollAmount = "small" | "page";

export interface ComputerScrollUntilVisibleInput {
  target: ComputerUnscopedSemanticTarget;
  within: ComputerTargetScope;
  direction: ComputerScrollDirection;
  amount?: ComputerScrollAmount;
  maxSteps?: number;
}

export interface ComputerScrollUntilVisibleResult {
  state: "target_visible" | "boundary_reached" | "needs_replan";
  stepsUsed: number;
  changed: boolean;
}

export interface ComputerResolvedTargetView {
  source: "ax" | "ocr" | "point";
  bounds: { x: number; y: number; width: number; height: number };
  actionPoint: { x: number; y: number };
  observationId?: string | null;
  confidence: "deterministic" | "high" | "explicit";
}

export type ComputerCoordinate = { x: number; y: number };
export type ComputerSemanticLocation = {
  target: ComputerTarget;
  retryBudget?: number;
  x?: never;
  y?: never;
};
export type ComputerActionLocation =
  | (ComputerCoordinate & { target?: never; retryBudget?: never })
  | ComputerSemanticLocation;
export type ComputerActionEndpoint = ComputerCoordinate | ComputerTarget;

export type ComputerActionVerification =
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

export type ComputerAction =
  | { type: "observe" }
  | { type: "pointer_position" }
  | { type: "open_app"; bundleIdentifier?: string; name?: string; timeoutMs?: number }
  | { type: "focus_app"; bundleIdentifier?: string; name?: string; timeoutMs?: number }
  | ({ type: "move_mouse"; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification } & ComputerActionLocation)
  | ({ type: "click" | "double_click"; button?: "left" | "right" | "middle"; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification } & ComputerActionLocation)
  | { type: "mouse_down" | "mouse_up"; button?: "left" | "right" | "middle"; verify?: ComputerActionVerification }
  | { type: "drag"; from: ComputerActionEndpoint; to: ComputerActionEndpoint; retryBudget?: number; button?: "left" | "right" | "middle"; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification }
  | ({ type: "scroll"; vertical: number; horizontal: number; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification } & (
      | { x?: never; y?: never; target?: never; retryBudget?: never }
      | ComputerActionLocation
    ))
  | { type: "type_text"; text: string; bundleIdentifier?: string; name?: string; verify?: ComputerActionVerification }
  | { type: "press_key"; key: ComputerKeyName; modifiers?: Array<"control" | "option" | "shift" | "command">; bundleIdentifier?: string; name?: string; verify?: ComputerActionVerification }
  | { type: "wait"; durationMs: number }
  | { type: "wait_for_frontmost"; bundleIdentifier?: string; name?: string; timeoutMs?: number }
  | { type: "wait_for_text"; text: string; exact?: boolean; timeoutMs?: number }
  | { type: "wait_until_changed"; baselineDigest: string; timeoutMs?: number }
  | { type: "release_inputs" };

export type ComputerFinalObservation = "none" | "active_window" | "observe";

export interface ComputerRunStepResult {
  index: number;
  type: ComputerAction["type"];
  state: "completed";
}

export interface ComputerRunResult {
  state: "completed" | "completed_unverified";
  completedCount: number;
  actionCount: number;
  steps: ComputerRunStepResult[];
  stepsTruncated: boolean;
  finalObservation?: unknown;
}
