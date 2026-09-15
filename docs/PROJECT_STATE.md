# chatgpt-system — Active Project State

Last updated: 2026-09-15
Status: **Computer Use perception-reliability implementation is integrated, verified, installed, and published; Acceptance C remains blocked by the current product/account UI surface.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank this file. Resume the exact alias named below before acting.

## Current goal

Preserve the verified perception-reliability publication lineage and rerun the remaining ChatGPT Plugins Refresh acceptance only when a supported Refresh surface is actually available. Do not create a synthetic success by weakening recovery, restarting normal Chrome, switching to Browser Runtime, or consuming unrelated dirty work.

## Active workspace

- Clean integration Continuity alias: `chatgpt-system-perception-integration`.
- Clean integration branch: `integration/computer-use-perception-native-verification`.
- Verified runtime/integration code baseline before this documentation-only follow-up: `35ec7a7595f4f8eab4dfe1ebace260dbce6d0af1`.
- `origin/integration/computer-use-perception-native-verification` was independently verified at that SHA before this docs follow-up; re-read remote truth after publishing documentation-only commits.
- Integrated main base: `4c94c42ad2ffb2fb3d6f79e0d14a725f9d3d0542`.
- Feature fix commit before integration: `4a7b5d11731bafc63c53931a5762e5df27b4ba60`.
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
- Exact runtime/integration baseline `35ec7a7595f4f8eab4dfe1ebace260dbce6d0af1` passed focused, native, full, packaging, signing, and freshness-bound verification.
- The identity-preserving daily-driver installer updated the fixed runtime bundle while preserving signer `ComputerUse Dev` and the stable designated requirement.
- The clean integration branch was published through guarded `git_push` and remote truth was re-read at the same code baseline before this documentation follow-up.

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

All evidence below is tied to clean exact HEAD `35ec7a7595f4f8eab4dfe1ebace260dbce6d0af1` before this final documentation-only follow-up:

- focused TypeScript integration suites: **80/80 passed**;
- native macOS Computer Runtime suite: **215/215 passed**;
- full `npm run check`: **722 passed, 2 skipped, 0 failures**;
- freshness-bound `project_check`: **PASS**, with matching HEAD and working-tree digest;
- `npm run build:computer:macos`: PASS;
- `npm run package:computer:macos`: PASS;
- `npm run package:computer-fixture:macos`: PASS;
- staged runtime and fixture bundles passed `codesign --verify --strict --deep` and expected bundle/executable checks;
- `git diff --check`: PASS;
- clean Git status before publication;
- guarded `git_push` succeeded and a fresh `project_resume` verified the remote integration branch at the same SHA.

The integrated native runtime source tree is unchanged from `4a7b5d1` to `35ec7a7`; the merged main changes are outside `native/macos-computer-runtime`.

## Installed runtime

The fixed daily-driver bundle is installed at:

`~/.chatgpt-system/ChatGPTSystemComputerRuntime.app`

Identity-preserving setup from the clean integration worktree reused signer `ComputerUse Dev`, kept `tccIdentityStable=true`, and preserved the designated requirement:

`identifier "com.senoldogann.chatgpt-system.computer-runtime" and certificate leaf = H"484f87624db0cea96cf9664e45d99bb7e2db8d4a"`

Independent installed-bundle checks passed strict/deep codesign verification, expected `CFBundleIdentifier`, expected executable name, and executable permissions.

The installed bundle is updated. The already-running native helper child was not forcibly restarted during the final documentation/publication pass because there was no new explicit physical Computer Use request; it will load the installed binary on the next controlled supervisor lifecycle.

## Next exact step

1. Do not modify the preserved dirty feature worktree to force task closure.
2. Use the clean integration branch as the publication/deployment lineage.
3. If a supported Workspace-admin/plugin Refresh surface becomes available, start with fresh `project_resume`, verify current Git/runtime state, and rerun Acceptance C using `computer_*` only.
4. Reacquire fresh observation/screenshot evidence after uncertain UI mutations. Never repeat a failed point blindly and never silently restart normal Chrome.
5. If Refresh remains unavailable, keep Acceptance C explicitly blocked rather than changing local authority or runtime behavior without new evidence.

## Invariants

- Git/worktree reality outranks Continuity, this file, and older chats.
- Never reset, clean, revert, overwrite, or delete unfamiliar work.
- Explicit Computer Use stays on `computer_*`; Browser Runtime is not a substitute for physical Computer Use.
- Preserve the normal Chrome profile/session and do not silently restart an already-running Chrome.
- Automatic OCR stays focused-window-only and bounded.
- No repeated blind coordinate or unchanged-scroll retry loops.
- TCC, SIP, FileVault/login, Keychain authentication, user takeover, CAPTCHA/anti-bot, and sudo/root boundaries remain authoritative.
- Publication requires a clean exact HEAD plus fresh verification evidence.
