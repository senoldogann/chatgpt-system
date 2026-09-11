# Project Continuity v1 Design

**Status:** Accepted design, Delivery 1 only

**Baseline:** `origin/main@3daf964357ce4fe7302f1badea95068a867145cd`

## Goal

Make project continuation independent of one ChatGPT conversation. After the ChatGPT app is invoked in a new normal chat, the user should be able to say only `X projesine devam et` and receive the exact registered working copy, current goal and constraints, critical decisions with short rationale, open local changes, separately verified published state, verification confidence, and the exact next step. The user must not have to paste an old chat summary.

Delivery 1 is deliberately narrow. It provides persistent semantic checkpoints and verified repository/worktree state. It does **not** add automatic operation logging, historical semantic search, a scheduler, a dashboard, a second model, semantic desktop targeting, or any Slice 5 Computer Runtime feature.

## Existing primitives to reuse

The implementation starts after Computer Runtime v2 Slice 4 is merged. The following existing infrastructure is authoritative and must not be duplicated:

- `AuthorityManager` creates opaque expiring leases, canonicalizes Project roots, keeps lease material only in memory, and revokes through `end(...)`.
- `AppError` / `ConflictError` are the public stable-error mechanism.
- `createRuntimeServices(...)` owns daemon-lifetime services and supports test dependency injection.
- modular MCP registration such as `registerComputerJsTools(...)` and `registerBrowserTools(...)` is preferred over adding another large inline block to `server.ts`.
- existing tool result contracts remain unchanged. In particular, `computer_run_js` returns only `stdout`, `stderr`, and optional `result`; Delivery 1 does not invent `cleanupStatus` or reinterpret unknown cleanup as success.
- `GitService` remains the scoped user-facing Git mutation/read service. Continuity needs additional Git facts, but they are internal read-only inspection facts and do not broaden the public generic Git tool surface.

There is no existing continuity subsystem, `project_register`, `project_resume`, `project_checkpoint`, or `project_context_read` implementation to preserve.

## Storage

Continuity state lives outside project source trees under:

```text
~/.chatgpt-system/continuity/continuity.db
```

`CHATGPT_SYSTEM_CONTINUITY_DATABASE` and `ConfigOverrides.continuityDatabasePath` may override the database path for tests/operators. Paths must be absolute or `~/...`, using the same home-relative configuration style as existing control/browser paths.

Use `better-sqlite3@13.0.3` and `@types/better-sqlite3@9.6.0`. The package declares Node `>=22`, matching this repository. `node:sqlite` is not selected because this repository still supports Node `>=22.0.0`, while core SQLite was introduced only in Node 22.5.0 and remained experimental in the Node 22 line. Delivery 1 must not silently raise the repository Node floor to obtain a different storage API.

The store is local and synchronous. `ContinuityStore` preserves the existing synchronous `createRuntimeServices(...)` API by using `mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 })`, opening `better-sqlite3` synchronously, then `chmodSync(databasePath, 0o600)`. Queries are small and bounded; no large history scan is on the resume path. Enable foreign keys and a bounded SQLite busy timeout. Do not store authority lease IDs, tunnel/API tokens, environment values, JavaScript source/output, full chat transcripts, or hidden model reasoning.

### Schema

Schema version 1 uses four logical tables:

```text
continuity_meta
projects
worktrees
continuity_records
```

`projects` stores the stable project ID, display alias, normalized unique alias key, canonical registered Project roots, current semantic record version, and timestamps.

`worktrees` stores exactly one primary continuation worktree for Delivery 1: canonical worktree path, canonical repository root, canonical Git common dir, canonical worktree Git dir, repository identity hash, worktree identity hash, current operational local snapshot, current published snapshot, and state-check timestamp. A canonical worktree path may belong to only one registered project.

`continuity_records` is append-only by `(project_id, version)`. Each semantic version stores the full current primary task, the current short list of critical decisions, uncertainties, verification summary, and optional bounded current-task detail. A checkpoint inserts a new record and atomically advances `projects.current_record_version`. Previous semantic versions are never overwritten.

The semantic `recordVersion` is intentionally separate from operational Git/remote snapshot freshness. `project_resume` may refresh `worktrees` state without incrementing the semantic record version. This prevents an ordinary remote re-check from creating false optimistic-concurrency conflicts while stale semantic writes remain rejected.

