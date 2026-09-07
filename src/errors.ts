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

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return { error: error.code, message: error.message, details: error.details ?? {} };
  }
  if (error instanceof Error) {
    return { error: "INTERNAL_ERROR", message: error.message };
  }
  return { error: "INTERNAL_ERROR", message: String(error) };
}
