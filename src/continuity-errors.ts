import { AppError } from "./errors.js";

export class ContinuityNotFoundError extends AppError {
  constructor(message?: string) {
    super(message ?? "The registered continuity project was not found.", "CONTINUITY_NOT_FOUND");
  }
}

export class ContinuityDatabaseInvalidError extends AppError {
  constructor(message?: string) {
    super(message ?? "The project continuity database is invalid or unsupported.", "CONTINUITY_DATABASE_INVALID");
  }
}

export class ContinuityWorktreeInvalidError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(message ?? "The registered continuity worktree is invalid.", "CONTINUITY_WORKTREE_INVALID", details);
  }
}

export class ContinuityWorktreeMismatchError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(message ?? "The registered continuity worktree identity no longer matches.", "CONTINUITY_WORKTREE_MISMATCH", details);
  }
}
