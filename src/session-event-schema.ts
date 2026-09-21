import Database from "better-sqlite3";
import { SessionDatabaseInvalidError } from "./session-event-errors.js";

export const SESSION_SCHEMA_VERSION = 1;

export const SESSION_SCHEMA_DDL = [
  `CREATE TABLE session_meta (schema_version INTEGER NOT NULL)`,
  `CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 256),
    state TEXT NOT NULL CHECK(state IN ('active','closed')),
    revision INTEGER NOT NULL CHECK(revision >= 1),
    next_seq INTEGER NOT NULL CHECK(next_seq >= 1),
    active_binding_id TEXT NULL CHECK(active_binding_id IS NULL),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT NULL,
    CHECK ((state='active' AND closed_at IS NULL) OR (state='closed' AND closed_at IS NOT NULL))
  )`,
  `CREATE TABLE bindings (
    binding_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 128),
    conversation_id TEXT NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 256),
    identity_evidence_ref TEXT NOT NULL CHECK(length(identity_evidence_ref) BETWEEN 1 AND 256),
    verified_at TEXT NOT NULL,
    retired_at TEXT NULL
  )`,
  `CREATE UNIQUE INDEX bindings_active_conversation ON bindings(provider,conversation_id) WHERE retired_at IS NULL`,
  `CREATE UNIQUE INDEX bindings_active_session ON bindings(session_id) WHERE retired_at IS NULL`,
  `CREATE TABLE events (
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    seq INTEGER NOT NULL CHECK(seq >= 1),
    kind TEXT NOT NULL CHECK(kind IN ('session.started','session.closed')),
    actor TEXT NOT NULL CHECK(actor='system'),
    correlation_id TEXT NULL CHECK(correlation_id IS NULL),
    metadata_json TEXT NOT NULL CHECK(metadata_json='{}'),
    happened_at TEXT NOT NULL,
    PRIMARY KEY(session_id,seq)
  )`,
  `CREATE TABLE messages (
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 256),
    turn_id TEXT NULL CHECK(turn_id IS NULL OR length(turn_id) BETWEEN 1 AND 256),
    role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
    status TEXT NOT NULL CHECK(length(status) BETWEEN 1 AND 32),
    version INTEGER NOT NULL CHECK(version >= 1),
    seq INTEGER NOT NULL CHECK(seq >= 1),
    created_at TEXT NOT NULL,
    PRIMARY KEY(session_id,message_id)
  )`,
  `CREATE TABLE tool_calls (
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    call_id TEXT NOT NULL CHECK(length(call_id) BETWEEN 1 AND 256),
    tool_name TEXT NOT NULL CHECK(length(tool_name) BETWEEN 1 AND 128),
    request_id TEXT NULL CHECK(request_id IS NULL OR length(request_id) BETWEEN 1 AND 256),
    turn_id TEXT NULL CHECK(turn_id IS NULL OR length(turn_id) BETWEEN 1 AND 256),
    outcome TEXT NOT NULL CHECK(length(outcome) BETWEEN 1 AND 32),
    evidence_ref TEXT NULL CHECK(evidence_ref IS NULL OR length(evidence_ref) BETWEEN 1 AND 256),
    seq INTEGER NOT NULL CHECK(seq >= 1),
    PRIMARY KEY(session_id,call_id)
  )`,
  `CREATE TRIGGER session_project_immutable BEFORE UPDATE OF project_id ON sessions
    BEGIN SELECT RAISE(ABORT,'immutable project'); END`,
  `CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT,'immutable event'); END`,
  `CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT,'immutable event'); END`,
  `CREATE TRIGGER events_sequence_order BEFORE INSERT ON events
    WHEN NEW.seq <> (SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE session_id=NEW.session_id)
    BEGIN SELECT RAISE(ABORT,'noncontiguous event sequence'); END`,
] as const;

type SchemaObject = { type: string; name: string; sql: string | null };

function schemaObjects(db: Database.Database): SchemaObject[] {
  return db.prepare(`SELECT type,name,sql FROM sqlite_master
    WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%'
    ORDER BY type,name`).all() as SchemaObject[];
}

function normalizedSql(sql: string | null): string {
  return sql?.replace(/\s+/g, " ").trim() ?? "";
}

// Compare complete definitions, including constraints and trigger bodies, not merely names.
const expectedObjects = (() => {
  const db = new Database(":memory:");
  try {
    for (const statement of SESSION_SCHEMA_DDL) db.exec(statement);
    return schemaObjects(db).map((object) => ({
      type: object.type, name: object.name, sql: normalizedSql(object.sql),
    }));
  } finally {
    db.close();
  }
})();

export function verifySessionSchema(db: Database.Database): void {
  try {
    const actual = schemaObjects(db).map((object) => ({
      type: object.type, name: object.name, sql: normalizedSql(object.sql),
    }));
    if (JSON.stringify(actual) !== JSON.stringify(expectedObjects)) throw new SessionDatabaseInvalidError();
    const rows = db.prepare("SELECT schema_version FROM session_meta").all() as Array<{ schema_version: number }>;
    if (rows.length !== 1 || rows[0]?.schema_version !== SESSION_SCHEMA_VERSION) {
      throw new SessionDatabaseInvalidError();
    }
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new SessionDatabaseInvalidError();
    if ((db.pragma("foreign_key_check") as unknown[]).length !== 0) throw new SessionDatabaseInvalidError();
  } catch {
    throw new SessionDatabaseInvalidError();
  }
}
