# Project Continuity v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Delivery 1 project continuity so a newly opened ChatGPT conversation can resume one explicitly registered project by alias with exact worktree identity, current semantic task/decisions, open local state, separately verified published state, a fresh Project lease, and a bounded resume package.

**Architecture:** Add a daemon-owned local SQLite continuity store plus a narrow read-only Git/worktree inspector. Keep semantic record versions append-only and OCC-protected while operational local/remote snapshots refresh independently. A dedicated continuity service verifies exact roots/worktree identity, creates a fresh Project lease only during resume, rolls it back on post-creation failure, and exposes exactly four dedicated MCP tools through modular registration.

**Tech Stack:** Node.js 22/24, TypeScript 6, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0`, MCP TypeScript SDK v2, Zod v4, Vitest, existing `AuthorityManager` and `AppError` infrastructure, Git CLI with `shell:false`.

**Spec:** `docs/superpowers/specs/2026-09-11-project-continuity-v1-design.md`

## Global Constraints

- Work only in `/private/tmp/chatgpt-system-project-continuity-v1` on branch `feat/project-continuity-v1`.
- Exact starting base is `origin/main@3daf964357ce4fe7302f1badea95068a867145cd` after Computer Runtime v2 Slice 4 PASS.
- Never reset, rebase, force checkout, force push, clean unrelated changes, switch to another worktree, or modify Slice 4 acceptance helpers.
- Delivery 1 adds no automatic operation logging and no continuity work ID to existing tools.
- Existing structured result contracts remain unchanged. Do not add `cleanupStatus` or any other invented Slice 4 result field.
- Continuity persistence contains no authority lease/token, API/tunnel secret, raw environment, full chat transcript, hidden model reasoning, JavaScript source/output, browser/process payload, or remote credential.
- `project_resume` may auto-create only a fresh **Project** lease for the exact registered roots. It never creates Admin. A post-lease resume failure must revoke the lease created by that invocation.
- Registered worktree path, repository identity, and worktree identity are strict. Missing/replaced state fails; there is no nearest-path, last-project, branch-switch, checkout, reset, clean, or recovery fallback.
- Local and published state remain separate. Remote failure maps to `unverified`, never `not_found`, and preserves last successful SHA/time.
- Semantic `recordVersion` changes only on semantic checkpoints. Operational Git/remote refresh does not create false OCC conflicts.
- Resume package content is deterministic and at most 12,000 JavaScript characters. Critical current-task overflow is retrievable through Delivery 1 `project_context_read`.
- A real new-normal-chat transition is required before Delivery 2 or Delivery 3 begins. Bare-prompt automatic app invocation is a separate platform experiment, not a continuity correctness gate.

---

### Task 1: Add continuity configuration, SQLite store, schema v1, and semantic OCC

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config.ts`
- Create: `src/continuity-types.ts`
- Create: `src/continuity-store.ts`
- Create: `src/continuity-errors.ts`
- Test: `tests/continuity-store.test.ts`
- Test: `tests/continuity-config.test.ts`

**Interfaces:**
- Produces:

```ts
export const CONTINUITY_SCHEMA_VERSION = 1;
export const CONTINUITY_MAX_RESUME_CHARS = 12_000;
export const CONTINUITY_MAX_TRACKED_PATHS = 100;
export const CONTINUITY_REMOTE_TIMEOUT_MS = 10_000;

export interface ContinuityConfig {
  databasePath: string;
  maxResumeChars: 12_000;
  maxTrackedPaths: 100;
  remoteVerificationTimeoutMs: 10_000;
}

export interface ContinuityTask {
  goal: string;
  constraints: string[];
  successCriteria: string[];
  status: "active" | "blocked" | "completed";
  nextStep: string;
  detail?: string;
}

export interface ContinuityDecision {
  decision: string;
  rationale: string;
  alternatives: string[];
  evidence: string[];
  validWhile?: string;
}

export interface ContinuitySemanticRecord {
  recordVersion: number;
  task: ContinuityTask;
  decisions: ContinuityDecision[];
  uncertainties: string[];
  verificationSummary: string[];
  createdAt: string;
}
```

- `ContinuityStore` methods used later:

```ts
interface RegisterProjectRecord {
  id: string;
  alias: string;
  roots: string[];
  worktree: StoredWorktreeIdentity;
  localState: ContinuityLocalState;
  publishedState: ContinuityPublishedState;
  semantic: Omit<ContinuitySemanticRecord, "recordVersion" | "createdAt">;
}

class ContinuityStore {
  constructor(options: { databasePath: string; now?: () => number });
  register(input: RegisterProjectRecord): StoredProject;
  getByAlias(alias: string): StoredProjectWithCurrentRecord;
  getRecord(projectId: string, version?: number): ContinuitySemanticRecord;
  checkpoint(input: {
    projectId: string;
    expectedRecordVersion: number;
    semantic: Omit<ContinuitySemanticRecord, "recordVersion" | "createdAt">;
    localState: ContinuityLocalState;
    publishedState: ContinuityPublishedState;
    checkedAt: string;
  }): ContinuitySemanticRecord;
  updateOperationalState(projectId: string, local: ContinuityLocalState, published: ContinuityPublishedState, checkedAt: string): void;
  close(): void;
}
```

- [ ] **Step 1: Install the exact reviewed SQLite dependency versions**

Run:

```bash
npm install better-sqlite3@13.0.3
npm install --save-dev @types/better-sqlite3@9.6.0
```

Then verify:

```bash
npm ls better-sqlite3 @types/better-sqlite3
```

