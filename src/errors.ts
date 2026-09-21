import { randomUUID } from "node:crypto";
import type { BrowserErrorCode } from "./browser-types.js";

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PolicyError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "POLICY_DENIED", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
  }
}

export class BrowserError extends AppError {
  constructor(code: BrowserErrorCode, message: string, details?: Record<string, unknown>) {
    super(message, code, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFLICT", details);
  }
}

export class WorkerRetiredError extends AppError {
  constructor(alias: string) {
    super(
      `Alias "${alias}" bitmiş bir worker'a ait; bu sohbet normal prime akışına dönmeli, yazım kapalı.`,
      "WORKER_RETIRED",
      { alias },
    );
  }
}

export class LimitError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "LIMIT_EXCEEDED", details);
  }
}

export class ExecutableNotFoundError extends AppError {
  constructor(command: string, details?: Record<string, unknown>) {
    super(
      `Executable "${command}" is allowlisted but was not found on the runtime executable search path.`,
      "EXECUTABLE_NOT_FOUND",
      { command, allowed: true, available: false, ...details },
    );
  }
}

export class LspUnavailableError extends AppError {
  constructor(reason: string) {
    super(
      "Semantic code intelligence is unavailable for this request. Use code_query search or symbols as an explicit fallback.",
      "LSP_UNAVAILABLE",
      { reason, retryable: false, recommendedOperations: ["search", "symbols"] },
    );
  }
}

export class TaskStateNotFoundError extends AppError {
  constructor() {
    super(
      "The durable task state record was not found for this project.",
      "TASK_STATE_NOT_FOUND",
      { retryable: false },
    );
  }
}

export class RecoveryRequiredError extends AppError {
  constructor(message = "Durable local state requires recovery before this operation can continue.") {
    super(message, "RECOVERY_REQUIRED", { retryable: false });
  }
}

export class WorktreeNotFoundError extends AppError {
  constructor() {
    super("The managed worktree was not found.", "WORKTREE_NOT_FOUND", { retryable: false });
  }
}

export class WorktreeDirtyError extends AppError {
  constructor(message = "The worktree has uncommitted or untracked changes.") {
    super(message, "WORKTREE_DIRTY", { retryable: false });
  }
}

export class ProjectResumeRequiredError extends AppError {
  constructor(message = "An active project_resume context is required for publication.") {
    super(message, "PROJECT_RESUME_REQUIRED", { retryable: true });
  }
}

export class LocalVerificationRequiredError extends AppError {
  constructor(overallStatus: string) {
    super(
      `Fresh passing local project verification is required before publication. Current status: ${overallStatus}.`,
      "LOCAL_VERIFICATION_REQUIRED",
      { overallStatus, retryable: true },
    );
  }
}

export class LocalVerificationStaleError extends AppError {
  constructor() {
    super(
      "Local project verification is stale for the state being published.",
      "LOCAL_VERIFICATION_STALE",
      { retryable: true },
    );
  }
}

export class WorktreeNotCleanError extends AppError {
  constructor() {
    super(
      "The project worktree must be clean before publication.",
      "WORKTREE_NOT_CLEAN",
      { retryable: true },
    );
  }
}

export class MainPushDeniedError extends AppError {
  constructor() {
    super(
      "Typed project publication may not push the main branch.",
      "MAIN_PUSH_DENIED",
      { retryable: false },
    );
  }
}

export class VerificationRequiredError extends AppError {
  constructor(overallStatus: string) {
    super(
      `Fresh passing project verification is required before task completion. Current status: ${overallStatus}.`,
      "VERIFICATION_REQUIRED",
      { overallStatus, retryable: true },
    );
  }
}

export class OwnerRuntimeDisabledError extends AppError {
  constructor() {
    super(
      "Owner Runtime is disabled. Restart with --enable-owner-runtime or CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME=true.",
      "OWNER_RUNTIME_DISABLED",
      { retryable: false },
    );
  }
}

export class OwnerShellFailedError extends AppError {
  constructor() {
    super("Owner shell execution could not be started or managed.", "SHELL_FAILED", { retryable: true });
  }
}

export class OwnerShellCancelledError extends AppError {
  constructor(reason: "abort" | "shutdown") {
    super("Owner shell execution was cancelled.", "SHELL_CANCELLED", { reason, retryable: true });
  }
}

export class TerminalSessionNotFoundError extends AppError {
  constructor() {
    super("The terminal session was not found.", "TERMINAL_SESSION_NOT_FOUND", { retryable: false });
  }
}

export class TerminalSessionClosedError extends AppError {
  constructor() {
    super("The terminal session is no longer running.", "TERMINAL_SESSION_CLOSED", { retryable: false });
  }
}

export class TerminalSessionLimitError extends AppError {
  constructor() {
    super("The terminal session limit has been reached.", "TERMINAL_SESSION_LIMIT", { retryable: true });
  }
}

export class TerminalSessionFailedError extends AppError {
  constructor() {
    super("The terminal session could not be created or managed.", "TERMINAL_SESSION_FAILED", { retryable: true });
  }
}

