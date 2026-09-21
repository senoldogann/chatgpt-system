import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, type Stats } from "node:fs";
import path from "node:path";
import { ConflictError, LimitError, PolicyError } from "./errors.js";
import { SessionClosedError, SessionDatabaseInvalidError, SessionNotFoundError } from "./session-event-errors.js";
import { SESSION_SCHEMA_DDL, SESSION_SCHEMA_VERSION, verifySessionSchema } from "./session-event-schema.js";
import { parseStoredSessionEvent, type EventPage, type SessionEventStoreOptions, type SessionView } from "./session-event-types.js";

type SessionRow = { session_id: string; project_id: string; state: string; revision: number; next_seq: number; active_binding_id: null; created_at: string; updated_at: string; closed_at: string | null };

function existingStat(file: string): Stats | undefined {
  try {
    return lstatSync(file, { bigint: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new SessionDatabaseInvalidError();
  }
}

function privateParent(directory: string): void {
  const missing: string[] = [];
  let candidate = directory;
  let foundPrivateAncestor = false;
  while (true) {
    const info = existingStat(candidate);
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) throw new SessionDatabaseInvalidError();
      if ((info.mode & 0o077) !== 0) {
        if (!foundPrivateAncestor) throw new SessionDatabaseInvalidError();
        break;
      }
      foundPrivateAncestor = true;
    } else {
      missing.unshift(candidate);
    }
    if (path.dirname(candidate) === candidate) {
      if (!foundPrivateAncestor) throw new SessionDatabaseInvalidError();
      break;
    }
    candidate = path.dirname(candidate);
  }
  for (const entry of missing) {
    try {
      mkdirSync(entry, { mode: 0o700 });
      const info = lstatSync(entry);
      if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new SessionDatabaseInvalidError();
    } catch {
      throw new SessionDatabaseInvalidError();
    }
  }
}

export class SessionEventStore {
  private readonly db: Database.Database;
  private closed = false;
  private readonly now: () => number;

  constructor(options: SessionEventStoreOptions) {
    if (!path.isAbsolute(options.databasePath)) throw new SessionDatabaseInvalidError();
    this.now = options.now ?? Date.now;
    privateParent(path.dirname(options.databasePath));
    const prior = existingStat(options.databasePath);
    if (prior && (!prior.isFile() || prior.isSymbolicLink() || (prior.mode & 0o077) !== 0 || prior.size === 0)) {
      throw new SessionDatabaseInvalidError();
    }
    let created = false;
    if (!prior) {
      try {
        const fd = openSync(options.databasePath, "wx", 0o600);
        closeSync(fd);
        created = true;
      } catch {
        throw new SessionDatabaseInvalidError();
      }
    }
    let opened: Database.Database | undefined;
    try {
      opened = new Database(options.databasePath, { fileMustExist: true });
      opened.pragma("foreign_keys = ON");
      opened.pragma("busy_timeout = 5000");
      if (created) {
        const db = opened;
        db.transaction(() => {
          for (const statement of SESSION_SCHEMA_DDL) db.exec(statement);
          db.prepare("INSERT INTO session_meta(schema_version) VALUES (?)").run(SESSION_SCHEMA_VERSION);
        })();
      }
      verifySessionSchema(opened);
      this.db = opened;
    } catch {
      if (opened?.open) opened.close();
      throw new SessionDatabaseInvalidError();
    }
  }