Expected: exactly the requested direct versions resolve without peer/engine failure on the local Node version. Do not change the repository Node engine floor.

- [ ] **Step 2: Write RED config tests for the persistent database path**

Add to a focused config test:

```ts
const config = await loadConfig({ roots: [root] });
expect(config.continuity).toEqual({
  databasePath: path.join(homedir(), ".chatgpt-system", "continuity", "continuity.db"),
  maxResumeChars: 12_000,
  maxTrackedPaths: 100,
  remoteVerificationTimeoutMs: 10_000,
});
```

Also set `CHATGPT_SYSTEM_CONTINUITY_DATABASE` to an absolute temporary path and assert it overrides the default. Assert a relative configured path is rejected.

Run:

```bash
npm test -- tests/continuity-config.test.ts
```

Expected: RED because `AppConfig.continuity` and the env input do not exist.

- [ ] **Step 3: Implement continuity config without changing existing capability gates**

Add `ContinuityConfig`, `ConfigOverrides.continuityDatabasePath`, and `CHATGPT_SYSTEM_CONTINUITY_DATABASE`. Resolve it through the existing home-path rule:

```ts
export function resolveContinuityDatabasePath(value?: string, homeDir = homedir()): string {
  const requested = value ?? path.join(homeDir, ".chatgpt-system", "continuity", "continuity.db");
  return resolveHomePath(requested, homeDir, "Continuity database path");
}
```

The returned `AppConfig` includes the four exact constants from the interface above. Do not expose DB contents through `system_capabilities`.

Re-run the focused config test and require GREEN.

- [ ] **Step 4: Write RED real-SQLite tests for initialization, persistence, history, and OCC**

`tests/continuity-store.test.ts` uses a fresh temporary DB file, not a mocked driver. Cover:

```ts
const first = store.register(registrationFixture());
expect(first.currentRecord.recordVersion).toBe(1);
store.close();

const reopened = new ContinuityStore({ databasePath });
expect(reopened.getByAlias("Project-X").id).toBe(first.id);
expect(reopened.getByAlias("project-x").currentRecord.recordVersion).toBe(1);
```

Then checkpoint version 1 to 2 and assert version 1 is still readable. Attempt another checkpoint with `expectedRecordVersion: 1` and assert:

```ts
expect(() => staleWrite()).toThrowError(ConflictError);
expect(reopened.getByAlias("project-x").currentRecord.recordVersion).toBe(2);
```

Add duplicate normalized alias and duplicate canonical-worktree registration tests. Add a test opening a file containing non-SQLite bytes and expect `CONTINUITY_DATABASE_INVALID` rather than a raw driver error.

Run:

```bash
npm test -- tests/continuity-store.test.ts
```

Expected: RED because the continuity store does not exist.

- [ ] **Step 5: Implement schema v1 and fail-closed store parsing**

Preserve the existing synchronous runtime-construction API. `ContinuityStore` creates the parent directory synchronously before opening SQLite:

```ts
mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
const db = new Database(databasePath);
chmodSync(databasePath, 0o600);
```

Schema v1 tables:

```sql
CREATE TABLE continuity_meta (
  schema_version INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL UNIQUE,
  roots_json TEXT NOT NULL,
  current_record_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE worktrees (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  canonical_path TEXT NOT NULL UNIQUE,
  repository_root TEXT NOT NULL,
  common_git_dir TEXT NOT NULL,
  git_dir TEXT NOT NULL,
  repository_identity TEXT NOT NULL,
  worktree_identity TEXT NOT NULL,
  local_state_json TEXT NOT NULL,
  published_state_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE continuity_records (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  task_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL,
  verification_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, version)
);
```

Use `PRAGMA foreign_keys = ON` and bounded `busy_timeout`. Force the DB file mode to `0600` after open. Parse every JSON column through Zod schemas from `continuity-types.ts`; malformed stored JSON maps to `CONTINUITY_DATABASE_INVALID`.

Derive the normalized alias key inside the store, never from caller-supplied state:

```ts
export function continuityAliasKey(alias: string): string {
  return alias.trim().normalize("NFKC").toLowerCase();
}
```

Registration uses one transaction. `checkpoint(...)` uses one transaction whose first action reads the current version and throws `ConflictError` if it differs from `expectedRecordVersion`; then it inserts version `current + 1`, updates the project pointer, and updates the verified local/published snapshot in `worktrees` in the same transaction.

- [ ] **Step 6: Run focused store tests GREEN, then build**

```bash
npm test -- tests/continuity-store.test.ts tests/continuity-config.test.ts
npm run build
```

Both must pass.

- [ ] **Step 7: Commit Task 1**

Review exact diff and run:

```bash
git diff --check
git add package.json package-lock.json src/config.ts src/continuity-types.ts src/continuity-store.ts src/continuity-errors.ts tests/continuity-store.test.ts tests/continuity-config.test.ts docs/superpowers/plans/2026-09-11-project-continuity-v1.md
git diff --cached --check
git commit -m "feat: add project continuity store"
```

---

### Task 2: Add strict worktree/repository identity and published-state inspection

**Files:**
- Create: `src/continuity-git-inspector.ts`
- Test: `tests/continuity-git-inspector.test.ts`

**Interfaces:**
- Consumes `ContinuityConfig.maxTrackedPaths` and `.remoteVerificationTimeoutMs` plus operational state types from `continuity-types.ts`.
- Produces:

