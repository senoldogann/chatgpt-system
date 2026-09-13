# chatgpt-system — Active Project State

Last updated: 2026-09-13T18:15+03:00
Status: Final v1 hardening, release-harness stabilization, and local checkout cleanup are complete on the Desktop checkout. One final state commit + fresh exact-head verification remain before publication, hosted CI, merge, branch cleanup, and v1 closure.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Finish the **final v1 hardening/release**: publish the locally merged Owner Runtime Phase 3 plus the four deep-review remediations, require exact-head local and hosted verification, merge the verified branch, rerun post-merge verification, and close the project without adding new features.

## Active workspace

- Authoritative development checkout: `/Users/dogan/Desktop/chatgpt-system`.
- Active branch: `fix/final-hardening-release`.
- Current candidate feature HEAD: `8e56440f1fda3356a37df68971533f93d89cc057` (`docs: finalize release evidence`).
- Desktop local `main`: `5fd7262d7af98f5f1315d38f065ea57b2ad5f5cf` (Owner Runtime Phase 3 locally merged).
- GitHub `origin/main`: `7aece8f5cb1b4397de04704a41b95626a0b8e887` (Phase 2 published baseline; Phase 3 is not yet remote).
- The old `/Users/dogan/chatgpt-system` safety clone and all of its historical `/private/tmp`/managed worktrees have been removed after confirming no active process depended on them. `/Users/dogan/Desktop/chatgpt-system` is the only remaining project checkout.
- Project Continuity exact alias for active work: `chatgpt-system-desktop`.
- Final hardening design: `docs/superpowers/specs/2026-09-13-final-hardening-release-design.md`.
- Final hardening plan: `docs/superpowers/plans/2026-09-13-final-hardening-release.md`.

## Completed

### Published Owner Runtime baseline

- Phase 1 PR #39 merged as `0195a432bae370eb36dedf65056c874634f805dc`.
- Phase 2 PR #40 merged as `7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- Phase 3 Computer Runtime ceiling/cancellation work was fully verified and merged **locally** into `main` as `5fd7262d7af98f5f1315d38f065ea57b2ad5f5cf`; it has not yet been pushed to GitHub.

### Final hardening milestones

- `7276021` — final hardening design.
- `1e61d68` — final hardening implementation plan.
- `8c261a9` — audit outcome integrity and bounded storage.
- `00362e6` — Browser diagnostic acquisition/retention bounds.
- `b3da960` — Computer native-helper forced shutdown escalation.
- `6e6168f` — non-loopback HTTP explicit opt-in/fail-closed startup guard.
- `e9031df` — final release architecture/state handoff plus project-wide local-first/branch-cleanup/repo-cleanliness rules in `AGENTS.md`.
- `6f4de6a` — repo-level Vitest scheduler stabilization: full suite now runs with `--maxWorkers=25%`; temporary per-test timeout widening was reverted, so product/test semantic timeout contracts remain unchanged.
- `8e56440` — final release evidence handoff before publication.

## Current state

The four deep-review findings are now closed in the local implementation:

1. **Audit outcome integrity:** `AuditLogger.run()` no longer converts an already-completed side effect into a failed MCP operation when audit persistence fails. Original operation errors remain authoritative. Direct `record()` still reports storage failures. Writes are serialized; the active audit file is bounded to 16 MiB plus one `.1` generation.
2. **Browser diagnostic memory containment:** Playwright diagnostic strings are bounded before insertion into backend memory: diagnostic text at 2,048 chars and URL-like strings at 16,384 chars. Existing BrowserService sanitization/redaction remains defense in depth.
3. **Computer native-helper lifecycle:** owned helper cleanup is bounded graceful EOF -> SIGTERM -> SIGKILL. Fatal invalidation uses the same cleanup path without unhandled promise rejection. MCP never exposes PID/signal control.
4. **Non-loopback HTTP:** loopback remains the default. A non-loopback bind is rejected unless `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true` explicitly acknowledges an authenticated TLS reverse-proxy deployment. The acknowledgement does not add TLS and bearer authentication remains mandatory.

No authority profile, execution surface, native protocol method, root capability, or unrelated dependency was added by this hardening sprint.

## Verification

Current pre-final evidence from `/Users/dogan/Desktop/chatgpt-system`:

