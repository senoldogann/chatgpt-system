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

- [x] Extend existing console/network diagnostic results instead of adding a parallel browser agent/tool family.
- [x] Add per-page diagnostic generation plus monotonic cross-console/network sequence evidence.
- [x] Advance diagnostic generation on explicit browser navigation so pre-fix and post-reload evidence are distinguishable.
- [x] Add opaque request IDs, resource type, navigation-request state, and frame initiator metadata for failed requests/responses.
- [x] Add console runtime source URL/line/column metadata when Playwright provides it.
- [x] Sanitize query strings/fragments from network URLs, initiator URLs, and console runtime-source URLs before public output.
- [x] Keep source-map status explicit as `UNAVAILABLE` rather than inventing a mapped source location.
- [x] Preserve browser audit redaction: diagnostic payloads, source/initiator secrets, opaque request IDs, headers/cookies/bodies are not audited.
- [x] Verify correlation contract through BrowserService, Playwright backend, public MCP, runtime, audit, and error-normalization coverage.
- [x] Run focused browser GREEN tests, full `npm run check`, and `git diff --check`.

**Task 6 verification evidence:** focused browser suite 7 files / 60 tests PASS; public MCP output verifies sanitized runtime-source/network/initiator fields and opaque request correlation; audit regression includes source/initiator/query sentinels; full suite 67 files / 412 tests PASS; `git diff --check` PASS.

---

### Task 7: Error taxonomy, audit, and recovery hardening

Normalize new stable errors and retryability. Ensure new project execution, code intelligence, task state, patch transaction, worktree, and verification operations produce redacted audit metadata. Test daemon/task/LSP/sandbox crash recovery and stale authority/evidence behavior.

- [x] Redact generic audit failure metadata to stable `errorCode` only; never persist `Error.message` or `AppError.details`.
- [x] Lock retryability for harness errors: unavailable sandbox/timeouts/verification are explicit; policy, dirty-state, recovery, and unsupported semantic errors do not encourage blind retry.
- [x] Verify corrupt durable task state fails closed with `RECOVERY_REQUIRED`.
- [x] Verify corrupt persisted project-check evidence fails closed with `RECOVERY_REQUIRED` and does not leak corrupt payload into audit.
- [x] Verify revoked Project authority cannot be reused by durable harness tools.
- [x] Re-run existing patch journal recovery, managed-worktree tamper recovery, LSP unavailable, and sandbox unavailable/timeout regressions in the focused harness suite.
- [x] Run focused GREEN tests, full `npm run check`, and `git diff --check`.

**Task 7 verification evidence:** focused harness security/recovery suite 9 files / 35 tests PASS; centralized audit error redaction 2/2 PASS; stable error/retryability contract 11/11 PASS; corrupt task/verification state and revoked authority covered; final full suite 69 files / 427 tests PASS; `git diff --check` PASS.

---

### Task 8: Tool-surface and backward-compatibility review

Review the complete MCP catalog for duplication and ambiguous selection. Keep existing stable APIs unless a breaking change is explicitly justified. Prefer operation enums within the six new compact capabilities rather than many new top-level tools.

- [x] Compare the exact baseline MCP catalog from `3daf964` against current HEAD.
- [x] Preserve all 62 baseline tools; no legacy tool name was removed or renamed.
- [x] Confirm the only six added top-level tools are `code_query`, `fs_apply_patch_set`, `git_worktree`, `project_check`, `project_exec`, and `task_state`.
- [x] Lock the baseline 62-tool catalog with a SHA-256 fingerprint in the real HTTP MCP handshake test.
- [x] Keep multi-operation behavior inside the compact tools instead of adding definition/reference/checkpoint/worktree sub-tools.
- [x] Re-run strict schema/integration coverage for all six harness tools under the repository worker policy.
- [x] Run full `npm run check` and `git diff --check`.