```ts
export type RemoteVerificationStatus = "verified" | "not_found" | "unverified";

export interface StoredWorktreeIdentity {
  canonicalPath: string;
  repositoryRoot: string;
  commonGitDir: string;
  gitDir: string;
  repositoryIdentity: string;
  worktreeIdentity: string;
}

export interface ContinuityLocalState {
  checkedAt: string;
  branch: string | null;
  headSha: string;
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  pathsTruncated: boolean;
}

export interface RemoteRefState {
  status: RemoteVerificationStatus;
  ref: string | null;
  currentSha?: string;
  checkedAt: string;
  lastVerifiedSha?: string;
  lastVerifiedAt?: string;
  reason?: "detached_head" | "remote_missing" | "remote_error";
}

export interface ContinuityPublishedState {
  remoteName: "origin" | null;
  branch: RemoteRefState;
  main: RemoteRefState;
}

export interface ContinuityInspection {
  identity: StoredWorktreeIdentity;
  local: ContinuityLocalState;
  published: ContinuityPublishedState;
}

export interface ContinuityGitInspectorOptions {
  maxTrackedPaths: number;
  remoteVerificationTimeoutMs: number;
  maxCommandOutputBytes: number;
  now?: () => number;
  runGit?: (cwd: string, args: readonly string[], timeoutMs?: number) => Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer; timedOut: boolean }>;
}

export class ContinuityGitInspector {
  constructor(options: ContinuityGitInspectorOptions);
  inspect(worktreePath: string, previousPublished?: ContinuityPublishedState): Promise<ContinuityInspection>;
  verifyIdentity(worktreePath: string, expected: StoredWorktreeIdentity, previousPublished?: ContinuityPublishedState): Promise<ContinuityInspection>;
}
```

- [ ] **Step 1: Write RED real-Git tests for identity and dirty state**

Create a temporary normal repo plus a linked worktree with Git CLI. In the linked worktree create one staged file, one modified unstaged file, and one untracked file. Assert inspection returns the exact canonical linked-worktree path, named branch, 40/64-hex HEAD accepted by Git, non-empty repository/worktree identity hashes, and all three path categories.

Assert `repositoryIdentity !== worktreeIdentity` for a linked worktree where the Git dirs are different.

Run:

```bash
npm test -- tests/continuity-git-inspector.test.ts
```

Expected: RED because the inspector does not exist.

- [ ] **Step 2: Implement a narrow bounded Git runner**

Do not export arbitrary Git arguments. Internal runner shape:

```ts
type GitInspectCommand =
  | { kind: "local"; args: readonly string[] }
  | { kind: "remote"; args: readonly string[]; timeoutMs: number };
```

Spawn only executable `git`, `shell:false`, with:

```ts
[
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "diff.external=",
  "-c", "interactive.diffFilter=",
  ...args,
]
```

Environment includes `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`, `PAGER=cat`, and `GIT_TERMINAL_PROMPT=0`. Bound combined output to existing `config.limits.maxCommandOutputBytes`; remote call timeout is `continuity.remoteVerificationTimeoutMs`.

- [ ] **Step 3: Implement identity calculation and porcelain parsing**

Require `--is-inside-work-tree=true` and `--is-bare-repository=false`. Canonicalize show-toplevel/common-dir/git-dir with `realpath`.

Use `stat(path, { bigint: true })` and:

```ts
function identity(pathname: string, stat: BigIntStats): string {
  return createHash("sha256")
    .update(pathname)
    .update("\0")
    .update(`${stat.dev}:${stat.ino}`)
    .digest("hex");
}
```

Parse `git status --porcelain=v1 -z --untracked-files=all` from bytes/NUL tokens. `??` is untracked; index column `X` marks staged; worktree column `Y` marks unstaged. Consume the additional NUL pathname for rename/copy records. Deduplicate, sort, and cap each category at 100, setting `pathsTruncated` when any category exceeds the cap.

`verifyIdentity(...)` compares canonical path, repository identity, and worktree identity; mismatch throws `CONTINUITY_WORKTREE_MISMATCH` before returning state.

- [ ] **Step 4: Write RED local-remote tests for all three verification states**

Use a temporary bare repo as `origin`:

1. push `main` and the current feature branch; assert both refs `verified` and capture SHA/time;
2. delete only the remote feature branch, inspect again; assert branch `not_found`, `currentSha` absent, previous `lastVerifiedSha/lastVerifiedAt` preserved; main remains `verified`;
3. inject a remote Git runner that returns nonzero/timeout while passing the previous published state; assert current branch/main status `unverified` and both previous last-verified values remain unchanged.

Also test a detached local HEAD returns `branch: null` and published branch `not_found` with `reason:"detached_head"`, without guessing another branch.

- [ ] **Step 5: Implement remote classification without throwing away last-good state**

First run `git remote get-url origin`. Missing origin returns `remoteName:null`; applicable refs are `unverified` with `reason:"remote_missing"`. A missing remote configuration is not proof that a remote branch is absent.

For a configured origin and named branch, one remote call is:

```text
git ls-remote --heads origin refs/heads/<branch> refs/heads/main
```

Classify only an exit-0 response as authoritative presence/absence. Any nonzero/timeout/runner failure maps both applicable refs to `unverified`. Do not throw merely because remote truth is unavailable.

Use a pure helper such as:

```ts
mergeRemoteRefState(currentStatus, ref, currentSha, checkedAt, previous): RemoteRefState
```

so preservation rules have focused unit coverage.

- [ ] **Step 6: Run inspector tests GREEN and full build**

```bash
npm test -- tests/continuity-git-inspector.test.ts
npm run build
```

- [ ] **Step 7: Commit Task 2**

