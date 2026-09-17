# chatgpt-system — Active Project State

Last updated: 2026-09-17
Status: **`feat/mcp-verification-diagnostics-20260917` is locally complete and fully verified in an isolated worktree. It is unpublished and awaiting explicit publication authorization. Acceptance A remains precondition-gated and Acceptance C remains blocked by the current product/account UI surface.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank this file. Resume the exact alias named below before acting.

## Current goal

Publish `feat/mcp-verification-diagnostics-20260917` only through the authorized path: explicit authorization, push, PR, hosted checks green on the PR's exact head, merge, then verified cleanup. Do not weaken any authority boundary, do not touch the live runtime or tunnel, and keep the two unclassifiable MCP failure classes reported rather than guessed.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`, currently equal to `origin/main`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Integration worktree: `~/.chatgpt-system/agent-worktrees/mcp-verification-diagnostics` on branch `feat/mcp-verification-diagnostics-20260917`, branched from `main@1080cbe`.
- Verified code HEAD for the evidence below: `63295f7` (this documentation commit sits on top of it and changes no source).
- Read the current HEAD from Git; never infer it from this file.
- Source branches `fix/project-check-native-routing-20260916` (`df20759`) and `fix/git-diff-check-20260917` (`5c5c62e`) hold the same code as branch-local lineage. Their worktrees are clean and their `docs/PROJECT_STATE.md` handoff notes were intentionally not carried into integration; this file supersedes them.
- Detached merged-runtime worktree `~/.chatgpt-system/runtime/chatgpt-system-main` and the preserved dirty `feat/computer-use-perception-reliability` worktree remain intentionally present. Do not repurpose, clean, or delete them.
- `origin/feat/computer-use-bridge` remains intentionally retained.

## Continuity tooling limitation

The client that produced this state had no `project_resume`, `project_check`, `project_checkpoint`, or `git_push` MCP namespace available. Continuity storage was therefore unavailable, no checkpoint was recorded, and Git/worktree reality was used as the authoritative source. Typed dual-authority publication could not be exercised from that client.

## Completed

- The native Admin-host check lane, the `git_diff` whitespace check, the typed `fs_patch` conflict, and the recovered poll-backoff classification are implemented, reviewed and locally verified on one integration branch.
- Each defect was reproduced before its fix: the `fs_patch` untyped error as a RED test, and the `diagnose:chatgpt` misclassification against the live tunnel log.
- The Admin-host lane was exercised end to end against this repository with a real Admin lease and a real Swift test run.
- `native/`, `docker/` and `.github/` are untouched by this branch.

## Current state

1. `project_check` discovers explicitly declared `*:macos` Swift test scripts as separate `admin-host` checks. Discovery reads package metadata only: the script value must match the fixed `swift test [--package-path <dir>]` form, the package directory must be a real in-repository directory holding a regular `Package.swift`, and symlinked or traversing paths are rejected.
2. Native checks are never selected implicitly. A default run leaves them `NOT_RUN`; running one requires an explicit `checkId` plus an active Admin lease, and is refused with `AUTHORITY_DENIED` otherwise.
3. The Project Docker sandbox refuses macOS-specific package scripts instead of executing them on Linux.
4. `git_diff` accepts an optional boolean `check` that routes to `git diff --check` (with `staged` for `--cached --check`). Diff arguments come from a fixed builder, so callers still cannot supply Git options, and the Project lease, PathPolicy and the `--no-ext-diff`/`--no-textconv` allowlist are unchanged.
5. `fs_patch` validates unified-diff structure before applying. Malformed patch text now fails closed as `CONFLICT`; previously it surfaced as an untyped `INTERNAL_ERROR`, and patch text carrying no hunks silently reported success while leaving the file unchanged. `fs_apply_patch_set` and `fs_patch` share one validator.
6. `diagnose:chatgpt` counts recovered poll backoffs separately and excludes them from failure classification, so a `poll timed out; backing off` that the poller itself recovers from no longer reports `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE`. Unrecovered backoffs, stdio failures and ERROR records keep their previous classification, and recovered backoffs stay visible in the report so flapping remains observable.
7. TCC, user takeover, emergency chord, input release, CAPTCHA/anti-bot, Browser-vs-Computer routing, and authority boundaries remain fail-closed and unchanged.