**Task 8 verification evidence:** baseline catalog 62 tools, current catalog 68 tools, removed legacy tools 0, added tools exactly the planned six; catalog fingerprint `9cdc86efe227f7d92b2da227aa3ff508c11ceb165b2e5877a6727c9620620051`; focused catalog/harness suite 8 files / 21 tests PASS with `--maxWorkers=50%`; final full suite 69 files / 427 tests PASS; `git diff --check` PASS. An initial unconstrained focused run hit only existing 5-second integration-test timeouts under excessive parallelism; the repository's real worker policy passed unchanged assertions.

---

### Task 9: Coding-harness benchmark suite

Add deterministic fixture tasks covering repository discovery, single/cross-file fixes, refactor, failing-test diagnosis, runtime/browser debugging, resume after context loss, concurrent modification, transaction failure, sandbox escape, and stale verification.

Record task success, requirements met, tool calls, wrong reads/edits, retries, human interventions, checks run, evidence freshness, false completion claims, security/scope violations, regressions, and final diff size.

Do not claim Codex parity from a single demo.

- [x] Define 11 deterministic scenario fixtures covering discovery, single/cross-file fixes, refactor, diagnosis, browser/runtime debugging, continuity resume, concurrent modification, transaction failure, sandbox escape, and stale verification.
- [x] Materialize each fixture with stable bytes, fixed Git identity/date, deterministic `TASK.md`, scenario metadata, scenario digest, fixture digest, and HEAD.
- [x] Derive benchmark metrics from structured events and final unified diff instead of accepting a caller-provided aggregate score.
- [x] Gate task success on all requirements, fresh evidence when required, zero false-completion claims, zero security/scope violations, and zero regressions.
- [x] Provide deterministic `list`, `prepare`, and `evaluate` CLI operations without adding MCP surface area or touching shared runtime config.
- [x] Explicitly avoid model-parity claims in the benchmark protocol/task text.
- [x] Run focused benchmark protocol/CLI tests, full `npm run check`, and staged whitespace review.

**Task 9 verification evidence:** benchmark protocol 5/5 PASS; scenario catalog contains 11 unique deterministic tasks; repeated fixture materialization produces identical scenario/fixture digests and Git HEAD; real CLI `list`, `prepare`, and `evaluate` paths PASS; full suite 70 files / 432 tests PASS after separately hardening the pre-existing `project-check-mcp` integration timeout (`545414e`); no production runtime/MCP code changed for the benchmark.

---

### Task 10: Documentation and operator runbook

Document authority/execution boundaries, Docker sandbox setup/limitations, code intelligence, task state, worktrees, verification, browser correlation, audit, stable errors, and the recommended agent workflow. Explicitly distinguish Project sandbox execution from Admin host execution.

- [x] Add a dedicated `docs/CODING_HARNESS_V2.md` operator runbook to minimize overlap with the parallel continuity branch.
- [x] Document Project sandbox execution separately from Admin host execution, including Docker trust, Linux-only behavior, and no host fallback.
- [x] Document all six new compact MCP capabilities, state/worktree ownership, verification freshness, browser correlation, and stable recovery errors.
- [x] Document the recommended `UNDERSTAND → SEARCH → PLAN → ISOLATE → EDIT → TEST → DIAGNOSE → VERIFY → CHECKPOINT → REPORT` workflow.
- [x] Document benchmark `list`, `prepare`, and `evaluate` operations and explicitly reject single-run model-parity claims.
- [x] Lock the required runbook contracts with repository tests.

**Task 10 verification evidence:** documentation contract test 1/1 PASS; runbook is self-contained and does not require edits to shared README/integration files owned by the parallel continuity effort.

---

### Task 11: Final verification and review

Run fresh repository checks appropriate to every touched subsystem, including build/tests, native checks when affected, security regression coverage, browser checks when affected, `git diff --check`, and the benchmark suite. Perform a whole-branch independent review. Report unverified behavior separately.

No push, merge, publish, or release without explicit user approval.