```bash
git add src/continuity-git-inspector.ts tests/continuity-git-inspector.test.ts
git diff --cached --check
git commit -m "feat: inspect continuity worktree state"
```

---

### Task 3: Implement project registration, checkpoints, and bounded current-record reads

**Files:**
- Modify: `src/authority.ts`
- Create: `src/project-continuity-service.ts`
- Test: `tests/project-continuity-service.test.ts`
- Modify: `tests/authority.test.ts`

**Interfaces:**
- Consumes `ContinuityStore`, `ContinuityGitInspector`, and `AuthorityManager`.
- Produces service methods:

```ts
export interface ProjectRegisterInput {
  alias: string;
  worktreePath: string;
  projectRoots: string[];
  task: ContinuityTask;
  decisions?: ContinuityDecision[];
  uncertainties?: string[];
  verificationSummary?: string[];
}

export interface ProjectCheckpointInput {
  authorityLeaseId: string;
  alias: string;
  expectedRecordVersion: number;
  task: ContinuityTask;
  decisions: ContinuityDecision[];
  uncertainties?: string[];
  verificationSummary?: string[];
}

export interface ProjectContinuityServiceOptions {
  store: ContinuityStore;
  inspector: ContinuityGitInspector;
  authority: AuthorityManager;
  homeDir: string;
}

export class ProjectContinuityService {
  constructor(options: ProjectContinuityServiceOptions);
  register(input: ProjectRegisterInput): Promise<ProjectRegistrationResult>;
  checkpoint(input: ProjectCheckpointInput): Promise<ProjectCheckpointResult>;
  contextRead(input: { authorityLeaseId: string; alias: string }): Promise<ProjectContextResult>;
  // resume is added in Task 4
}
```

- [ ] **Step 1: Write RED authority tests for reusable Project-root canonicalization**

Refactor without behavior change. New exported helper:

```ts
export async function canonicalizeProjectRoots(homeDir: string, requestedRoots: string[]): Promise<string[]>;
```

Tests must prove the same existing rules: canonical real directories, deduplication, reject empty, filesystem root, whole home, and symlink alias of home. Existing `AuthorityManager.start({profile:"project"})` must still return identical roots and terminal-disabled behavior.

Run:

```bash
npm test -- tests/authority.test.ts
```

Expected initial RED because the helper is not exported.

- [ ] **Step 2: Implement the root helper and make AuthorityManager use it**

Move only Project-root canonicalization from private `resolveRoots(...)` into the exported helper. Keep User/Admin root behavior untouched. Re-run all authority tests GREEN before continuity service work.

- [ ] **Step 3: Write RED registration tests**

Construct a real temp Git repo/worktree and real temp continuity DB. Registration must:

- canonicalize explicit Project roots through the shared helper;
- require the canonical worktree path to be inside at least one registered root;
- inspect and store exact worktree identity/local/published state;
- create version 1 with supplied task and current critical decisions;
- create no authority lease;
- reject a missing worktree, broad root, duplicate normalized alias, and a worktree outside roots.

Representative assertion:

```ts
const result = await service.register(input);
expect(result).toMatchObject({
  alias: "Project-X",
  recordVersion: 1,
  localState: { branch: "feature/x", headSha: expect.any(String) },
});
expect(authorityStartedCount).toBe(0);
```

- [ ] **Step 4: Implement registration using store + inspector only**

The service takes `homeDir` as an injected constructor option for deterministic tests. It calls `canonicalizeProjectRoots(...)`, checks worktree containment, calls `inspector.inspect(...)`, and stores the initial semantic and operational records. Registration never calls `authority.start(...)`.

- [ ] **Step 5: Write RED Project-lease scope tests for checkpoint/context read**

Start two distinct Project leases for two registered root sets. Assert:

```ts
await expect(service.checkpoint({
  ...validCheckpointInput,
  authorityLeaseId: leaseForOtherProject,
})).rejects.toMatchObject({ code: "AUTHORITY_DENIED" });
```

Reject User/Admin profile as continuity semantic authority in Delivery 1. A valid Project lease must have exactly the same canonical root set as the registered project.

Checkpoint tests also prove:

- exact worktree identity is re-verified before semantic write;
- version 1 + expected 1 -> version 2;
- stale expected 1 after version 2 throws `CONFLICT` and version 2 remains current;
- operational local/published snapshot refresh does not itself change semantic version.

Context read tests prove the current record is returned, no record-version selector exists in Delivery 1, and a wrong-project lease is denied.

- [ ] **Step 6: Implement checkpoint/context read**

Add one internal scope guard:

```ts
private requireRegisteredProjectLease(leaseId: string, storedRoots: string[]): void {
  const lease = this.authority.resolve(leaseId);
  if (lease.profile !== "project" || !sameCanonicalRootSet(lease.roots, storedRoots)) {
    throw new AuthorityDeniedError("Project continuity requires a Project lease for the exact registered roots.");
  }
}
```

Checkpoint calls `inspector.verifyIdentity(...)` before one atomic `store.checkpoint(...)` that writes the new semantic record and refreshed operational state together. It never switches/cleans the worktree.

Context read only returns one immutable semantic record; no history search API is introduced.

- [ ] **Step 7: Run service + authority tests GREEN**

```bash
npm test -- tests/authority.test.ts tests/project-continuity-service.test.ts
npm run build
```

- [ ] **Step 8: Commit Task 3**

```bash
git add src/authority.ts src/project-continuity-service.ts tests/authority.test.ts tests/project-continuity-service.test.ts
git diff --cached --check
git commit -m "feat: register and checkpoint project continuity"
```

