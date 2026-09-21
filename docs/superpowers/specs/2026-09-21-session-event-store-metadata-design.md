# SessionEventStore v1 — metadata-only design

**Date:** 2026-09-21
**Status:** Written design for separate user review; not approved for implementation.
**Baseline:** `main@140fd5283978bd5e400a57c6044fc9df876d3a92`, clean at design start. The separately committed Owner Shell Batch remains on `feat/owner-shell-batch-20260921@0a541d6201044b9865800627a80738f9739639de`; no merge is implied.

## Purpose and independent delivery boundary

This is subproject 2 in `2026-09-21-orchestration-architecture-draft.md`: a durable, **metadata-only** work-session and event-history foundation. Subproject 1 (Owner Shell Batch) is separate. A session is a locally generated work-session identity referencing an existing, registered `projectId`; it is not a ChatGPT conversation. This slice does not implement DeliveryOutbox, TurnEvidenceProvider, Goal/Loop, Finish, Compact & Resume, worker execution, encrypted recording or UI. Their future tables/operations require separate reviewed changes. The proposed interface is an internal runtime service, **not a new MCP tool in v1**.

The value of this slice is that authorized internal callers can create and close work sessions, record a small fixed vocabulary of operational metadata events, inspect ordered history across a store reopen, and distinguish current versus stale concurrent updates. An absent verified external provider means no automatic chat binding, message observation, tool recording, or sending is possible. Successful source tests do not establish live ChatGPT integration.

## Reconciled existing components

- `package.json`: Node `>=22`, TypeScript, `better-sqlite3@13.0.3` and `@types/better-sqlite3` already exist; no new runtime dependency.
- `src/continuity-store.ts` owns its independent version-1 SQLite schema and implements bounded busy timeout, FK validation, integrity checking, 0700/0600 creation and atomic optimistic semantic checkpoints. Reuse patterns, **not its tables or DB file**.
- `src/config.ts` resolves the Continuity DB to `~/.chatgpt-system/continuity/continuity.db`; `src/server.ts` resolves `taskStateRoot` to `~/.chatgpt-system/state`. The new DB path is derived under that state root, not from Continuity's path.
- `src/task-state-service.ts` and Project Continuity remain authoritative for task completion, project/worktree identity, verification and publication. The session store references `projectId` but cannot perform atomic cross-database transactions or confer project authority.
- `createRuntimeServices` and `closeRuntimeResources` own daemon-lifetime dependencies; fixture paths must be injected to avoid writing into the real operator's state/audit during tests.
- Existing MCP routes always resolve the current authority when handling a tool call. An in-process API is not permission to introduce an unauthenticated public endpoint later.

## Chosen architecture and alternatives

Use a separate versioned SQLite file with a small store class (`src/session-event-store.ts`), strict types/validation (`src/session-event-types.ts`) and stable errors (`src/session-event-errors.ts`). The runtime integration is explicitly opt-in: `sessionEvents.enabled` defaults **false**; a config-derived DB path defaults to `path.join(taskStateRoot, 'session-events', 'metadata.db')`. A runtime with the feature off does not create the directory or open a DB. Tests enabling it inject an isolated temporary state root or store; enabling it at source level does not change the currently running daemon. The store itself is usable in isolated unit tests with an explicit temporary path. When enabled, runtime shutdown closes it idempotently before closing the transport. No background collectors are started by enabling the store.

Rejected alternatives: extending `continuity.db` conflates project and session lifecycles; copying audit JSONL into a searchable second database duplicates untrusted/possibly sensitive content; creating a global DB from every runtime fixture pollutes real operator state; making a browser URL or user-supplied conversation ID into authoritative binding fabricates identity evidence.

## Storage, opening and failure policy

Default file: `~/.chatgpt-system/state/session-events/metadata.db` (derived from the configured `taskStateRoot`; no two independently configured roots). Store paths are absolute. Create a missing private directory with `0700`, a missing regular DB file with `0600`, and initialize all v1 tables plus its version row in **one SQLite transaction**. Before opening a pre-existing file, check that it is a regular file, not a symlink and not more permissive than `0600`; check the existing parent directory's identity/type and private permissions. Fail closed on an unexpected symlink, file type or permissions rather than following it or silently chmod-ing a foreign file. Avoid claiming protection against malicious same-user filesystem races that cannot be guaranteed by the SQLite filename-opening API. Do not traverse, repair, rename, delete, truncate or replace an unfamiliar state file. Tests must explicitly demonstrate failure preservation.

Set `foreign_keys=ON`, a finite `busy_timeout` (5 s) and SQLite `quick_check` on open. A brand-new missing path may be initialized. A present but zero-byte, non-SQLite, corrupt, incompatible-schema or partially populated database fails with stable `SESSION_DATABASE_INVALID`; do not treat a present empty file as fresh. The `schema_version` row must exist exactly once and equal 1, and the exact required table/index contract must be checked. Unsupported newer schemas are not automatically migrated or downgraded. Any later migration is a separately reviewed, tested change with backup/recovery procedures. Disable arbitrary extension loading; do not persist leases, credentials or raw payloads. Keep SQL parameters bound, never interpolate caller strings.

