# SessionEventStore Metadata v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an opt-in, private, durable, metadata-only work-session store with atomic lifecycle events and bounded history without creating an external chat identity or capturing content.

**Architecture:** Add a versioned SQLite store independent from Project Continuity and task_state. Keep its synchronous API internal, with a fixed two-event vocabulary and transactionally allocated per-session sequence/revision; construct it only when explicitly enabled and close it in the existing daemon lifetime. Do not register an MCP tool, bind external conversations, or copy audit/tool/chat payloads.

**Tech Stack:** Node.js >=22; TypeScript 6; existing better-sqlite3 13.0.3 and @types/better-sqlite3; node:crypto, node:fs, node:path; Vitest 5; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-21-session-event-store-metadata-design.md`, approved by the user after local spec commit `2c63b980e032b4c9a8c6b1251dcb7840b638aa7f`.

## Global Constraints

- Start with `project_resume({alias:"chatgpt-system-desktop"})` and reconcile Git, HEAD, worktree ownership and `AGENTS.md`. The clean canonical `main` carries the spec; the separate unpublished `feat/owner-shell-batch-20260921@0a541d6201044b9865800627a80738f9739639de` must not be merged, overwritten or included.
- This is **implementation planning only** until the user reviews this plan and chooses an execution method. When authorized to execute, follow the repository's branch/worktree policy and TDD RED before any production code. Commits, push, PR, merge, deployment and restart are distinct operations and need their respective authorization. Do not stage broad directories, rewrite history or clean unfamiliar files.
- The default metadata DB is `path.join(taskStateRoot, 'session-events', 'metadata.db')`; `taskStateRoot` defaults to `~/.chatgpt-system/state`. `sessionEvents.enabled` defaults false. Disabled runtime construction does not even open or create this DB; tests supply temporary roots.
- No new runtime dependencies, public MCP tools, autonomous collectors, external egress, second authority/task/project truth, cross-database atomicity, transcript/tool/terminal bodies, lease IDs, raw provider receipts or plaintext content storage.
- A `verifiedProjectId` is a trusted calling-service input, **not** evidence produced by the store. There is no external route or binding/message/tool writer in this delivery; later routes must re-resolve their Project lease and project identity at use time.
- Schema version 1 only; reject existing zero-byte, nonregular, symlink, permissive, corrupt, partial or unsupported files without repairing/overwriting them. Newly created directories 0700 and DB 0600; `foreign_keys=ON`, `busy_timeout=5000`, `quick_check`, schema/trigger/index checks and foreign-key integrity.
- Store sessions as local UUID v4 with immutable project, `active|closed`, revision 1 on creation then +1 per later mutation, and events `session.started|session.closed` only (actor `system`, NULL correlation, `{}` metadata). No user-supplied session IDs or generic event append.
- All DB writes are transactional, SQL parameter-bound, and fail closed. No host execution fallback when Project sandbox or declared native verification refuses an operation. Do not infer running-daemon activation from source tests.

## File map and dependency order

| File | Responsibility |
| --- | --- |
| `src/session-event-types.ts` (new) | Exact `SessionView`, `SessionEvent`, `EventPage`, input validators and bounded IDs/cursor/page types. No DB/authority access. |
| `src/session-event-errors.ts` (new) | `SESSION_DATABASE_INVALID`, `SESSION_NOT_FOUND` and `SESSION_CLOSED` via existing `AppError`; reuse `ConflictError`, `PolicyError`, `LimitError`. |
| `src/session-event-schema.ts` (new) | Complete v1 DDL and schema fingerprint/introspection helpers; single responsibility, no DB filesystem opening. |
| `src/session-event-store.ts` (new) | Private DB open/close, integrity check, transactions and four internal methods; no MCP or content ingestion. |
| `tests/session-event-store.test.ts` (new) | Real temporary SQLite tests for private opening, corruption, concurrency, scoped history and no content. |
| `src/config.ts` (modify) | `sessionEvents: {enabled:boolean}` and optional override/env flag, default false; no independently configured DB path. |
| `tests/session-event-config.test.ts` (new) | Default-off config, explicit opt-in, invalid env and no path override. |
| `src/server.ts` (modify) | Optional `sessionEventStore` runtime property; create only if explicitly enabled, deriving DB path from `taskStateRoot`; injection is test-only and cannot silently enable disabled mode. No `registerTool`. |
| `src/runtime-shutdown.ts` (modify) | Optional `session-events` shutdown phase before transport and independently of continuity; idempotent store close. |
| `tests/runtime-shutdown.test.ts` (modify) | Normal and failure phase ordering. |
| `tests/session-event-runtime.test.ts` (new) | Real temp runtime enable/disable and fixture isolation, unchanged MCP tool catalog. |
| `docs/ARCHITECTURE.md`, `README.md` (modify only as required after tests) | Accurate opt-in metadata-only operator contract, no activation or provider claims. |
| `tests/session-event-documentation.test.ts` (new) | Design, README and architecture boundary contract. |

`src/continuity-store.ts`, `src/task-state-service.ts`, Owner Shell, browser/computer, `tool-output-schemas.ts`, publish gate, native code and all existing tool registrations remain unchanged. Never add a `session_*` MCP surface in this slice.

## Review Focus — five high-risk input/failure classes

1. **A present zero-byte DB or malicious symlink:** must be rejected without reinitialization or changing original bytes; Task 1 tests direct file and parent links.
2. **A store opened over altered schema/index/trigger or an openable damaged B-tree:** fail `SESSION_DATABASE_INVALID` rather than treating a table-name match as valid; Task 1 tests schema tampering and integrity.
3. **Two callers close with the same revision:** exactly one commits, the stale caller gets `CONFLICT`, and there is exactly one close event with no sequence gap; Task 2 tests both calls and rollback injection.
4. **A valid-looking session ID supplied with another project ID:** both get/read/list/close must return indistinguishable `SESSION_NOT_FOUND` from genuinely unknown IDs; Task 2/3 tests.
5. **A malformed cursor or stored event payload alongside changing history:** no skipped/reordered event, no fabricated event on parse failure; Task 3 tests 0/101 limits, invalid cursor, a concurrent append between pages and direct DB tampering.

---

### Task 0: Reconcile exact project and establish implementation ownership

**Files:** Read `AGENTS.md`, `docs/PROJECT_STATE.md`, the approved spec, this plan, `src/config.ts`, `src/server.ts`, `src/runtime-shutdown.ts`, `src/continuity-store.ts`; do not modify files in this task.

**Interfaces:** Produces verified root, branch, HEAD, owner and permitted change scope; no code interface.

- [ ] **Step 1: Resume and inspect.** Invoke the Mac-connected MCP `project_resume` with the exact alias; use its returned Project lease for `git_status`, `git_log`, `git_diff`, `git_inventory` and `fs_read`. Confirm canonical root `/Users/dogan/Desktop/chatgpt-system`, branch/worktree identity and current tracked/untracked ownership, rather than assuming the spec's dated HEAD remains current.
- [ ] **Step 2: Select the work location.** Apply `AGENTS.md`: default to clean canonical `main` for solo work, or use an explicitly authorized branch / plugin-owned worktree if ownership isolation actually requires it. Do not change an unfamiliar dirty checkout or mix the separate Owner Shell Batch feature branch. Record the exact branch, head, root and decision via `project_checkpoint` **before** the first test write.
- [ ] **Step 3: Establish safety baseline.** Confirm `docs/superpowers/specs/2026-09-21-session-event-store-metadata-design.md` matches approved design, the new file names in the file map do not already exist, and `package.json` still has existing `better-sqlite3` and `npm run check`; if not, reconcile the plan before modifying code. No Admin lease is needed for Project-only source edits/tests.

**Acceptance:** Current state and ownership are known, no unrelated path is edited and the approved written spec remains unchanged.

### Task 1: Private versioned SQLite schema and fail-closed opener

**Files:** Create `src/session-event-types.ts`, `src/session-event-errors.ts`, `src/session-event-schema.ts`, `src/session-event-store.ts`, `tests/session-event-store.test.ts`.

**Interfaces:**

```ts
export type SessionState = "active" | "closed";
export interface SessionView { sessionId: string; projectId: string; state: SessionState; revision: number; nextSeq: number; activeBindingId: null; createdAt: string; updatedAt: string; closedAt: string | null; }
export type SessionEventKind = "session.started" | "session.closed";
export interface SessionEvent { sessionId: string; seq: number; kind: SessionEventKind; actor: "system"; correlationId: null; metadata: Record<string, never>; happenedAt: string; }
export interface EventPage { events: SessionEvent[]; nextCursor: number; hasMore: boolean; }
export interface SessionEventStoreOptions { databasePath: string; now?: () => number; }
export class SessionEventStore { constructor(options: SessionEventStoreOptions); close(): void; /* methods added in Tasks 2–3 */ }
```

`SessionDatabaseInvalidError extends AppError` code `SESSION_DATABASE_INVALID`; `SessionNotFoundError` code `SESSION_NOT_FOUND`; `SessionClosedError` code `SESSION_CLOSED`. Reuse `ConflictError` for stale revision and `PolicyError` / `LimitError` for invalid inputs. New errors carry no file contents or identifiers.

**Exact DDL contract:** Export a single `SESSION_SCHEMA_VERSION=1`, a named `SESSION_SCHEMA_DDL` array, and a `verifySessionSchema(db)` helper from `session-event-schema.ts`. Use SQLite quoted literal `{}` (not JavaScript interpolation), placeholders in DML and only fixed SQL identifiers. The required logical SQL is:

```sql
CREATE TABLE session_meta (schema_version INTEGER NOT NULL);
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 256),
  state TEXT NOT NULL CHECK(state IN ('active','closed')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  next_seq INTEGER NOT NULL CHECK(next_seq >= 1),
  active_binding_id TEXT NULL CHECK(active_binding_id IS NULL),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT NULL,
  CHECK ((state='active' AND closed_at IS NULL) OR (state='closed' AND closed_at IS NOT NULL))
);
CREATE TABLE bindings (
  binding_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id),
  provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 128),
  conversation_id TEXT NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 256),
  identity_evidence_ref TEXT NOT NULL CHECK(length(identity_evidence_ref) BETWEEN 1 AND 256),
  verified_at TEXT NOT NULL, retired_at TEXT NULL
);
CREATE UNIQUE INDEX bindings_active_conversation ON bindings(provider,conversation_id) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX bindings_active_session ON bindings(session_id) WHERE retired_at IS NULL;
CREATE TABLE events (
  session_id TEXT NOT NULL REFERENCES sessions(session_id), seq INTEGER NOT NULL CHECK(seq >= 1),
  kind TEXT NOT NULL CHECK(kind IN ('session.started','session.closed')),
  actor TEXT NOT NULL CHECK(actor='system'),
  correlation_id TEXT NULL CHECK(correlation_id IS NULL),
  metadata_json TEXT NOT NULL CHECK(metadata_json='{}'),
  happened_at TEXT NOT NULL, PRIMARY KEY(session_id,seq)
);
CREATE TABLE messages (
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 256),
  turn_id TEXT NULL CHECK(turn_id IS NULL OR length(turn_id) BETWEEN 1 AND 256),
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
  status TEXT NOT NULL CHECK(length(status) BETWEEN 1 AND 32),
  version INTEGER NOT NULL CHECK(version >= 1), seq INTEGER NOT NULL CHECK(seq >= 1),
  created_at TEXT NOT NULL, PRIMARY KEY(session_id,message_id)
);
CREATE TABLE tool_calls (
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  call_id TEXT NOT NULL CHECK(length(call_id) BETWEEN 1 AND 256),
  tool_name TEXT NOT NULL CHECK(length(tool_name) BETWEEN 1 AND 128),
  request_id TEXT NULL CHECK(request_id IS NULL OR length(request_id) BETWEEN 1 AND 256),
  turn_id TEXT NULL CHECK(turn_id IS NULL OR length(turn_id) BETWEEN 1 AND 256),
  outcome TEXT NOT NULL CHECK(length(outcome) BETWEEN 1 AND 32),
  evidence_ref TEXT NULL CHECK(evidence_ref IS NULL OR length(evidence_ref) BETWEEN 1 AND 256),
  seq INTEGER NOT NULL CHECK(seq >= 1), PRIMARY KEY(session_id,call_id)
);
CREATE TRIGGER session_project_immutable BEFORE UPDATE OF project_id ON sessions BEGIN SELECT RAISE(ABORT,'immutable project'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER events_sequence_order BEFORE INSERT ON events
  WHEN NEW.seq <> (SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE session_id=NEW.session_id)
  BEGIN SELECT RAISE(ABORT,'noncontiguous event sequence'); END;
```

`session_meta` must contain exactly one row `1`; names and normalized SQL definitions for all six tables, both named indexes and four triggers must agree with the code's DDL, rather than checking table names alone. Ignore SQLite's own `sqlite_%` objects; reject unexpected application tables or a missing/replaced constraint. Verify `PRAGMA foreign_key_check` returns no rows and `PRAGMA quick_check` is `ok`. Keep the schema as a whole atomic transaction, not six independent writes. The reserved `messages`, `tool_calls` and `bindings` tables have no application writer.

- [ ] **Step 1: RED private path and persistence tests.** In `tests/session-event-store.test.ts`, use `mkdtemp(path.join(tmpdir(), 'session-events-'))` and register cleanup with `afterEach`. Use `path.join(root,'private-state','session-events','metadata.db')` for the new path, construct `new SessionEventStore({databasePath})`, then assert `(await stat(parent)).mode & 0o777 === 0o700`, `(await stat(file)).mode & 0o777 === 0o600`; open with `better-sqlite3` read-only to assert six table names, two named indexes, four triggers, one version row and no rows in reserved tables. Call `close()` twice and reopen without losing the schema. Initial RED must be the missing store/schema module, not a fixture typo.
- [ ] **Step 2: Run the failing test.** Mac Project lease through `project_exec({command:'npm',args:['test','--','tests/session-event-store.test.ts'],cwd:'.'})`. Expected **exit nonzero** because `src/session-event-store.ts` is not present; save the actual failure instead of calling it green.
- [ ] **Step 3: Implement only opening and schema.** Create the three type/error/schema files and the store with constructor/close. Use `lstatSync` on the intended state root, session-events parent and DB entry before open; reject symlinks, non-directory parent, unsafe modes and existing nonregular/permissive file with `SESSION_DATABASE_INVALID`. Create *missing* trusted directories `0700` and a missing file with `openSync(databasePath,'wx',0o600)` then close that fd; track `createdByThisCall`. On a new file open SQLite and initialize schema+meta in `db.transaction(... )()`. On existing files do not run DDL; verify schema, version, `quick_check` and `foreign_key_check` before returning. Treat even an existing zero-byte file as invalid. Use `db.pragma('foreign_keys = ON')`, `db.pragma('busy_timeout = 5000')`; `db.open`/`close()` idempotent. If a new file fails initialization, report error without silently rebuilding the file; recovery is separately reviewed. On all constructor failures close any opened DB. Do not claim lstat+SQLite path open is an atomic defense against malicious same-user races.
- [ ] **Step 4: GREEN and adversarial RED extensions.** Run the focused test to exit 0. Then extend the same file with parameterized cases for pre-existing zero-byte/non-SQLite DB, file symlink and parent symlink, world-readable DB and parent, directory in DB path, version 999, missing index and replaced trigger. For openable corruption, initialize a valid DB; insert 30 raw fixture `sessions` rows using UUID test IDs, project `fixture`, `state='active'`, `revision=1`, `next_seq=1`, `active_binding_id=NULL`, timestamps and `closed_at=NULL`; close it, obtain a `sessions` leaf page through SQLite `dbstat`, alter that page's bytes, and first prove `PRAGMA quick_check` is not `ok` before asserting constructor failure. For each case capture the pre-open bytes or symlink target and assert `SESSION_DATABASE_INVALID`, no repair/replacement and no state outside the temp directory. Use a valid DB opened by SQLite with raw DDL changes to prove schema fingerprint rejects a changed named index even when its name still exists.
- [ ] **Step 5: Verify hardening GREEN.** Implement missing open-path/schema fingerprint behavior minimally and run `npm test -- tests/session-event-store.test.ts` until all Task 1 cases pass, then `npm run build` exit 0. Do not weaken corrupt-file assertions or modify `continuity-store.ts` to satisfy them.
- [ ] **Step 6: Review deliverable.** Inspect only the five Task 1 paths and run `git_diff({check:true})`. If local commits are explicitly authorized as part of the chosen execution method, stage these exact paths with `git_stage_paths` SHA guards and commit `feat: add private session metadata database`; otherwise retain the changes for review without altering other files.

**Acceptance:** A fresh DB is private/valid/reopenable; every existing invalid file fails without repair; schema constraints/triggers/indexes are checked and unrelated state is untouched.

### Task 2: Session lifecycle, scoped lookup and transactional CAS

**Files:** Modify `src/session-event-store.ts`, `src/session-event-types.ts`, `tests/session-event-store.test.ts`.

**Interfaces:** Implement `createSession(verifiedProjectId:string):SessionView`, `getSession(sessionId:string,verifiedProjectId:string):SessionView`, `closeSession(sessionId:string,verifiedProjectId:string,expectedRevision:number):SessionView`. `verifiedProjectId` is produced by a future trusted internal caller; this class does not authenticate arbitrary text itself.

- [ ] **Step 1: RED create/lookup contract.** Add a test with project IDs `project-a` and `project-b` (opaque local test fixtures only): create for A, assert UUID v4 regex, immutable project, `state:'active'`, `revision:1`, `nextSeq:2`, `activeBindingId:null`, `closedAt:null`; inspect SQLite row/event to confirm exactly one `session.started` event at `seq=1`. Assert `getSession(id,'project-b')` and `getSession('00000000-0000-4000-8000-000000000000','project-a')` throw the same `{code:'SESSION_NOT_FOUND'}` with no ID in error message. Direct SQL `UPDATE sessions SET project_id='project-b'` must fail via immutable trigger. Assert blank, NUL and >256-byte `verifiedProjectId` are rejected before persistence.
- [ ] **Step 2: Verify RED.** `npm test -- tests/session-event-store.test.ts` must fail because `createSession/getSession` do not exist, not because of invalid fixture setup.
- [ ] **Step 3: Minimal create/lookup.** Use `randomUUID()` (never caller session ID); accept `verifiedProjectId` only after bounded nonempty UTF-8/NUL validation, then a single SQLite transaction inserts a session (`revision=1`, `next_seq=1`) followed by the fixed start event (`seq=1`, `metadata_json='{}'`) and advances `next_seq=2`. Map DB rows to `SessionView` with runtime validation; query `WHERE session_id=? AND project_id=?` for every lookup. Use `new Date((now??Date.now)()).toISOString()` and never retain content input.
- [ ] **Step 4: GREEN then RED close race.** Run focused tests green; add a test that captures initial revision and executes `closeSession(id,'project-a',1)` twice: first returns `closed`, revision 2, `nextSeq=3`, non-null `closedAt`; second throws `CONFLICT` because expected revision 1 is stale; exactly one `session.closed` at seq 2. `closeSession(id,'project-a',2)` after closing throws `SESSION_CLOSED` rather than succeeding again. `closeSession(id,'project-b',1)` and unknown id both report `SESSION_NOT_FOUND`; wrong revision on still-active session reports `CONFLICT`; closed session cannot create additional events. Simulate atomic rollback with a test-only raw SQL trigger on `events` aborting a `session.closed` insert, and confirm session remains active, revision 1, nextSeq 2 and zero close events.
- [ ] **Step 5: Verify RED and implement transactional close.** Record the failing test, then put scoped `SELECT`, expected revision check, single `UPDATE ... WHERE session_id=? AND project_id=? AND revision=? AND state='active'`, close event insertion at saved `next_seq`, and revision/next_seq/closedAt update into one `db.transaction`. Distinguish in this exact order: scoped row absent => `SESSION_NOT_FOUND`; expected revision differs => `CONFLICT` even if the row was already closed; revision equal but row already closed => `SESSION_CLOSED`; only an active matching revision may update. If `changes!==1` after a matching pre-read, throw `CONFLICT` and roll back. On transaction error, rollback all rows; do not swallow SQLite errors or invent success. Run focused tests and `npm run build` to exit 0.
- [ ] **Step 6: Review and commit gate.** Inspect only Task 2 file changes, `git_diff --check` exit0 and, if separately authorized, exact-path SHA stage/local commit `feat: add scoped session lifecycle and atomic close`.

**Acceptance:** One authentic create event, immutable project, no cross-project enumeration, stale/duplicate closes never produce extra events and an insert failure cannot half-close a session.

### Task 3: Bounded cursor history, stored-data corruption and privacy boundaries

**Files:** Modify `src/session-event-store.ts`, `src/session-event-types.ts`, `tests/session-event-store.test.ts`; optionally create `tests/session-event-privacy.test.ts` to keep canary cases isolated.

**Interfaces:** Implement `listEvents(sessionId:string,verifiedProjectId:string,afterSeq:number,limit:number):EventPage`. Return exact `{events,nextCursor,hasMore}`; `SessionEvent` uses `metadata:{}` only.

- [ ] **Step 1: RED page behavior.** With a created then closed session, request `(afterSeq=0,limit=1)` => start event, cursor 1, hasMore true; `(1,1)` => close event, cursor 2, hasMore false; `(2,100)` => `events:[]`, cursor 2, hasMore false. `(0,100)` returns both in order. Reject limits `0`, `101`, `NaN`, `1.5`, and cursors `-1`, `NaN`, `1.5`, `Number.MAX_SAFE_INTEGER+1` before query. Unknown and cross-project IDs must produce identical `SESSION_NOT_FOUND` errors. A closed session remains readable across DB reopen.
- [ ] **Step 2: Verify RED.** `npm test -- tests/session-event-store.test.ts` must fail specifically on absent `listEvents`.
- [ ] **Step 3: Minimal bounded query.** Validate `Number.isSafeInteger(afterSeq) && afterSeq>=0`, `Number.isSafeInteger(limit) && limit>=1 && limit<=100`; fetch session through scoped lookup, then `SELECT ... WHERE session_id=? AND seq>? ORDER BY seq ASC LIMIT ?` with `limit+1` bound. Parse every returned row through strict stored-data validation (including kind, actor, NULL correlation, literal `{}` JSON, timestamp, integer seq); return first `limit` and `hasMore=rows.length>limit`. Empty-page `nextCursor=afterSeq`, otherwise last returned seq. Do not return DB metadata JSON as arbitrary model-controlled content.
- [ ] **Step 4: GREEN then corruption RED.** Run the focused suite green; export a pure `parseStoredSessionEvent(row: unknown): SessionEvent` validator from `src/session-event-types.ts`, used by `listEvents`. Unit-test it directly against `kind:'other'`, `actor:'user'`, `metadata_json:'{"token":"secret"}'`, malformed JSON, non-integer `seq` and `correlation_id:'forged'`, each starting from an otherwise valid known test row. Each case must throw `SESSION_DATABASE_INVALID` rather than returning an event. Do not disable/drop the immutable SQL trigger to fabricate a persisted row: the schema fingerprint would correctly reject that modification before event parsing. Include a canary `chat-secret-canary` as an extra input field and assert that the returned valid event exposes no extra field and the DB never contains it.
- [ ] **Step 5: Privacy and schema-reserve negative tests.** Assert `typeof (store as unknown as Record<string,unknown>).bindConversation`, `.recordMessage`, `.recordToolCall`, `.appendEvent`, `.send` are all `undefined`. Inspect raw SQLite: no body/arguments/output/encrypted-body columns, zero bindings/messages/tool_calls. For raw SQL only, insert two active binding rows sharing `(provider,conversation_id)` on different sessions and expect unique-constraint failure; insert two active bindings for one session with different conversation IDs and expect failure. Exercise `events_no_update`/`events_no_delete` triggers. Test that no method accepts or writes unique body/output/lease canaries; do not write real tokens.
- [ ] **Step 6: GREEN, review, commit gate.** Add the pure validator and assertions, run both focused tests and `npm run build` exit0, `git_diff --check` exit0; stage only named paths and local commit `feat: add bounded session history and privacy guards` only if authorized.

**Acceptance:** Pagination is deterministic, bounded and scoped; malformed persisted rows fail closed, no generic event/content ingestion exists, and unique binding constraints are effective even though binding API is absent.

### Task 4: Default-off config and test-isolated daemon lifetime

**Files:** Modify `src/config.ts`, `src/server.ts`, `src/runtime-shutdown.ts`, `tests/runtime-shutdown.test.ts`; create `tests/session-event-config.test.ts`, `tests/session-event-runtime.test.ts`.

**Interfaces:** `AppConfig.sessionEvents:{enabled:boolean}`, `ConfigOverrides.sessionEventsEnabled?:boolean`, `EnvSchema.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS?:'true'|'false'|'1'|'0'`. Extend `RuntimeOptions.sessionEventStore?:SessionEventStore`, and `RuntimeServices.sessionEventStore?:SessionEventStore`. No change to `createScopedRuntime`, tool registrations or existing output schemas. Derive `path.join(taskStateRoot,'session-events','metadata.db')` **inside** `createRuntimeServices`.

- [ ] **Step 1: RED config.** In `tests/session-event-config.test.ts`, preserve/restore `process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS` in `afterEach`. With env unset, `loadConfig({roots:[process.cwd()]})` must have `{sessionEvents:{enabled:false}}`; with env `'true'` it must be enabled; with explicit `sessionEventsEnabled:false` it must override `'true'`; invalid env `'maybe'` must reject. No arbitrary DB file override is added to `ConfigOverrides` or env.
- [ ] **Step 2: Verify RED and implement.** `npm test -- tests/session-event-config.test.ts` fails for missing config; modify only config schema/types/default/override, then run focused test and `npm run build` to exit0. Do not turn Owner Runtime or Personal Admin on as a side effect.
- [ ] **Step 3: RED runtime isolation and shutdown.** In `tests/session-event-runtime.test.ts`, create a private temp root and use a test config with `auditFile` and `continuity.databasePath` under that temp root plus `taskStateRoot` injected. Disabled `createRuntimeServices` must have `sessionEventStore===undefined` and no `session-events` directory; enabled creates store only under `path.join(tempRoot,'session-events','metadata.db')`. Create a session through the internal store, close runtime, reopen with the same fixture DB and read it. Assert `createMcpServer(runtime)` advertises the same tool set with enabled/disabled configs and **no** tool whose name begins `session_event_`. For existing fixtures, keep default disabled so creating runtime never touches a real-user metadata DB.
- [ ] **Step 4: Verify RED and implement runtime hook.** `npm test -- tests/session-event-runtime.test.ts tests/runtime-shutdown.test.ts` fails on missing property/phase. In `createRuntimeServices`, use `const sessionEventStore = config.sessionEvents?.enabled === true ? options.sessionEventStore ?? new SessionEventStore({ databasePath: path.join(taskStateRoot,'session-events','metadata.db') }) : undefined;`; reject `options.sessionEventStore` when config disabled instead of silently enabling or closing a borrowed fixture. Return the optional property only when defined; no tools registered and no new hooks. Ensure all newly constructed stores are closed if a later constructor throws (or construct store last after other fallible services), without changing unrelated supervisors.
- [ ] **Step 5: Shutdown GREEN.** Add `"session-events"` to `RuntimeShutdownPhase`; after browser and before continuity, conditionally `await attempt('session-events', async()=>input.runtime.sessionEventStore!.close())`. Amend the two existing runtime-shutdown tests to record the new phase and inject a store whose close throws for failure isolation; verify later continuity/control/transport phases still run and report `'session-events'` exactly once. Add a shutdown test invoking close twice to show `SessionEventStore.close()` is idempotent; the runtime shutdown function itself still follows its existing semantics. Run focused config/runtime/shutdown tests and `npm run build` exit0.
- [ ] **Step 6: Review and commit gate.** Ensure no generated DB is inside the repo or real home. Inspect only named files, run `git_diff --check` exit0 and locally commit `feat: wire opt-in session metadata runtime` only if authorized.

**Acceptance:** Default startup leaves no new state file, opt-in goes only to injected test root, existing MCP catalog is unchanged, and shutdown owns store lifecycle without interfering with Continuity or process/PTY shutdown.

### Task 5: Operator documentation and complete local verification

**Files:** Create `tests/session-event-documentation.test.ts`; modify `README.md`, `docs/ARCHITECTURE.md`. Do not modify the approved spec without an explicit separate design revision.

**Interfaces:** No runtime API changes.

- [ ] **Step 1: RED documentation contract.** Add a Vitest test using `readFile('README.md','utf8')` and `readFile('docs/ARCHITECTURE.md','utf8')`. Assert both mention `SessionEventStore`, `metadata`, `disabled by default`, separate Continuity DB, internal-only/no MCP tool, no verified ChatGPT conversation binding, no transcript/tool body recording, no automatic capture and no deployment/restart. Also assert architecture points at the approved spec file and describes separate future provider/encryption work.
- [ ] **Step 2: Verify RED.** `npm test -- tests/session-event-documentation.test.ts` must fail on missing documentation, not a test syntax error.
- [ ] **Step 3: Update only relevant docs.** Add one concise SessionEventStore subsection to README's owner/operator section and one to ARCHITECTURE's storage/runtime section, describing opt-in config `CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS=true` as a future startup setting, private state-root DB, two fixed lifecycle events, revision/cursor, internal API and no live deployment. Avoid claiming that merely committing code changes the running daemon or that `complete` events verify a Project task.
- [ ] **Step 4: GREEN focused suites.** Run `npm test -- tests/session-event-store.test.ts tests/session-event-config.test.ts tests/session-event-runtime.test.ts tests/runtime-shutdown.test.ts tests/session-event-documentation.test.ts`. Require actual exit0; if failures occur, reproduce/reason and fix only within reviewed feature scope, never weaken tests.
- [ ] **Step 5: Complete declared verification.** Run `npm run check` from the exact Mac Project lease through the supported `project_exec` lane; require build and full Vitest real exit0. Detect declared lanes with `project_check detect`, run Node Project-sandbox check and the native macOS `swift test --package-path native/macos-computer-runtime` only through `project_check` Admin-host with genuinely obtained active Admin authority. If native authority is unavailable, report `NOT_RUN`/`UNAVAILABLE`, do not bypass or claim PASS. Run `git_diff --check`; explicitly inspect Git status, owner inventory, touched files and that no real-user state/audit path received test output.
- [ ] **Step 6: Freshness and handoff.** If and only if local commits are authorized, stage exact reviewed files with SHA guards, inspect `git_diff --cached --check`, commit only feature-owned files, then rerun `project_check` on the new exact HEAD + working-tree digest and require `report.overallStatus==='PASS'` and both `headMatches`/`workingTreeMatches===true`; a previous PASS becomes stale on commit. Record actual outputs/check IDs/exits/status and exact next step via `project_checkpoint`. Leave a clean checkout; never publish/merge/deploy/restart without separate user request.

**Acceptance:** Operator documentation matches code boundaries, focused and full verification use real exit codes, native results are honestly classified, and final evidence is fresh for the final local state.

## Self-review and execution gate

- **Scope:** Six tables are metadata-only; only sessions/events are written in v1. No provider, outbox, message/tool ingestion, worker, Goal/Loop, encryption or UI is introduced. No new MCP tools or dependency upgrades.
- **Type/API consistency:** `SessionView`, `SessionEvent`, `EventPage`, `SessionEventStoreOptions` defined Task 1; create/get/close Task 2; list Task 3; optional config/runtime Task 4. All Task 3 cursor and Task 2 CAS tests use these exact method names and fixed status values.
- **Review Focus mapping:** zero-byte/symlink and altered schema Task 1; stale close Task 2; cross-project leak Task 2/3; malformed cursor/payload Task 3.
- **Boundary:** The written spec is approved. **This implementation plan requires its own user review and execution-method selection before Task 0 or any TDD/product changes.** A plan saved in Git is not authorization to write product code. Local commit, push, PR, merge, deployment and service restart remain distinct authorization and verification gates.