---

### Task 4: Add fresh-Project resume, rollback, and deterministic 12k package

**Files:**
- Create: `src/continuity-resume-package.ts`
- Modify: `src/project-continuity-service.ts`
- Test: `tests/continuity-resume-package.test.ts`
- Modify: `tests/project-continuity-service.test.ts`

**Interfaces:**
- Extends `ProjectContinuityServiceOptions` with:

```ts
maxResumeChars: number;
packageBuilder?: typeof buildResumePackage; // deterministic failure injection only in tests
```

- Produces:

```ts
export interface ProjectResumeInput {
  alias: string;
  requestedTtlSeconds?: number;
}

export interface ProjectResumeResult {
  projectId: string;
  alias: string;
  recordVersion: number;
  authorityLease: AuthorityLeaseView;
  resumePackage: string;
  packageTruncated: boolean;
  contextAvailable: boolean;
}

export function buildResumePackage(input: ResumePackageInput, maxChars: number): {
  text: string;
  truncated: boolean;
  contextAvailable: boolean;
};
```

- [ ] **Step 1: Write RED deterministic package tests**

Create a record with many large decisions/details and assert:

```ts
const first = buildResumePackage(input, 12_000);
const second = buildResumePackage(input, 12_000);
expect(first).toEqual(second);
expect(first.text.length).toBeLessThanOrEqual(12_000);
expect(first.truncated).toBe(true);
expect(first.contextAvailable).toBe(true);
expect(first.text).toContain("project_context_read");
expect(first.text).toContain(String(input.record.recordVersion));
```

With a small record assert `truncated:false` and required sections include goal, constraints, success criteria/status, exact worktree path, branch/HEAD, staged/unstaged/untracked summaries, published `verified/not_found/unverified` state with last-good evidence, critical decisions/rationale, uncertainty, verification summary, and next step.

- [ ] **Step 2: Implement package assembly with mandatory-first budgeting**

Do not slice arbitrary JSON mid-field. Build named text sections in fixed priority order. Mandatory sections always include project/record identity, task goal/constraints/status/next step, worktree identity summary, local state, and published state. Optional full detail/decisions are appended while the whole string remains within `maxChars`.

If an optional section does not fit, omit it and append a bounded marker:

```text
[CONTINUITY_TRUNCATED projectId=<id> recordVersion=<n>]
Current critical detail remains available through project_context_read.
```

Reserve marker bytes before adding optional sections so the final length can never exceed the cap.

- [ ] **Step 3: Write RED resume tests for fresh lease and failure rollback**

Test two consecutive resumes of the same project:

```ts
const a = await service.resume({ alias: "project-x", requestedTtlSeconds: 120 });
const b = await service.resume({ alias: "project-x", requestedTtlSeconds: 120 });
expect(a.authorityLease.profile).toBe("project");
expect(b.authorityLease.profile).toBe("project");
expect(a.authorityLease.leaseId).not.toBe(b.authorityLease.leaseId);
expect(a.authorityLease.roots).toEqual(registeredRoots);
```

No Admin lease must be created even when `personalAdmin.enabled` is true elsewhere.

Inject a package builder that throws *after* `authority.start(...)`. Assert resume rejects and `authority.status(capturedLeaseId)` then throws `AUTHORITY_REQUIRED`. Also assert inspector/root/worktree failures that occur before lease creation create zero leases.

- [ ] **Step 4: Implement the exact resume order**

`resume(...)` performs:

```text
lookup current record
-> canonical root revalidation
-> strict worktree/repository/worktree verification
-> local + published refresh
-> authority.start(profile:"project", exact stored roots)
-> build bounded package
-> update operational snapshot
-> return
```

Wrap only the post-`start` block in rollback. Task 4 extends `ProjectContinuityServiceOptions` with `maxResumeChars` and optional test-only `packageBuilder`:

```ts
const lease = await this.authority.start({
  profile: "project",
  projectRoots: project.roots,
  ...(input.requestedTtlSeconds !== undefined
    ? { requestedTtlSeconds: input.requestedTtlSeconds }
    : {}),
});
try {
  const packaged = this.packageBuilder(
    { project, record: project.currentRecord, inspection },
    this.maxResumeChars,
  );
  this.store.updateOperationalState(
    project.id,
    inspection.local,
    inspection.published,
    inspection.local.checkedAt,
  );
  return {
    projectId: project.id,
    alias: project.alias,
    recordVersion: project.currentRecord.recordVersion,
    authorityLease: lease,
    resumePackage: packaged.text,
    packageTruncated: packaged.truncated,
    contextAvailable: packaged.contextAvailable,
  };
} catch (error) {
  try { this.authority.end(lease.leaseId); } catch { /* already expired/revoked */ }
  await this.authority.flushAudit();
  throw error;
}
```

Do not persist `leaseId` anywhere.

- [ ] **Step 5: Run package/service tests GREEN**

```bash
npm test -- tests/continuity-resume-package.test.ts tests/project-continuity-service.test.ts tests/authority.test.ts
npm run build
```

- [ ] **Step 6: Commit Task 4**

```bash
git add src/continuity-resume-package.ts src/project-continuity-service.ts tests/continuity-resume-package.test.ts tests/project-continuity-service.test.ts
git diff --cached --check
git commit -m "feat: resume projects with fresh authority"
```

---

### Task 5: Wire daemon lifetime and register the four continuity MCP tools