A schema-version mismatch, malformed required JSON, failed integrity/open operation, or a file that is not a valid continuity database produces an explicit continuity database error. No state is reconstructed from audit logs or guessed from repository content.

## Alias identity

A project alias is a human-facing exact key, not fuzzy search. Registration stores both the trimmed display alias and a deterministic key produced by Unicode NFKC normalization followed by lowercase. The normalized key must be unique. Resume/checkpoint/context lookup applies the same normalization. No nearest-name, last-project, or prefix fallback is allowed.

## Repository and worktree identity

A registered worktree is verified using Git and filesystem identity, not only its path.

Registration and resume must obtain, with `shell:false`, credential prompts disabled, and bounded stdout/stderr:

```text
git rev-parse --is-inside-work-tree
git rev-parse --is-bare-repository
git rev-parse --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git rev-parse --path-format=absolute --git-dir
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1 -z --untracked-files=all
```

The canonical worktree path is `realpath(--show-toplevel)` and must equal the registered canonical path on resume. Bare repositories are rejected for Delivery 1.

For ordinary non-bare repositories, canonical repository root is the parent of canonical `git-common-dir` when the common directory is `.git`. The store records the canonical common dir and unique worktree Git dir separately.

Filesystem identity is taken with `stat(..., { bigint: true })`:

```text
repositoryIdentity = SHA-256(canonicalCommonGitDir + NUL + dev + ":" + ino)
worktreeIdentity   = SHA-256(canonicalGitDir       + NUL + dev + ":" + ino)
```

On resume, canonical path, repository identity, and worktree identity must all match. If the path is gone, is not a Git worktree, is now another repository, or was recreated as another worktree, resume fails explicitly. It never scans nearby directories, chooses another registered worktree, switches branch, resets, cleans, or checks out files.

Current local state includes:

```ts
interface ContinuityLocalState {
  checkedAt: string;
  branch: string | null;
  headSha: string;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  pathsTruncated: boolean;
}
```

Path lists are bounded to 100 distinct paths per category. Git porcelain data is metadata only; file contents are not copied into the continuity database.

## Published state and remote verification

Local state and published state are independent.

Delivery 1 uses remote `origin` when configured. The inspector reads the origin URL only to establish that a remote is configured; the URL itself is not placed in the resume package. For a named current branch it performs a bounded, non-interactive:

```text
git ls-remote --heads origin refs/heads/<branch> refs/heads/main
```

A detached worktree has no current branch ref to verify and reports that branch as `not_found` with a categorical reason; it never guesses a branch.

Each remote ref uses:

```ts
type RemoteVerificationStatus = "verified" | "not_found" | "unverified";

interface RemoteRefState {
  status: RemoteVerificationStatus;
  ref: string | null;
  currentSha?: string;
  checkedAt: string;
  lastVerifiedSha?: string;
  lastVerifiedAt?: string;
}
```

Rules are strict:

- `git ls-remote` exit 0 + requested ref present => `verified`, update current and last-verified SHA/time.
- `git ls-remote` exit 0 + requested ref absent => `not_found`. Preserve any previous last-verified SHA/time.
- timeout, DNS/network failure, authentication failure, missing executable, nonzero remote command, or another inability to establish remote truth => `unverified`. Never translate it to `not_found`; preserve previous last-verified SHA/time.
- if `origin` is not configured, `remoteName` is `null` and applicable remote refs are `unverified` with reason `remote_missing`; absence of a configured remote is not treated as proof that a branch does not exist.

Remote verification failure does not by itself block project resume. The package reports `unverified` and the last successful verification evidence when available.

## Semantic record

Delivery 1 has one primary continuation task per project.

```ts
interface ContinuityTask {
  goal: string;
  constraints: string[];
  successCriteria: string[];
  status: "active" | "blocked" | "completed";
  nextStep: string;
  detail?: string;
}

interface ContinuityDecision {
  decision: string;
  rationale: string;
  alternatives: string[];
  evidence: string[];
  validWhile?: string;
}

interface ContinuityRecord {
  recordVersion: number;
  task: ContinuityTask;
  decisions: ContinuityDecision[];
  uncertainties: string[];
  verificationSummary: string[];
  createdAt: string;
}
```

