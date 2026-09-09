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
