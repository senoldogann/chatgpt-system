import { AppError } from "./errors.js";

export const COMPUTER_ERROR_MESSAGES = {
  COMPUTER_DISABLED: "Computer Runtime is disabled.",
  COMPUTER_UNAVAILABLE: "Computer Runtime is unavailable.",
  COMPUTER_PERMISSION_REQUIRED: "Computer Runtime permission is required.",
  COMPUTER_PROTOCOL_INVALID: "Computer Runtime protocol is invalid.",
  COMPUTER_TIMEOUT: "Computer operation timed out.",
  COMPUTER_TARGET_NOT_FOUND: "Computer target was not found.",
  COMPUTER_TARGET_AMBIGUOUS: "Computer target is ambiguous.",
  COMPUTER_STALE_SNAPSHOT: "Computer snapshot is stale.",
  COMPUTER_FOCUS_FAILED: "Computer focus verification failed.",
  COMPUTER_ACTION_FAILED: "Computer action failed.",
  COMPUTER_USER_TAKEOVER: "User took over computer input.",
  COMPUTER_NEEDS_REPLAN: "Computer operation needs replanning.",
  COMPUTER_OUTPUT_LIMIT: "Computer Runtime output exceeded the limit.",
} as const;

export type ComputerErrorCode = keyof typeof COMPUTER_ERROR_MESSAGES;

const COMPUTER_ERROR_CODES = new Set<string>(Object.keys(COMPUTER_ERROR_MESSAGES));

export function isComputerErrorCode(value: string): value is ComputerErrorCode {
  return COMPUTER_ERROR_CODES.has(value);
}

export class ComputerError extends AppError {
  constructor(code: ComputerErrorCode, details?: Record<string, unknown>) {
    super(COMPUTER_ERROR_MESSAGES[code], code, details);
  }
}

export function normalizeComputerNativeError(
  code: string,
  details?: Record<string, unknown>,
): ComputerError {
  if (!isComputerErrorCode(code)) {
    throw new ComputerError("COMPUTER_PROTOCOL_INVALID");
  }
  return new ComputerError(code, details);
}
