import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionEventStore } from "../src/continuity/session-event-store.js";
import { parseStoredSessionEvent } from "../src/continuity/session-event-types.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "session-events-"));
  cleanup.push(root);
  const parent = path.join(root, "private-state", "session-events");
  return { root, parent, databasePath: path.join(parent, "metadata.db") };
}

function openReadOnly(databasePath: string) {
  return new Database(databasePath, { readonly: true });
}

describe("SessionEventStore metadata database", () => {
  it("creates a private versioned SQLite schema, closes twice and reopens", async () => {
    const { parent, databasePath } = await fixture();
    const store = new SessionEventStore({ databasePath });
    expect((await stat(parent)).mode & 0o777).toBe(0o700);
    expect((await stat(databasePath)).mode & 0o777).toBe(0o600);
    store.close();
    store.close();
    const raw = openReadOnly(databasePath);
    try {
      const names = (type: string) => (raw.prepare("SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type) as Array<{ name: string }>).map((row) => row.name);
      expect(names("table")).toEqual(["bindings", "events", "messages", "session_meta", "sessions", "tool_calls"]);
      expect(names("index")).toEqual(["bindings_active_conversation", "bindings_active_session"]);
      expect(names("trigger")).toEqual(["events_no_delete", "events_no_update", "events_sequence_order", "session_project_immutable"]);
      expect(raw.prepare("SELECT schema_version FROM session_meta").all()).toEqual([{ schema_version: 1 }]);
      for (const table of ["bindings", "messages", "tool_calls"]) {
        expect((raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(0);
      }
    } finally {
      raw.close();
    }
    const reopened = new SessionEventStore({ databasePath });
    reopened.close();
  });

  it("refuses an existing zero-byte or non-SQLite file without changing its bytes", async () => {
    for (const content of ["", "not a database"]) {
      const { parent, databasePath } = await fixture();
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await writeFile(databasePath, content, { mode: 0o600 });
      const before = await readFile(databasePath);
      expect(() => new SessionEventStore({ databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
      expect(await readFile(databasePath)).toEqual(before);
    }
  });

  it("rejects file and parent symlinks without opening their targets", async () => {
    const { root, parent, databasePath } = await fixture();
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const target = path.join(root, "target.db");
    await writeFile(target, "unmodified", { mode: 0o600 });
    await symlink(target, databasePath);
    expect(() => new SessionEventStore({ databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    expect(await readFile(target, "utf8")).toBe("unmodified");
    expect((await lstat(databasePath)).isSymbolicLink()).toBe(true);

    const other = await fixture();
    const alternate = path.join(other.root, "alternate");
    await mkdir(alternate, { mode: 0o700 });
    await mkdir(path.dirname(other.parent), { mode: 0o700 });
    await symlink(alternate, other.parent);
    expect(() => new SessionEventStore({ databasePath: other.databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    expect(await lstat(other.parent)).toMatchObject({});
  });

  it("rejects a symlinked ancestor above an existing private database parent", async () => {
    const { root } = await fixture();
    const actual = path.join(root, "actual");
    const actualParent = path.join(actual, "private-state", "session-events");
    await mkdir(actualParent, { recursive: true, mode: 0o700 });
    const alias = path.join(root, "alias");
    await symlink(actual, alias);
    const targetDatabase = path.join(actualParent, "metadata.db");
    const linkedDatabase = path.join(alias, "private-state", "session-events", "metadata.db");
    await expect(stat(targetDatabase)).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => new SessionEventStore({ databasePath: linkedDatabase }))
      .toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    await expect(stat(targetDatabase)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a world-readable file, permissive parent, or directory as the DB", async () => {
    const file = await fixture();
    const store = new SessionEventStore({ databasePath: file.databasePath });
    store.close();
    await chmod(file.databasePath, 0o644);
    expect(() => new SessionEventStore({ databasePath: file.databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    await chmod(file.databasePath, 0o600);
    await chmod(file.parent, 0o755);
    expect(() => new SessionEventStore({ databasePath: file.databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    const other = await fixture();
    await mkdir(other.databasePath, { recursive: true, mode: 0o700 });
    expect(() => new SessionEventStore({ databasePath: other.databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
  });

  it("rejects an unsupported version, missing index, modified named index and replaced trigger", async () => {
    const attacks = [
      "UPDATE session_meta SET schema_version=999",
      "DROP INDEX bindings_active_session",
      "DROP INDEX bindings_active_session; CREATE UNIQUE INDEX bindings_active_session ON bindings(provider) WHERE retired_at IS NULL",
      "DROP TRIGGER events_no_update; CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT 1; END",
    ];
    for (const attack of attacks) {
      const { databasePath } = await fixture();
      const store = new SessionEventStore({ databasePath });
      store.close();
      const db = new Database(databasePath);
      db.exec(attack);
      db.close();
      const before = await readFile(databasePath);
      expect(() => new SessionEventStore({ databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
      expect(await readFile(databasePath)).toEqual(before);
    }
  });

  it("rejects an openable SQLite DB with a damaged table B-tree", async () => {
    const { databasePath } = await fixture();
    new SessionEventStore({ databasePath }).close();
    const db = new Database(databasePath);
    const insert = db.prepare(`INSERT INTO sessions(session_id,project_id,state,revision,next_seq,active_binding_id,created_at,updated_at,closed_at)
      VALUES (?,?, 'active', 1, 1, NULL, ?, ?, NULL)`);
    for (let i = 0; i < 30; i += 1) insert.run(randomUUID(), "fixture", "2026-09-21T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    const pageSize = db.pragma("page_size", { simple: true }) as number;
    const leaf = db.prepare("SELECT pageno FROM dbstat WHERE name='sessions' AND pagetype='leaf' ORDER BY pageno DESC LIMIT 1").get() as { pageno: number };
    db.close();
    const bytes = await readFile(databasePath);
    const offset = (leaf.pageno - 1) * pageSize;
    bytes[offset + 3] = 0x7f;
    bytes[offset + 4] = 0xff;
    await writeFile(databasePath, bytes);
    const probe = new Database(databasePath);
    try {
      let invalid = false;
      try { invalid = probe.pragma("quick_check", { simple: true }) !== "ok"; } catch { invalid = true; }
      expect(invalid).toBe(true);
    } finally { probe.close(); }
    const before = await readFile(databasePath);
    expect(() => new SessionEventStore({ databasePath })).toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    expect(await readFile(databasePath)).toEqual(before);
  });
});

describe("SessionEventStore project-scoped lifecycle", () => {
  it("creates one local session and start event, rejects foreign and unknown lookup", async () => {
    const { databasePath } = await fixture();
    const store = new SessionEventStore({ databasePath });
    try {
      const created = store.createSession("project-a");
      expect(created).toMatchObject({
        sessionId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        projectId: "project-a", state: "active", revision: 1, nextSeq: 2,
        activeBindingId: null, closedAt: null,
      });
      expect(store.getSession(created.sessionId, "project-a")).toEqual(created);
      const foreign = () => store.getSession(created.sessionId, "project-b");
      const unknown = () => store.getSession("00000000-0000-4000-8000-000000000000", "project-a");
      for (const request of [foreign, unknown]) {
        expect(request).toThrowError(expect.objectContaining({ code: "SESSION_NOT_FOUND" }));
      }
      const raw = new Database(databasePath);
      try {
        const rows = raw.prepare("SELECT seq,kind,actor,correlation_id,metadata_json FROM events").all();
        expect(rows).toEqual([{ seq: 1, kind: "session.started", actor: "system", correlation_id: null, metadata_json: "{}" }]);
        expect(() => raw.prepare("UPDATE sessions SET project_id='project-b'").run()).toThrow();
      } finally { raw.close(); }
      for (const projectId of ["", " ", "\u0000", "x".repeat(257)]) {
        expect(() => store.createSession(projectId)).toThrow();
      }
    } finally { store.close(); }
  });

  it("closes exactly once with revision CAS, rejects stale and cross-project callers", async () => {
    const { databasePath } = await fixture();
    const store = new SessionEventStore({ databasePath });
    try {
      const created = store.createSession("project-a");
      const foreign = () => store.closeSession(created.sessionId, "project-b", 1);
      const unknown = () => store.closeSession("00000000-0000-4000-8000-000000000000", "project-a", 1);
      for (const request of [foreign, unknown]) {
        expect(request).toThrowError(expect.objectContaining({ code: "SESSION_NOT_FOUND" }));
      }
      expect(() => store.closeSession(created.sessionId, "project-a", 2)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
      const closed = store.closeSession(created.sessionId, "project-a", 1);
      expect(closed).toMatchObject({ sessionId: created.sessionId, state: "closed", revision: 2, nextSeq: 3 });
      expect(closed.closedAt).toEqual(expect.any(String));
      expect(() => store.closeSession(created.sessionId, "project-a", 1)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
      expect(() => store.closeSession(created.sessionId, "project-a", 2)).toThrowError(expect.objectContaining({ code: "SESSION_CLOSED" }));
      const raw = openReadOnly(databasePath);
      try {
        expect(raw.prepare("SELECT seq,kind FROM events WHERE session_id=? ORDER BY seq").all(created.sessionId)).toEqual([
          { seq: 1, kind: "session.started" }, { seq: 2, kind: "session.closed" },
        ]);
      } finally { raw.close(); }
    } finally { store.close(); }
  });

  it("rolls back status, revision and sequence if close-event insert fails", async () => {
    const { databasePath } = await fixture();
    const store = new SessionEventStore({ databasePath });
    try {
      const created = store.createSession("project-a");
      const injector = new Database(databasePath);
      try {
        injector.exec(`CREATE TRIGGER test_abort_close BEFORE INSERT ON events
          WHEN NEW.kind='session.closed' BEGIN SELECT RAISE(ABORT,'injected close failure'); END`);
      } finally { injector.close(); }
      expect(() => store.closeSession(created.sessionId, "project-a", 1)).toThrow(/injected close failure/);
      expect(store.getSession(created.sessionId, "project-a")).toMatchObject({ state: "active", revision: 1, nextSeq: 2, closedAt: null });
      const raw = openReadOnly(databasePath);
      try {
        expect(raw.prepare("SELECT seq,kind FROM events WHERE session_id=?").all(created.sessionId)).toEqual([{ seq: 1, kind: "session.started" }]);
      } finally { raw.close(); }
    } finally { store.close(); }
  });
});

describe("SessionEventStore bounded history", () => {
  it("paginates closed session events with a stable forward cursor", async () => {
    const { databasePath } = await fixture();
    const store = new SessionEventStore({ databasePath });
    const created = store.createSession("project-a");
    store.closeSession(created.sessionId, "project-a", created.revision);
    const first = store.listEvents(created.sessionId, "project-a", 0, 1);
    expect(first).toMatchObject({ nextCursor: 1, hasMore: true });
    expect(first.events.map((event) => [event.seq, event.kind])).toEqual([[1, "session.started"]]);
    const second = store.listEvents(created.sessionId, "project-a", first.nextCursor, 1);
    expect(second).toMatchObject({ nextCursor: 2, hasMore: false });
    expect(second.events.map((event) => [event.seq, event.kind])).toEqual([[2, "session.closed"]]);
    expect(store.listEvents(created.sessionId, "project-a", 2, 100)).toEqual({ events: [], nextCursor: 2, hasMore: false });
    expect(store.listEvents(created.sessionId, "project-a", 0, 100).events).toHaveLength(2);
    for (const limit of [0, 101, NaN, 1.5]) {
      expect(() => store.listEvents(created.sessionId, "project-a", 0, limit)).toThrow();
    }
    for (const cursor of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.listEvents(created.sessionId, "project-a", cursor, 1)).toThrow();
    }
    const foreign = () => store.listEvents(created.sessionId, "project-b", 0, 1);
    const unknown = () => store.listEvents("00000000-0000-4000-8000-000000000000", "project-a", 0, 1);
    for (const request of [foreign, unknown]) {
      expect(request).toThrowError(expect.objectContaining({ code: "SESSION_NOT_FOUND" }));
    }
    store.close();
    const reopened = new SessionEventStore({ databasePath });
    try {
      expect(reopened.listEvents(created.sessionId, "project-a", 0, 1).events).toEqual(first.events);
      expect(reopened.listEvents(created.sessionId, "project-a", 1, 1).events).toEqual(second.events);
    } finally { reopened.close(); }
  });
});

describe("SessionEventStore metadata privacy and parsing", () => {
  const validRow = {
    session_id: "00000000-0000-4000-8000-000000000000", seq: 1,
    kind: "session.started", actor: "system", correlation_id: null,
    metadata_json: "{}", happened_at: "2026-09-21T00:00:00.000Z",
  };

  it("rejects malformed event rows rather than returning untrusted data", () => {
    for (const update of [
      { kind: "other" }, { actor: "user" },
      { metadata_json: '{"token":"secret"}' }, { metadata_json: "{broken" },
      { seq: 1.5 }, { correlation_id: "forged" },
      { happened_at: "2026-09-21" },
    ]) {
      expect(() => parseStoredSessionEvent({ ...validRow, ...update }))
        .toThrowError(expect.objectContaining({ code: "SESSION_DATABASE_INVALID" }));
    }
    expect(parseStoredSessionEvent({ ...validRow, secret: "chat-secret-canary" })).toEqual({
      sessionId: validRow.session_id, seq: 1, kind: "session.started", actor: "system",
      correlationId: null, metadata: {}, happenedAt: validRow.happened_at,
    });
  });

  it("does not provide ingestion methods or content columns and reserves unique bindings", async () => {
    const { databasePath } = await fixture();
    const store = new SessionEventStore({ databasePath });
    const one = store.createSession("project-a");
    const two = store.createSession("project-a");
    for (const method of ["bindConversation", "recordMessage", "recordToolCall", "appendEvent", "send"]) {
      expect((store as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
    store.close();
    const db = new Database(databasePath);
    try {
      for (const table of ["bindings", "messages", "tool_calls"]) {
        expect((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(0);
      }
      const columns = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").all() as Array<{ sql: string }>).map((row) => row.sql).join("\n");
      expect(columns).not.toMatch(/encrypted_body|raw_body|tool_output|tool_arguments|transcript/i);
      const insert = db.prepare(`INSERT INTO bindings
        (binding_id,session_id,provider,conversation_id,identity_evidence_ref,verified_at)
        VALUES (?,?,?,?,?,?)`);
      insert.run(randomUUID(), one.sessionId, "fixture-provider", "conversation-a", "fixture-evidence", "2026-09-21T00:00:00.000Z");
      expect(() => insert.run(randomUUID(), two.sessionId, "fixture-provider", "conversation-a", "fixture-evidence", "2026-09-21T00:00:00.000Z")).toThrow();
      expect(() => insert.run(randomUUID(), one.sessionId, "fixture-provider", "conversation-b", "fixture-evidence", "2026-09-21T00:00:00.000Z")).toThrow();
      expect(() => db.prepare("UPDATE events SET kind='session.closed' WHERE session_id=?").run(one.sessionId)).toThrow();
      expect(() => db.prepare("DELETE FROM events WHERE session_id=?").run(one.sessionId)).toThrow();
    } finally { db.close(); }
    expect((await readFile(databasePath)).toString("utf8")).not.toContain("chat-secret-canary");
  });
});
