# chatgpt-system — Active Project State

Last updated: 2026-09-17
Status: **`fix/diagnose-runtime-scoped-dependency-signature-20260917` is locally complete and fully verified in an isolated worktree. It is unpublished and awaiting hosted CI. `main` is `a83dfe6` and the live MCP runtime has been repointed onto it. Acceptance A remains precondition-gated and Acceptance C remains blocked by the current product/account UI surface.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank this file. Resume the exact alias named below before acting.

## Current goal

Publish `fix/diagnose-runtime-scoped-dependency-signature-20260917` only through the authorized path: push, PR, hosted checks green on the PR's exact head, merge, then verified cleanup. Keep the change to diagnostic accuracy — the dependency-failure signature must belong to the active runtime — and keep the still-unclassifiable hosted MCP failure class reported rather than guessed. The live runtime is already repointed at `a83dfe6`; do not touch the tunnel profile, LaunchAgent, Chrome profile, or Computer Runtime.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`, currently equal to `origin/main`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Active worktree: `~/.chatgpt-system/agent-worktrees/diagnose-runtime-signature` on branch `fix/diagnose-runtime-scoped-dependency-signature-20260917`, branched from `main@a83dfe6`.
- Read the current HEAD from Git; never infer it from this file. The evidence below was produced on the branch tip and must be re-run after any further HEAD or worktree change.
- Superseded clean worktrees `fix/project-check-native-routing-20260916` (`df20759`) and `fix/git-diff-check-20260917` (`5c5c62e`) remain present. Their contribution is already in `main` via PR #57; they are not content-equivalent to `main` and deleting them would need a force delete, so they were left alone.
- Detached runtime worktree `~/.chatgpt-system/runtime/chatgpt-system-main` is the tunnel target and is now checked out at `a83dfe6` with `dist` rebuilt from that source and the daily-driver restarted onto it, under explicit user authorization. The merged PR branches that are not content-equivalent to `main` need a force delete, so they were left alone. The preserved dirty `feat/computer-use-perception-reliability` worktree also remains intentionally present. Do not repurpose, clean, or delete any of them.
- `origin/feat/computer-use-bridge` remains intentionally retained.

## Continuity tooling limitation

The client that produced this state had no `project_resume`, `project_check`, `project_checkpoint`, or `git_push` MCP namespace available. Continuity storage was therefore unavailable, no checkpoint was recorded, and Git/worktree reality was used as the authoritative source. Typed dual-authority publication could not be exercised from that client.

## Completed

- PR #57 merged the native Admin-host check lane, the `git_diff` whitespace check, the typed `fs_patch` conflict, the recovered poll-backoff classification and the `bun` bare-script sandbox refusal as `main@3cc8fb8`, verified independently after merge.
- PR #58 merged the auditable authority lease-resolution denials as `main@a83dfe6`, making the local authority-refusal class measurable from the audit file.
- The live MCP runtime was repointed from `96d76b2` to `main@a83dfe6`: the stable runtime worktree was checked out at `a83dfe6`, `dist` was rebuilt from it, and the daily-driver was restarted onto it (MCP child started after the build), under explicit user authorization.
- `diagnose:chatgpt` no longer reports a missing-dependency failure that belongs to a different runtime than the active one.
- Every defect so far was reproduced RED before its fix.
- `native/`, `docker/` and `.github/` are untouched by this branch.

## Current state

1. `project_check` discovers explicitly declared `*:macos` Swift test scripts as separate `admin-host` checks. Discovery reads package metadata only: the script value must match the fixed `swift test [--package-path <dir>]` form, the package directory must be a real in-repository directory holding a regular `Package.swift`, and symlinked or traversing paths are rejected.
2. Native checks are never selected implicitly. A default run leaves them `NOT_RUN`; running one requires an explicit `checkId` plus an active Admin lease, and is refused with `AUTHORITY_DENIED` otherwise.
3. The Project Docker sandbox refuses macOS-specific package scripts instead of executing them on Linux, including the bare-script forms `yarn <script>` and `bun <script>` that take no `run` subcommand.
4. `git_diff` accepts an optional boolean `check` that routes to `git diff --check` (with `staged` for `--cached --check`). Diff arguments come from a fixed builder, so callers still cannot supply Git options, and the Project lease, PathPolicy and the `--no-ext-diff`/`--no-textconv` allowlist are unchanged.
5. `fs_patch` validates unified-diff structure before applying. Malformed patch text now fails closed as `CONFLICT`; previously it surfaced as an untyped `INTERNAL_ERROR`, and patch text carrying no hunks silently reported success while leaving the file unchanged. `fs_apply_patch_set` and `fs_patch` share one validator.
6. `diagnose:chatgpt` counts recovered poll backoffs separately and excludes them from failure classification, so a `poll timed out; backing off` that the poller itself recovers from no longer reports `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE`. Unrecovered backoffs, stdio failures and ERROR records keep their previous classification, and recovered backoffs stay visible in the report so flapping remains observable.
7. Blank and unknown lease ids emit an `authority.denied` audit event carrying only a coarse reason (`missing` or `unknown`), a count and a window start — never a lease id, lease digest, scope or caller data. The refusal, its ordering and the authority model are unchanged, and audit failures stay swallowed so enforcement remains fail-closed.
8. Denials are coalesced per reason into one window-opening record plus one window-summary record per 60-second window, so a forged-lease flood cannot grow the audit file without bound. The runtime logger writes them with `outcome: "error"` and `errorCode: "AUTHORITY_REQUIRED"`, so they appear in ordinary audit error-code analysis.
9. TCC, user takeover, emergency chord, input release, CAPTCHA/anti-bot, Browser-vs-Computer routing, and authority boundaries remain fail-closed and unchanged.
10. `diagnose:chatgpt` attributes `dependencyFailureSignature` to the active runtime only: it counts an `ERR_MODULE_NOT_FOUND` for `zod` only when the failing module's own import path lies inside the running runtime root, and it reports nothing when no runtime root could be resolved. The retained stderr window is shared across restarts and still holds failures from whatever the tunnel targeted before, so the unscoped match previously reported a dependency failure the active runtime never had. Classification priority, the report shape and every authority path are unchanged.

