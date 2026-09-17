# chatgpt-system — Active Project State
> **Branch-local handoff 2026-09-17:** `fix/git-diff-check-20260917` is an isolated, unpublished worktree from `main@1080cbe`; main and the staged native-routing worktree are untouched.
> Worktree: `~/.chatgpt-system/worktrees/e4eaca835975a22d75cc3e7778bb895500595d13b544a96d350c557d9edad976/5fa7dc41-1727-4d79-8952-fcc493e001ab`.
> Draft: optional boolean `git_diff.check` routes through existing Project authority and Git safety checks to `git diff --check` or `git diff --cached --check`, preserving default diff behavior; unit/MCP regressions added.
> Evidence: dependency-free smoke RED (missing helper) then GREEN (`GIT_DIFF_CHECK_SMOKE_PASS`); edited service, server, and two test files passed Node TypeScript syntax checks. Full `npm run check` cannot run in fresh worktree: missing `tsc`, `npm ci --offline` returned `ENOTCACHED`.
> Blocker: attempt to run focused `npm test -- tests/git-service.test.ts tests/git-authority-boundary.test.ts` was blocked by OpenAI safety before execution. Stop; do not retry the blocked test by another tool or invoke Admin by another route.
> Next exact step: use a future officially permitted environment to install dependencies and run focused and full checks, then Git whitespace check and local review; do not claim release-ready or commit before verified checks. Deploy/push/PR/merge require separate authorization.
> Current MCP runtime has NOT loaded this draft. Cross-chat shared Admin is separately blocked by absent verified caller identity. No runtime, tunnel, Computer Use, Admin, main, or other worktree changes.

Last updated: 2026-09-15
Status: **Computer Use perception-reliability is merged and independently verified on published `main`; integration cleanup is complete. Acceptance A remains precondition-gated and Acceptance C remains blocked by the current product/account UI surface.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank this file. Resume the exact alias named below before acting.

## Current goal

Preserve the verified `main@8ae6bee3f2aedca3a6b31b3dc17a909b4e49296d` perception-reliability lineage. Rerun the remaining acceptance work only when its real preconditions are satisfied: Chrome is naturally stopped or explicitly authorized to close for Acceptance A, and a supported ChatGPT Plugins Refresh surface is available for Acceptance C. Do not create synthetic success by weakening recovery, restarting normal Chrome, switching to Browser Runtime, or consuming unrelated dirty work.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Perception-reliability implementation merge baseline on `main`: `8ae6bee3f2aedca3a6b31b3dc17a909b4e49296d` (`feat: harden computer use perception reliability (#51)`). Current repository HEAD must be read from Git, not inferred from this historical baseline.
- PR #51 squash-merged the verified perception-reliability integration lineage to `main`.
- The local/remote integration branch and its integration/post-merge verification worktrees were removed after successful merge verification.
- Detached merged-runtime worktree `/Users/dogan/.chatgpt-system/runtime/chatgpt-system-main` remains intentionally present at `8ae6bee`; do not repurpose or delete it as part of unrelated work.
- Feature Continuity alias: `chatgpt-system-perception-feature`.
- Feature branch `feat/computer-use-perception-reliability` remains intentionally unpublished and its worktree remains dirty only with preserved concurrent documentation/daily-driver changes.

Preserved feature-worktree paths that must not be staged, stashed, reset, cleaned, reverted, or overwritten as part of this task:

- `docs/CHATGPT_INTEGRATION.md`
- `docs/PROJECT_STATE.md`
- `scripts/setup-daily-driver.mjs`
- `tests/setup-daily-driver.test.ts`

The preserved daily-driver pair diff SHA-256 remains `47df7fedc5e2f8a98374793c8d6213db2aa6cb0c62358ce863bea76ca52ccc28` at the last verified feature checkpoint.

`origin/feat/computer-use-bridge` remains intentionally retained and must not be deleted or rewritten without separate classification.

## Completed

- The cached structured-OCR zero-retry defect was reproduced RED, fixed, and regression-tested.
- The clean feature lineage was integrated with `main@4c94c42` without consuming preserved dirty work.
- Exact runtime/integration baseline `35ec7a7595f4f8eab4dfe1ebace260dbce6d0af1` passed focused, native, full, packaging, signing, and freshness-bound verification before publication.
- The identity-preserving daily-driver installer updated the fixed runtime bundle while preserving signer `ComputerUse Dev` and the stable designated requirement.
- The clean integration branch was published through guarded `git_push`; PR #51 passed hosted Node 22, Node 24, and macOS-native checks and was squash-merged as `8ae6bee3f2aedca3a6b31b3dc17a909b4e49296d`.
- Independent post-merge verification passed on exact published `main@8ae6bee`, and local `main` was confirmed equal to `origin/main`.
- The merged integration branch plus temporary integration/post-merge worktrees were cleaned up without modifying preserved dirty/review worktrees.

## Current state

