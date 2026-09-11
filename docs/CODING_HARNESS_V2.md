# Coding Harness v2 Operator Runbook

Coding Harness v2 extends `chatgpt-system` with a least-privilege software-engineering execution layer. It does not replace the existing authority model and does not turn Project authority into host-shell access.

## Execution boundaries

There are two deliberately separate execution paths.

### Project sandbox execution

`project_exec` is available only to an active Project lease and only when the runtime was started with the explicit Project-execution gate.

```text
Project authority
    ↓
project_exec
    ↓
Docker sandbox
    ↓
/workspace = selected project root
```

Properties:

- Docker container networking is disabled.
- The container root filesystem is read-only.
- Only the selected Project root is bind-mounted at `/workspace`.
- Host home directories are not mounted.
- The Docker socket is not mounted into the container.
- The container receives bounded CPU, memory, PID, runtime, and output budgets.
- The runtime accepts only a trusted local Unix-socket Docker context.
- The fixed sandbox image is used with pull-at-call-time disabled.
- No host fallback is permitted. Docker/image/backend failure returns `SANDBOX_UNAVAILABLE`.

The Docker daemon is trusted infrastructure. Anyone able to control the host Docker daemon may already have highly privileged host access; Coding Harness v2 does not attempt to make an untrusted Docker daemon safe.

The sandbox is Linux-based. Xcode/macOS-native checks, Apple-platform signing, simulator work, and similar tasks remain outside this path.

### Admin host execution

`terminal_run`, `process_start`, and related process tools remain Admin-only host execution.

```text
Admin authority
    ↓
terminal_run / managed processes
    ↓
current macOS user account
```

This path uses `shell=false`, an executable allowlist, scoped cwd checks, bounded output/runtime, and sanitized environment handling, but it is not an OS sandbox.

Project and User authority do not gain host-terminal capability from Coding Harness v2.

## One-time sandbox setup

Build the fixed Project execution image with a trusted local Docker daemon:

```bash
npm run setup:project-exec
```

Start the runtime with Project execution explicitly enabled:

```bash
npm run dev -- stdio --root /absolute/path/to/project --enable-project-exec
```

For the tunnel setup flow, pass the same independent gate to the setup command. Omitting `--enable-project-exec` keeps Project execution disabled.

## Public Coding Harness capabilities

Coding Harness v2 adds six compact top-level MCP capabilities. Existing legacy tools remain unchanged.

### `project_exec`

Runs one allowlisted command in the Project Docker sandbox. The caller supplies a command, argument array, cwd inside the Project scope, and optional timeout. The caller cannot choose the image, mounts, Docker flags, network mode, or host fallback.

Use this for repository-local Linux-compatible checks where Project authority is sufficient.

### `code_query`

Operations:

```text
search
symbols
definition
references
diagnostics
```

`search` and `symbols` use current working-tree content and repository ignore rules. Dependency trees, generated/build/cache directories, binary files, and obvious secret files are excluded.

TypeScript semantic operations use the local TypeScript language-service adapter. Unsupported semantic requests return `LSP_UNAVAILABLE`; use `search` or `symbols` as the explicit fallback. Semantic results are never invented.

### `task_state`

Operations:

```text
start
checkpoint
status
complete
fail
```

Durable task records live only below:

```text
~/.chatgpt-system/state/projects/<project-fingerprint>/tasks/
```

The implementation does not recursively own or mutate the shared `~/.chatgpt-system/` parent and does not use the Project Continuity subtree.

Task freshness is tied to Git repository identity, current HEAD, and a working-tree digest covering tracked and untracked state. Secret-like text is redacted before persistence. Stored records are bounded and written atomically with restrictive permissions.

### `fs_apply_patch_set`

Applies a bounded multi-file logical change using optimistic SHA-256 preconditions.

Before destination mutation it validates:

- every path;
- canonical path uniqueness;
- authority confinement;
- symlink safety;
- expected SHA-256;
- unified-diff structure;
- read/write/transaction size limits.

Transaction state is journaled under the dedicated Coding Harness state subtree. Interrupted committing transactions are rolled back from verified backups when safe. Ambiguous/corrupt recovery state fails closed with `RECOVERY_REQUIRED`.

### `git_worktree`

Operations:

```text
create
status
remove
```

Only plugin-owned worktrees are manageable. The caller receives and later uses an opaque `worktreeId`; callers cannot submit an arbitrary remove path. Dirty source worktrees cannot be used for create, and dirty managed worktrees cannot be removed. Tampered or inconsistent ownership metadata fails closed.

Normal removal removes the managed worktree but preserves its Git branch. Push and merge remain separate existing operations.

### `project_check`

Operations:

```text
detect
run
report
```

`detect` reads actual project configuration instead of accepting an arbitrary command from the caller. For Node repositories, an existing aggregate `check` script is preferred; otherwise existing typecheck/lint/test/build scripts may be detected.

`run` executes only detected checks through Project sandbox execution. Evidence stores categorical execution metadata plus output digests and byte counts; raw stdout/stderr are not persisted.

Statuses:

```text
PASS
FAIL
NOT_RUN
STALE
UNAVAILABLE
```

Any relevant HEAD or working-tree change makes previous verification stale. When detectable verification is required, `task_state complete` is blocked by `VERIFICATION_REQUIRED` unless the current evidence is fresh `PASS`.

## Browser correlation

The existing browser surface remains authoritative. No parallel browser agent was introduced.

Use:

```text
browser_console_errors
browser_network_errors
```

