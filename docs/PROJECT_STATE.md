# chatgpt-system — Active Project State
> **Current branch-local handoff (2026-09-17):** `fix/browser-computer-reliability-20260917`, isolated managed worktree `9eb34010-c986-4586-b8ec-474ec41f054c`, based on the clean, unpublished `fs_stat` fix at `4ccd421`. Git reality outranks this cache; do not modify `main`, its pre-existing `.freebuff/`, or other worktrees.
> **Browser root cause reproduced:** existing-Chrome adapter marks non-HTTP pages closed, while backend drops their opaque IDs without clearing its page-to-ID map or rediscovering returned eligible pages. Two tests failed RED: a returned HTTP tab remained absent, and a tab observed as ineligible reused its stale ID. Backend now synchronizes eligible context pages on `tabs()`, unregisters ineligible entries and clears the reverse ID mapping. Both tests GREEN; old IDs remain invalid and Chrome-internal pages stay hidden.
> **Browser verification before this handoff edit:** focused 31/31; `npm run check` TypeScript build and 756 passed / 2 skipped (758 total), exit 0. Native macOS tests 215/215, exit 0. No live Browser/Chrome acceptance or deployed-runtime test was performed; the prior intermittent incident and `BROWSER_UNAVAILABLE` are not conclusively explained by this separate proven lifecycle defect.
> **Computer Use still open:** `type_text` groups up to 20 UTF-16 code units in one CGEvent key-down/up; a previous Calculator trial displayed only the first of two digits. Cause cannot be attributed to chunking or app behavior without a controlled fixture-versus-Calculator comparison. Read-only observation showed another user application active, so no focus-changing, physical typing, or native code change was attempted. The 215 native unit tests pass but do not establish real GUI typing behavior.
> No running MCP, tunnel, LaunchAgent, browser, Chrome profile, native runtime, remote branch, or `main` was changed. The `fs_stat` and Browser fixes remain unpublished and are not active in the live MCP runtime.
> **Next exact step:** review the three-file branch diff, run whitespace checks, commit the Browser fix locally, rerun Node/native verification at the exact commit, and checkpoint the branch SHA. For Computer A/B, obtain a quiet user-approved fixture GUI window and record the exact observed input outcome before changing native input semantics. Push/PR/merge/deploy require separate authorization.

Last updated: 2026-09-17
Status: **PR #57 through #61 are merged and their branches deleted. Read the current HEAD from Git. This revision rides with `fix/test-evidence-trustworthiness-20260917`, which keeps the local test gate out of the operator's audit log and pins the mixed-repository publish composition. The live MCP runtime is repointed at `a83dfe6`, which the docs/scripts/tests-only commits after it leave unchanged, so the deployed `dist` is the same source and no redeploy is needed. Everything still open needs an external artifact or a user decision; nothing is locally actionable.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank this file. Resume the exact alias named below before acting.

## Current goal