export class ProjectExecDisabledError extends AppError {
  constructor() {
    super(
      "Sandboxed project execution is disabled. Restart with --enable-project-exec or CHATGPT_SYSTEM_ENABLE_PROJECT_EXEC=true.",
      "PROJECT_EXEC_DISABLED",
      { retryable: false },
    );
  }
}

export class CommandNotAllowedError extends AppError {
  constructor(command: string, allowed: string[]) {
    super(
      `Command "${command}" is not allowed for sandboxed project execution.`,
      "COMMAND_NOT_ALLOWED",
      { command, allowed, retryable: false },
    );
  }
}

export class SandboxUnavailableError extends AppError {
  constructor(reason: "docker_unavailable" | "image_unavailable" | "backend_failure" | "nonlocal_docker_context") {
    super(
      "Sandboxed project execution is unavailable on this host.",
      "SANDBOX_UNAVAILABLE",
      { backend: "docker", reason, retryable: true },
    );
  }
}

export class ProjectExecTimeoutError extends AppError {
  constructor(timedOutAfterMs: number) {
    super(
      `Sandboxed project command timed out after ${timedOutAfterMs}ms.`,
      "COMMAND_TIMEOUT",
      { timedOutAfterMs, retryable: true },
    );
  }
}

export type PatchInvalidReason =
  | "multiple_files"
  | "invalid_hunk_line"
  | "missing_file_header"
  | "hunk_line_count_mismatch"
  | "unparseable";

export class PatchInvalidError extends AppError {
  constructor(reason: PatchInvalidReason, guidance: string, parserMessage: string) {
    super(
      `The unified diff could not be parsed: ${guidance}`,
      "PATCH_INVALID",
      {
        reason,
        guidance,
        parserMessage,
        recommendedOperations: ["fs_read", "fs_apply_patch"],
        retryable: true,
      },
    );
  }
}

export class HostedResponseBudgetError extends AppError {
  constructor(requestedTimeoutMs: number | null, budgetMs: number) {
    super(
      `A single tool call may run for at most ${budgetMs}ms so the hosted response deadline is never missed. `
        + "Start long work with process_start or terminal_session_open and poll its status instead.",
      "HOSTED_RESPONSE_BUDGET_EXCEEDED",
      {
        requestedTimeoutMs,
        budgetMs,
        recommendedTools: ["process_start", "process_status", "process_logs", "terminal_session_open"],
        retryable: false,
      },
    );
  }
}

export class ProcessTerminationFailedError extends AppError {
  constructor(command: string, signal: NodeJS.Signals, details?: Record<string, unknown>) {
    super(
      `Terminating the process group for "${command}" with ${signal} failed, so the command result cannot be trusted.`,
      "PROCESS_TERMINATION_FAILED",
      { command, signal, retryable: false, ...details },
    );
  }
}

export class CommandTimeoutError extends AppError {
  constructor(timedOutAfterMs: number, details?: Record<string, unknown>) {
    super(
      `Command timed out after ${timedOutAfterMs}ms. Use process_start with process_status/process_logs polling for long-running commands.`,
      "COMMAND_TIMEOUT",
      {
        timedOutAfterMs,
        recommendedTool: "process_start",
        retryable: true,
        started: true,
        processState: "failed",
        resolution: "Use the returned jobId with process_status/process_logs; do not start a duplicate request.",
        ...details,
      },
    );
  }
}

export class ProcessNotFoundError extends AppError {
  constructor(message = "The managed process was not found.") {
    super(message, "PROCESS_NOT_FOUND");
  }
}

export class ProcessControlUnavailableError extends AppError {
  constructor() {
    super(
      "The independent process controller is unavailable; no PID or process-group signal was sent.",
      "PROCESS_CONTROL_UNAVAILABLE",
      { retryable: true, started: true, processState: "running", resolution: "Query the job again after the wrapper controller is available; do not signal the PID directly." },
    );
  }
}

export class ProcessTerminationTimeoutError extends AppError {
  constructor() {
    super(
      "The wrapper acknowledged termination, but no verified child exit result arrived before the grace period.",
      "PROCESS_TERMINATION_TIMEOUT",
      { retryable: true, started: true, processState: "stopping", resolution: "Poll process_status/process_logs; do not treat the controller ACK as cancellation." },
    );
  }
}

export class ProcessIdentityUnverifiedError extends AppError {
  constructor() {
    super(
      "The recovered process identity could not be verified; no PID or process-group signal was sent.",
      "PROCESS_IDENTITY_UNVERIFIED",
      {
        retryable: false,
        started: true,
        processState: "unknown",
        resolution: "Inspect the job status and let the independent result record settle; do not retry by PID or process group.",
      },
    );
  }
}

