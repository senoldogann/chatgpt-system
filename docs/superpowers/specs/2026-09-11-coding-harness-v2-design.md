# Coding Harness v2 Design

## Goal

Extend `chatgpt-system` from a secure local MCP authority gateway into a reliable local software-engineering harness for capable coding models. The harness should help a model locate relevant code, make isolated changes, execute project checks under least privilege, recover task context, and report completion only with fresh evidence.

The goal is not to clone Codex internals. The goal is a strong local execution layer with explicit security boundaries and deterministic tool contracts.

## Existing foundation

The current repository already provides strong primitives that remain authoritative:

- Project/User/Admin authority leases in `src/authority.ts`;
- scoped capability construction in `src/scoped-runtime.ts`;
- filesystem confinement and symlink validation in `src/policy.ts`;
- SHA-256 guarded writes and patches in `src/fs-service.ts`;
- typed local Git operations in `src/git-service.ts`;
- Admin-only `shell=false` host execution in `src/process-service.ts` and `src/process-supervisor.ts`;
- semantic browser automation and diagnostics;
- Computer Runtime v2;
- bounded audit and output handling.

These boundaries must not be weakened for convenience.

## Security boundary

There are two distinct execution paths:

```text
Project authority -> project_exec -> OS/container sandbox -> project-scoped execution
Admin authority   -> terminal_run -> host execution as current user
```

`project_exec` must never fall back to `terminal_run` or another unsandboxed host path. If a supported sandbox backend is unavailable, it returns a stable `SANDBOX_UNAVAILABLE` error.

The first production backend is Docker-based because the repository needs a real OS isolation boundary. Apple documents App Sandbox as the supported macOS sandbox technology, while the older `sandbox-exec`/SBPL path is not a suitable long-term product foundation. A future native App Sandbox/XPC backend may be added behind the same internal interface.

Docker project execution requirements:

- `shell=false` for host-side Docker invocation;
- project root mounted read-write at `/workspace`;
- no host home mount;
- no Docker socket mount;
- no privileged mode;
- no host PID/network namespaces;
- network disabled by default;
- read-only container root filesystem where practical;
- bounded output, duration, and process lifetime;
- image pull disabled during `project_exec`;
- no host secret environment inheritance;
- no fallback when Docker or the configured image is unavailable.

Host-native tasks that cannot run in a Linux container, such as Xcode/macOS-specific builds, remain explicit Admin-host operations.

## Tool surface

Avoid adding many narrow MCP tools. New public capabilities should remain compact:

- `project_exec`
- `code_query`
- `task_state`
- `fs_apply_patch_set`
- `git_worktree`
- `project_check`

Browser tools remain separate because their semantic surface is already narrow and mature.

## Code intelligence

`code_query` will provide bounded repository-aware operations:

```text
search
symbols
definition
references
diagnostics
```

The first layer uses local filename/text/symbol indexing and ignore rules. LSP integration is added behind a language-service adapter without requiring cloud embeddings.

Indexes must account for current filesystem content, not only `HEAD`, and must exclude obvious secrets, binaries, dependency trees, caches, and generated outputs.

## Durable task state

Long-running engineering work must not rely only on conversation context. `task_state` stores project-scoped local state under a dedicated subtree such as:

```text
~/.chatgpt-system/state/projects/<project-fingerprint>/tasks/
```

It must never recursively mutate the shared `~/.chatgpt-system` parent. Project Continuity v1 owns its separate `~/.chatgpt-system/continuity/` subtree.

Stored task records include goal, base/current HEAD observations, working-tree digest, findings, decisions, inspected/modified files, verification evidence references, and next step. Assertions such as "tests pass" are not evidence unless backed by a recorded execution result.

## Safe changes

`fs_apply_patch_set` validates every path, current hash, and patch before changing production files. Normal precondition failures must leave all destination files unchanged. Crash semantics must be documented honestly; if cross-file crash atomicity is not guaranteed, journal/recovery state is required.

`git_worktree` manages only plugin-owned worktrees and never deletes unmanaged or dirty worktrees.

## Verification

`project_check` detects project-configured checks and records structured evidence for test/typecheck/lint/build/integration runs. Evidence is associated with the current repository state; a changed HEAD or working-tree digest makes previous evidence stale.

Completion state is explicit:

```text
PASS
FAIL
NOT_RUN
STALE
UNAVAILABLE
```

A task cannot be reported as fully verified when required evidence is stale, failed, or not run.

## Browser/runtime correlation

Existing browser network/console diagnostics will be enhanced with safe correlation metadata where available, without exposing cookies, authorization headers, query secrets, sensitive bodies, or arbitrary JavaScript execution. Source-map resolution must fail explicitly rather than inventing a source location.

## Error and recovery model

New capabilities return stable, machine-actionable errors such as:

```text
SANDBOX_UNAVAILABLE
SANDBOX_DENIED
COMMAND_NOT_ALLOWED
NETWORK_DENIED
LSP_UNAVAILABLE
INDEX_STALE
WORKTREE_DIRTY
WORKTREE_UNMANAGED
CHECK_FAILED
VERIFICATION_REQUIRED
STALE_EVIDENCE
RECOVERY_REQUIRED
```

Retryability should be explicit where useful. Blind retry must not be encouraged.

## Testing strategy

Repository-local instructions take precedence over generic TDD preferences. The implementation therefore uses RED -> GREEN verification but prefers integration, end-to-end, and smoke tests for behavior boundaries. Unit tests are reserved for stable pure transformations and policy logic where they add meaningful confidence.

Every major task receives fresh verification and an independent diff review before proceeding. No success claim is made from stale or indirect evidence.

## Parallel-work boundary

This feature is implemented in:

```text
/private/tmp/chatgpt-system-coding-harness-v2
branch: feat/coding-harness-v2
base: origin/main @ 3daf964357ce4fe7302f1badea95068a867145cd
```

Project Continuity v1 is separately owned at:

```text
/private/tmp/chatgpt-system-project-continuity-v1
branch: feat/project-continuity-v1
```

This feature must not modify that worktree, its untracked plan/spec files, or its `~/.chatgpt-system/continuity/` state subtree.

## Non-goals

This delivery does not add:

- multi-agent orchestration;
- cloud vector databases or cloud embeddings;
- automatic push/merge/release;
- arbitrary shell access;
- generic remote desktop control;
- provider routing;
- UI redesign;
- self-learning behavior.

Single-agent engineering reliability comes first.
