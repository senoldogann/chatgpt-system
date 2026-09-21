import { SessionDatabaseInvalidError } from "./session-event-errors.js";

export type SessionState = "active" | "closed";

export interface SessionView {
  sessionId: string;
  projectId: string;
  state: SessionState;
  revision: number;
  nextSeq: number;
  activeBindingId: null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export type SessionEventKind = "session.started" | "session.closed";

export interface SessionEvent {
  sessionId: string;
  seq: number;
  kind: SessionEventKind;
  actor: "system";
  correlationId: null;
  metadata: Record<string, never>;
  happenedAt: string;
}

export interface EventPage {
  events: SessionEvent[];
  nextCursor: number;
  hasMore: boolean;
}

export interface SessionEventStoreOptions {
  databasePath: string;
  now?: () => number;
}

/** Parse only the fixed, content-free event contract; never return additional persisted fields. */
export function parseStoredSessionEvent(value: unknown): SessionEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SessionDatabaseInvalidError();
  const row = value as Record<string, unknown>;
  if (typeof row.session_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.session_id) ||
    !Number.isSafeInteger(row.seq) || (row.seq as number) < 1 ||
    (row.kind !== "session.started" && row.kind !== "session.closed") ||
    row.actor !== "system" || row.correlation_id !== null || row.metadata_json !== "{}" ||
    typeof row.happened_at !== "string" || !Number.isFinite(Date.parse(row.happened_at)) ||
    new Date(row.happened_at).toISOString() !== row.happened_at) {
    throw new SessionDatabaseInvalidError();
  }
  return {
    sessionId: row.session_id,
    seq: row.seq as number,
    kind: row.kind,
    actor: "system",
    correlationId: null,
    metadata: {},
    happenedAt: row.happened_at,
  };
}
