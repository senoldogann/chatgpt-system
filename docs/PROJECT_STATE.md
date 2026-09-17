# chatgpt-system — Active Project State

Last updated: 2026-09-17
Status: **PR #57 through #60 are merged and their branches deleted. Read the current HEAD from Git: the last revision of this file was written on top of `c3fa7a7` plus its own merge commit, and this revision rides with `fix/diagnose-poll-backoff-vocabulary-20260917`. The live MCP runtime is repointed at `a83dfe6`, which the docs/scripts/tests-only commits after it leave unchanged, so the deployed `dist` is the same source and no redeploy is needed. Acceptance A remains precondition-gated and Acceptance C remains blocked by the current product/account UI surface.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank this file. Resume the exact alias named below before acting.

## Current goal

No branch is currently in flight. The next milestone should be chosen from the open items below and recorded here before work starts. The highest-value candidate is pinning the mixed-repository publish-gate contract with a test, because a default `project_check` run leaves the declared native check `NOT_RUN` and a typified `git_push` therefore fails closed with no test asserting that intent. Keep the still-unclassifiable hosted MCP failure class reported rather than guessed. Do not redeploy the live runtime for changes that touch only docs, scripts or tests; touching the tunnel profile, LaunchAgent, Chrome profile or Computer Runtime needs its own explicit authorization.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`, currently equal to `origin/main`.
- Project Continuity alias: `chatgpt-system-desktop`.
- In-flight: `~/.chatgpt-system/agent-worktrees/poll-backoff-vocabulary` on branch `fix/diagnose-poll-backoff-vocabulary-20260917`, branched from the post-#60 `main`. It is removed once merged. The `diagnose-runtime-signature` and `state-post-merge` worktrees and branches were already removed after their content was proven equivalent to the squash commits `main` received.
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
- PR #59 merged the runtime-scoped dependency signature as `main@c3fa7a7` (squash of the exact CI-verified head `c75cabf`) and realigned this file with the repointed runtime.
- `diagnose:chatgpt` no longer reports a missing-dependency failure that belongs to a different runtime than the active one.
- `diagnose:chatgpt` no longer reports a self-recovered poll backoff as a local failure: the poller retries with more than one wording, and only the retry wordings it demonstrably heals from are counted as recovered.
- Every defect so far was reproduced RED before its fix.
- `native/`, `docker/` and `.github/` are untouched by this branch.

## Current state

1. `project_check` discovers explicitly declared `*:macos` Swift test scripts as separate `admin-host` checks. Discovery reads package metadata only: the script value must match the fixed `swift test [--package-path <dir>]` form, the package directory must be a real in-repository directory holding a regular `Package.swift`, and symlinked or traversing paths are rejected.
2. Native checks are never selected implicitly. A default run leaves them `NOT_RUN`; running one requires an explicit `checkId` plus an active Admin lease, and is refused with `AUTHORITY_DENIED` otherwise.
3. The Project Docker sandbox refuses macOS-specific package scripts instead of executing them on Linux, including the bare-script forms `yarn <script>` and `bun <script>` that take no `run` subcommand.
4. `git_diff` accepts an optional boolean `check` that routes to `git diff --check` (with `staged` for `--cached --check`). Diff arguments come from a fixed builder, so callers still cannot supply Git options, and the Project lease, PathPolicy and the `--no-ext-diff`/`--no-textconv` allowlist are unchanged.
5. `fs_patch` validates unified-diff structure before applying. Malformed patch text now fails closed as `CONFLICT`; previously it surfaced as an untyped `INTERNAL_ERROR`, and patch text carrying no hunks silently reported success while leaving the file unchanged. `fs_apply_patch_set` and `fs_patch` share one validator.
6. `diagnose:chatgpt` counts recovered poll backoffs separately and excludes them from failure classification, so a poll backoff that the poller itself recovers from no longer reports `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE`. Both retry wordings the poller actually emits are recognised — `poll timed out; backing off` and `poll failed; backing off` — and a backoff only counts as recovered when a following `poller recovered; polling operational` line is present, so a backoff nobody recovered from still counts. Warning and error totals, stdio failures, other poller warnings and ERROR records keep their previous classification, and recovered backoffs stay visible in the report so flapping remains observable.
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
- the unrecognised poll-backoff wording was reproduced against the live tunnel log: the retained window holds eight `poll failed; backing off` records, and the live `09:51:44Z` one was followed 31 seconds later by `poller recovered; polling operational`. On the same machine, log and 30-minute window, `main` classified `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE` with `recoveredPollBackoffCount: 0`, while the fixed branch reports `LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE` with `recoveredPollBackoffCount: 1` and keeps `warningCount: 1` visible;

Not run: `npm audit`, runtime/fixture packaging, codesign verification, and a freshness-bound typed `project_check`. Hosted CI is green on the exact merged heads of PR #59 (`c75cabf`) and PR #60 (`8254e20`) — `macos-native`, Node 22 and Node 24 all passed — so only the remaining items above still must not be reported as passing.

## MCP failure-boundary classification

- The tunnel forwarded 2113 commands in the retained 1 MiB log window; the last forwarded command was `2026-09-17T07:54:24Z`.
- Audit activity at `08:40Z` and `08:43Z` post-dates that last forwarded command, so those calls reached the MCP server from a non-tunnel local client. The last tunnel command and the last audit record do **not** correspond.
- `fs.patch` accounts for 171 of 214 recorded `INTERNAL_ERROR` audit entries. That class is now a local defect with a typed fix, not a hosted block.
- Lease-resolution denials are now inside audit coverage as `authority.denied` / `AUTHORITY_REQUIRED`, so the local authority-refusal class is measurable from the audit file without weakening the authority model.
- Two false positives in the same tool class were found by reading its own bounded artifacts rather than by guessing: an unscoped dependency signature, and a poll-backoff wording the recovered-backoff counter did not recognise. Both made the diagnostic attribute a non-existent local failure to the active runtime, which is the failure mode `AGENTS.md` warns about when it forbids restarting a healthy tunnel.
- A dependency signature sitting in the retained stderr window is not by itself runtime evidence. The diagnostic did not scope it to the active runtime and produced a false `dependencyFailureSignature: true` while `runtime.source` was `stable-runtime` and `zodPresent` was true. That false positive is fixed; the hosted product-surface class is still unclassified.
- The hosted product-surface class cannot be proven from local artifacts. No root cause is asserted for it without the exact blocked-call UI text and its local timestamp.

## Blockers / uncertainties

- The exact UI text and local timestamp of the reported safety-blocked calls were never captured, so the hosted-surface class remains unclassified.
- Acceptance C cannot be completed honestly until the account/workspace exposes a supported Refresh surface.
- Acceptance A remains pending until Chrome is naturally stopped or the user explicitly authorizes closing it.

## Next exact step

Read the current HEAD from Git, confirm the working tree is clean, and pick the next milestone from the still-open items. The recommended first step is to pin the mixed-repository publish-gate contract: assert, with a test, that a default `project_check` run leaves the declared native check `NOT_RUN` and that a typified `git_push` consequently fails closed, so the behaviour introduced by PR #57 is intentional rather than accidental. Then publish it through the usual path (non-`main` branch, full local gate, PR, hosted checks green on the PR's exact head, merge, verified cleanup). Re-run the full local gate first if HEAD or the working tree changed, and do not redeploy the live runtime unless `src/` changed.

Still open and deliberately unaddressed here: the publish-gate contract above is not pinned by a test (`tests/project-publish-gate.test.ts` is untouched); the hosted product-surface class stays unclassified until the exact blocked-call UI text and its local timestamp are captured; and Acceptance C stays blocked until the account/workspace exposes a supported Refresh surface.

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