  private projectId(value: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\u0000") || Buffer.byteLength(value, "utf8") > 256) {
      throw new PolicyError("The verified project ID is invalid.");
    }
    return value;
  }

  private view(row: SessionRow): SessionView {
    if (typeof row.session_id !== "string" || typeof row.project_id !== "string"
      || (row.state !== "active" && row.state !== "closed")
      || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !Number.isSafeInteger(row.next_seq) || row.next_seq < 2
      || row.active_binding_id !== null || typeof row.created_at !== "string"
      || typeof row.updated_at !== "string"
      || (row.closed_at !== null && typeof row.closed_at !== "string")
      || (row.state === "closed") !== (row.closed_at !== null)) {
      throw new SessionDatabaseInvalidError();
    }
    return {
      sessionId: row.session_id, projectId: row.project_id,
      state: row.state, revision: row.revision, nextSeq: row.next_seq,
      activeBindingId: null, createdAt: row.created_at,
      updatedAt: row.updated_at, closedAt: row.closed_at,
    };
  }

  createSession(verifiedProjectId: string): SessionView {
    const projectId = this.projectId(verifiedProjectId);
    const sessionId = randomUUID();
    const timestamp = new Date(this.now()).toISOString();
    return this.db.transaction(() => {
      this.db.prepare(`INSERT INTO sessions
        (session_id,project_id,state,revision,next_seq,active_binding_id,created_at,updated_at,closed_at)
        VALUES (?,?,'active',1,1,NULL,?,?,NULL)`).run(sessionId, projectId, timestamp, timestamp);
      this.db.prepare(`INSERT INTO events
        (session_id,seq,kind,actor,correlation_id,metadata_json,happened_at)
        VALUES (?,1,'session.started','system',NULL,'{}',?)`).run(sessionId, timestamp);
      this.db.prepare("UPDATE sessions SET next_seq=2 WHERE session_id=?").run(sessionId);
      return this.getSession(sessionId, projectId);
    })();
  }

  getSession(sessionId: string, verifiedProjectId: string): SessionView {
    const projectId = this.projectId(verifiedProjectId);
    const row = this.db.prepare("SELECT * FROM sessions WHERE session_id=? AND project_id=?")
      .get(sessionId, projectId) as SessionRow | undefined;
    if (!row) throw new SessionNotFoundError();
    return this.view(row);
  }

  closeSession(sessionId: string, verifiedProjectId: string, expectedRevision: number): SessionView {
    const projectId = this.projectId(verifiedProjectId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new PolicyError("The expected session revision is invalid.");
    }
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM sessions WHERE session_id=? AND project_id=?")
        .get(sessionId, projectId) as SessionRow | undefined;
      if (!row) throw new SessionNotFoundError();
      if (row.revision !== expectedRevision) throw new ConflictError("Session revision changed; reread before updating.");
      if (row.state !== "active") throw new SessionClosedError();
      const timestamp = new Date(this.now()).toISOString();
      const updated = this.db.prepare(`UPDATE sessions SET state='closed',revision=revision+1,
        next_seq=next_seq+1,updated_at=?,closed_at=?
        WHERE session_id=? AND project_id=? AND revision=? AND state='active'`)
        .run(timestamp, timestamp, sessionId, projectId, expectedRevision);
      if (updated.changes !== 1) throw new ConflictError("Session revision changed; reread before updating.");
      this.db.prepare(`INSERT INTO events(session_id,seq,kind,actor,correlation_id,metadata_json,happened_at)
        VALUES (?,?,'session.closed','system',NULL,'{}',?)`).run(sessionId, row.next_seq, timestamp);
      return this.getSession(sessionId, projectId);
    })();
  }

  listEvents(sessionId: string, verifiedProjectId: string, afterSeq: number, limit: number): EventPage {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new PolicyError("The session event cursor is invalid.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new LimitError("The session event page limit must be between 1 and 100.");
    }
    this.getSession(sessionId, verifiedProjectId);
    const rows = this.db.prepare(`SELECT session_id,seq,kind,actor,correlation_id,metadata_json,happened_at
      FROM events WHERE session_id=? AND seq>? ORDER BY seq ASC LIMIT ?`)
      .all(sessionId, afterSeq, limit + 1);
    const parsed = rows.map((row) => parseStoredSessionEvent(row));
    const events = parsed.slice(0, limit);
    return {
      events,
      nextCursor: events.length === 0 ? afterSeq : events[events.length - 1]!.seq,
      hasMore: parsed.length > limit,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
