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

## Task 8 exact-HEAD local gate — 2026-09-15

Git/worktree reconciliation now places the implementation branch at exact HEAD `48e60fe8004e5fedc334c9d33c0da7652c475859`. The only remaining unstaged paths are the pre-existing mixed-ownership documentation files plus the preserved daily-driver pair; there are no staged or untracked files.

Task 7 / reliability-v2 completion commits after the earlier live deployment include:

- `723f310` — bounded non-sensitive computer recovery evidence
- `9dbfd1c` — TypeScript/MCP scoped-target and reliability-contract parity
- `bc97501` — reliability-v2 integration documentation contract
- `768a47f` — review fix preserving required-nullable `parentIndex`
- `48e60fe` — broad-gate fixture/catalog alignment for the v2 public contract

The structured review found one correctness issue before the full gate: the approved v2 observation contract specifies `parentIndex: number | null`, but Swift synthesized encoding omitted root `parentIndex` and the TypeScript output schema treated it as optional. RED tests failed in native `ObservationTests` and the MCP schema test, then passed after `768a47f` added explicit JSON null encoding and required-nullable schema validation.

The first exact-HEAD `npm run check` then exposed eight stale broad-suite expectations rather than production regressions: older native fakes still returned `{ state: "completed" }` after the public mutation-result contract changed to `completed_unverified`, and the global HTTP catalog baseline had not classified `computer_scroll_until_visible` as a reliability-v2 tool. Those expectations were updated without weakening runtime validation; the focused five-file rerun passed 34 tests with one intentional long acceptance skip before commit `48e60fe`.

Exact `48e60fe` local verification is GREEN:

- feature diff whitespace check: PASS
- `npm run check`: **113 test files passed, 1 skipped; 707 tests passed, 2 skipped**
- `npm run test:computer:macos`: **214/214 passed, 0 failures**
- `npm audit --omit=dev`: **0 vulnerabilities**
- `npm run build`: PASS
- `npm run build:computer:macos`: PASS
- `npm run package:computer:macos`: PASS, producing the staged ad-hoc app from exact `48e60fe`

Independent reviewer-subagent infrastructure is not available in this chat surface, so no independent-review PASS claim is made. A separate structured spec/diff review was performed and the nullable-parent defect above was found and fixed through RED -> GREEN evidence.

Important deployment boundary: the previously recorded live Mac/tunnel deployment and Acceptance B/C evidence are tied to the older `5cb22d7` lineage. Exact `48e60fe` has been built and packaged locally but has **not** yet been installed/deployed, and final real-Mac Acceptance B/C has therefore **not** been rerun against the exact final local artifact. Do not call the slice complete until deployment identity and live acceptance are tied to the same exact HEAD.

Next exact step from this checkpoint:

1. Reconfirm the preserved daily-driver diff fingerprint before any deploy-side action.
2. Install/deploy exact `48e60fe` only through the existing identity-preserving Computer Runtime/tunnel path; do not restart already-running normal Chrome.
3. Verify installed helper signature/artifact lineage and local/tunnel health before physical UI work.
4. Rerun Acceptance B/C on the exact deployed artifact using `computer_*` only, with fresh observation after uncertain mutations and no repeated blind coordinates/unchanged scrolls.
5. Leave Acceptance A pending unless Chrome is naturally stopped or explicit permission to close it exists.
6. Record exact deployed identity and acceptance evidence, then rerun final exact-HEAD publication gates before any push/PR/merge.

## Task 8 exact deployment and safe acceptance checkpoint — 2026-09-15

The feature branch is at exact HEAD `428da223b6542b93a7fe19d4a04a3592cd4511a7`. The complete local gate set was rerun from a `git archive HEAD` snapshot after the Task 8 state commit and is GREEN: `npm run check` passed 113 test files with 707 tests passed and 2 intentional skips; native tests passed 214/214; production dependency audit found 0 vulnerabilities; TypeScript build, release native build, package, and implementation-range `git diff --check` all passed.

Exact-lineage deployment evidence:

- the native helper was installed from the exact `428da22` archive snapshot through `setup-macos-computer-runtime.mjs`;
- the existing `ComputerUse Dev` signing identity was reused, `tccIdentityStable=true`, and the designated requirement remained `identifier "com.senoldogann.chatgpt-system.computer-runtime" and certificate leaf = H"484f87624db0cea96cf9664e45d99bb7e2db8d4a"`;
- the installed native executable SHA-256 is `446c8cf6ef7f26521ca24918a16ef7a8545a5af8d9a9cfafdda6615d62fa7535`;
- feature-worktree `dist/cli.js`, `dist/computer-runtime.js`, `dist/computer-tool-registration.js`, and `dist/tool-output-schemas.js` were rebuilt and matched the exact archive build byte-for-byte;
- the Secure MCP Tunnel profile was backed up to `~/.config/tunnel-client/chatgpt-system.yaml.pre-reliability-v2-428da22.bak` and its stdio child was moved from the stale main-checkout `dist` to the exact-matching feature-worktree `dist`;
- after LaunchAgent reactivation, the running tunnel child command points to the feature-worktree `dist/cli.js` and local `/healthz` and `/readyz` both return HTTP 200 (`live` / `ready`);
- Computer Runtime readiness remains fully authorized for Accessibility, Screen Capture, event listen, and event post.

Safe Acceptance B/C retry evidence on the exact deployed lineage:

- the current normal Chrome main process is PID `86148`, started `2026-09-15 00:35:21` local, which predates the exact helper/tunnel deployment; this deployment did not restart Chrome;
- an initial read-only Chrome observation again showed weak web AX with focused-window OCR active and the new required-nullable `parentIndex` field present;
- two stale snapshot-index attempts were stopped before physical input and returned bounded recovery evidence rather than clicking stale geometry;
- subsequent semantic `text` and `role` attempts also failed closed with `candidateCount=0`, `activeScrollContainerCount=0`, and `recommendedRecovery=screenshot`; no blind coordinate fallback was executed;
- a fresh screenshot then showed the user actively working in T3 Code rather than Chrome, so foreground acceptance was stopped immediately and runtime-held inputs were released;
- no `browser_*` fallback was used and no coordinate point was clicked during this exact-lineage retry.

Acceptance B/C therefore remains **pending**, not failed: the deployed exact lineage is healthy, but final ChatGPT Plugins -> Refresh interaction must wait for a short uninterrupted Chrome-control window so the runtime does not steal foreground focus. Acceptance A remains pending under the existing stopped-Chrome precondition.
