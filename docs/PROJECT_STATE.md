# chatgpt-system — Active Project State

Last updated: 2026-09-12T19:33+03:00
Status: Owner Runtime Phase 1 implemented and locally verified; remote PR/CI publication gate remains.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Deliver Owner Runtime / Full-Host Development in reviewable phases so a locally approved Admin ChatGPT session can perform Codex-class local development while `Project` and `User` authority remain narrow. Phase 1 is the unrestricted one-shot `shell_run` surface; PTY, Computer Runtime productivity-ceiling removal, and final end-to-end acceptance remain separate later phases.

## Active workspace

- Stable project root / continuity anchor: `/Users/dogan/chatgpt-system` on `main`.
- Stable merged baseline: `main@a5923a5bbae8743abc1cd5ca39cdb73926787270`.
- Active isolated managed worktree: `/Users/dogan/.chatgpt-system/worktrees/d0a0a546782faa2c9a9906345e9290c84508aad64b304746b50965bb2ff58ef1/d9a07fdd-6900-4143-9dda-d4ce640a571f`.
- Active branch: `design/owner-runtime-full-host`.
- Approved design: `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`.
- Phase 1 plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase1-shell.md`.
- Latest implementation head before this state refresh: `452d147` (`fix: surface owner shell signaling failures`).
- Project Continuity exact alias: `chatgpt-system`, intentionally anchored to the stable root worktree rather than this feature worktree.

## Completed

- `cb20690` — Owner Runtime full-host development design.
- `3bc3c3a` — detailed Phase 1 shell plan and planning handoff.
- `5a1b203` — explicit Owner Runtime startup gate/config/CLI/categorical capability reporting.
- `3a2eda9` — shared `OwnerShellSupervisor`, authority-scoped `OwnerShellService`, bounded output tails, timeout/abort/shutdown process-group cleanup, stable errors, and runtime shutdown ownership.
- `ccdc1c1` — strict `shell_run` MCP surface, output schema, AbortSignal propagation, Project/User denial, Owner gate enforcement, and content-free shell audit contract.
- `6d0b66c` — ChatGPT tunnel setup propagation plus README/security/architecture/integration documentation.
- `12ba094` — acceptance regression proving Admin can execute outside the bootstrap root while an omitted shell timeout remains independent of the legacy structured-terminal timeout.
- `452d147` — final-review lifecycle fix: process-group signal-management failures are surfaced as stable `SHELL_FAILED` instead of producing an unhandled rejection; active child ownership remains tracked until close and failed termination attempts can be retried during shutdown.

Phase 1 behavior now implemented:

```text
Admin + Personal Admin + explicit Owner Runtime gate
  -> shell_run
  -> trusted configured login shell
  -> arbitrary shell syntax / executable paths / installed toolchains / host network
  -> authority-scoped cwd as the current OS user
  -> bounded retained stdout/stderr tails
  -> optional finite timeout or no default wall-clock deadline
  -> MCP abort / daemon-shutdown process-group cleanup