Diagnostic entries expose bounded correlation metadata including `generation` and monotonic `sequence`. Network failures may also include an opaque request ID, resource type, navigation-request state, and sanitized frame initiator. Console diagnostics may expose a sanitized runtime source URL plus line/column when Playwright supplies them.

Explicit navigation advances the diagnostic generation, allowing pre-fix and post-reload evidence to be distinguished.

URL query strings and fragments are stripped before public output. Headers, cookies, authorization values, bodies, and diagnostic payloads are not copied into audit records. If deterministic source-map resolution is unavailable, the runtime reports source-map status as unavailable rather than inventing a mapped source location.

## Stable error and recovery model

Important Coding Harness errors include:

- `SANDBOX_UNAVAILABLE`: Project sandbox backend/image/context is unavailable. No host fallback occurs.
- `PROJECT_EXEC_DISABLED`: Project execution was not enabled at startup.
- `COMMAND_NOT_ALLOWED`: requested sandbox command is outside the allowed executable set.
- `LSP_UNAVAILABLE`: requested semantic code intelligence is unsupported; use text/symbol fallback.
- `WORKTREE_DIRTY`: a worktree mutation was refused because local changes exist.
- `VERIFICATION_REQUIRED`: completion requires current passing verification evidence.
- `RECOVERY_REQUIRED`: persisted transactional/ownership/task/verification state cannot be safely trusted automatically.
- `COMMAND_TIMEOUT`: execution exceeded the configured bound.
- `CONFLICT`: optimistic content preconditions no longer match current state.

Audit failure records contain stable error codes rather than raw exception messages/details. Recovery errors are intentionally fail-closed; do not blindly retry `RECOVERY_REQUIRED` without inspecting the underlying state.

## Recommended engineering loop

Use the following loop for substantial repository work:

```text
UNDERSTAND → SEARCH → PLAN → ISOLATE → EDIT → TEST → DIAGNOSE → VERIFY → CHECKPOINT → REPORT
```

Recommended sequence:

1. Start a Project lease scoped to the repository or managed worktree.
2. Use `code_query` to locate symbols, definitions, references, and diagnostics before broad file reads.
3. Start or restore `task_state` for work expected to survive context compaction or interruption.
4. Use `git_worktree create` when isolation from the user's current working tree is appropriate.
5. Read target files and retain their current SHA-256 values.
6. Use `fs_apply_patch_set` for logically related multi-file edits.
7. Use `project_check detect` and `project_check run` rather than inventing repository verification commands.
8. If a check fails, diagnose with current code/search/diagnostics and rerun only after a justified change.
9. For UI/runtime problems, correlate browser network/console evidence, edit the responsible source, reload, and require a newer diagnostic generation.
10. Create a durable checkpoint containing current findings, decisions, modified files, next step, and evidence references.
11. Report completion only when required evidence is fresh. Do not translate `UNAVAILABLE` or `STALE` into success.

## Isolation and parallel work

Use separate worktrees/branches for parallel agents. Never clean, reset, stash, delete, merge, or rewrite another agent's worktree on its behalf.

Coding Harness managed worktrees are intentionally narrow; they do not grant permission to modify unrelated worktrees or branches.

No automatic push, merge, publish, release, force operation, or destructive shared cleanup is part of this harness. Those remain explicit operator decisions under the existing Git/authority policy.

## Benchmark protocol

The deterministic benchmark protocol lives at:

```text
benchmarks/coding-harness-v2/benchmark.mjs
```

List available scenarios:

```bash
node benchmarks/coding-harness-v2/benchmark.mjs list
```

Materialize a deterministic scenario into an empty directory:

```bash
node benchmarks/coding-harness-v2/benchmark.mjs prepare <scenario-id> <empty-output-dir>
```

Evaluate a structured run record:

```bash
node benchmarks/coding-harness-v2/benchmark.mjs evaluate <run-record.json>
```

The shorthand contract strings `benchmark.mjs list`, `benchmark.mjs prepare`, and `benchmark.mjs evaluate` are intentionally stable for operators and tests.

The benchmark records requirements met, tool calls, wrong reads/edits, retries, human interventions, checks run, evidence freshness, false completion claims, security/scope violations, regressions, and final diff size. Success requires all scenario requirements, fresh evidence when required, zero false-completion claims, zero security/scope violations, and zero regressions.

A single benchmark run is not evidence of model parity. Compare repeat runs, scenario-level failures, safety behavior, and evidence freshness rather than one aggregate score.

## Operational checks

Before claiming a harness change is complete:

```bash
npm run check
git diff --check
```

For the benchmark protocol:

```bash
npx vitest run tests/coding-harness-benchmark.test.ts --maxWorkers=1
```

When Project Docker execution itself changed, additionally perform a real Docker/MCP acceptance run on a disposable fixture and verify:

- command runs inside the fixed image;
- unrelated host paths are hidden;
- external network is denied;
- workspace writes stay inside the selected Project root;
- audit records contain categorical evidence rather than command payload/output secrets.

## Known boundaries

- The Docker sandbox is Linux, not macOS.
- Xcode/macOS-native checks require explicit Admin host execution.
- Docker daemon trust is outside the container isolation boundary.
- TypeScript is the first semantic language-service adapter; other languages return explicit unsupported semantic behavior until an adapter exists.
- Source-map correlation is reported only when deterministic; otherwise it remains unavailable.
- The harness does not provide multi-agent orchestration, self-learning, provider routing, generic remote desktop, or automatic release operations.
- The harness cannot reproduce hidden Codex product internals such as proprietary orchestration/context-compaction behavior; it provides a local execution and evidence layer.
