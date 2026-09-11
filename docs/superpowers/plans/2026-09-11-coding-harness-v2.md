# Coding Harness v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` when available, otherwise `superpowers:executing-plans`. Use repository-local instructions, RED -> GREEN verification, fresh evidence, and isolated worktrees.

**Goal:** Add a least-privilege local software-engineering harness to `chatgpt-system` without weakening the existing authority, filesystem, process, browser, Computer Runtime, or audit boundaries.

**Architecture:** Keep Admin host execution unchanged. Add Project-scoped sandbox execution as a separate fail-closed capability, then build repository code intelligence, durable task state, transactional edits, managed worktrees, and structured verification around the existing scoped runtime. Prefer compact MCP primitives and structured results over many narrow tools.

**Tech Stack:** Node.js 22+, TypeScript 6, MCP TypeScript SDK v2, Zod v4, Vitest, Docker as the first Project execution sandbox backend, existing Playwright and macOS native components.

**Spec:** `docs/superpowers/specs/2026-09-11-coding-harness-v2-design.md`

## Global Constraints

- Work only in `/private/tmp/chatgpt-system-coding-harness-v2` on `feat/coding-harness-v2` unless explicitly instructed otherwise.
- Base is `origin/main` SHA `3daf964357ce4fe7302f1badea95068a867145cd`.
- Do not touch `/private/tmp/chatgpt-system-project-continuity-v1` or its branch/files.
- Do not recursively mutate, move, chmod, chown, or clean `~/.chatgpt-system`; this plan may later own only `~/.chatgpt-system/state/`.
- Preserve Project/User/Admin lease semantics. Existing Admin `terminal_run` remains unsandboxed host execution and must not be widened to Project/User.
- `project_exec` must fail closed when its sandbox backend is unavailable. No host fallback is permitted.
- Keep `shell=false`, bounded output/runtime, symlink protections, SHA-256 write guards, audit redaction, and browser credential refusal.
- No automatic push, merge, publish, release, force operation, or unrelated refactor.
- Prefer integration/E2E/smoke coverage. Add unit tests only for stable policy/pure transformations where justified.
- No completion claim without fresh verification evidence.

---

### Task 0: Preflight, mapping, baseline, and durable plan

**Verified repository map:**

| Capability | Existing production files | Existing tests |
| --- | --- | --- |
| Authority | `src/authority.ts`, `src/authority-request-manager.ts`, `src/scoped-runtime.ts` | `tests/authority*.test.ts`, `tests/control*.test.ts` |
| Filesystem policy | `src/policy.ts`, `src/fs-service.ts` | `tests/policy.test.ts`, `tests/fs-service.test.ts` |
| Git | `src/git-service.ts` | `tests/git-service.test.ts` |
| Host execution/processes | `src/process-policy.ts`, `src/process-service.ts`, `src/process-supervisor.ts`, `src/managed-process-service.ts` | `tests/process*.test.ts`, `tests/managed-process-service.test.ts` |
| MCP registration/output | `src/server.ts`, `src/tool-output-schemas.ts` | `tests/*-mcp.test.ts`, `tests/http-transport.test.ts` |
| Browser | `src/browser-tool-registration.ts`, `src/browser-service.ts`, `src/browser-runtime.ts`, `src/playwright-browser-backend.ts`, `src/scoped-browser-service.ts` | `tests/browser*.test.ts`, `tests/playwright-browser-backend.test.ts` |
| Audit | `src/audit.ts` plus scoped services | `tests/*-audit.test.ts` |
| Computer Runtime | `src/computer-*.ts`, `src/scoped-computer-*.ts` | `tests/computer*.test.ts` |

**Baseline evidence:**

```text
npm ci --ignore-scripts --no-audit --no-fund -> exit 0
npm run check -> exit 0
56 test files passed
379 tests passed
0 failures
```

