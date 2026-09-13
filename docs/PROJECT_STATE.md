# chatgpt-system — Active Project State

Last updated: 2026-09-14T02:00+03:00
Status: **Computer Use perception reliability spec is approved and the TDD implementation plan is written; implementation has not started.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile Git/worktree reality first, then continue from the exact next step below.

## Current goal

Fix the real execution/perception failure exposed by ChatGPT Web product acceptance after Computer-Use-first routing was already corrected.

The problem is no longer tool routing: explicit Computer Use correctly reaches real `Google Chrome.app` / `computer_*`. The current failure is that normal running Chrome may expose only browser chrome through macOS AX (`AXWebArea=0`), so page controls are not semantically visible and the agent falls into slow screenshot-coordinate guessing. The public key contract is also looser than native `KeyMapping`, which caused observed protocol-invalid `Enter` calls.

## Active workspace

- Authoritative checkout / Continuity worktree: `/Users/dogan/Desktop/chatgpt-system`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Design branch: `design/computer-use-perception-reliability`.
- Design base: `d5a24e469ad0fa948dfdbb52e16c4609e0c017da`.
- Approved design spec: `docs/superpowers/specs/2026-09-14-computer-use-perception-reliability-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-09-14-computer-use-perception-reliability.md`.
- `origin/feat/computer-use-bridge` remains intentionally retained at `aca2507210c356fd6d2bc89bb86a1f1dc01719c0`; do not delete or rewrite it without separate classification.

## Current state

The architecture decisions and writing-plans phase are complete. No runtime/production implementation has started yet.

Approved design decisions:

1. Never silently restart an already-running normal Chrome just to enable renderer accessibility.
2. If Computer Runtime starts stopped `com.google.Chrome`, launch the real installed app with `--force-renderer-accessibility=complete`, using the normal default profile/session and no temporary automation profile.
3. If AX is weak or Chrome web content is unavailable, `computer_observe` automatically adds bounded structured OCR.
4. Automatic OCR is focused-window-only; no silent full-screen OCR broadening.
5. OCR bounds: max 64 candidates, max 512 chars/candidate, max 8192 aggregate chars, confidence <0.5 filtered when confidence is present; fast pass first, one accurate pass only if fast yields no acceptable candidates.
6. MCP key contract becomes canonical and bounded with explicit aliases such as `enter -> return`, `esc -> escape`, `backspace -> delete`, arrow aliases, and case normalization for letters/F-keys.
7. Recovery ladder is AX -> fresh AX -> focused-window OCR -> fresh screenshot/model replan -> one explicit verified visual point -> `COMPUTER_NEEDS_REPLAN`.
8. The runtime never invents coordinates or automatically retries failed point guesses.
9. TCC, user takeover, CAPTCHA/anti-bot, input safety, and Browser-vs-Computer boundaries remain unchanged.

The implementation plan decomposes the work into eight TDD tasks: perception model/classification, focused-window OCR, stopped-Chrome launch policy, canonical key normalization, bounded point recovery, MCP perception metadata/privacy, deterministic fixture regressions, and real-Mac/publication acceptance.

## Root-cause evidence

- Failed product acceptance was stopped rather than forced through after simple `Settings -> Plugins/custom app -> Refresh` navigation became excessively slow.
- Screenshots were readable; image quality was not the main blocker.
- Direct live Chrome AX traversal: `71` nodes, max depth `9`, `AXWebArea=0`.
- Runtime bounds are `maxElements=500`, `maxDepth=12`; missing page semantics are therefore not caused by traversal truncation.
- Isolated real `Google Chrome.app` launched with `--force-renderer-accessibility=complete` on real HTML exposed `AXWebArea=1` plus semantic web roles.
- `computer_press_key` public schema currently accepts arbitrary strings while native `KeyMapping` accepts a fixed lowercase vocabulary; acceptance produced `COMPUTER_PROTOCOL_INVALID` for `Enter`.
- Audit showed one correct `COMPUTER_USER_TAKEOVER` event; takeover behavior must remain unchanged.
- Existing `ComputerRecoveryEngine` already has Vision OCR and deterministic bounds conversion, but ordinary `computer_observe` does not surface structured OCR candidates.

## Verification

- Root cause was reproduced and measured directly on the real Mac.
- AX traversal-limit hypothesis was disproved.
- Renderer-accessibility feasibility was proved with an isolated real Google Chrome instance; no Chrome for Testing was used.
- Existing native recovery/OCR implementation boundaries were inspected and reused in the design instead of inventing a second perception subsystem.
- Design self-review found no placeholder/TODO, routing contradiction, safety-boundary regression, or unresolved product-contract ambiguity.
- Implementation plan covers every approved spec section and uses RED -> minimal GREEN -> focused verification -> commit for each implementation task.
- No runtime implementation code has been modified for this reliability slice yet.

## Completed

- Previous Computer-Use-first real-Chrome routing slice is merged and closed.
- Product acceptance proved routing alone was insufficient and exposed the perception/action-contract defects.
- Architectural brainstorming for the new reliability slice is complete.
- Design spec written and approved at `docs/superpowers/specs/2026-09-14-computer-use-perception-reliability-design.md`.
- Detailed TDD implementation plan written at `docs/superpowers/plans/2026-09-14-computer-use-perception-reliability.md`.

## Next exact step

1. Commit the approved-spec status, implementation plan, and this handoff update on `design/computer-use-perception-reliability`.
2. Choose execution mode required by Superpowers: `subagent-driven-development` (recommended where fresh subagents are available) or inline `executing-plans` in this conversation.
3. For inline execution, read `superpowers:executing-plans`, create an isolated implementation worktree/feature branch via `superpowers:using-git-worktrees`, and execute the plan task-by-task with TDD checkpoints.
4. Do not implement runtime/production changes on this design branch.

## Invariants

- Git/worktree reality outranks Continuity, this file, and older chat context.
- Never reset, clean, revert, overwrite, or delete unfamiliar work.
- Do not develop on `main` or the design branch.
- Explicit Computer Use must remain on `computer_*`; Browser Runtime is not a substitute.
- Normal user Chrome profile/session must be preserved.
- Already-running Chrome must not be silently restarted by this feature.
- TCC, SIP, FileVault/login, Keychain authentication, user takeover, CAPTCHA/anti-bot, and sudo/root boundaries remain authoritative.
- No repeated blind coordinate-click recovery loops.
- No push/PR/merge until implementation later passes the existing local-first verified publication lifecycle.
- `origin/feat/computer-use-bridge` remains preserved until separately classified.

## Blockers / uncertainties

- No design blocker remains. Implementation is waiting only for execution-mode handoff.
- `NSWorkspace.OpenConfiguration.arguments` is the preferred stopped-Chrome launch mechanism; implementation must prove it preserves the default profile/session. A narrow dedicated launch adapter is allowed only if the Apple API path fails deterministic real-Mac tests.
