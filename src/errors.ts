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

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return { error: error.code, message: error.message, details: error.details ?? {} };
  }
  if (error instanceof Error) {
    return { error: "INTERNAL_ERROR", message: error.message };
  }
  return { error: "INTERNAL_ERROR", message: String(error) };
}