- [x] Verify shared repository/worktree topology.
- [x] Read `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, global `AGENTS.md`.
- [x] Create isolated worktree/branch from exact `origin/main`.
- [x] Run fresh baseline build/tests.
- [x] Record exact architecture mapping.
- [x] Persist design and implementation plan.

---

### Task 1: Project-sandboxed execution

**Files expected to create:**
- `src/project-exec-types.ts`
- `src/project-exec-backend.ts`
- `src/docker-project-exec-backend.ts`
- `src/project-exec-service.ts`
- `src/project-exec-tool-registration.ts`

**Files expected to modify:**
- `src/errors.ts`
- `src/scoped-runtime.ts`
- `src/server.ts`
- `src/system-environment.ts`
- `src/tool-output-schemas.ts`
- `README.md`
- `SECURITY.md`

**Tests expected:**
- focused policy/service tests for pure argument construction and fail-closed behavior;
- MCP integration proving Project can use `project_exec`, User/Admin policy is explicit, and `terminal_run` behavior is unchanged;
- real Docker acceptance when Docker daemon and the fixed local image are available;
- security assertions for no host-home mount, no Docker socket, no privileged mode, network disabled by default, no pull-at-call-time, bounded runtime/output, and no host fallback.

**Interface:**

```ts
project_exec({
  authorityLeaseId,
  command,
  args,
  cwd?,
  timeoutMs?,
})
```

The first backend uses a fixed trusted local image and `docker run --pull=never --rm --network=none`. The active Project root is mounted read-write at `/workspace`; unrelated host paths and secrets are not mounted or inherited.

- [x] Write RED policy/backend tests.
- [x] Verify RED for missing production implementation.
- [x] Implement stable sandbox errors.
- [x] Implement deterministic Docker invocation builder with no caller-controlled Docker flags/image/mounts.
- [x] Implement bounded runner and fail-closed Docker availability/image checks.
- [x] Wire Project-scoped service and strict MCP registration.
- [x] Preserve existing Admin `terminal_run` unchanged.
- [x] Run focused GREEN tests.
- [x] Run full `npm run check` and `git diff --check`.
- [x] Perform independent security/diff review.
- [x] Commit only after fresh verification.

---

### Task 2A: Repository-aware local search and symbols

**Likely files:** new `src/code-query-*` modules; register through `src/server.ts` or a dedicated registration module; add schemas in `src/tool-output-schemas.ts`.

`code_query` operations in this slice:

```text
search
symbols
```

Requirements:

- honor repository ignore rules;
- exclude dependency/build/cache/binary/obvious-secret files;
- bounded results;
- current content hash in results;
- dirty-file/deleted-file invalidation;
- no cloud embeddings requirement.

Verification should use fixture repositories and integration-style MCP calls.

- [x] Add RED MCP integration coverage for repository search/symbol behavior.
- [x] Honor Git ignore rules and exclude dependency/build/cache/binary/obvious-secret files.
- [x] Return bounded current-content search/symbol results with SHA-256 hashes.
- [x] Verify dirty-file and deleted-file results are refreshed from the working tree.
- [x] Keep query/symbol payloads out of audit metadata.
- [x] Run focused GREEN tests, full `npm run check`, and `git diff --check`.

**Task 2A verification evidence:** focused MCP tests 5/5 PASS; full suite 62 files / 400 tests PASS; `git diff --check` PASS.

---

### Task 2B: LSP code intelligence

Extend `code_query` with:

```text
definition
references
diagnostics
```

Create a language-service adapter/lifecycle boundary. Support the current repository language first (TypeScript) with explicit `LSP_UNAVAILABLE` fallback to text/symbol search. Do not silently invent semantic results.

- [x] Add RED MCP integration coverage for `definition`, `references`, and `diagnostics`.
- [x] Add a TypeScript language-service adapter/lifecycle boundary behind `code_query`.
- [x] Keep semantic reads repository-local; no project-external package/lib source reads.
- [x] Refresh semantic results from current dirty working-tree content on each request.
- [x] Return explicit `LSP_UNAVAILABLE` with `search`/`symbols` fallback for unsupported languages/configurations.
- [x] Bound semantic scans/results and preserve SHA-256 content hashes.
- [x] Keep semantic request/diagnostic payloads out of audit metadata.
- [x] Move TypeScript to runtime dependencies and validate the lockfile.
- [x] Run focused semantic GREEN tests, full `npm run check`, and `git diff --check`.

**Task 2B verification evidence:** focused code-query suite 7/7 PASS; full suite 63 files / 402 tests PASS; `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` PASS; `git diff --check` PASS.

---

### Task 3: Durable task/checkpoint state

Add compact `task_state` operations:

```text
start
checkpoint
status
complete
fail
```

Store only inside a dedicated `~/.chatgpt-system/state/projects/<fingerprint>/...` subtree. Never recursively mutate the shared parent or continuity subtree. Bind state/evidence freshness to repository identity, HEAD, and working-tree digest. Redact secrets.

- [x] Add RED MCP integration coverage for `start`, `checkpoint`, `status`, `complete`, and `fail`.
- [x] Restrict durable task state to Project authority.
- [x] Persist atomically under the dedicated `state/projects/<fingerprint>/tasks/` subtree only.
- [x] Bind freshness to repository identity, HEAD, and tracked/untracked working-tree content digests.
- [x] Preserve task state across runtime restart without touching the continuity subtree.
- [x] Redact common secret/token/password forms before persistence and keep task IDs/payloads out of audit metadata.
- [x] Use bounded checkpoint/state sizes and `0600` state files.
- [x] Verify both dirty-worktree and HEAD-only staleness.
- [x] Run focused GREEN tests, full `npm run check`, and `git diff --check`.

**Task 3 verification evidence:** focused task-state/catalog suite 5/5 PASS; isolated Docker lifecycle regression 6/6 PASS after one unrelated parallel timing flake; final full suite 64 files / 404 tests PASS; `git diff --check` PASS.

---

### Task 4A: Transactional multi-file patches

Add `fs_apply_patch_set` using existing `PathPolicy`, SHA-256 preconditions, and patch semantics. Validate all paths/hashes/patches before destination mutation. Add journaling/recovery if crash-atomicity cannot be guaranteed. Explicitly test concurrent change, invalid patch, duplicate path, symlink escape, and recovery.

- [x] Add RED MCP integration coverage for multi-file success and prevalidation failures.
- [x] Validate all canonical paths, hashes, unified-diff hunks, and size limits before destination mutation.
- [x] Reject duplicate canonical targets and symlink escapes.
- [x] Re-check every original hash after transaction artifacts are materialized and before commit.
- [x] Persist bounded prepared/committing/committed journals under `state/patch-transactions/<scope-fingerprint>/`.
- [x] Recover interrupted committing transactions by restoring verified original backups before the next request.
- [x] Keep audit metadata categorical; patch/file contents are not copied into audit records.
- [x] Run focused GREEN tests, full `npm run check`, and `git diff --check`.

**Task 4A verification evidence:** focused patch-set/catalog suite 6/6 PASS; stale hash, malformed patch, duplicate canonical path, symlink escape, and interrupted-commit rollback covered; final full suite 65 files / 407 tests PASS; `git diff --check` PASS. A macOS `/var` → `/private/var` test-fixture alias was corrected to use the canonical Project-lease root; production recovery already keyed state by canonical authority roots.

---

### Task 4B: Managed worktree lifecycle

Add compact `git_worktree` operations:

```text
create
status
remove
```

Manage plugin-owned worktrees only. Never delete unmanaged/dirty worktrees. Branch names remain validated; no arbitrary Git arguments. Push/merge remain separate operations requiring existing policy/user approval.

- [x] Add RED MCP integration coverage for `create`, `status`, and `remove`.
- [x] Restrict managed worktree lifecycle to Project authority.
- [x] Generate destinations only under the plugin-owned worktree root; callers cannot provide remove paths.
- [x] Persist ownership registry entries as bounded `0600` JSON under `state/managed-worktrees/`.
- [x] Reuse the existing validated Git branch-name policy and fixed `shell=false` Git argv.
- [x] Refuse dirty source worktrees, dirty managed removal, unmanaged IDs, and tampered registry paths.
- [x] Preserve the created branch on normal worktree removal; push/merge remain separate tools.
- [x] Harden the existing Docker timeout lifecycle test against fixture-startup timing without changing production behavior.
- [x] Run focused GREEN tests, full `npm run check`, and `git diff --check`.

**Task 4B verification evidence:** focused managed-worktree/catalog suite 5/5 PASS; dirty source/removal, invalid branch, unmanaged path injection, registry tampering, and non-Project authority covered; Docker timeout/policy regression 9/9 PASS after deterministic test hardening; final full suite 66 files / 409 tests PASS; `git diff --check` PASS.

---

### Task 5: Structured project verification

Add `project_check` operations:

```text
detect
run
report
```

Detect real repository scripts/configuration rather than inventing commands. Record evidence with check kind, command, cwd, times, exit status, HEAD, working-tree digest, bounded output digests, and status. Any code-state change makes prior evidence stale by default.

Statuses:

```text
PASS
FAIL
NOT_RUN
STALE
UNAVAILABLE
```

Tie `task_state.complete` to current verification policy without pretending unavailable checks passed.

- [x] Add RED MCP integration coverage for `detect`, `run`, and `report`.
- [x] Detect repository-defined package scripts instead of accepting caller-provided commands.
- [x] Prefer an existing aggregate `check` script; otherwise detect existing typecheck/lint/test/build scripts only.
- [x] Run detected checks through the existing Project Docker sandbox with no host fallback or network widening.
- [x] Persist bounded `0600` verification evidence with HEAD, working-tree digest, timing, exit status, and stdout/stderr SHA-256 digests only.
- [x] Mark evidence `STALE` after HEAD/working-tree changes or when a check mutates code state during execution.
- [x] Distinguish `PASS`, `FAIL`, `NOT_RUN`, `STALE`, and `UNAVAILABLE` without treating unavailable execution as success.
- [x] Gate `task_state.complete` only when detectable verification is required; require fresh `PASS` while preserving completion for repositories with no detected checks.
- [x] Keep arbitrary command/argument injection out of the `project_check` MCP schema.
- [x] Run focused GREEN tests, full `npm run check`, and `git diff --check`.

**Task 5 verification evidence:** focused project-check/task-state/catalog suite 7/7 PASS; arbitrary-command schema rejection, digest-only persistence, PASS/FAIL/STALE/UNAVAILABLE behavior, code-state mutation staleness, and completion gating covered; final full suite 67 files / 411 tests PASS. One first full-suite run hit only parallel 5-second integration-test timeouts; narrowing tool construction removed unnecessary runtime overhead and the unchanged assertions passed on the fresh full rerun.

---

### Task 6: Browser/runtime/source correlation

Enhance existing browser diagnostics rather than creating a parallel browser agent. Add safe request/initiator/evidence metadata where available, preserve URL/query/credential redaction, and resolve source maps only when deterministic. Verify the loop: UI failure -> network/console -> source -> fix -> reload -> fresh browser evidence.

---

### Task 7: Error taxonomy, audit, and recovery hardening

Normalize new stable errors and retryability. Ensure new project execution, code intelligence, task state, patch transaction, worktree, and verification operations produce redacted audit metadata. Test daemon/task/LSP/sandbox crash recovery and stale authority/evidence behavior.

---

### Task 8: Tool-surface and backward-compatibility review

Review the complete MCP catalog for duplication and ambiguous selection. Keep existing stable APIs unless a breaking change is explicitly justified. Prefer operation enums within the six new compact capabilities rather than many new top-level tools.

---

### Task 9: Coding-harness benchmark suite

Add deterministic fixture tasks covering repository discovery, single/cross-file fixes, refactor, failing-test diagnosis, runtime/browser debugging, resume after context loss, concurrent modification, transaction failure, sandbox escape, and stale verification.

Record task success, requirements met, tool calls, wrong reads/edits, retries, human interventions, checks run, evidence freshness, false completion claims, security/scope violations, regressions, and final diff size.

Do not claim Codex parity from a single demo.

---

### Task 10: Documentation and operator runbook

Document authority/execution boundaries, Docker sandbox setup/limitations, code intelligence, task state, worktrees, verification, browser correlation, audit, stable errors, and the recommended agent workflow. Explicitly distinguish Project sandbox execution from Admin host execution.

---

### Task 11: Final verification and review

Run fresh repository checks appropriate to every touched subsystem, including build/tests, native checks when affected, security regression coverage, browser checks when affected, `git diff --check`, and the benchmark suite. Perform a whole-branch independent review. Report unverified behavior separately.

No push, merge, publish, or release without explicit user approval.
