# chatgpt-system — Active Project State

Last updated: 2026-09-12T18:47+03:00
Status: Owner Runtime design approved; Phase 1 full-host shell implementation planned.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Add an explicitly enabled Admin-only **Owner Runtime** so ChatGPT Web can perform Codex-class local development on the Mac while `Project` and `User` authority remain narrow. The first implementation phase is unrestricted one-shot `shell_run`; interactive PTY, Computer Runtime ceiling removal, and full integration acceptance remain separate later phases.

## Active workspace

- Stable project root / continuity anchor: `/Users/dogan/chatgpt-system` on `main`.
- Stable merged baseline: `main@a5923a5bbae8743abc1cd5ca39cdb73926787270`.
- Active isolated managed worktree: `/Users/dogan/.chatgpt-system/worktrees/d0a0a546782faa2c9a9906345e9290c84508aad64b304746b50965bb2ff58ef1/d9a07fdd-6900-4143-9dda-d4ce640a571f`.
- Active branch: `design/owner-runtime-full-host`.
- Approved design: `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md` at commit `cb20690`.
- Phase 1 plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase1-shell.md`.
- Project Continuity exact alias: `chatgpt-system`, still anchored to the stable root worktree rather than the feature worktree.

## Completed

- Computer Runtime v2 Slice 5 remains completed and merged; its accepted safety/cleanup invariants remain baseline requirements.
- The user explicitly approved the Owner Runtime direction: full-host capability belongs to locally approved Admin/Owner sessions; `Project` and `User` keep their current limits.
- Repository architecture was inspected before design. Existing Admin already has `/` filesystem scope; existing `terminal_run` is deliberately `shell=false` + allowlisted; existing process/computer runtimes already provide useful lifecycle/cancellation patterns.
- Owner Runtime design was written, self-reviewed, and committed as `cb20690` (`docs: design owner runtime full-host development`).
- The design keeps the existing `admin` authority profile and adds a separate startup capability instead of creating a fourth authority profile.
- The design keeps `terminal_run` backward-compatible and adds distinct unrestricted `shell_run` plus later persistent PTY tools.
- A Phase 1 implementation plan was decomposed from the larger design so unrestricted shell can land and be reviewed independently from PTY and Computer Runtime ceiling changes.
- Phase 1 planning explicitly uses one shared `OwnerShellSupervisor` so timeout, MCP cancellation, and daemon shutdown can terminate every owned process group; the scoped service handles authority/path/audit policy.

## Current state

No Owner Runtime production code has been implemented yet. The active branch contains the approved design and the Phase 1 implementation plan/handoff only.

Phase 1 is intentionally limited to:

```text
Admin + explicit Owner Runtime gate
  -> shell_run
  -> trusted configured login shell
  -> arbitrary shell syntax / installed local toolchain
  -> bounded retained output
  -> process-group timeout/cancel/shutdown cleanup
```

Interactive PTY is Phase 2. Removal of arbitrary Owner Computer Runtime action/wall-clock ceilings is Phase 3. Codex-class end-to-end development acceptance and final Computer Runtime acceptance/freeze are later gates.

## Next exact step

1. Choose the Phase 1 execution workflow (subagent-driven is preferred; inline execution is also valid).
2. Execute `docs/superpowers/plans/2026-09-12-owner-runtime-phase1-shell.md` task-by-task with RED → GREEN TDD and frequent commits.
3. Keep the implementation isolated from `main`; do not widen `Project`/`User`, weaken `terminal_run`, or mix PTY work into the Phase 1 PR.
4. Run exact-head local verification, publish a reviewable feature PR, wait Node 22/24 and macOS-native CI, then stop at the explicit main-merge authorization gate.
5. After a verified Phase 1 merge, write the separate Phase 2 interactive-PTY plan from the approved design.

## Invariants

- Full-host shell/PTY capability is Admin-only and requires explicit Owner Runtime startup enablement.
- `Project` and `User` retain current host-execution restrictions.
- Existing `terminal_run` remains structured, allowlisted, and `shell=false`; unrestricted shell is a distinct tool.
- Owner Runtime executes as the current macOS user; it does not bypass TCC, sudo, Keychain, SIP, or OS authentication.
- Daemon/tunnel/authority secrets are not automatically forwarded to full-host child environments.
- Raw shell script, stdout/stderr, PTY content, typed computer text, screenshot/OCR/AX content, credentials, secrets, lease IDs, or raw OS PIDs must not enter persistent audit/continuity metadata.
- Long Owner Runtime work may be unbounded in wall-clock/action count, but retained memory/protocol payloads remain bounded and every owned execution must remain cancellable/stoppable.
- Computer user takeover, the fixed emergency chord, held-input cleanup, bounded automatic recovery, and fail-closed semantic targeting remain authoritative.
- Local worktree/files are active implementation truth; Git is durable code/history; Project Continuity is semantic handoff memory.
- Preserve unrelated agents/worktrees. No direct `main` mutation, main merge, history rewrite, or deployment without explicit user authorization.

## Verification

Planning baseline/evidence:

- Stable root `main`: clean and synchronized at `a5923a5bbae8743abc1cd5ca39cdb73926787270` before the Owner Runtime branch was created.
- Isolated Owner Runtime worktree baseline `npm run check`: `560/560` tests passed with `1` environment-gated skip.
- Design spec placeholder/scope/consistency review: PASS.
- Design commit: `cb20690`; worktree was clean immediately after that commit.
- Phase 1 plan self-review covers spec scope, exact file responsibilities, TDD steps, process-group shutdown ownership, cancellation, output retention, audit redaction, setup/docs, exact-head verification, PR/CI, and continuity handoff.

## Blockers / uncertainties

- No Phase 1 design blocker is known.
- PTY dependency choice is intentionally deferred to the separate Phase 2 plan; `node-pty` remains the leading candidate but is not part of Phase 1.
- Final Screen Recording/Accessibility readiness must be rechecked during later real-Mac acceptance; Slice 5 last verified the stable signed helper with all required permissions ready.
