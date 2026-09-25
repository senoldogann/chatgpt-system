import { AppError } from "../core/errors.js";

export class SessionDatabaseInvalidError extends AppError {
  constructor() {
    super("The session metadata database is invalid or unsupported.", "SESSION_DATABASE_INVALID");
  }
}

export class SessionNotFoundError extends AppError {
  constructor() {
    super("The session was not found for this project.", "SESSION_NOT_FOUND");
  }
}

export class SessionClosedError extends AppError {
  constructor() {
    super("The session is already closed.", "SESSION_CLOSED");
  }
}
