# chatgpt-system — Active Project State

Last updated: 2026-09-12T18:20+03:00
Status: Computer Runtime v2 Slice 5 complete; awaiting the next explicitly scoped capability.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Keep the merged Computer Runtime v2 Slice 5 baseline stable. Do not implicitly extend Slice 5; the next implementation must start from a new explicit goal/plan after reconciling current `main` and Project Continuity.

## Active workspace

- Stable project worktree: `/Users/dogan/chatgpt-system`
- Stable branch: `main`
- Slice 5 implementation PR: `#37` — merged
- Slice 5 merge commit: `b1503e438b3e43b1ae3e0e8de10626fe8bdfb739`
- Project Continuity alias: exact alias `chatgpt-system`, anchored to `/Users/dogan/chatgpt-system`.
- No Slice 5 implementation worktree is authoritative after the merge; old feature worktrees/branches are historical context only and must not override current Git reality.

## Completed

- PRs #28–#35 were inspected/reconciled and merged before the final Slice 5 gate.
- PR #36 was reviewed against the plan/CI and squash-merged as `d48b9b3b319395732334eb226dec459b961f1cff`.
- Task 9 added content-free deterministic target-source audit metadata without persisting target text/coordinates.
- Real-Mac acceptance exposed and fixed a stale recovery-cache bug: explicit `observe` now refreshes the shared recovery state before later semantic mutation. The fix was developed RED → GREEN and covered by native regression tests.
- Slice 5 routing, OCR limitations, acceptance evidence, and performance notes are documented in `docs/CHATGPT_INTEGRATION.md`.
- Exact signed helper acceptance preserved stable TCC identity; Accessibility, Screen Recording, event-listen, and event-post readiness were verified true.
- Fixture acceptance covered AX resolve/click, stale-target refusal with fresh semantic recovery, ambiguity fail-closed behavior, OCR-only resolve/click, screen/AX verification, five semantic local actions in one `computer_run_js`, physical takeover cleanup, and the emergency chord.
- Harmless real-app smoke covered Calculator, Finder, TextEdit, System Settings, and Chrome.
- PR #37 exact head `ae7b2f7ed96dc53d8a7ee7b5ed1d15634441fcda` passed both hosted CI trigger sets (Node 22, Node 24, macOS-native) and was squash-merged as `b1503e438b3e43b1ae3e0e8de10626fe8bdfb739`.
- Root `main` was fast-forwarded to the merge commit and post-merge verification passed.

## Current state

Computer Runtime v2 Slice 5 has no known open implementation, test, security, hosted-CI, or real-Mac acceptance blocker. The merged baseline is on `main` at/after `b1503e438b3e43b1ae3e0e8de10626fe8bdfb739`.

The current task is handoff-only: keep this file and the Project Continuity checkpoint aligned with merged Git reality. No further Computer Runtime feature layer is implied by Slice 5 completion.

## Next exact step

When the user next asks to continue `chatgpt-system`:

1. Run the root `AGENTS.md` continuation boot sequence and `project_resume` for exact alias `chatgpt-system`.
2. Reconcile current `main`/worktrees against the latest checkpoint before editing; do not resurrect old Task 7/8/9 branches from historical context.
3. If the user requests a new capability, inspect the current architecture and create/confirm a new scoped plan before implementation.
4. Preserve the accepted Slice 5 safety invariants below and rerun the relevant fresh verification gates for any later change.

## Invariants

- Every `computer_run_js` call keeps fresh child/Worker isolation. Reuse is limited to compatible daemon/native connections and content-free safe process-local metadata/cache.
- Explicit fresh observation refreshes the shared recovery cache before later semantic mutation.
- Semantic targets/window generation/display topology are revalidated before physical mutation; stale, ambiguous, unsafe, permission, takeover, and exhausted-recovery states fail closed.
- `exists()` returns `false` only for target-not-found; other stable errors propagate.
- Timeout/cancellation/takeover prevents later physical action and releases held input.
- OCR fallback captures the focused display; repeated identical visible text may intentionally end in `COMPUTER_NEEDS_REPLAN` rather than guessed coordinates.
- Never persist screenshots, OCR/AX document text, typed sensitive content, credentials, secrets, lease IDs, or raw native pointers in continuity/audit metadata.
- Preserve other agents' dirty/untracked work.
- No direct `main` mutation, main merge, history rewrite, or production deployment without explicit user authorization.
- Fresh verification evidence is required before completion/PASS claims for later changes.

## Verification

Final Slice 5 evidence:

- PR #37 hosted CI on exact feature head `ae7b2f7ed96dc53d8a7ee7b5ed1d15634441fcda`: both Node 22 jobs PASS, both Node 24 jobs PASS, both macOS-native jobs PASS.
- PR #37: MERGED as `b1503e438b3e43b1ae3e0e8de10626fe8bdfb739`.
- Post-merge `swift test --package-path native/macos-computer-runtime`: `164/164` passed.
- Post-merge `npm run check`: `560/560` passed with `1` environment-gated skip.
- Post-merge `npm audit --omit=dev`: `0` vulnerabilities.
- Root `main` was clean and synchronized with `origin/main` at the Slice 5 merge milestone.

## Blockers / uncertainties

- No Slice 5 blocker is known.
- The next product/capability goal has not been selected. Do not infer one from the completed Slice 5 plan; obtain or establish a new scoped goal before implementation.
