# chatgpt-system — Active Project State

Last updated: 2026-09-12T18:05+03:00
Status: active

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Finish Computer Runtime v2 Slice 5 safely by shepherding Task 9 / PR #37 through its final review and merge gate. Do not merge `main` without explicit user authorization.

## Active workspace

- Branch: `feat/computer-runtime-v2-slice5-task9`
- Worktree: `/private/tmp/chatgpt-system-slice5-task9`
- Remote PR: `#37` — `https://github.com/senoldogann/chatgpt-system/pull/37`
- Remote base: `main` at `d48b9b3b319395732334eb226dec459b961f1cff` (PR #36 squash merge)
- Pre-handoff verified feature head before this state-file refresh: `9b4676c8ce0ad1cff7eb8c83f9f3ef7a2e55f5cf`
- The exact feature HEAD will advance when this handoff file is committed; always read Git rather than treating the value above as current.
- Project Continuity alias `chatgpt-system` remains anchored to the stable root worktree `/Users/dogan/chatgpt-system`.

The root worktree is intentionally not being used for Task 9 implementation. Its local `main` may lag verified remote `main`; reconcile Git before any later main update.

## Completed

- PRs #28–#35 were inspected/reconciled and were already merged.
- PR #36 was reviewed against the Slice 5 plan and CI, then squash-merged as `d48b9b3b319395732334eb226dec459b961f1cff` under the user's explicit authorization.
- Task 9 content-free target-source audit metadata is committed (`bbe6934c93b2476ab9f15186946eb928ebc0b38a`).
- Real-Mac acceptance exposed a stale recovery-cache bug: protocol `observe` returned a fresh Accessibility snapshot without refreshing the shared recovery state, so a later semantic mutation could use old geometry.
- The bug was fixed with RED → GREEN TDD in `ce728478ddcc20e96ccce6c305a57e5e718d1aad` (`fix: refresh recovery state on observe`).
- Slice 5 routing, limitations, acceptance evidence, and performance notes were documented in `0fe6c11e5b25a2954664e38c65eca917961981ad`.
- The feature branch was merged with current `origin/main` to remove already-merged Task 8 files from the PR diff; the resulting PR #37 server-side scope is Task 9 only.
- Exact signed helper installation preserved the stable signing/designated requirement and reported `tccIdentityStable: true`; Accessibility, Screen Recording, event-listen, and event-post readiness were all verified true.
- Deterministic fixture acceptance passed: AX resolve/click, intentional stale rejection with no old-geometry actuation plus fresh semantic recovery, duplicate-target fail-closed behavior, OCR-only resolve/click, screen/AX effect verification, 5 semantic local actions in one `computer_run_js`, physical takeover interruption/input release, and the emergency chord.
- Harmless real-app smoke covered Calculator, Finder, TextEdit, System Settings, and Chrome. One System Settings `openApp` call transiently returned unavailable although the app became frontmost; immediate `active_window` + fresh observation succeeded.
- Connection reuse was verified across separate ordinary `computer_run_js` calls using the same daemon-owned native helper process.

## Current state

PR #37 is OPEN and GitHub reports `mergeStateStatus=CLEAN`. Its server-side diff contains only Task 9 files. The latest hosted CI run for the verified head passed Node 22, Node 24, and macOS-native jobs; duplicate push/PR-triggered CI sets were also green.

No known code, test, security, or real-Mac acceptance blocker remains. The remaining merge gate is explicit user authorization to merge PR #37 into `main`.

## Next exact step

1. Commit this `PROJECT_STATE.md` refresh on `feat/computer-runtime-v2-slice5-task9` without mixing unrelated files.
2. Because the branch HEAD changes, rerun the full exact-head gate: native Swift suite, `npm run check`, `npm audit --omit=dev`, `git diff --check origin/main...HEAD`, and clean status.
3. Push the updated branch and wait for the new PR #37 hosted CI to finish; verify server-side diff scope and `mergeStateStatus` again.
4. If all gates remain green, stop before merging and obtain explicit user authorization for PR #37 → `main`.
5. After an authorized merge, update/fast-forward the root main worktree safely, run post-merge verification, and checkpoint continuity to the next planned capability.

## Invariants

- Every `computer_run_js` call keeps fresh child/Worker isolation. Reuse is limited to compatible daemon/native connections and content-free safe process-local metadata/cache.
- Explicit fresh observation must refresh the shared recovery cache before later semantic mutation.
- Semantic targets/window generation/display topology are revalidated before physical mutation; stale, ambiguous, unsafe, permission, takeover, and exhausted-recovery paths fail closed.
- `exists()` returns `false` only for target-not-found; other stable errors propagate.
- Timeout/cancellation/takeover must prevent later physical action and release held input.
- OCR fallback currently captures the focused display, so repeated identical visible text can intentionally end in `COMPUTER_NEEDS_REPLAN` rather than guessing.
- Never persist screenshots, OCR/AX document text, typed sensitive content, credentials, secrets, lease IDs, or raw native pointers in continuity/audit metadata.
- Preserve other agents' dirty/untracked work.
- No direct `main` mutation, main merge, history rewrite, or production deployment without explicit user authorization.
- Fresh verification evidence is required before completion/PASS claims.

## Verification

Fresh verification on feature head `9b4676c8ce0ad1cff7eb8c83f9f3ef7a2e55f5cf` before this state-file refresh:

- `swift test --package-path native/macos-computer-runtime`: `164/164` passed.
- `npm run check`: `560/560` passed with `1` environment-gated skip.
- `npm audit --omit=dev`: `0` vulnerabilities.
- `git diff --check origin/main...HEAD`: PASS.
- Worktree: clean.
- PR #37 hosted CI: Node 22 PASS, Node 24 PASS, macOS-native PASS for both triggered CI sets.
- PR #37: OPEN, server-side Task 9-only diff, `mergeStateStatus=CLEAN`.

This evidence must be rerun after committing this file because the exact HEAD changes.

## Blockers / uncertainties

- No implementation blocker is currently known.
- PR #37 must not be merged until the user explicitly authorizes that merge.
- The root `/Users/dogan/chatgpt-system` local `main` may lag remote `main`; re-read status/HEAD before any post-merge synchronization.