No branch is in flight beyond this revision, and every locally actionable item found so far is closed. Start new work from a fresh reading of Git and the open lists below, and record the milestone here before starting it. Keep the still-unclassifiable hosted MCP failure class reported rather than guessed. Do not redeploy the live runtime for changes that touch only docs, scripts or tests; touching the tunnel profile, LaunchAgent, Chrome profile or Computer Runtime needs its own explicit authorization.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`, currently equal to `origin/main`.
- Project Continuity alias: `chatgpt-system-desktop`.
- In-flight: `~/.chatgpt-system/agent-worktrees/evidence-trust` on branch `fix/test-evidence-trustworthiness-20260917`, branched from the post-#61 `main`. It is removed once merged. The `diagnose-runtime-signature`, `state-post-merge` and `poll-backoff-vocabulary` worktrees and branches were already removed after their content was proven equivalent to the squash commits `main` received.
- Read the current HEAD from Git; never infer it from this file. The evidence below was produced on the branch tip and must be re-run after any further HEAD or worktree change.
- Superseded clean worktrees `fix/project-check-native-routing-20260916` (`df20759`) and `fix/git-diff-check-20260917` (`5c5c62e`) remain present. Their contribution is already in `main` via PR #57; they are not content-equivalent to `main` and deleting them would need a force delete, so they were left alone.
- Detached runtime worktree `~/.chatgpt-system/runtime/chatgpt-system-main` is the tunnel target and is now checked out at `a83dfe6` with `dist` rebuilt from that source and the daily-driver restarted onto it, under explicit user authorization. Its files other than `dist` stay frozen at that commit, so its copy of `scripts/diagnose-chatgpt-connection.mjs` predates PR #59 and #61: run `npm run diagnose:chatgpt` from the authoritative checkout, never from the runtime worktree, where the script still reports both false positives. The merged PR branches that are not content-equivalent to `main` need a force delete, so they were left alone. The preserved dirty `feat/computer-use-perception-reliability` worktree also remains intentionally present. Do not repurpose, clean, or delete any of them.
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
- PR #61 merged that wording fix as `main@888dc07`.
- The local test gate no longer writes fixture rows into the operator's audit log, and the mixed-repository publish composition is pinned end to end.
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
11. The publish composition is pinned end to end: in a mixed repository a default `project_check` run leaves the declared native check `NOT_RUN`, persists exactly that, and the real `ProjectPublishGate` then refuses typified publication with `LOCAL_VERIFICATION_REQUIRED` on that status without ever reaching the Admin push path. A control case asserts that a sandbox-verified repository publishes the expected branch at the verified HEAD.
12. No test builds runtime services without an explicit `auditFile`. Two suites previously used the default `~/.chatgpt-system/audit.jsonl` and added roughly 20 fixture rows per `npm run check` — including `authority.start` with an Admin profile and `shell.run` — to the very file used as failure-boundary evidence. A guard test fails when a file has more `createRuntimeServices(` calls than `auditFile` occurrences, so a second fixture in the same file cannot slip through again.

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
- the audit pollution was measured and closed: on the same machine, five `npm run check` runs added five identical 20-row fixture batches to the live audit log, and after the fix the full gate adds **0 rows** while the same 120 test files pass;
- the new guard was shown RED against the pre-fix file: the count rule sees `createRuntimeServices=2 auditFile=0` in `owner-shell-mcp.test.ts` on `main`;
- the publish-composition tests were reproduced RED first (`report` reflects persisted evidence rather than running checks, so the tests only passed once they executed a real sandbox run before consulting the gate), then GREEN;
- the unrecognised poll-backoff wording was reproduced against the live tunnel log: the retained window holds eight `poll failed; backing off` records, and the live `09:51:44Z` one was followed 31 seconds later by `poller recovered; polling operational`. On the same machine, log and 30-minute window, `main` classified `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE` with `recoveredPollBackoffCount: 0`, while the fixed branch reports `LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE` with `recoveredPollBackoffCount: 1` and keeps `warningCount: 1` visible;

Not run: `npm audit`, runtime/fixture packaging, codesign verification, and a freshness-bound typed `project_check`. Hosted CI is green on the exact merged heads of PR #59 (`c75cabf`), PR #60 (`8254e20`) and PR #61 (`dde56a8`) — `macos-native`, Node 22 and Node 24 all passed — so only the remaining items above still must not be reported as passing.

## MCP failure-boundary classification

- The tunnel forwarded 2113 commands in the retained 1 MiB log window; the last forwarded command was `2026-09-17T07:54:24Z`.
- Audit activity at `08:40Z` and `08:43Z` post-dates that last forwarded command, so those calls reached the MCP server from a non-tunnel local client. The last tunnel command and the last audit record do **not** correspond.
- `fs.patch` accounts for 171 of 214 recorded `INTERNAL_ERROR` audit entries. That class is now a local defect with a typed fix, not a hosted block.
- Lease-resolution denials are now inside audit coverage as `authority.denied` / `AUTHORITY_REQUIRED`, so the local authority-refusal class is measurable from the audit file without weakening the authority model.
- Two false positives in the same tool class were found by reading its own bounded artifacts rather than by guessing: an unscoped dependency signature, and a poll-backoff wording the recovered-backoff counter did not recognise. Both made the diagnostic attribute a non-existent local failure to the active runtime, which is the failure mode `AGENTS.md` warns about when it forbids restarting a healthy tunnel.
- A dependency signature sitting in the retained stderr window is not by itself runtime evidence. The diagnostic did not scope it to the active runtime and produced a false `dependencyFailureSignature: true` while `runtime.source` was `stable-runtime` and `zodPresent` was true. That false positive is fixed; the hosted product-surface class is still unclassified.
- About 100 rows in the live audit log between `09:42Z` and `09:55Z` are local test fixtures, not client traffic: they arrive in identical 20-row batches (`authority.start` x12 with an Admin profile, `shell.run` x3, `terminal.session.*`, `process.run`, `fs.patch`, `git.read`), one batch per gate run. Discard that signature before counting authority or shell usage in that window; it is no longer produced after the fix. Hosted-side traffic in the same window looks different — four forwarded commands at `09:41:25Z`–`09:41:52Z` with **no** audit rows, consistent with a session handshake and tool-list refresh rather than tool execution.
- The hosted product-surface class cannot be proven from local artifacts. No root cause is asserted for it without the exact blocked-call UI text and its local timestamp.

## Blockers / uncertainties

- The exact UI text and local timestamp of the reported safety-blocked calls were never captured, so the hosted-surface class remains unclassified.
- Acceptance C cannot be completed honestly until the account/workspace exposes a supported Refresh surface.
- Acceptance A remains pending until Chrome is naturally stopped or the user explicitly authorizes closing it.

## Next exact step

Nothing is locally actionable. Read the current HEAD from Git, confirm the working tree is clean, and pick up one of the externally blocked items:

1. Close the hosted product-surface class: capture the exact UI text of one safety-blocked call plus its local timestamp, then rerun `npm run diagnose:chatgpt` near that time and record the classification. That single input is what the unclassified boundary is missing.
2. Acceptance C needs the account/workspace to expose a supported Refresh surface.
3. Acceptance A needs Chrome naturally stopped, or explicit user authorization to close it.

Correction of an earlier claim in this file: the gate half of the publish contract was already pinned before PR #57 — a typified push carrying `overallStatus` `NOT_RUN`, `FAIL` or `UNAVAILABLE` was already refused with `LOCAL_VERIFICATION_REQUIRED` — so "the publish-gate contract is not pinned by a test" was wrong. What was genuinely missing was the composition with a real `project_check` run, and that is now pinned as well.

Publish anything new through the usual path (non-`main` branch, full local gate, PR, hosted checks green on the PR's exact head, merge, verified cleanup), and re-run the full local gate if HEAD or the working tree changed.

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