1. `computer_observe` classifies AX quality and returns bounded perception metadata.
2. Weak Chrome AX may enrich the fresh observation with bounded **focused-window-only** Vision OCR; automatic OCR never silently broadens to the full display.
3. OCR remains bounded to 64 candidates, 512 characters per candidate, 8192 aggregate OCR characters; fast Vision runs first and accurate Vision may run once only after an empty acceptable fast pass.
4. `webContentAccessible` and OCR `confidence` preserve required-nullable JSON fields instead of omitting nil values.
5. `recommendedTargeting` distinguishes `ax`, `ocr`, and `visual-point` recovery paths.
6. A fresh visual fallback permits at most one explicit verified point attempt; failed points are replan boundaries, not retry loops.
7. A stopped real `com.google.Chrome` may be launched with `--force-renderer-accessibility=complete`; an already-running normal Chrome is reused and never silently restarted to change accessibility behavior.
8. The public key vocabulary is finite and normalized before native IPC; unknown key names fail before dispatch.
9. Cached structured OCR is resolvable even when `retryBudget=0`; zero retry still prevents fresh-context/on-demand retry work.
10. TCC, user takeover, emergency chord, input release, CAPTCHA/anti-bot, Browser-vs-Computer routing, and authority boundaries remain fail-closed.

## Acceptance status

### Acceptance A — stopped normal Chrome

**Pending by precondition.** Do not close a running user Chrome solely to satisfy this acceptance. Run it only when Chrome is naturally stopped or the user explicitly authorizes closing it.

### Acceptance B — already-running Chrome with weak web AX

**Verified.** Live normal Chrome remained the same process while `computer_observe` reported weak web AX, `webContentAccessible=false`, focused-window OCR usage, and `recommendedTargeting=ocr`. The cached-OCR zero-retry regression was reproduced before the fix and the same semantic target navigated successfully after the fix without restarting Chrome.

### Acceptance C — ChatGPT Plugins -> Refresh

**Blocked by current product/account surface; not passed.** The user-level Plugins settings and public plugin-detail views exposed no Refresh control. The account UI inspected during acceptance did not expose a Workspace-admin action-control surface. Do not disconnect/recreate the plugin, guess repeated coordinates, or use Browser Runtime as a substitute. Rerun only when a supported Refresh surface is available.

## Blockers / uncertainties

- Acceptance C cannot be completed honestly until the account/workspace exposes a supported Refresh surface.
- Acceptance A remains pending until Chrome is naturally stopped or the user explicitly authorizes closing it.
- The installed bundle is current, but the already-running helper child was intentionally not force-restarted during this documentation/publication pass.

## Verification

The authoritative completion evidence is tied to exact published merge commit `8ae6bee3f2aedca3a6b31b3dc17a909b4e49296d`:

- PR #51 hosted CI: Node 22 PASS, Node 24 PASS, macOS-native PASS;
- main push CI: SUCCESS;
- full `npm run check`: **722 passed, 2 skipped, 0 failures**;
- native macOS Computer Runtime suite: **215/215 passed**;
- `npm audit --omit=dev`: **0 vulnerabilities**;
- runtime and fixture packaging: PASS;
- independent strict/deep codesign and bundle-contract verification: PASS;
- `git diff --check`: PASS;
- freshness-bound `project_check`: **PASS** with matching exact HEAD and working-tree digest;
- post-verification Git status: clean;
- at perception-reliability publication close, local `main == origin/main == 8ae6bee3f2aedca3a6b31b3dc17a909b4e49296d`.

The earlier clean integration baseline `35ec7a7595f4f8eab4dfe1ebace260dbce6d0af1` remains useful pre-merge evidence, but completion/publication claims are bound to the independently verified merge commit above.

## Installed runtime

The fixed daily-driver bundle is installed at:

`~/.chatgpt-system/ChatGPTSystemComputerRuntime.app`

Identity-preserving setup from the clean integration worktree reused signer `ComputerUse Dev`, kept `tccIdentityStable=true`, and preserved the designated requirement:

`identifier "com.senoldogann.chatgpt-system.computer-runtime" and certificate leaf = H"484f87624db0cea96cf9664e45d99bb7e2db8d4a"`

Independent installed-bundle checks passed strict/deep codesign verification, expected `CFBundleIdentifier`, expected executable name, and executable permissions.

The installed bundle is updated. The already-running native helper child was not forcibly restarted during the final documentation/publication pass because there was no new explicit physical Computer Use request; it will load the installed binary on the next controlled supervisor lifecycle.

## Next exact step

1. Do not modify the preserved dirty feature worktree to force task closure.
2. Treat published `main@8ae6bee` as the completed perception-reliability publication/deployment lineage; do not resurrect the removed integration branch.
3. Run Acceptance A only when Chrome is naturally stopped or the user explicitly authorizes closing it.
4. If a supported Workspace-admin/plugin Refresh surface becomes available, start with fresh `project_resume`, verify current Git/runtime state, and rerun Acceptance C using `computer_*` only.
5. Reacquire fresh observation/screenshot evidence after uncertain UI mutations. Never repeat a failed point blindly and never silently restart normal Chrome.
6. If neither acceptance precondition is available, keep those items pending/blocked and start any new `chatgpt-system` development as a separately scoped non-`main` branch/worktree from the current published `main`.

## Invariants

- Git/worktree reality outranks Continuity, this file, and older chats.
- Never reset, clean, revert, overwrite, or delete unfamiliar work.
- Explicit Computer Use stays on `computer_*`; Browser Runtime is not a substitute for physical Computer Use.
- Preserve the normal Chrome profile/session and do not silently restart an already-running Chrome.
- Automatic OCR stays focused-window-only and bounded.
- No repeated blind coordinate or unchanged-scroll retry loops.
- TCC, SIP, FileVault/login, Keychain authentication, user takeover, CAPTCHA/anti-bot, and sudo/root boundaries remain authoritative.
- Publication requires a clean exact HEAD plus fresh verification evidence.