## Verification

Evidence is bound to the integration branch tip:

- full `npm run check` (build + Vitest): exit 0, **744 passed, 2 skipped, 0 failures** across 118 test files;
- native macOS Computer Runtime suite (`npm run test:computer:macos`): **215/215 passed**, exit 0;
- real `git diff --check`: exit 0;
- dependency-free smokes `native-check-routing-smoke.mjs` and `git-diff-check-smoke.mjs`: PASS;
- live Admin-host lane check against this repository through a local `--owner-workstation` stdio server: detection returned `package-script:test:computer:macos` as `admin-host`; the run was refused with `AUTHORITY_DENIED` without an Admin lease and reported `PASS` with one, while the unrequested sandbox check correctly stayed `NOT_RUN` and held `overallStatus` at `NOT_RUN`;
- the `fs_patch` defect was reproduced RED (untyped `Error: Hunk at line 3 has more lines than expected`) before the fix and is GREEN after it;
- the `diagnose:chatgpt` misclassification was reproduced against the live tunnel log before the fix and re-verified after it on the same window;
- the missing denial audit was reproduced RED, and a live runtime run then refused 20,001 forged or blank leases while writing **2 `authority.denied` records in an 853-byte audit file**, with neither the real lease id nor the forged ids present;
- the unscoped dependency signature was reproduced against the live stderr log: on the same machine, log and 30-minute window, `main` reported `stderr.dependencyFailureSignature: true` while the only matching line pointed at `~/.chatgpt-system/worktrees/.../03a798c1-.../dist/control-protocol.js` and the active runtime was `runtime/chatgpt-system-main`; the fixed branch reports `false` on that same window. No line in the log references the active runtime path;
- the deployed artifact (`runtime/chatgpt-system-main/dist/cli.js`, the exact script path in the running MCP child's command line, started after the `dist` rebuild) was driven over local stdio: **10/10 checks passed** — `git_diff` advertises `check`, a schema-valid forged lease is refused with `AUTHORITY_REQUIRED`, that denial lands in the audit as `authority.denied` carrying only `reason`/`deniedCount`/`windowStartedAt`, `git diff --check` returns exit 2 with `trailing whitespace` on a dirty tree and 0 on a clean one, and a malformed or hunk-less patch fails as typed `CONFLICT` while the file stays unchanged;
- the live audit file contains two post-repoint `authority.denied` records (`09:23:16Z` and `09:27:24Z`) with `outcome: "error"` and `errorCode: "AUTHORITY_REQUIRED"`;

Not run: hosted CI, `npm audit`, runtime/fixture packaging, codesign verification, and freshness-bound typed `project_check`. Those belong to the publication pass and must not be reported as passing.

## MCP failure-boundary classification

- The tunnel forwarded 2113 commands in the retained 1 MiB log window; the last forwarded command was `2026-09-17T07:54:24Z`.
- Audit activity at `08:40Z` and `08:43Z` post-dates that last forwarded command, so those calls reached the MCP server from a non-tunnel local client. The last tunnel command and the last audit record do **not** correspond.
- `fs.patch` accounts for 171 of 214 recorded `INTERNAL_ERROR` audit entries. That class is now a local defect with a typed fix, not a hosted block.
- Lease-resolution denials are now inside audit coverage as `authority.denied` / `AUTHORITY_REQUIRED`, so the local authority-refusal class is measurable from the audit file without weakening the authority model.
- A dependency signature sitting in the retained stderr window is not by itself runtime evidence. The diagnostic did not scope it to the active runtime and produced a false `dependencyFailureSignature: true` while `runtime.source` was `stable-runtime` and `zodPresent` was true. That false positive is fixed; the hosted product-surface class is still unclassified.
- The hosted product-surface class cannot be proven from local artifacts. No root cause is asserted for it without the exact blocked-call UI text and its local timestamp.

## Blockers / uncertainties

- The exact UI text and local timestamp of the reported safety-blocked calls were never captured, so the hosted-surface class remains unclassified.
- Acceptance C cannot be completed honestly until the account/workspace exposes a supported Refresh surface.
- Acceptance A remains pending until Chrome is naturally stopped or the user explicitly authorizes closing it.

## Next exact step

Push `fix/diagnose-runtime-scoped-dependency-signature-20260917`, open a PR, and merge only if the PR's exact head passes the required hosted checks. Re-run the full local gate first if HEAD or the working tree changed. After merge, sync local `main`, confirm `main == origin/main`, and delete only merged, clean, provably agent-owned branches and worktrees. Leave the live runtime repointed at the merged `main`; redeploying it again, or touching the tunnel profile or LaunchAgent, needs separate authorization.

Still open and deliberately unaddressed here: a default `project_check` run leaves the declared native check `NOT_RUN` in a mixed repository, so a typified `git_push` fails closed without a fresh Admin-host run — that publish-gate contract is not pinned by a test (`tests/project-publish-gate.test.ts` is untouched); and the hosted product-surface class stays unclassified until the exact blocked-call UI text and its local timestamp are captured.

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