## Verification

Evidence is bound to code HEAD `63295f7` in the integration worktree:

- full `npm run check` (build + Vitest): exit 0, **740 passed, 2 skipped, 0 failures** across 118 test files;
- native macOS Computer Runtime suite (`npm run test:computer:macos`): **215/215 passed**, exit 0;
- real `git diff --check`: exit 0;
- dependency-free smokes `native-check-routing-smoke.mjs` and `git-diff-check-smoke.mjs`: PASS;
- live Admin-host lane check against this repository through a local `--owner-workstation` stdio server: detection returned `package-script:test:computer:macos` as `admin-host`; the run was refused with `AUTHORITY_DENIED` without an Admin lease and reported `PASS` with one, while the unrequested sandbox check correctly stayed `NOT_RUN` and held `overallStatus` at `NOT_RUN`;
- the `fs_patch` defect was reproduced RED (untyped `Error: Hunk at line 3 has more lines than expected`) before the fix and is GREEN after it;
- the `diagnose:chatgpt` misclassification was reproduced against the live tunnel log before the fix and re-verified after it on the same window.

Not run: hosted CI, `npm audit`, runtime/fixture packaging, codesign verification, and freshness-bound typed `project_check`. Those belong to the publication pass and must not be reported as passing.

## MCP failure-boundary classification

- The tunnel forwarded 2113 commands in the retained 1 MiB log window; the last forwarded command was `2026-09-17T07:54:24Z`.
- Audit activity at `08:40Z` and `08:43Z` post-dates that last forwarded command, so those calls reached the MCP server from a non-tunnel local client. The last tunnel command and the last audit record do **not** correspond.
- `fs.patch` accounts for 171 of 214 recorded `INTERNAL_ERROR` audit entries. That class is now a local defect with a typed fix, not a hosted block.
- Lease-resolution denials are still outside audit coverage, so an L2 authority-refusal class cannot be confirmed or excluded from local evidence. This gap is reported, not closed by weakening the authority model.
- The hosted product-surface class cannot be proven from local artifacts. No root cause is asserted for it without the exact blocked-call UI text and its local timestamp.

## Blockers / uncertainties

- The exact UI text and local timestamp of the reported safety-blocked calls were never captured, so the hosted-surface class remains unclassified.
- Authority lease-resolution failures are not written to the audit log.
- Acceptance C cannot be completed honestly until the account/workspace exposes a supported Refresh surface.
- Acceptance A remains pending until Chrome is naturally stopped or the user explicitly authorizes closing it.

## Next exact step

Obtain explicit authorization to publish, then push `feat/mcp-verification-diagnostics-20260917`, open a PR, and merge only if the PR's exact head passes the required hosted checks. Re-run the full local gate first if HEAD or the working tree changed. After merge, sync local `main`, confirm `main == origin/main`, and delete only merged, clean, provably agent-owned branches and worktrees. Do not redeploy the live runtime, tunnel profile, or LaunchAgent as part of this work; that needs separate authorization.

## Invariants

- Git/worktree reality outranks Continuity, this file, and older chats.
- Never reset, clean, revert, overwrite, or delete unfamiliar work.
- If a hosted surface blocks an operation, stop and report; never retry it through another tool, endpoint, terminal, or container.
- Admin authority is never bound to anonymous callers and existing authority checks are never loosened to make a check pass.
- Explicit Computer Use stays on `computer_*`; Browser Runtime is not a substitute for physical Computer Use.
- Preserve the normal Chrome profile/session and do not silently restart an already-running Chrome.
- Automatic OCR stays focused-window-only and bounded.
- TCC, SIP, FileVault/login, Keychain authentication, user takeover, CAPTCHA/anti-bot, and sudo/root boundaries remain authoritative.
- Publication requires a clean exact HEAD plus fresh verification evidence.