export class AuthorityRequiredError extends AppError {
  constructor(
    message = "No authority lease matched the provided authorityLeaseId (unknown or expired).",
    details?: Record<string, unknown>,
  ) {
    super(message, "AUTHORITY_REQUIRED", {
      resolution:
        "Free mode: omit authorityLeaseId to run against the configured roots. Never reuse a lease id from an earlier session; call session_authority_start only when an explicit scoped project lease is required.",
      ...(details ?? {}),
    });
  }
}

export class AuthorityExpiredError extends AppError {
  constructor(message = "The authority lease has expired.", details?: Record<string, unknown>) {
    super(message, "AUTHORITY_EXPIRED", details);
  }
}

export class AuthorityDeniedError extends AppError {
  constructor(message = "The authority lease does not permit this operation.", details?: Record<string, unknown>) {
    super(message, "AUTHORITY_DENIED", details);
  }
}

export class LocalApprovalRequiredError extends AppError {
  constructor(message = "Local approval on the Mac is required before User or Admin authority can start.", details?: Record<string, unknown>) {
    super(message, "LOCAL_APPROVAL_REQUIRED", details);
  }
}

export class LocalApprovalUnavailableError extends AppError {
  constructor(message = "Local approval is unavailable on this host.", details?: Record<string, unknown>) {
    super(message, "LOCAL_APPROVAL_UNAVAILABLE", details);
  }
}

export class LocalApprovalDeniedError extends AppError {
  constructor(message = "Local approval was denied or cancelled.", details?: Record<string, unknown>) {
    super(message, "LOCAL_APPROVAL_DENIED", details);
  }
}

export class LocalApprovalExpiredError extends AppError {
  constructor(message = "The local approval request has expired.", details?: Record<string, unknown>) {
    super(message, "LOCAL_APPROVAL_EXPIRED", details);
  }
}

export class LocalApprovalInvalidError extends AppError {
  constructor(message = "The local approval request is invalid or no longer consumable.", details?: Record<string, unknown>) {
    super(message, "LOCAL_APPROVAL_INVALID", details);
  }
}

export class ControlSocketUnavailableError extends AppError {
  constructor(message = "The local authority control socket is unavailable.", details?: Record<string, unknown>) {
    super(message, "CONTROL_SOCKET_UNAVAILABLE", details);
  }
}

export class ControlSocketInUseError extends AppError {
  constructor(message = "The local authority control socket is already in use.", details?: Record<string, unknown>) {
    super(message, "CONTROL_SOCKET_IN_USE", details);
  }
}

export class ControlProtocolInvalidError extends AppError {
  constructor(message = "The local authority control protocol message is invalid.", details?: Record<string, unknown>) {
    super(message, "CONTROL_PROTOCOL_INVALID", details);
  }
}

export class AuthorizationBusyError extends AppError {
  constructor(message = "Another local authority authorization is already in progress.") {
    super(message, "AUTHORIZATION_BUSY");
  }
}

export class LeaseDeliveryFailedError extends AppError {
  constructor(message = "Authority lease delivery failed.") {
    super(message, "LEASE_DELIVERY_FAILED");
  }
}

function errorSource(code: string): "local_authority" | "scope" | "command_validation" | "sandbox" | "platform" | "timeout" | "connection" | "internal" {
  if (code === "CONTROL_SOCKET_UNAVAILABLE" || code === "CONTROL_PROTOCOL_INVALID" || code === "PROCESS_CONTROL_UNAVAILABLE") return "connection";
  if (code.startsWith("AUTHORITY_") || code.startsWith("LOCAL_APPROVAL_") || code.startsWith("CONTROL_")) return "local_authority";
  if (["POLICY_DENIED", "CONFLICT", "WORKTREE_NOT_CLEAN", "MAIN_PUSH_DENIED"].includes(code)) return "scope";
  if (["COMMAND_NOT_ALLOWED", "EXECUTABLE_NOT_FOUND", "LIMIT_EXCEEDED", "PROCESS_IDENTITY_UNVERIFIED"].includes(code)) return "command_validation";
  if (code.startsWith("SANDBOX_") || code.startsWith("PROJECT_EXEC_")) return "sandbox";
  if (code.includes("TIMEOUT")) return "timeout";
  if (code.includes("SOCKET") || code.includes("CONNECTION") || code === "LEASE_DELIVERY_FAILED") return "connection";
  if (code.startsWith("BROWSER_") || code.startsWith("COMPUTER_")) return "platform";
  return "internal";
}

function failurePayload(code: string, message: string, details: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    error: code,
    message,
    operationId: randomUUID(),
    source: errorSource(code),
    started: details.started === true,
    processState: typeof details.processState === "string" ? details.processState : "not_started",
    ...(typeof details.exitCode === "number" || details.exitCode === null ? { exitCode: details.exitCode } : {}),
    resolution: typeof details.resolution === "string" ? details.resolution : "Inspect the structured error and do not retry through an alternate tool until the boundary is resolved.",
    details,
  };
}

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return failurePayload(error.code, error.message, error.details ?? {});
  if (error instanceof Error) return failurePayload("INTERNAL_ERROR", error.message);
  return failurePayload("INTERNAL_ERROR", String(error));
}