**Files:**
- Create: `src/project-continuity-tool-registration.ts`
- Create: `src/continuity-output-schemas.ts`
- Modify: `src/server.ts`
- Modify: `src/runtime-shutdown.ts`
- Test: `tests/project-continuity-mcp.test.ts`
- Modify: `tests/runtime-shutdown.test.ts`
- Modify: `tests/http-transport.test.ts`
- Modify any runtime fixture type literals strictly required by the new daemon service.

**Interfaces:**
- `RuntimeServices` adds:

```ts
continuityStore: ContinuityStore;
continuity: ProjectContinuityService;
```

- `RuntimeOptions` may inject:

```ts
continuityStore?: ContinuityStore;
continuityService?: ProjectContinuityService;
```

- MCP surface is exactly:

```text
project_register
project_resume
project_checkpoint
project_context_read
```

- [ ] **Step 1: Write RED MCP catalog/schema tests**

Use a real temporary continuity DB in the MCP fixture. Assert the four tools appear and no other `project_*` continuity tool is registered.

Annotations:

```ts
project_register:    { readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:true }
project_resume:      { readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:true }
project_checkpoint:  { readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:true }
project_context_read:{ readOnlyHint:true,  destructiveHint:false, idempotentHint:true,  openWorldHint:false }
```

Every input schema is `.strict()`. Reject unknown fields.

Tool descriptions must explicitly guide model behavior:

- `project_resume`: use when the user asks to continue a registered project by its alias in a new/current chat; never fuzzy-match.
- `project_checkpoint`: update after user direction changes, important decisions, milestones/failures, and before a project handoff/final response; Delivery 1 is not automatically logged.
- `project_context_read`: use only when resume says current critical context was truncated or the full current semantic record is required.

- [ ] **Step 2: Define strict bounded MCP schemas**

In the registration module define reusable schemas with exact maxima from the spec. At minimum:

```ts
const taskSchema = z.object({
  goal: z.string().min(1).max(8_000),
  constraints: z.array(z.string().min(1).max(2_000)).max(32),
  successCriteria: z.array(z.string().min(1).max(2_000)).max(32),
  status: z.enum(["active", "blocked", "completed"]),
  nextStep: z.string().min(1).max(4_000),
  detail: z.string().max(32_000).optional(),
}).strict();

const decisionSchema = z.object({
  decision: z.string().min(1).max(4_000),
  rationale: z.string().min(1).max(8_000),
  alternatives: z.array(z.string().min(1).max(2_000)).max(12),
  evidence: z.array(z.string().min(1).max(2_000)).max(20),
  validWhile: z.string().max(4_000).optional(),
}).strict();
```

Cap current critical decisions at 20, uncertainties at 20 x 2k, verification summaries at 20 x 2k, project roots at 16, alias at 128, worktree path at 16,384.

Output schemas in `continuity-output-schemas.ts` mirror only safe public fields. Repository common Git dir and internal inode-derived materials need not be exposed; return identity digests and canonical worktree/repository paths.

- [ ] **Step 3: Write RED end-to-end MCP behavior test**

Through a real MCP client:

1. `project_register` a temp repo/worktree with initial task/decision;
2. `project_resume` with alias only and receive a fresh Project lease + bounded package;
3. create staged/unstaged/untracked changes, checkpoint with returned lease and `expectedRecordVersion:1`, receive version 2;
4. `project_context_read` with lease returns the version 2 current record and accepts no historical-version selector;
5. stale checkpoint using expected version 1 returns `CONFLICT`;
6. end returned lease with existing `session_authority_end`; a later context read with it returns `AUTHORITY_REQUIRED`.

Verify the continuation DB bytes/queries do not contain the raw lease ID.

- [ ] **Step 4: Wire store/service once per runtime**

`createRuntimeServices` uses the configured DB path:

```ts
const continuityStore = options.continuityStore
  ?? new ContinuityStore({ databasePath: config.continuity.databasePath });
const continuityInspector = new ContinuityGitInspector({
  maxTrackedPaths: config.continuity.maxTrackedPaths,
  remoteVerificationTimeoutMs: config.continuity.remoteVerificationTimeoutMs,
  maxCommandOutputBytes: config.limits.maxCommandOutputBytes,
});
const continuity = options.continuityService
  ?? new ProjectContinuityService({
    store: continuityStore,
    inspector: continuityInspector,
    authority,
    homeDir: homedir(),
    maxResumeChars: config.continuity.maxResumeChars,
  });
```

The store constructor is synchronous by Task 1 contract, so `createRuntimeServices(...)` remains synchronous. Do not add a second async runtime constructor.

Register tools through `registerProjectContinuityTools(server, runtime)` near the other modular runtime registrations.

- [ ] **Step 5: Add continuity store to ordered shutdown**

Add `continuity` before control/transport close. Expected tail order:

```text
computer-js
computer
processes
browser
continuity
control
transport
```

`ContinuityStore.close()` is idempotent. A continuity close error is reported through the existing shutdown error callback but must not stop control/transport cleanup.

- [ ] **Step 6: Run MCP/catalog/shutdown tests GREEN**

```bash
npm test -- tests/project-continuity-mcp.test.ts tests/http-transport.test.ts tests/runtime-shutdown.test.ts
npm run build
```

- [ ] **Step 7: Commit Task 5**

```bash
git add src/project-continuity-tool-registration.ts src/continuity-output-schemas.ts src/server.ts src/runtime-shutdown.ts tests/project-continuity-mcp.test.ts tests/runtime-shutdown.test.ts tests/http-transport.test.ts
# include only explicitly required runtime fixture updates
git diff --cached --check
git commit -m "feat: expose project continuity MCP tools"
```

---