- TypeScript build: PASS.
- Full Vitest suite using the repository contract `--maxWorkers=25%`: `107` passing test files + `1` intentional skipped file; `643/643` tests PASS + `2` intentional/environment-gated skips.
- Root cause for the earlier Git/process/PTTY integration timeouts was repo-level worker contention at `--maxWorkers=50%`; the permanent harness contract is 25% and temporary per-test timeout widening was reverted.
- One later `computer-js-integration` run produced a single generic `COMPUTER_JS_FAILED` after successful user-code completion. It passed immediately in isolation. Temporary env-gated signal diagnostics were added only to the local worktree, then five consecutive full-suite runs all passed with no signal error logged; the diagnostics were reverted completely and no production fix was made for a non-reproducible transient.
- Prior release gates on the same hardening tree: `npm audit --omit=dev` = `0` vulnerabilities; Owner >30s acceptance `3/3` PASS; real PTY `1/1` PASS; Swift macOS Computer Runtime `164/164` PASS; branch diff-check PASS.
- Active process inspection confirms the daily-driver runner, tunnel client, and MCP daemon execute from `/Users/dogan/Desktop/chatgpt-system`; the LaunchAgent was reinstalled from Desktop before deleting the old clone/worktrees.
- Home checkout scan found only `/Users/dogan/Desktop/chatgpt-system` after cleanup.

The final publication claim will use a fresh clean exact-head gate after this state commit. Node/TypeScript and Swift are deliberately run sequentially; concurrent cold builds are not release evidence.

## Hosted acceptance state

- `fix/final-hardening-release` is not yet published to GitHub.
- No final-release PR or hosted-CI claim exists yet.
- Because `origin/main` is still `7aece8f5...`, the final PR will intentionally contain both the already-local Phase 3 merge and this final hardening sprint.
- Hosted evidence must bind to the exact published PR head and require Node 22, Node 24, and macOS-native success plus a clean merge state.

## Next exact step

1. Run docs contract tests and `git diff --check` for this final state update, then commit only `docs/PROJECT_STATE.md`.
2. Rerun the complete release gate sequentially on that exact successor SHA: TypeScript build + full Node suite; production audit; Owner >30s acceptance; real PTY; Swift; branch diff-check; clean status.
3. Run final branch-scope/security review: no authority widening, new execution surface, bearer-auth weakening, native protocol/TCC identity change, or unrelated dependency/lockfile drift.
4. Checkpoint Project Continuity against the exact verified Desktop head.
5. Publish only `fix/final-hardening-release`, open one PR to GitHub `main`, and verify remote head/base/server-side diff.
6. Require exact-head hosted Node 22, Node 24, and macOS-native CI success plus clean merge state.
7. Squash-merge only the verified PR head, synchronize Desktop `main`, rerun the complete local release gate sequentially on the merge commit, and require hosted `main` CI success on the same merge commit.
8. Delete the merged feature branch locally/remotely, verify only clean `main` remains, checkpoint `chatgpt-system-desktop` as `completed`, and declare v1 complete.

## Invariants

- `/Users/dogan/Desktop/chatgpt-system` is the authoritative local project location.
- Project/User authority remains narrow; Owner capabilities require Admin plus explicit startup gates.
- Bearer authentication is never optional in HTTP mode.
- Audit, browser, PTY, shell, managed-process, Git, Project Exec, and Computer Runtime content/privacy boundaries remain intact.
- No TCC, Accessibility, Screen Recording, sudo, Keychain, SIP, or OS-authentication bypass is introduced.
- Final claims use fresh exact-head evidence; a new commit invalidates older local/hosted CI evidence.
- The user has explicitly authorized completing the remaining publication, merge, post-merge verification, and v1 closure sequence.
- Project-wide lifecycle rule: all implementation/tests/checks happen locally on a non-main branch first; only a clean fully green local tree is published as a PR and merged after exact-head hosted CI.
- After a verified merge, unused merged branches/worktrees are removed safely; dirty/unmerged or unfamiliar agent work is never force-deleted.
- The authoritative checkout must finish clean (`git status` clean) with no unrelated generated/stale project state.

## Blockers / uncertainties

- No known implementation blocker remains.
- Hosted CI is the remaining external release gate after the final local exact-head verification.
