# chatgpt-system — Active Project State

Last updated: 2026-09-12T20:29+03:00
Status: Owner Runtime Phase 2 persistent interactive PTY is implemented locally and has passed pre-handoff acceptance; final exact-head verification/publication is in progress.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Finish **Owner Runtime Phase 2 — persistent interactive PTY** as a reviewable branch after the verified Phase 1 merge. Keep PTY Admin-only behind the existing Owner Runtime gate, preserve the narrow `terminal_run` and one-shot `shell_run` contracts, and do not mix Phase 3 Computer Runtime ceiling work into this branch.

## Active workspace

- Stable project root / continuity anchor: `/Users/dogan/chatgpt-system` on `main`.
- Stable merged baseline: `main@0195a432bae370eb36dedf65056c874634f805dc`.
- Phase 1 PR: `#39`, merged by squash after explicit authorization.
- Active Phase 2 managed worktree: `/Users/dogan/.chatgpt-system/worktrees/d0a0a546782faa2c9a9906345e9290c84508aad64b304746b50965bb2ff58ef1/1f372958-250d-456a-be9f-9ce8ddafc944`.
- Active Phase 2 branch: `feat/owner-runtime-phase2-pty`.
- Current implementation head before the final docs/state commit: `cf8a1624383c94a5ae206f7a674539febf4ec20c`.
- Approved design: `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`.
- Phase 2 plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase2-pty.md`.
- Project Continuity exact alias: `chatgpt-system`; continuity remains anchored to the stable root worktree.

## Completed

### Phase 1 merge

- PR #39 exact head `6776214b9a8e15cbe23a75172c22fa54f3cab772` passed hosted Node 22, Node 24, and macOS-native CI with `mergeStateStatus=CLEAN`.
- PR #39 was squash-merged as `0195a432bae370eb36dedf65056c874634f805dc`.
- Stable root `main` was fast-forwarded to the merge commit and matches `origin/main`.
- Fresh merged-root verification passed: Node/TypeScript `588/588` + `1` skip, production audit `0` vulnerabilities, Swift `164/164`.

### Phase 2 implementation

Implementation followed the committed RED → GREEN plan and is split into reviewable commits:

- `0aa038b` — exact `node-pty@1.2.0-beta.15`, lazy `NodePtyBackend`, real TTY/write/read/resize smoke, macOS CI PTY binding hook.
- `82b6cda` — bounded UTF-8-safe output ring, monotonic event-sequence cursors, daemon-owned `TerminalSessionSupervisor`, process-group cleanup, fixed PTY resource ceilings.
- `975d658` — Admin + Owner Runtime service/policy layer, later-Admin visibility, stable PTY errors, content-free audit.
- `da37e55` — six strict `terminal_session_*` MCP tools, output schemas, scoped runtime wiring, shared supervisor ownership, ordered daemon shutdown.
- `cf8a162` — real MCP PTY integration covering TTY interaction, cursoring, resize, lease handoff, audit privacy, and runtime shutdown cleanup.

Public PTY surface is exactly:

```text
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
```

The resulting architecture is:

```text
Admin lease + ownerRuntime.enabled
        |
        v
TerminalSessionService
  - Admin/gate/path visibility policy
  - bounded input / dimensions / cursor validation
  - content-free audit metadata
        |
        v
shared TerminalSessionSupervisor
  - opaque daemon-local session registry
  - bounded UTF-8 output ring + event-sequence cursor
  - later-Admin rediscovery; Project/User hidden
  - SIGTERM -> grace -> SIGKILL shutdown cleanup
        |
        v
lazy NodePtyBackend
  - exact node-pty@1.2.0-beta.15
  - trusted configured login shell
  - real interactive PTY