## V1 normalized schema and invariants

The following are logical columns/constraints; the implementation plan will supply exact SQL without weakening the invariants.

- `session_meta(schema_version INTEGER NOT NULL)`: exactly one row with version 1.
- `sessions(session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, next_seq INTEGER NOT NULL, active_binding_id TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT NULL)`: locally generated UUID v4; immutable project association; CHECK state in (`active`, `closed`), revision >=1 and next_seq >=1. Creation initializes revision 1 and sequence counter 1, then inserts the start event at sequence 1 and advances the counter to 2 within the same transaction. Each **subsequent** successful mutation increments revision exactly once. Closing is terminal; a repeated close is rejected rather than silently counted as a successful mutation. Reject unknown IDs uniformly without exposing other-project existence. An update trigger rejects project_id changes.
- `bindings(binding_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id), provider TEXT NOT NULL, conversation_id TEXT NOT NULL, identity_evidence_ref TEXT NOT NULL, verified_at TEXT NOT NULL, retired_at TEXT NULL)`: a partial unique index on `(provider, conversation_id)` for `retired_at IS NULL` ensures at most one active owner across sessions; an additional partial unique index on `session_id` for active rows ensures one active binding per session. In v1 all bindings are empty and `sessions.active_binding_id` is always NULL. Future binding activation must transactionally validate that any pointer belongs to the session's own active row; do not expose or accept a free-text pointer in v1. Binding activation/retirement is **unavailable in v1 until a separately implemented trusted evidence provider**. The `identity_evidence_ref` is a bounded opaque reference to independently verified evidence, not a URL, lease or transcript.
- `events(session_id TEXT NOT NULL REFERENCES sessions(session_id), seq INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, correlation_id TEXT NULL, metadata_json TEXT NOT NULL, happened_at TEXT NOT NULL, PRIMARY KEY(session_id, seq))`: append-only, including SQL triggers rejecting UPDATE/DELETE. Sequence numbers strictly ascend per session starting at 1; allocate from `sessions.next_seq` and update the session revision in the same transaction as each post-creation event insert. No arbitrary event-kind or metadata passthrough; v1 allows only `session.started` and `session.closed`, actor `system`, `correlation_id=NULL` and `metadata_json='{}'`. Event types or payload fields cannot be expanded without a separate review.
- `messages(session_id, message_id, turn_id, role, status, version, seq, created_at)` and `tool_calls(session_id, call_id, tool_name, request_id, turn_id, outcome, evidence_ref, seq)`: schema-reserved metadata-only tables with FK `session_id` to `sessions`, unique `(session_id, message_id)` and `(session_id, call_id)` respectively, strict bounded fields and no body/argument/output columns. Their v1 writer methods are **absent** and rows stay empty. Future message/tool insertion requires a proven identity/receipt provider, stable logical ID/version rules and its own contract and tests; no caller can populate them from free-text MCP input. Do not create tables for `tasks`, `workers`, `deliveries` or `continuations` in v1; adding them belongs to later subprojects and explicit schema migrations.

Persist no duplicate authoritative task status, Git verification status, raw commands, model messages or audit rows. A session project reference cannot be an SQLite FK into the independent Continuity DB: the internal orchestration service must obtain its project ID from a freshly resolved registered project/authorized context before calling the store. A bare arbitrary `projectId` string from a future MCP request is not proof of registration or ownership. Do not attempt dual writes to session and continuity DBs; on failure, reconcile derived views rather than claim cross-database atomicity.

## API and authorization boundaries

Internal proposed surface:

```ts
interface SessionEventStore {
  createSession(verifiedProjectId: string): SessionView;
  getSession(sessionId: string, verifiedProjectId: string): SessionView;
  closeSession(sessionId: string, verifiedProjectId: string, expectedRevision: number): SessionView;
  listEvents(sessionId: string, verifiedProjectId: string, afterSeq: number, limit: number): EventPage;
  close(): void;
}
```

`verifiedProjectId` names an already-resolved project in the trusted **calling service**; this API is not published verbatim as an MCP endpoint. Future external routes must resolve a current Project lease and exact registered project on every call, pass the trusted resulting ID and reject cross-project reads/writes. Do not auto-issue Admin authority. A session ID alone never authorizes access. A closed session remains readable to its authorized owner and cannot accept further events or rebind in v1.

