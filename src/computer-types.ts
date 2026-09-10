export const COMPUTER_PROTOCOL_VERSION = 1 as const;
export const COMPUTER_MAX_REQUEST_LINE_BYTES = 262_144;
export const COMPUTER_MAX_RESPONSE_BYTES = 12_582_912;

export const COMPUTER_NATIVE_METHODS = [
  "health",
  "list_apps",
  "active_window",
  "observe",
  "screenshot",
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
  | { type: "move_mouse"; x: number; y: number; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification }
  | { type: "click" | "double_click"; x: number; y: number; button?: "left" | "right" | "middle"; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification }
  | { type: "mouse_down" | "mouse_up"; button?: "left" | "right" | "middle"; verify?: ComputerActionVerification }
  | { type: "drag"; from: { x: number; y: number }; to: { x: number; y: number }; button?: "left" | "right" | "middle"; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification }
  | { type: "scroll"; vertical: number; horizontal: number; x?: number; y?: number; motionMode?: "instant" | "fast" | "natural"; verify?: ComputerActionVerification }
  | { type: "type_text"; text: string; bundleIdentifier?: string; name?: string; verify?: ComputerActionVerification }
  | { type: "press_key"; key: string; modifiers?: Array<"control" | "option" | "shift" | "command">; bundleIdentifier?: string; name?: string; verify?: ComputerActionVerification }
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
  finalObservation?: unknown;
}
