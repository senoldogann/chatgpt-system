# chatgpt-system — Active Project State

## 2026-09-20 Workspace cleanup — local delivery

- Worktrees went from 21 to 3. Kept: the canonical checkout, `~/.chatgpt-system/runtime/releases/2a7c8b7` (live MCP child PID and the LaunchAgent runner both resolve here through `chatgpt-system-main -> current`), and `chatgpt-system-main-062f73a-20260919-v2` (the rollback target behind `previous -> releases/062f73a`, which is a symlink to that worktree, not a separate directory).
- `npm run diagnose:chatgpt` reported runtime source `stable-runtime` before any removal, so the managed-worktree cleanup guard was satisfied. The live tunnel and MCP child were never restarted and remain up.
- Every removed worktree had a HEAD that is an ancestor of `main`. Two were force-removed after their content was verified redundant and archived: the stale acceptance deployment (untracked `action-review-cli.ts`, `process-wrapper.ts` and their test were byte-identical to `main`) and the browser-reliability worktree carrying the Jev/MLX spike.
- Archive at `~/.chatgpt-system/archive/20260920-cleanup/`: both uncommitted runtime diffs, the branch-tip and worktree inventories, the Jev/MLX spike minus its 1.3 GB re-downloadable model weights, and 20 stale managed-worktree ownership records.
- All 20 local branches other than `main` were deleted with plain `git branch -d`; no force delete was needed because every branch was already merged. Remote branches were not touched and nothing was pushed.
- Ownership records: 20 dangling entries removed (17 from this repo's removed worktrees, 3 from the defunct `/Users/dogan/chatgpt-system` checkout). The 6 remaining records belong to the separate MacAgent projects and were deliberately left alone.
- Disk: `~/.chatgpt-system` 8.6 GB -> 1.5 GB; repository `.git` 39 MB -> 2.3 MB after `git gc --prune=now`.
- Verification after cleanup, bound to `HEAD 04a295d`: `npm run check` **exit 0** (911 passed, 2 skipped) and `npm run test:computer:macos` **exit 0** (226/226). Live runtime process confirmed still running afterwards.
- Safety refs retained: tags `backup/main-pre-merge-20260920` and `backup/docsbranch-pre-merge-20260920`.
- **Next exact step:** unchanged from the integration entry below — restore the Project Docker sandbox lane so `project_check` can reach an exact-head PASS, then seek explicit authorization to push `main` and open the PR.

## 2026-09-20 Open-branch integration into main — local delivery

- Every open local branch is now reachable from `main@fcaec9e`; `git branch --no-merged main` is empty. Publication was not performed: `main` is 127 commits ahead of `origin/main` and no push, PR or deployment occurred.
- Safety refs before the operation: tags `backup/main-pre-merge-20260920` (`0c1d5a0`) and `backup/docsbranch-pre-merge-20260920`. Branch-tip inventory kept at `/tmp/merge-all-20260920/`.
- Uncommitted work in six development worktrees was committed on its own branch first, so nothing was discarded. Deliberately hidden spike artifacts (`.jev-mlx-spike-20260918/`, dot-prefixed `scripts/.stdio-timing-*`) were left untracked. The four detached runtime/release worktrees under `~/.chatgpt-system/runtime/` were not touched and no service was restarted.
- Seven branches were content-merged. Six parallel computer-use lines carried 1-4% content not already present in `main` in refined form and were recorded with `-s ours` rather than resurrecting superseded implementations of a safety-critical input path. Their novel work was cherry-picked separately where it was not superseded: the personal-admin timeout contract and the native perception decoders landed; the `feat/computer-use-perception-reliability` daily-driver script change was skipped because its version predates TypeSafe Keychain support and would have regressed the credential path.
- Branch-local `docs/PROJECT_STATE.md` sections were not union-merged; this consolidated entry replaces them. Per-branch handoff text remains in Git history.
- Integration fallout fixed under test: `fs_apply_patch` had regressed to silently returning the unchanged file for hunk-free patch text, so `validateUnifiedPatch` now lives in `src/unified-patch.ts` and is shared by `fs-service` and `patch-set-service`; the computer-use flow benchmark gained the two Jev error codes; the semantic-target lease assertion was split by personal-admin mode.
- Verification bound to exact `HEAD fcaec9e`: `npm run check` **exit 0** (134 files passed, 1 skipped; 911 tests passed, 2 skipped) and `npm run test:computer:macos` **exit 0** (226/226). `git diff --check` clean. Hosted CI, `project_check` publication evidence and live deployment were not run.
- **Next exact step:** decide whether the six `-s ours` branches should stay recorded-only or have specific hunks re-integrated target-by-target. Before any publication, obtain fresh `project_check` PASS on the exact publish head — the Project Docker sandbox lane is still the open blocker — then push and open the PR under explicit authorization.

## 2026-09-20 Conservative branch cleanup — local handoff

- Canonical `main` and `origin/main` remain exactly `0c1d5a0038db496d2bb6acc600db7d803e89f67d` with identical tree `11ec24f1494944e6ce52537e12ce9992ea906a5c`. The tracked tree is clean; user-owned `.freebuff/project-id` remains untracked and untouched.
- Four local branches whose commits remain reachable from `main` were deleted with normal `git branch -d`: `feat/jev-semantic-target-resolution-2026-09-19`, `fix/computer-protocol-validation-2026-09-17`, `fix/jev-keychain-credential-transfer-2026-09-19` and `fix/swiftpm-project-check`. The clean plugin-owned SwiftPM worktree was removed through the managed worktree tool before its branch was deleted.
- The remote branches for merged PRs #48, #54 and #56 were already absent and their stale remote-tracking refs were pruned. The exact remote branches for merged PRs #63, #64 and #65 were deleted normally. The remote now has only `main`, the open PR #49 head `dependabot/npm_and_yarn/types/node-26.5.1`, and intentionally retained `feat/computer-use-bridge`.
- Runtime diagnosis returned `LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE` with source `stable-runtime`; no managed worktree was the active runtime. No service restart, deployment, force-delete, reset, stash, clean or force-push occurred.
- `fix/chatgpt-connection-resilience-20260920` and `fix/workflow-fast-path-20260920` are ancestors of this retained docs branch, but their managed-worktree status calls were refused by the Project scope. That refusal was not bypassed through shell removal, so both remain. Branches with unique commits, dirty worktrees, open publication work or uncertain ownership also remain; their deletion would require an explicit target-by-target discard decision rather than broad cleanup.
- **Next exact step:** keep the remaining dirty/runtime worktrees and the three unpublished integration candidates intact. If further pruning is desired, first classify each remaining unique branch and obtain explicit discard approval for the exact branch/worktree list; never use a broad force-delete. The separate publication blocker remains restoration of the declared Project sandbox lane before the three candidate branches can be updated, pushed and merged.

## 2026-09-20 GitHub integration handoff — PR #48 merged; local branches blocked

- The user authorized publication and merge only for PR #48/#49 and the three prepared branches. `project_resume` returned Continuity v171 and the registered root `/Users/dogan/Desktop/chatgpt-system`; a Persistent Owner Admin lease was reused. No new persistent Admin session, force-push, reset, stash, live deployment or service restart occurred.
- PR #48 (`zod`) was updated with then-current `main@2a7c8b7`, producing exact head `e22ff27451b152a9048df1bf46b69ad71c670d1d`. Fresh hosted CI run `35524875003` passed Node 22, Node 24 and `macos-native` on that head. A head-pinned normal GitHub merge produced `main@0c1d5a0038db496d2bb6acc600db7d803e89f67d`; local `main` was fast-forwarded to the same commit.
- The three prepared branches remain local and unpushed. Direct `project_check` calls against their external worktrees were refused before execution as outside the resumed Project root; no alternate lease, endpoint or terminal substitute was used. Each branch was then checked at the registered canonical root without changing its commit: `docs/risk-tiered-development-20260920@4e53ccd`, `fix/types-node-26-integration-20260920@e7221fe` and `fix/fs-stat-not-found-main-20260920@6ed7c40`. On every exact head the native macOS lane passed with exit 0, but the sandboxed `npm run check` lane returned `UNAVAILABLE` with exit `null`, so all three overall results were `UNAVAILABLE`, not PASS. Typed push was not called and no PR was opened for any of them.
- PR #49 remains open at failed Dependabot head `616d7cad004263b84710a5b525a49e9c7f34fafb`. The corrected successor was not published because its `project_check` was not PASS, so the condition for commenting on and closing #49 was not met.
- Fresh post-merge verification on `main@0c1d5a0` passed: `npm run check` exit 0, 123 test files passed and 1 skipped, 798 tests passed and 2 skipped; `npm run test:computer:macos` exit 0, 215/215 tests passed. These host results verify the merged tree but do not replace the missing sandbox evidence for the three unpublished branches.
- The canonical tracked tree remains clean with only user-owned `.freebuff/project-id` untracked. All unrelated dirty and runtime worktrees were preserved. The three candidate worktrees were restored to their original branches after the canonical-root checks; none was cleaned, reset, stashed or deleted.
- **Next exact step:** restore the declared Project Docker sandbox lane through the supported runtime/operator path without host fallback or a security-boundary bypass. Then resume the exact alias, reconcile `main@0c1d5a0`, update each still-relevant candidate from current `main` in an isolated clean worktree, rerun both detected `project_check` lanes to an overall exact-head PASS, and only then use typed push, PR CI and sequential merge. Keep PR #49 open until the corrected successor PR is successfully published and verified.

## 2026-09-20 Risk-tiered development protocol — local handoff (not published)

- Isolated branch `docs/risk-tiered-development-20260920` starts at `33b6c1d` in managed worktree `45024643-4eb7-4ca6-857f-667facdf3dad`. Canonical `main@2a7c8b7`, `.freebuff/`, the prior optimization/resilience branches and live runtime were left untouched.
- `AGENTS.md` now defines low-risk focused checks and a short status, normal-development focused tests plus completion full gate, and comprehensive critical checks. Project Continuity is the primary working record; this file changes for significant decisions, handoff or delivery only. Identity, fail-closed, other-agent safety, exact-HEAD publication and explicit live-deployment permission remain mandatory.
- Tests were written first: RED targeted `npm test` exit 1 (3 expected failures); after the procedure change, focused suites exit 0 (13 passed across four files). The first managed full check printed green tests but ended with `SIGTERM` and no exit code, so it is not PASS.
- Independently rerun `npm run check` returned **exit 0**: TypeScript build passed, 125 test files (124 passed, 1 skipped), 810 tests (808 passed, 2 skipped). No hosted CI, native macOS suite, `project_check` publication proof or live deployment was run.
- After this handoff-file edit, two exact-tree full `npm run check` reruns exited **1** in unchanged `tests/process-supervisor.test.ts` (cursor timing assertion, then `ENOTEMPTY` test cleanup). A focused supervisor rerun also exited **1** on a different late-result timing assertion. The final tree does not have a passing full gate; no supervisor code was changed. Do not publish until a fresh complete verification passes.
- **Next exact step:** after the local commit, read its exact HEAD from Git and investigate the unchanged supervisor timing/cleanup failures separately. Obtain fresh full verification and `project_check` evidence bound to that committed HEAD before any separately authorized push/PR; live deployment needs its own explicit permission.

## 2026-09-20 Workflow fast path — isolated local optimization (not deployed)

- Branch `fix/workflow-fast-path-20260920` is isolated at a managed worktree based on the preceding `9bd0736` resilience commit. Canonical `main`, `.freebuff/`, other worktrees, the live tunnel and the current runtime were not modified; no push, merge or deployment was performed.
- The existing non-expiring Persistent Owner Admin lease is reused: `project_resume` first, and an existing Admin lease or one status lookup only if an Admin-only action becomes necessary. Explicit per-operation authority and hosted approval checks remain unchanged.
- Vitest worker reuse (`--no-isolate`) and 50% available workers replace the prior isolated 25% configuration. On this 10-core/16-GiB Mac, the previous committed full Vitest run took 87.58 s; a 50%-worker trial took 49.09 s and the optimized `npm run check` test phase took 51.92 s. These are observations, not a cross-machine speed guarantee. All required checks remain enabled.
- A higher-concurrency test exposed a real recovery race: after a wrapper exited but before its independent result was observable, a restored process could transition to `unknown` forever. A regression reproduced the late authentic result RED, then passed GREEN after `refreshRecovered` was limited to re-checking its validated result for unknown records. The cross-daemon test now coordinates exit through an explicit file handshake instead of a ten-second sleep. Unknown records without independent evidence stay unknown.
- A screenshot displayed `Bağlantı kesildi. Tam yanıt bekleniyor` near 06:46 local time. A 15-minute sanitized local diagnostic shortly afterward showed a running daily-driver, 28 forwarded calls, zero WARN/ERROR, zero stdio failures and zero response-deadline events. This does not determine the hosted stream's cause or establish a local tunnel failure.
- Source commit `dbdd693` was independently verified with `npm run check` exit 0: 805 passed, 2 skipped, 0 failed tests across 124 files; full test phase 50.38 s. The branch diff passed `git diff --check`. Hosted Node 22/24 CI and live deployment were not run.
- **Next exact step:** keep this locally verified branch available for review. If publication is explicitly requested, revalidate the final exact HEAD, run required fresh verification and hosted CI through the normal PR flow, then separately plan live deployment and rollback. Do not restart the healthy tunnel for a ChatGPT Web stream symptom.

## 2026-09-20 ChatGPT connection resilience — isolated local implementation (not deployed)

- The user approved implementing the connection-resilience recommendations. Work is isolated on branch `fix/chatgpt-connection-resilience-20260920`, based on `main@2a7c8b7`, in plugin-managed worktree ID `dda81326-54b8-4b71-af3f-4886ea375fe2`. The canonical `main`, its user-owned `.freebuff/`, all pre-existing worktrees and the live daily-driver runtime remain untouched. No push, PR, merge, tunnel restart, catalog refresh, secret access or deployment occurred.
- Tunnel-client `0.0.14` retained logs contain 17 `INFO`-level `command response deadline reached; dropping without posting a response` events on 2026-09-19 that the old diagnostic missed. The fixed diagnostic adds a distinct `MCP_RESPONSE_DEADLINE_EVIDENCE` classification, bounded last-20 failure timestamps without identifiers, and offset-aware `--at` historical windows. Historical classification ignores present-day service/runtime health. A real 30-minute window ending `2026-09-19T19:05:30+03:00` reports 6 deadline drops; current diagnostic still reports no recent local-failure evidence.
- Process-supervisor tests now wait for child readiness, control-socket readiness and terminal process state instead of fixed sleeps. The initially reproducible SIGTERM and intermittent missing-log/socket failures were isolated to test startup assumptions; `src/process-supervisor.ts` production execution and all authority/security boundaries remain unchanged.
- `README.md`, `AGENTS.md` and `docs/CHATGPT_WEB_RESILIENCE.md` document the short-call managed-process workflow, the difference between per-command deadline and connection TTL, passive health inspection, and no blind restarts/authority escalation/concurrency tuning.
- Verification after final code review: `npm run check` **exit 0: 803 passed, 2 skipped, 0 failed**, 124 test files (123 passed, 1 skipped). Focused diagnostics, docs and process suites separately passed. A prior managed `npm run check` printed a green Vitest summary but its supervising job ended with `SIGTERM`, so only the independently run gate with verified exit code 0 is claimed. The attempt to read new health routes at default `127.0.0.1:8080` returned 404; that URL was not established as the running tunnel's health listener and no health-failure claim is made.
- **Next exact step:** review the isolated branch diff/commit and verify `git diff --check` plus source-branch status. Publication/deployment requires separately explicit authorization and fresh verification tied to the exact publish head. Before any live replacement, confirm active runtime source, supported tunnel health URL, real tool catalog compatibility and rollback readiness. Do not restart merely for the Web-stream symptom; preserve the clean release and any unrelated dirty worktree.


## 2026-09-19 final Git integrity gate

- Current branch: `fix/computer-protocol-validation-2026-09-17`; working tree remains intentionally dirty with pre-existing and current uncommitted changes. No commit, push, reset, stash, cleanup, or live deployment was performed.
- `stagePaths()` now retains the approved raw bytes, creates a Git blob from those bytes, and writes only that blob plus the detected `100644`/`100755` mode via `git update-index --cacheinfo`. It does not invoke `git add` on the mutable worktree after the final review check. Deleted paths use `git update-index --remove`. Post-write verification compares index blob identity to a raw `hash-object --stdin` result, not UTF-8-converted `git show` output.
- Deterministic final-check-to-index-write mutation now stages the approved bytes, not the later unapproved worktree content. Text, binary, executable-mode, deletion, and unrelated-index preservation tests are covered. Secret/binary/artifact labels remain path/content heuristics and are not a substitute for review; bounded review must be used and sensitive contents are not emitted by classification alone.
- Regression evidence: initial race test was RED (`stagePaths()` resolved and would have staged the changed worktree content; exit 1). After the fix: focused Git suite exit 0, 14 tests passed; full `npm run check` exit 0, 120 files, 778 passed, 2 skipped; `git diff --check` exit 0. Live MCP catalog/deployment acceptance was not run.
- Next exact step: stop feature development and perform the separately authorized live MCP acceptance, comparing running-runtime version/HEAD with the source checkout, actual tool catalog, and reconnect scenario. Do not infer live state from build or local tests.

> **2026-09-18 newer branch-local handoff:** On canonical `fix/computer-protocol-validation-2026-09-17` (baseline HEAD `dd4f80b`), a `review-action` local CLI addition is under review. It invokes the existing trusted macOS **User-profile authentication**, then independently requests exact terminal confirmation for a caller-supplied CLICK scope. It creates only an in-process, consumed-once `REVIEW_ONLY` result; no authority lease, browser/Computer action, model action binding, signed-helper replacement, live runtime change, publication or deployment. Fresh `npm run build` passed; focused CLI/native-broker test selection 51/51 passed. Full repository check, physical macOS helper acceptance and live MCP integration were NOT run.
> **Security blocker:** user-supplied CLI scope is not authenticated ChatGPT conversation provenance; protected helper alone does not display exact action. Real Browser dispatch-time same-node identity plus semantic uniqueness remains unproven, so no model-sourced mutation can be enabled. Previously platform-blocked benchmark aggregation must not be retried by another route.
> **Next exact step:** Verify current branch diff and local checks, then independently review this source-only CLI change; require explicit permission for any real native UI acceptance test or publication. Keep browser execution disconnected until its separate event-time invariant is proven.


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