Bounds prevent continuity from becoming a transcript store: one task, at most 20 current critical decisions, at most 20 uncertainties, and at most 20 verification-summary items. Individual fields and arrays receive explicit string-length bounds in MCP schemas/store validation. `detail` exists only for current-task critical context that may overflow the first resume package; it is not a chat transcript.

Delivery 1 does not automatically instrument existing tools. Semantic continuity therefore depends on ChatGPT making `project_checkpoint` calls at meaningful boundaries. This limitation must be documented and measured during real new-chat acceptance rather than presented as automatic memory.

## Optimistic record versioning

`project_register` creates semantic version 1.

`project_checkpoint` requires `expectedRecordVersion`. In one SQLite transaction it reads `projects.current_record_version`, rejects a mismatch with the existing `CONFLICT` error family, inserts exactly one new immutable record at `current + 1`, updates the project pointer, and writes the already-verified local/published operational snapshot captured for that checkpoint. A delayed old conversation therefore cannot silently overwrite a newer semantic checkpoint, and checkpoint cannot report failure after committing only half of its continuity state.

Operational worktree/published snapshots may be refreshed by register/resume without changing `recordVersion`; checkpoint refreshes the same snapshots atomically with its semantic version transition.

## Authority bootstrap

The continuity database never stores leases.

`project_resume` takes only the project alias and optional requested Project TTL. The flow is:

1. resolve exact registered alias;
2. load and validate the current semantic record;
3. verify registered roots still canonicalize to the exact stored roots and remain valid Project roots;
4. verify exact registered worktree/repository/worktree identities;
5. refresh local and published state;
6. create a **fresh Project lease** with `AuthorityManager.start({ profile: "project", projectRoots: storedRoots })`, adding only `requestedTtlSeconds` when the resume input explicitly supplied it;
7. build the bounded resume package;
8. persist refreshed operational state and return the package plus the new Project lease.

No Admin lease is created or implied. No previous lease is loaded from persistence.

If any failure occurs after step 6, `project_resume` must call `AuthorityManager.end(newLeaseId)` before returning the error. Tests must verify that the returned/observed lease cannot be resolved after this rollback. Failure before fresh lease creation obviously creates no lease.

`project_checkpoint` and `project_context_read` require an active authority lease whose canonical authority roots cover the registered roots. Normal intended use is the fresh Project lease returned by resume. This prevents a context-read/checkpoint for one project from being paired with an unrelated Project lease. Admin may not be auto-created by continuity; a manually supplied broader authority is not necessary for Delivery 1 and is rejected to keep project semantic state explicitly Project-scoped.

## MCP surface

Delivery 1 adds exactly four continuity tools through a dedicated registration module.

### `project_register`

Input:

```ts
{
  alias: string;
  worktreePath: string;
  projectRoots: string[];
  task: ContinuityTask;
  decisions?: ContinuityDecision[];
  uncertainties?: string[];
  verificationSummary?: string[];
}
```

Registration canonicalizes/validates roots and worktree identity, captures local/published state, and creates version 1. It does not create an authority lease. Duplicate normalized alias, duplicate registered worktree, invalid/broad roots, missing/replaced Git worktree, or invalid database state fails explicitly.

Output is bounded project metadata: project ID, alias, record version, verified worktree identity summary, local state, and published state. It contains no secret remote URL or lease.

### `project_resume`

Input:

```ts
{
  alias: string;
  requestedTtlSeconds?: number;
}
```

Output:

```ts
{
  projectId: string;
  alias: string;
  recordVersion: number;
  authorityLease: AuthorityLeaseView; // always profile:"project"
  resumePackage: string;              // <= 12_000 characters
  packageTruncated: boolean;
  contextAvailable: boolean;
}
```

`resumePackage` prioritizes: goal and constraints; success conditions and task status; exact worktree/repository identity summary; local branch/HEAD/open changes; current and last-good published state; critical decisions/rationale; verification summary; uncertainty; exact next step. The package explicitly marks unknown/unverified facts. It does not claim cleanup/verification facts that existing source contracts cannot prove.

### `project_checkpoint`

Input:

```ts
{
  authorityLeaseId: string;
  alias: string;
  expectedRecordVersion: number;
  task: ContinuityTask;
  decisions: ContinuityDecision[];
  uncertainties?: string[];
  verificationSummary?: string[];
}
```

