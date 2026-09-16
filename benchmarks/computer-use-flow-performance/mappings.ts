import type { ComputerErrorCode } from "../../src/computer-errors.js";
import type { ComputerScrollUntilVisibleResult } from "../../src/computer-types.js";
import {
  COMPUTER_FLOW_OPERATIONS,
  type ComputerFlowFailureCategory,
  type ComputerFlowOperation,
  type ComputerFlowOutcome,
  type ComputerFlowRecoveryOutcome,
} from "./contract.js";

export interface ComputerFlowMappedResult {
  outcome: ComputerFlowOutcome;
  failureCategory: ComputerFlowFailureCategory;
  recoveryOutcome: ComputerFlowRecoveryOutcome;
}

export const COMPUTER_FLOW_ERROR_MAP = {
  COMPUTER_DISABLED: { outcome: "unavailable", failureCategory: "unavailable", recoveryOutcome: "unavailable" },
  COMPUTER_UNAVAILABLE: { outcome: "unavailable", failureCategory: "unavailable", recoveryOutcome: "unavailable" },
  COMPUTER_PERMISSION_REQUIRED: { outcome: "blocked", failureCategory: "permission", recoveryOutcome: "permission_blocked" },
  COMPUTER_PROTOCOL_INVALID: { outcome: "blocked", failureCategory: "protocol_invalid", recoveryOutcome: "protocol_invalid" },
  COMPUTER_TIMEOUT: { outcome: "timeout", failureCategory: "timeout", recoveryOutcome: "timeout" },
  COMPUTER_TARGET_NOT_FOUND: { outcome: "needs_replan", failureCategory: "target_not_found", recoveryOutcome: "target_not_found" },
  COMPUTER_TARGET_AMBIGUOUS: { outcome: "needs_replan", failureCategory: "target_ambiguous", recoveryOutcome: "target_ambiguous" },
  COMPUTER_STALE_SNAPSHOT: { outcome: "needs_replan", failureCategory: "stale", recoveryOutcome: "stale_refused" },
  COMPUTER_FOCUS_FAILED: { outcome: "blocked", failureCategory: "focus", recoveryOutcome: "focus_refused" },
  COMPUTER_ACTION_FAILED: { outcome: "blocked", failureCategory: "action_failed", recoveryOutcome: "action_failed" },
  COMPUTER_USER_TAKEOVER: { outcome: "cancelled", failureCategory: "takeover", recoveryOutcome: "takeover_refused" },
  COMPUTER_NEEDS_REPLAN: { outcome: "needs_replan", failureCategory: "needs_replan", recoveryOutcome: "needs_replan" },
  COMPUTER_OUTPUT_LIMIT: { outcome: "blocked", failureCategory: "output_limit", recoveryOutcome: "output_limit" },
  COMPUTER_JS_DISABLED: { outcome: "blocked", failureCategory: "js_forbidden", recoveryOutcome: "js_forbidden" },
  COMPUTER_JS_FAILED: { outcome: "blocked", failureCategory: "action_failed", recoveryOutcome: "action_failed" },
  COMPUTER_JS_TIMEOUT: { outcome: "timeout", failureCategory: "timeout", recoveryOutcome: "timeout" },
} as const satisfies Readonly<Record<ComputerErrorCode, ComputerFlowMappedResult>>;

export const COMPUTER_FLOW_SCROLL_STATE_MAP = {
  target_visible: { outcome: "completed", failureCategory: "none", recoveryOutcome: "target_visible" },
  boundary_reached: { outcome: "needs_replan", failureCategory: "needs_replan", recoveryOutcome: "boundary_reached" },
  needs_replan: { outcome: "needs_replan", failureCategory: "needs_replan", recoveryOutcome: "needs_replan" },
} as const satisfies Readonly<Record<ComputerScrollUntilVisibleResult["state"], ComputerFlowMappedResult>>;

const OBSERVED_WRAPPER_ERROR_MAP = {
  POLICY_DENIED: { outcome: "blocked", failureCategory: "permission", recoveryOutcome: "permission_blocked" },
  INTERNAL_ERROR: { outcome: "blocked", failureCategory: "action_failed", recoveryOutcome: "action_failed" },
} as const satisfies Readonly<Record<"POLICY_DENIED" | "INTERNAL_ERROR", ComputerFlowMappedResult>>;

const operationSet = new Set<string>(COMPUTER_FLOW_OPERATIONS);
const errorSet = new Set<string>(Object.keys(COMPUTER_FLOW_ERROR_MAP));
const scrollStateSet = new Set<string>(Object.keys(COMPUTER_FLOW_SCROLL_STATE_MAP));

export function mapComputerErrorCode(code: ComputerErrorCode): ComputerFlowMappedResult {
  return COMPUTER_FLOW_ERROR_MAP[code];
}

export function mapComputerScrollState(state: ComputerScrollUntilVisibleResult["state"]): ComputerFlowMappedResult {
  return COMPUTER_FLOW_SCROLL_STATE_MAP[state];
}

export interface ComputerFlowObservedAuditEventInput {
  operation: string;
  outcome: "ok" | "error";
  errorCode?: string;
  scrollState?: string;
}

function requireOperation(operation: string): ComputerFlowOperation {
  if (!operationSet.has(operation)) throw new Error(`Unknown observed computer operation: ${operation}`);
  return operation as ComputerFlowOperation;
}

function mapObservedError(errorCode: string | undefined): ComputerFlowMappedResult {
  if (!errorCode) throw new Error("Observed computer audit error is missing a closed error code.");
  if (errorSet.has(errorCode)) return COMPUTER_FLOW_ERROR_MAP[errorCode as ComputerErrorCode];
  if (errorCode === "POLICY_DENIED" || errorCode === "INTERNAL_ERROR") return OBSERVED_WRAPPER_ERROR_MAP[errorCode];
  throw new Error(`Unknown observed computer error code: ${errorCode}`);
}

export function mapObservedComputerAuditEvent(input: ComputerFlowObservedAuditEventInput): ComputerFlowMappedResult {
  const operation = requireOperation(input.operation);
  if (input.outcome === "error") {
    if (input.scrollState !== undefined) throw new Error("Observed computer error cannot also carry a scroll state.");
    return mapObservedError(input.errorCode);
  }
  if (input.errorCode !== undefined) throw new Error("Observed computer success cannot carry an error code.");
  if (input.scrollState !== undefined) {
    if (operation !== "scroll_until_visible") throw new Error("Observed scroll state is only valid for scroll_until_visible.");
    if (!scrollStateSet.has(input.scrollState)) throw new Error(`Unknown observed scroll state: ${input.scrollState}`);
    return COMPUTER_FLOW_SCROLL_STATE_MAP[input.scrollState as ComputerScrollUntilVisibleResult["state"]];
  }
  return { outcome: "completed", failureCategory: "none", recoveryOutcome: "operation_completed" };
}