```

`terminal_run` remains a separate structured `shell=false` + executable-allowlist surface. `Project` and `User` still cannot use host shell execution. No persistent PTY was added in Phase 1.

## Current state

Phase 1 implementation is complete in the isolated feature worktree and has no known local code/test/audit blocker. The final branch-scope review found one lifecycle-management defect in the timeout/abort signaling error path; it was reproduced with a RED regression, fixed in `452d147`, and reverified. The user has now explicitly authorized the next remote step: branch push, Phase 1 PR creation, and hosted CI verification. `main` merge remains a separate authorization gate.

## Verification

Fresh Phase 1 evidence before this state-file commit:

- Task 1 focused config/CLI/environment suite: `29/29` PASS; TypeScript build PASS.
- Task 2 shell lifecycle/process compatibility suite: `25/25` PASS; TypeScript build PASS.
- Task 3 MCP/audit/catalog suite: `10/10` PASS; TypeScript build PASS.
- Task 4 setup/docs compatibility suite: `56/56` PASS.
- Focused Phase 1 acceptance suite: `64/64` PASS.
- Acceptance covers Project/User denial, disabled-Admin `OWNER_RUNTIME_DISABLED`, arbitrary shell syntax and non-allowlisted executable paths, unchanged `terminal_run` allowlist behavior, Admin cwd outside the bootstrap root, daemon-secret canary isolation, bounded output without output-volume termination, no inherited legacy command timeout, explicit timeout, MCP abort, daemon shutdown, process-group cleanup, and content-free audit metadata.
- Pre-state-commit `npm run check`: `97` test files PASS + `1` skipped; `587/587` tests PASS + `1` environment-gated skip.
- Pre-state-commit `npm audit --omit=dev`: `0` vulnerabilities.
- Pre-state-commit `git diff --check origin/main...HEAD`: PASS.
- Pre-state-commit worktree: clean.
- Final branch review found a real `terminate()` signaling-failure bug: non-`ESRCH` process-group signal errors could resolve the shell request later while also causing an unhandled rejected promise. RED regression reproduced both symptoms.
- `452d147` fixes the lifecycle path by surfacing stable `SHELL_FAILED`, keeping active ownership until child close, and allowing later shutdown retry after a failed termination attempt.
- Post-fix Owner shell/process/shutdown compatibility suite: `31/31` PASS; TypeScript build PASS.
- Static scope review: no `package.json`/lockfile change, no Project/User shell widening, no `terminal_run` semantic widening, no caller-controlled shell executable/environment/PID/signal surface, and audit metadata remains content-free.

Because this state-file commit changes HEAD, exact-head completion evidence must be rerun after committing this file; do not reuse the pre-state-commit full gate as final exact-head proof.

## Next exact step

1. Commit this `docs/PROJECT_STATE.md` handoff refresh.
2. Rerun exact-head `npm run check`, `npm audit --omit=dev`, `git diff --check origin/main...HEAD`, and clean-status verification on the resulting head.
3. Update Project Continuity with the final local exact-head evidence.
4. Push `design/owner-runtime-full-host`, open the Phase 1 PR, wait for exact-head Node 22/24 and macOS-native CI, then verify server-side diff scope, head SHA, and mergeability.
5. Stop before merging to `main`; merge remains a separate explicit authorization gate.
6. After a verified Phase 1 merge, write the separate Phase 2 interactive-PTY implementation plan from the approved design.

## Invariants

- Full-host Owner Runtime is Admin-only and separately opt-in; `Project` and `User` retain current host-execution restrictions.
- Existing `terminal_run` stays structured, allowlisted, timeout/output bounded, and `shell=false`; unrestricted shell is the distinct `shell_run` tool.
- The MCP caller cannot choose the trusted shell executable, child environment, raw OS PID, process-group ID, arbitrary signal, or detached mode.
- Owner Runtime executes as the current macOS user; it does not bypass TCC, sudo, Keychain, SIP, or OS authentication.
- Daemon/tunnel/authority secrets are not automatically forwarded to Owner shell children.
- Raw shell script, stdout/stderr, environment values, typed computer text, screenshot/OCR/AX content, credentials, secrets, lease IDs, and raw native/OS identifiers must not enter persistent audit/continuity metadata.
- Long Owner Runtime work may omit a product wall-clock deadline, but retained memory/protocol/output payloads remain bounded and every owned execution remains stoppable through cancellation/shutdown.
- Computer Runtime user takeover, emergency stop, held-input cleanup, bounded automatic recovery, and fail-closed semantic targeting remain authoritative and unchanged by Phase 1.
- Local worktree/files are active implementation truth; Git is durable code/history; Project Continuity is semantic handoff memory.
- Preserve unrelated agents/worktrees. Branch push/PR creation is authorized for this Phase 1 head; direct `main` mutation, main merge, history rewrite, or deployment still require separate explicit user authorization.

## Blockers / uncertainties

- No known Phase 1 code, test, audit, or local-verification blocker remains before the final exact-head rerun.
- Hosted Node 22/24 and macOS-native CI have not run for this unpublished feature head yet.
- Persistent interactive PTY is intentionally deferred to Phase 2; dependency choice remains to be validated there.
- Screen Recording/Accessibility readiness is outside Phase 1 shell scope and will be rechecked during later Owner Runtime/Computer Runtime real-Mac acceptance.