### Task 6: Harden restart, remote-staleness, corruption, and replacement behavior

**Files:**
- Create: `tests/project-continuity-integration.test.ts`
- Modify production files from Tasks 1-5 only if a reproducible failing acceptance test exposes a Critical/Important defect.

**Interfaces:**
- No new MCP tools or product features.
- This task is acceptance hardening for the existing Delivery 1 contracts.

- [ ] **Step 1: Write one real persistence/restart integration scenario**

Use a real temporary SQLite file and real Git repo/worktree. Register + checkpoint to version 2, close all continuity/runtime objects, construct fresh store/service instances against the same DB, and resume. Assert goal/decision/next-step/version/worktree identity survive process-like restart and the new lease differs from any prior lease.

- [ ] **Step 2: Write replacement/loss failure scenarios**

Cover separately:

1. delete the registered worktree path;
2. remove it and create an unrelated Git repo at the exact same path;
3. remove and recreate another worktree at that path from the same repository so filesystem worktree identity changes.

Every resume must fail with continuity worktree invalid/mismatch and must not inspect/select another existing worktree. If the failure occurs before lease creation, authority start count remains zero.

- [ ] **Step 3: Write remote last-good preservation scenario**

Start with a local bare origin where branch/main verify. Persist that operational snapshot. Make the remote inaccessible through injected remote-runner failure, restart the service, and resume. Assert current remote statuses are `unverified`, previous `lastVerifiedSha/lastVerifiedAt` remain exact, and resume still returns a Project lease/package that says remote state is unverified rather than branch missing.

- [ ] **Step 4: Write corrupt DB and stale chat scenarios**

Corrupt database bytes and schema-version mismatch each produce `CONTINUITY_DATABASE_INVALID` without creating an empty replacement DB.

For concurrency:

```text
chat A reads version 2
chat B checkpoint expected 2 -> version 3
chat A checkpoint expected 2 -> CONFLICT
current remains version 3
```

Then restart and assert version 3 persists.

- [ ] **Step 5: Prove resume post-lease rollback in an integration fixture**

Use the real store/inspector but inject package assembly failure after authority start. Capture authority audit/start event or injected manager wrapper, assert the minted lease is revoked before the error returns, and verify no lease token appears in DB bytes or semantic JSON.

- [ ] **Step 6: Prove Delivery 1 does not silently add automatic operation logging**

After a project checkpoint, execute an existing unrelated read tool/service such as filesystem read or Git status without invoking checkpoint. Re-read the semantic record and assert `recordVersion` and semantic contents are unchanged. This test documents the intentional Delivery 1 limitation rather than pretending existing tool activity is automatic continuity memory.

- [ ] **Step 7: Run integration tests and full repository check**

```bash
npm test -- tests/project-continuity-integration.test.ts tests/continuity-store.test.ts tests/continuity-git-inspector.test.ts tests/project-continuity-service.test.ts tests/project-continuity-mcp.test.ts
npm run check
```

If a failure is production-relevant, follow root-cause -> RED -> minimal fix -> focused GREEN -> full GREEN. Do not refactor unrelated code.

- [ ] **Step 8: Commit Task 6**

```bash
git add tests/project-continuity-integration.test.ts
# add production files only when justified by a RED Critical/Important fix
git diff --cached --check
git commit -m "test: harden project continuity recovery"
```

---

### Task 7: Document model behavior and prepare real new-chat Delivery 1 acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Create: `tests/project-continuity-docs.test.ts`

**Interfaces:**
- No new runtime behavior beyond Tasks 1-6.
- Documentation must distinguish continuity correctness from platform app auto-invocation.

- [ ] **Step 1: Write RED documentation contract assertions**

Assert both operator guides contain the four tool names and the exact product limitations/conventions:

```text
X projesine devam et
fresh Project authority
no automatic operation logging in Delivery 1
project_checkpoint
12,000
project_context_read
verified / not_found / unverified
no Admin auto-escalation
no automatic branch/worktree switching
app auto-invocation is a separate platform experiment
```

Also assert no docs claim `cleanupStatus` or automatic capture of every existing tool result.

- [ ] **Step 2: Update README/runbook with the intended ChatGPT behavior**

Document a one-time setup flow:

1. explicitly register the project/worktree with its initial primary task and critical decisions;
2. during ordinary work, ChatGPT should checkpoint after user direction changes, important decisions, meaningful milestone/failure, and before final handoff;
3. in a new chat with the app invoked, user says only `X projesine devam et`;
4. ChatGPT calls `project_resume`, uses the returned fresh Project lease, and calls `project_context_read` only if package truncation says current critical context remains outside the first package.

State clearly that Delivery 1 does not automatically observe every tool operation and semantic freshness depends on regular checkpoint calls. Stored semantic text is untrusted context, not authority/system instruction.

- [ ] **Step 3: Document platform experiment separately**

Create two acceptance result headings:

```text
Continuity correctness (app invoked)
Platform auto-invocation experiment (app not explicitly selected)
```

The first is a product gate. The second is informational and may require app selection/reference depending on ChatGPT platform behavior.

- [ ] **Step 4: Run docs contract + full check**

```bash
npm test -- tests/project-continuity-docs.test.ts
npm run check
git diff --check
```

- [ ] **Step 5: Commit Task 7**

```bash
git add README.md docs/CHATGPT_INTEGRATION.md tests/project-continuity-docs.test.ts
git diff --cached --check
git commit -m "docs: define project continuity workflow"
```

---

### Task 8: Final verification, exact-head merge, deployment, and real new-chat gate