```

### Phase 2 acceptance evidence before final docs/state commit

- Real PTY backend test: PASS after fresh `npm ci --ignore-scripts`.
- Real MCP integration: TTY + interactive input + resize + cursor no-duplication + Admin lease A → B rediscovery + content-free audit + daemon shutdown cleanup PASS.
- Integration test repeated after initial acceptance: `5/5` PASS.
- Focused MCP/runtime compatibility: Owner shell, authority, HTTP catalog, PTY, and shutdown suites PASS.
- Full `npm run check`: `614/614` tests PASS with `1` environment-gated skip; `105` test files PASS + `1` skipped file.
- `npm audit --omit=dev`: `0` vulnerabilities.
- `swift test --package-path native/macos-computer-runtime`: `164/164` PASS.
- `git diff --check origin/main...HEAD`: PASS at implementation head; docs/state are being committed next, so exact-head gates must be rerun after that commit.

## Current state

Phase 2 production implementation is complete locally. The only current working-tree changes are the planned operator/security/architecture/integration documentation updates plus this handoff refresh. No Phase 3 Computer Runtime ceiling change is present.

Key behavior now implemented:

- PTY exists only for Admin under explicit `--personal-admin --enable-owner-runtime`.
- Sessions are daemon-owned rather than lease-owned: creator lease expiry/revocation does not kill a PTY, and a later active Admin Owner lease can rediscover/manage it.
- Project/User cannot list/discover/read/write/resize/close Owner PTYs.
- MCP sees opaque session IDs only; no OS PID/process-group ID, arbitrary signal, shell executable, caller environment, or detached-mode input is exposed.
- Output is retained only in a bounded UTF-8-safe in-memory ring with monotonic event-sequence cursors; truncation is explicit when the requested cursor predates retained history.
- Input size, session count, output retention, and terminal dimensions are bounded; session wall-clock runtime is not arbitrarily capped while the daemon is alive.
- PTY input/output/session identifiers are excluded from persistent audit metadata.
- Sessions do not survive daemon restart; runtime shutdown terminates every running PTY process group with SIGTERM then SIGKILL after the configured grace period.
- `terminal_run` remains allowlisted `shell=false`; `shell_run` remains unrestricted one-shot Owner shell; PTY is a distinct persistent subsystem.

## Next exact step

1. Commit the four operator docs plus this `PROJECT_STATE.md` handoff as the final local Phase 2 candidate.
2. Because HEAD changes, rerun fresh exact-head verification from zero: `npm run check`, `npm audit --omit=dev`, real PTY integration, Swift `164/164`, `git diff --check origin/main...HEAD`, and clean status.
3. Perform final branch-scope/security review: authority widening, raw PID/signal/shell/env exposure, PTY content/session-ID audit leakage, unbounded memory/session growth, cleanup failure paths, dependency/lockfile scope, and Phase 3 leakage.
4. Write a Project Continuity checkpoint containing only content-free Phase 2 evidence.
5. With the user's current continuation authorization, publish this verified branch and open a Phase 2 PR; verify the exact remote head and hosted Node 22/24 + macOS-native CI.
6. Stop before any `main` merge unless merge authorization is separately explicit.

## Invariants

- PTY is Admin-only and requires the existing explicit Owner Runtime startup gate.
- Project/User cannot discover, read, write, resize, list, or close PTY sessions.
- Existing `terminal_run` stays structured/allowlisted; existing `shell_run` stays unrestricted one-shot; PTY is a distinct persistent surface.
- MCP never exposes raw OS PID/process-group ID, arbitrary signal, child environment, shell executable selection, or detached mode.
- PTY sessions run as the current OS user and do not bypass TCC, sudo, Keychain, SIP, or OS authentication.
- Admin lease expiration/revocation does not kill the session; a later active Admin Owner lease may rediscover/manage it.
- Sessions do not persist across daemon restart and all running PTY process groups are terminated on daemon shutdown.
- PTY output retention, input payloads, session count, and dimensions remain bounded; session runtime itself has no arbitrary wall-clock deadline.
- Raw PTY input/output, session IDs, PIDs, environment values, credentials, and secrets must not enter persistent audit or continuity metadata.
- Local worktree/files are active implementation truth; Git is durable code/history; Project Continuity is semantic handoff memory.
- Preserve unrelated agents/worktrees. No direct `main` mutation, main merge, history rewrite, or deployment without explicit authorization.

## Verification

- Stable main: `0195a432bae370eb36dedf65056c874634f805dc`, clean and synchronized with `origin/main` at the last reconciliation.
- Phase 2 branch baseline before implementation: `588/588` PASS + `1` skip.
- Exact dependency candidate: `node-pty@1.2.0-beta.15`; real Apple Silicon PTY smoke PASS.
- Phase 2 implementation pre-handoff Node/TypeScript: `614/614` PASS + `1` skip.
- Phase 2 real PTY integration: PASS; repeated `5/5` PASS.
- Phase 2 production audit: `0 vulnerabilities`.
- Unchanged Swift Computer Runtime: `164/164` PASS.
- Docs contract tests: `3/3` PASS before final state commit.
- Phase 2 plan placeholder scan: PASS.

## Blockers / uncertainties

- No local Phase 2 design or implementation blocker is known.
- `node-pty@1.2.0-beta.15` is intentionally an exact prerelease pin because stable `1.1.0` has the macOS packaging defect. Repository-level local macOS evidence is green; hosted Node 22/24 Linux and hosted macOS exact-head CI remain mandatory before merge.
- The `project_check` Docker sandbox previously reported the repository npm check as `UNAVAILABLE`; host verification is authoritative for this local native PTY work and is green.
- Screen Recording/Accessibility readiness is outside Phase 2 PTY scope and remains for later integrated Owner Runtime/Computer Runtime acceptance.
