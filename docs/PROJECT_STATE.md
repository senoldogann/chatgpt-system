# chatgpt-system — Active Project State

Last updated: 2026-09-12T20:00+03:00
Status: Owner Runtime Phase 1 merged and verified; Phase 2 interactive PTY is planned in an isolated branch and awaiting implementation authorization.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Continue the approved Owner Runtime / Full-Host Development design with **Phase 2 — persistent interactive PTY**. Phase 1 unrestricted `shell_run` is now part of `main`. Phase 2 must add daemon-owned interactive terminal sessions without widening Project/User authority or mixing in Phase 3 Computer Runtime ceiling work.

## Active workspace

- Stable project root / continuity anchor: `/Users/dogan/chatgpt-system` on `main`.
- Stable merged baseline: `main@0195a432bae370eb36dedf65056c874634f805dc`.
- Phase 1 PR: `#39`, merged by squash after explicit authorization.
- Active Phase 2 managed worktree: `/Users/dogan/.chatgpt-system/worktrees/d0a0a546782faa2c9a9906345e9290c84508aad64b304746b50965bb2ff58ef1/1f372958-250d-456a-be9f-9ce8ddafc944`.
- Active Phase 2 branch: `feat/owner-runtime-phase2-pty`.
- Approved design: `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`.
- Phase 1 plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase1-shell.md`.
- Phase 2 plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase2-pty.md`.
- Project Continuity exact alias: `chatgpt-system`; continuity remains anchored to the stable root worktree.

## Completed

### Phase 1 merge

- PR #39 exact head `6776214b9a8e15cbe23a75172c22fa54f3cab772` passed hosted Node 22, Node 24, and macOS-native CI with `mergeStateStatus=CLEAN`.
- PR #39 was squash-merged as `0195a432bae370eb36dedf65056c874634f805dc`.
- Stable root `main` was fast-forwarded to the merge commit and matches `origin/main`.
- Fresh merged-root verification passed:
  - `npm run check`: `588/588` tests PASS with `1` environment-gated skip;
  - `npm audit --omit=dev`: `0` vulnerabilities;
  - `swift test --package-path native/macos-computer-runtime`: `164/164` PASS;
  - root worktree clean.

### Phase 2 planning

- A new managed worktree/branch was created directly from merged `main@0195a432`.
- Clean Phase 2 branch baseline `npm run check`: `588/588` PASS with `1` environment-gated skip.
- The approved Owner Runtime design was re-read before planning; PTY remains a separate additive subsystem under the existing Admin + Owner Runtime gate.
- Dependency research rejected blindly using stable `node-pty@1.1.0` because its macOS npm artifact has a known `spawn-helper` executable-bit packaging defect.
- Exact `node-pty@1.2.0-beta.15` was validated in a fresh temporary npm project on this Apple Silicon Mac with Node `v26.7.0`.
- Real PTY smoke evidence for `1.2.0-beta.15`:
  - install succeeded;
  - child observed a real TTY (`TTY:yes`);
  - interactive write/read returned `hello`;
  - resize changed terminal dimensions to `100x30`;
  - child exited with code `0`.
- The Phase 2 implementation plan is written and self-reviewed with no placeholder terms.

## Current state

No Phase 2 production code or dependency change has been made yet. The active branch contains planning/handoff changes only.

The planned PTY architecture is:

```text
Admin lease + ownerRuntime.enabled
        |
        v
TerminalSessionService
  - Admin/gate/path/visibility policy
  - bounded input validation
  - content-free audit metadata
        |
        v
shared TerminalSessionSupervisor
  - opaque session registry
  - bounded output ring + monotonic sequence cursor
  - session lifetime independent of creator lease
  - SIGTERM -> grace -> SIGKILL process-group cleanup
        |
        v
lazy NodePtyBackend
  - exact node-pty@1.2.0-beta.15
  - trusted configured login shell
  - real interactive PTY
```

Initial MCP surface remains exactly:

```text
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
```

## Next exact step

1. Obtain explicit authorization to begin Phase 2 implementation; the prior user authorization covered the Phase 1 merge, post-merge verification, and moving into the Phase 2 plan.
2. Execute `docs/superpowers/plans/2026-09-12-owner-runtime-phase2-pty.md` task-by-task with RED → GREEN TDD and frequent commits.
3. Keep the implementation isolated from `main` and keep Phase 3 Computer Runtime action/runtime changes out of this branch.
4. After implementation, run focused real PTY acceptance repeatedly, then fresh exact-head `npm run check`, production audit, Swift native tests, diff check, and clean-status verification.
5. Stop before branch push/PR creation unless separately authorized; after publication, require exact-head Node 22/24 + macOS-native CI and stop again before any `main` merge unless merge authorization is explicit.

## Invariants

- PTY is Admin-only and requires the existing explicit Owner Runtime startup gate.
- Project/User cannot discover, read, write, resize, list, or close PTY sessions.
- Existing `terminal_run` stays structured/allowlisted; existing `shell_run` stays unrestricted one-shot; PTY is a distinct persistent surface.
- MCP never exposes raw OS PID/process-group ID, arbitrary signal, child environment, shell executable selection, or detached mode.
- PTY sessions run as the current OS user and do not bypass TCC, sudo, Keychain, SIP, or OS authentication.
- Creating Admin lease expiration/revocation does not kill the session; a later active Admin Owner lease may rediscover/manage it.
- Sessions do not persist across daemon restart and all running PTY process groups are terminated on daemon shutdown.
- PTY output retention, input payloads, and session count remain bounded; session runtime itself has no arbitrary wall-clock deadline.
- Raw PTY input/output, session IDs, PIDs, environment values, credentials, and secrets must not enter persistent audit or continuity metadata.
- Local worktree/files are active implementation truth; Git is durable code/history; Project Continuity is semantic handoff memory.
- Preserve unrelated agents/worktrees. No direct `main` mutation, branch push, PR creation, main merge, history rewrite, or deployment without the corresponding explicit user authorization.

## Verification

- Phase 1 merged main: `0195a432bae370eb36dedf65056c874634f805dc`, clean and synchronized with `origin/main`.
- Post-merge Node/TypeScript: `588/588` PASS + `1` skip.
- Post-merge production audit: `0 vulnerabilities`.
- Post-merge Swift: `164/164` PASS.
- Phase 2 isolated branch baseline: `588/588` PASS + `1` skip.
- Temporary `node-pty@1.2.0-beta.15` macOS/arm64/Node 26 smoke: real TTY + write/read + resize + clean exit PASS.
- Phase 2 plan placeholder scan: PASS.

## Blockers / uncertainties

- No Phase 2 design blocker is known.
- `node-pty@1.2.0-beta.15` is intentionally an exact prerelease pin because current stable `1.1.0` has the macOS packaging defect; Node 22/24 Linux and hosted macOS compatibility must still be proven by Phase 2 CI before merge.
- The `project_check` Docker sandbox currently reports the repository npm check as `UNAVAILABLE`; host verification is green and Phase 2 does not depend on that sandbox path.
- Screen Recording/Accessibility readiness is outside Phase 2 PTY scope and remains for later integrated Owner Runtime/Computer Runtime acceptance.
