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

export class VerificationRequiredError extends AppError {
  constructor(overallStatus: string) {
    super(
      `Fresh passing project verification is required before task completion. Current status: ${overallStatus}.`,
      "VERIFICATION_REQUIRED",
      { overallStatus, retryable: true },
    );
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

export class CommandTimeoutError extends AppError {
  constructor(timedOutAfterMs: number, details?: Record<string, unknown>) {
    super(
      `Command timed out after ${timedOutAfterMs}ms. Use process_start with process_status/process_logs polling for long-running commands.`,
      "COMMAND_TIMEOUT",
      { timedOutAfterMs, recommendedTool: "process_start", retryable: true, ...details },
    );
  }
}

export class ProcessNotFoundError extends AppError {
  constructor(message = "The managed process was not found.") {
    super(message, "PROCESS_NOT_FOUND");
  }
}

export class AuthorityRequiredError extends AppError {
  constructor(message = "An active authority lease is required.", details?: Record<string, unknown>) {
    super(message, "AUTHORITY_REQUIRED", details);
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

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return { error: error.code, message: error.message, details: error.details ?? {} };
  }
  if (error instanceof Error) {
    return { error: "INTERNAL_ERROR", message: error.message };
  }
  return { error: "INTERNAL_ERROR", message: String(error) };
}