The tool verifies the lease belongs to the registered Project roots, re-verifies the exact worktree before accepting the semantic write, refreshes local/published state, performs the optimistic SQLite transaction, and returns the new `recordVersion` plus refreshed state summary.

### `project_context_read`

Input:

```ts
{
  authorityLeaseId: string;
  alias: string;
}
```

Delivery 1 reads **only the current semantic record**. It returns the full bounded current task/decisions/uncertainties/verification summary so critical current-task detail omitted from the 12k resume package remains accessible. It cannot request older versions; historical semantic lookup remains Delivery 3. It does not query model transcripts.

## Resume package bound

`resumePackage` is assembled deterministically and must never exceed 12,000 JavaScript characters. It first includes mandatory sections with concise JSON-derived text. If the optional critical-decision/detail sections do not fit, they are omitted in a deterministic order and the package ends with an explicit truncation marker containing the project ID and record version for `project_context_read`.

No silent truncation is allowed. `packageTruncated` and `contextAvailable` must agree with the marker.

## Errors and corruption behavior

Use stable `AppError` subclasses/codes for continuity-specific failures:

```text
CONTINUITY_NOT_FOUND
CONTINUITY_DATABASE_INVALID
CONTINUITY_WORKTREE_INVALID
CONTINUITY_WORKTREE_MISMATCH
CONTINUITY_REMOTE_UNVERIFIED is data state, not a thrown error
```

Optimistic semantic version mismatch uses existing `CONFLICT`.

Remote unavailability is represented in published state and does not become a thrown `not found` error. Database corruption, worktree replacement, or repository identity mismatch is fail-closed.

## Runtime lifetime

`RuntimeServices` owns one daemon-lifetime `ContinuityStore` and `ProjectContinuityService`. Tests may inject a store/service. The store exposes idempotent `close()` and joins the ordered runtime shutdown before transport close. Continuity shutdown does not mutate projects or revoke unrelated leases; Project leases expire/revoke through the existing authority manager.

## Security and privacy

- no persisted authority lease IDs/tokens;
- no Admin auto-escalation;
- no remote credentials in output or DB;
- Git remote calls are `shell:false`, bounded, non-interactive, and read-only;
- no auto checkout/reset/clean/switch/rebase;
- no fuzzy project selection;
- no filesystem scan outside the registered worktree/root validation path;
- no transcript, hidden reasoning, raw environment, JavaScript source/output, or arbitrary tool payload copied into continuity state;
- stored semantic text is untrusted context, not system instruction or authority.

## Delivery 1 acceptance

Automated tests must use a real temporary SQLite database and real temporary Git repositories/worktrees where practical. They must prove:

1. registration survives service/store restart;
2. normalized alias is exact and unique, with no fuzzy fallback;
3. exact worktree identity and repository identity are restored on resume;
4. missing/replaced worktree fails without selecting another path;
5. local branch/HEAD plus staged/unstaged/untracked changes are reported;
6. published branch/main states distinguish `verified`, `not_found`, and `unverified`;
7. a failed remote check preserves previous last-verified SHA/time;
8. stale `expectedRecordVersion` cannot overwrite a newer checkpoint;
9. corrupt database/schema produces an explicit error;
10. resume creates a fresh Project lease and never Admin;
11. failure after lease creation revokes that call's lease;
12. resume package is <=12,000 characters and truncation directs the model to `project_context_read`;
13. current critical task detail is retrievable with `project_context_read`;
14. existing structured result contracts, including Slice 4 `computer_run_js`, are unchanged;
15. full `npm run check` remains green.

After automated Delivery 1 is green, perform real new-normal-chat acceptance **before** Delivery 2/3 scope expansion. When the app is invoked, `X projesine devam et` must be enough to restore the correct project/worktree/task without a pasted summary. Separately report whether a bare prompt with the app not selected causes the platform to invoke the app automatically; that platform experiment is not a continuity correctness gate.

## Non-goals for Delivery 1

- automatic operation logging or continuity work IDs on existing tools;
- copying runner/browser/process structured payloads into continuity DB;
- historical decision/attempt search beyond reading one record version;
- semantic/embedding search, vector DB, knowledge graph;
- dashboard, scheduler, chat-opening automation;
- Slice 5 Computer Runtime features;
- changing or extending `computer_run_js` cleanup/result fields;
- automatic branch switching, worktree cleanup, reset, rebase, or recovery.
