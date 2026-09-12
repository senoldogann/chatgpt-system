# chatgpt-system — Active Project State

Last updated: 2026-09-12T15:20+03:00
Status: active

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Complete Computer Runtime v2 Slice 5 safely: finish the semantic `computer_run_js` fast path, close verified security/correctness findings, complete deterministic fixture/integration coverage, then finish audit, exact-head verification, real-Mac acceptance, PR review, and merge gates.

## Active workspace

Primary implementation currently belongs to another active agent:

- Branch: `feat/computer-runtime-v2-slice5-js-fast-path`
- Worktree: `/private/tmp/chatgpt-system-computer-runtime-v2-slice5-task7`
- Base/HEAD observed at handoff: `755454bf5e07dceef05d76add9e746c56b7d9e4f`
- State observed at handoff: dirty; do not modify, reset, clean, revert, or delete files there unless that agent has handed ownership over.

Independent continuity-protocol work uses a separate worktree/branch and must not interfere with the active implementation worktree.

## Completed

- Computer Runtime v2 Slices 1–4 were merged through PRs #23–#26.
- Combined harness/continuity/Existing-Chrome/Slice 5 Task 1–6 integration merged through PR #27.
- Project Continuity exact alias `chatgpt-system` is registered against the stable main worktree; initial semantic recordVersion: `1`.
- `main` at the start of this handoff: `755454bf5e07dceef05d76add9e746c56b7d9e4f`.
- Merge-post verification previously recorded: Node/TypeScript `530` tests passed with `1` env-gated skip; native Swift `154/154` passed.
- Slice 5 design/plan exists at:
  - `docs/superpowers/specs/2026-09-12-computer-runtime-v2-slice5-recovery-vision-design.md`
  - `docs/superpowers/plans/2026-09-12-computer-runtime-v2-slice5-recovery-vision.md`

## Current state

Task 7 is in active development by another agent. At the latest read-only check, the worktree had modifications in JS protocol/RPC/runner/runtime files and focused tests. The active agent reported that it was continuing from the Task 7 RED state, strengthening session-reuse and timeout/cancellation safety tests, then planned to close verified security/correctness findings before Tasks 8–9.

Do not assume those uncommitted files or test outcomes remain unchanged. Re-read that worktree and its latest checkpoint when ownership changes or a new chat resumes the project.

## Next exact step

For the agent that currently owns `feat/computer-runtime-v2-slice5-js-fast-path`:

1. Continue the existing Task 7 RED → minimal GREEN cycle without weakening fresh child/Worker isolation.
2. Prove timeout/cancellation cannot permit delayed physical actions after the parent run is terminal.
3. Run focused Task 7 JS suites and build; commit only after GREEN.
4. Close the already reproduced security/correctness findings one by one with evidence → RED test → minimal fix → focused/full verification → separate commits.
5. Continue Slice 5 Task 8 fixture/integration and Task 9 audit/performance/exact-head/real-Mac acceptance.
6. Open a PR only after fresh full gates; do not merge until CI and review findings are GREEN/closed.

For any different/new agent: first run the continuation boot sequence in root `AGENTS.md`. If the active worktree is still owned/dirty, do not take it over; either wait for handoff or use a separate worktree for independent work.

## Invariants

- Every `computer_run_js` call keeps fresh child/Worker isolation. Reuse is limited to compatible daemon/native connections and content-free safe process-local metadata/cache.
- Semantic targets/window generation/display topology are revalidated before physical mutation.
- `exists()` returns `false` only for target-not-found; ambiguity, stale state, permission loss, takeover, and other stable errors propagate.
- Timeout/cancellation/takeover must prevent later physical action and must release held input.
- Never persist screenshots, OCR/AX document text, typed sensitive content, credentials, secrets, lease IDs, or raw native pointers in continuity/audit metadata.
- Preserve other agents' dirty/untracked work.
- No direct `main` mutation, push/merge, history rewrite, or production deployment without explicit user authorization.
- Fresh verification evidence is required before completion/PASS claims.

## Verification

Latest known merged-main evidence before this continuity-protocol change:

- `npm run check`: 530 passed, 1 env-gated skip.
- `swift test --package-path native/macos-computer-runtime`: 154/154 passed.
- PR #27 merged successfully.

Fresh continuity-protocol branch evidence:

- Continuation docs contract: `2/2` passed.
- An initial full-suite run under concurrent heavy local workloads timed out in unrelated existing Git/continuity tests; the same four suites were rerun serially after contention ended and passed `23/23`.
- Fresh `npm run check` after contention ended: `532` passed, `1` env-gated skip; exit code `0`.
- `git diff --cached --check`: PASS before the final state refresh; rerun required before commit.

This evidence does not replace fresh verification after later implementation commits.

## Blockers / uncertainties

- Another agent is actively modifying the Task 7 worktree; its current uncommitted state must be preserved.
- The exact results of that agent's newest focused tests/security fixes are not yet committed into this handoff and must be re-read from Git/checkpoint when resuming.
- The active Task 7 agent may advance after this snapshot; resume must always reconcile against current Git and the latest `chatgpt-system` checkpoint.