**Files:**
- No production changes unless a fresh reproducible Critical/Important defect is found.
- Real-chat acceptance notes/helpers may remain untracked; do not commit secrets, leases, ChatGPT transcripts, or account UI data.

**Interfaces:**
- Final feature HEAD is immutable during exact-head PR CI.
- Required CI remains `test (22)`, `test (24)`, and `macos-native` unless the repository workflow itself changes before this task.

- [ ] **Step 1: Fresh final local verification**

Run from exact continuity worktree:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
git diff --check origin/main...HEAD
git diff --check
rg -n "continuityWorkId|automatic operation logging|cleanupStatus" src
```

Expected grep: no Delivery 2 `continuityWorkId`, no automatic-operation implementation, and no invented cleanup field in production. Documentation prose does not count as a production hit.

Also run focused continuity files:

```bash
npm test -- \
  tests/continuity-store.test.ts \
  tests/continuity-git-inspector.test.ts \
  tests/project-continuity-service.test.ts \
  tests/continuity-resume-package.test.ts \
  tests/project-continuity-mcp.test.ts \
  tests/project-continuity-integration.test.ts
```

- [ ] **Step 2: Exact final diff review**

Review only `origin/main...HEAD`. Confirm:

- no authority lease persistence;
- no Admin auto-start;
- no generic arbitrary Git executor exposed;
- no automatic path/branch fallback;
- remote errors cannot become `not_found`;
- last-good published evidence is preserved;
- semantic OCC and operational snapshot freshness are separate;
- no existing tool output contract changed;
- no Delivery 2/3 or Slice 5 implementation leaked in.

Fix only a proven Critical/Important issue using RED -> minimal fix -> focused/full GREEN.

- [ ] **Step 3: Push without force and create exact-head PR**

Record final SHA, push the current branch with no force, open a PR to `main`, and require the PR head SHA to equal the reviewed SHA.

Require exact-head PR CI:

```text
test (22) SUCCESS
test (24) SUCCESS
macos-native SUCCESS
```

Immediately before merge, re-read PR head and checks. Squash merge only with `--match-head-commit <reviewed-sha>` or equivalent expected-head guard.

- [ ] **Step 4: Verify exact post-merge main**

Fetch `origin/main`, record the squash SHA, verify remote `refs/heads/main` is identical, then require the `push` CI run on that same SHA:

```text
test (22) SUCCESS
test (24) SUCCESS
macos-native SUCCESS
```

Only then deploy/use that exact merged build for the product acceptance.

- [ ] **Step 5: Register one real project and verify a service restart**

With the installed/current ChatGPT backend using a dedicated continuity DB, register a harmless real development project alias with its exact worktree and current task/decisions. Restart only the normal service component required to prove persistence; do not clean/switch the project worktree. In the same chat verify resume still returns the same project ID/record version and a new Project lease after restart.

Revoke test leases after the check; never persist them in notes.

- [ ] **Step 6: Real new-normal-chat continuity correctness gate**

Open a **new normal ChatGPT chat**, invoke/select the app as required by the platform, and send only:

```text
X projesine devam et
```

PASS requires the resulting continuity flow to identify, without pasted old-chat summary:

```text
exact registered worktree
current goal and critical constraints
current recordVersion
critical decision(s) with rationale
staged/unstaged/untracked open changes
local branch + HEAD
published verified/not_found/unverified state and last-good evidence when relevant
verification/uncertainty summary
exact next step
fresh Project lease, not Admin
```

If the first package is truncated, the app/model must use `project_context_read` and still recover current critical task detail.

Do not proceed to Delivery 2 if this gate fails. Root-cause the plugin/tool-description/store/resume problem inside Delivery 1.

- [ ] **Step 7: Separate bare-prompt platform experiment**

Open another new normal ChatGPT chat **without explicitly selecting/referencing the app** and send the same natural phrase. Record only whether the platform automatically invokes the app. A failure to auto-invoke is not a continuity product failure; report it separately and do not change continuity correctness logic to game platform routing.

- [ ] **Step 8: Freeze Delivery 1 scope**

After the real new-chat gate passes, record the result in the project handoff. Do **not** begin automatic operation logging, detailed historical query, Slice 5, or another continuity delivery until a separate approved plan begins.

---

## Plan Self-Review

- **Spec coverage:** persistence/restart, exact alias, strict worktree/repository identity, local dirty state, three-state published verification with last-good preservation, one primary task, decision rationale, optimistic semantic versioning, fresh Project-only lease, rollback, 12k package, current-record overflow read, corruption behavior, no automatic operation logging, unchanged existing result contracts, and real new-chat acceptance are each mapped to a task.
- **Scope separation:** Delivery 2 operation linkage/work IDs and Delivery 3 historical semantic query are explicitly absent. Slice 5 is absent. No task adds `cleanupStatus`.
- **Authority consistency:** only `project_resume` creates a lease; it creates Project only. Checkpoint/context require exact registered Project roots. Registration creates no lease. No lease is persisted.
- **State consistency:** semantic version history is append-only and OCC-protected; resume operational snapshots refresh separately. `verified`, `not_found`, and `unverified` are not conflated.
- **Identity consistency:** canonical path + repository identity + worktree identity are all required for resume. No fallback location or branch mutation exists.
- **Test realism:** SQLite tests use actual files; Git identity and verified/not-found remote tests use temporary real repos/bare remotes; injected runner failure is reserved for deterministic remote-unavailable classification and post-lease package failure.
- **No placeholders:** every implementation task names exact files, interfaces, RED expectations, GREEN commands, and commit boundaries.