`createSession` inserts one session and its `session.started` event in a transaction; `revision=1`, start event `seq=1`, `next_seq=2`. It generates `session_id` locally (UUID v4) and never accepts caller-supplied identity. `closeSession` performs a compare-and-swap (`WHERE session_id=? AND project_id=? AND revision=? AND state='active'`), inserts `session.closed` at the next sequence, updates state/revision/closedAt atomically and returns the committed view. Revision mismatch returns `CONFLICT`, including a stale concurrent close; unknown or cross-project access returns indistinguishable `SESSION_NOT_FOUND`. Any callback failure rolls the entire operation back; never record a success event without the state mutation.

`listEvents`: reject negative/non-integer `afterSeq`, unknown/cross-project session, invalid `limit` (allowed 1..100), and querying a closed session remains allowed. Query `WHERE session_id=? AND seq>? ORDER BY seq ASC LIMIT limit+1`. Return at most `limit` rows, `hasMore` from the extra row, `nextCursor` equal to the last returned `seq` or unchanged `afterSeq` for an empty page. Reject malformed stored JSON or unrecognized enums as `SESSION_DATABASE_INVALID`, not a fabricated history. Cursor pagination is a point-in-time forward view, not a globally atomic snapshot under concurrent writers; newly appended events may appear on subsequent pages, but already allocated sequence numbers cannot be reordered or silently reused.

No v1 `bindConversation`, `recordMessage`, `recordToolCall`, generic `appendEvent`, `send`, `finish`, `resume` or autonomous loop API. When a real provider and verified identity are separately approved, their methods can be introduced through guarded store/service interfaces, not by reinterpreting existing v1 methods. No new MCP session tools are registered in this slice.

## Bounded privacy and audit

Recording default remains **Off**. Enabling metadata storage is not consent to record content. A future content flag `recordContent` cannot be enabled by this v1 implementation: encrypted-body columns, content-key generation, macOS Keychain integration, authenticated encryption, rotation, bounded asset storage, retention and deletion require their own reviewed implementation. No plaintext fallback.

Persist only allowlisted operational fields, synthetic local UUIDs, registered project ID, bounded ISO timestamps, state/revision, fixed event kind/actor and permitted opaque identity references when evidence support exists. Never persist transcript or model-reasoning text, MCP tool arguments/output, shell scripts, stdout/stderr, environment, screenshots/OCR, clipboard, authority lease ID, API token or raw provider receipt. An audit entry for a store operation may contain only action, coarse operation, outcome, count and duration; it must not contain session/conversation ID, free-form metadata or payload. No implicit event-capture instrumentation on existing tools; no new egress or provider connection.

## Failure scenarios and test acceptance

Write tests **RED before production changes** using a temporary, real SQLite database and real runtime fixtures where appropriate:

1. Absent DB creates private `0700` directory/`0600` file and v1 schema; store close is idempotent and reopening preserves one session and ordered events. Runtime disabled by default never creates a DB, including when many existing tests instantiate runtime services.
2. Existing zero-byte, non-database, symlink, nonregular or permissive file, hostile parent, corrupt B-tree, partial schema and version 999 all fail without overwriting/repairing source bytes. Open failure closes handles; valid fixture DB remains readable.
3. New session uses an internally generated UUID, immutable project reference, correct `revision`, `session.started` event `seq=1` and no persisted raw content.
4. Stale revision and concurrent close: exactly one close commits, one receives `CONFLICT`, one `session.closed` event appears; a transaction failure leaves state, sequence and revision unchanged. Closed sessions reject future mutation; cross-project and unknown IDs are indistinguishable.
5. Page limit 0/101 and malformed cursor are rejected; limits 1 and 100 succeed. Deterministic ascending `seq`, `hasMore`, `nextCursor`, reopened pagination without skips or duplicated logical event IDs; malformed stored enum/JSON fails closed.
6. Binding partial unique indexes block two active owners and two active bindings for one session at raw-SQL constraint level; public v1 APIs cannot bind an unverified conversation. Schema-only reserve does not claim a provider exists.
7. Inspect database and audit bytes for unique content canaries in message body, tool output, lease and secrets: none may appear. `messages`/`tool_calls` have no writer API and no automatic event hooks.
8. Opt-in runtime injection uses only test-supplied DB paths; shutdown closes store exactly once without altering ContinuityStore lifecycle or unrelated process/PTY behavior; Project/User authority and existing MCP catalog remain unchanged.
9. Full focused tests then `npm run check`, applicable native check and `project_check` on the exact changed HEAD/worktree, with real exit codes and `git diff --check`. No passing claim from stale verification. No live daemon restart/deployment is part of local acceptance.

## Implementation and review gate

Only after this **written spec** has been independently reviewed and approved, write a separate task-by-task plan with file map, explicit RED commands, minimal GREEN steps, rollback/recovery checks and verification. Choose an appropriate work branch/worktree using fresh Git and ownership evidence before any product modification; do not mix this feature into the unpublished shell-batch feature branch. This document may receive a local docs-only commit on clean canonical `main`; that commit does not approve implementation, constitute GitHub publication or activate a running daemon. Push, PR, merge, deployment and service restart each require separate explicit instructions.
