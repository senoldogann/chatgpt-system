# chatgpt-system — Active Project State

Last updated: 2026-09-13T18:46+03:00
Status: Final v1 hardening is complete locally. PR #41 exposed one macOS success-path runner close/signal race; the race is fixed locally with regression coverage. Remote watcher timeouts and Vitest integration-runner timeouts are now handled by durable project-wide rules. One state commit + fresh exact-head gate remain before updating PR #41, hosted CI, merge, cleanup, and v1 closure.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Finish the **final v1 hardening/release**: publish the locally merged Owner Runtime Phase 3 plus the four deep-review remediations, require exact-head local and hosted verification, merge the verified branch, rerun post-merge verification, and close the project without adding new features.

## Active workspace

- Authoritative development checkout: `/Users/dogan/Desktop/chatgpt-system`.
- Active branch: `fix/final-hardening-release`.
- Current pre-state feature HEAD: `2dccbb3` (`test: harden integration runner budgets`).
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
- `55c4189` — Desktop cleanup evidence; first PR #41 published head.
- `05dc036` — preserve completed Computer JS results when process-group signaling races with observed runner close; real cleanup failures remain fatal.
- `2dccbb3` — project-wide CI polling rule plus Vitest `--testTimeout=30000` runner budget; product/runtime timeout contracts remain unchanged.

## Current state

The four deep-review findings are now closed in the local implementation:

1. **Audit outcome integrity:** `AuditLogger.run()` no longer converts an already-completed side effect into a failed MCP operation when audit persistence fails. Original operation errors remain authoritative. Direct `record()` still reports storage failures. Writes are serialized; the active audit file is bounded to 16 MiB plus one `.1` generation.
2. **Browser diagnostic memory containment:** Playwright diagnostic strings are bounded before insertion into backend memory: diagnostic text at 2,048 chars and URL-like strings at 16,384 chars. Existing BrowserService sanitization/redaction remains defense in depth.
3. **Computer native-helper lifecycle:** owned helper cleanup is bounded graceful EOF -> SIGTERM -> SIGKILL. Fatal invalidation uses the same cleanup path without unhandled promise rejection. MCP never exposes PID/signal control.
4. **Non-loopback HTTP:** loopback remains the default. A non-loopback bind is rejected unless `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true` explicitly acknowledges an authenticated TLS reverse-proxy deployment. The acknowledgement does not add TLS and bearer authentication remains mandatory.

No authority profile, execution surface, native protocol method, root capability, or unrelated dependency was added by this hardening sprint.

## Verification

Current pre-final evidence from `/Users/dogan/Desktop/chatgpt-system`:

- TypeScript build: PASS on the current race-fix tree.
- Full Vitest suite using `--maxWorkers=25% --testTimeout=30000`: `107` passing test files + `1` intentional skipped file; `645/645` tests PASS + `2` intentional/environment-gated skips.
- The 25% worker contract remains the scheduler-contention control. The repository-wide 30-second Vitest runner budget replaces the unsuitable default 5-second budget for real Git/MCP/process integration tests; product/runtime timeout contracts are unchanged.
- PR #41 first published head `55c4189...`: hosted Node 22 and Node 24 passed. macOS-native initially failed after the 31-second Owner JavaScript completed, at `ComputerJsRunnerSupervisor.finishSuccess()` cleanup. The exact same hosted macOS job rerun passed fully, confirming a close/signal race rather than an implicit deadline failure.
- RED/GREEN regression coverage now proves that a process-group signal error is tolerated only when runner close is observed within the cleanup grace window; if the runner/descendant remains open, cleanup still fails closed. Focused supervisor suite: `11/11` PASS.
- Local Owner >30s acceptance after the race fix: `3/3` PASS; long run `31.317s`.
- Prior unchanged release gates: `npm audit --omit=dev` = `0` vulnerabilities; real PTY `1/1` PASS; Swift macOS Computer Runtime `164/164` PASS; branch diff-check PASS.
- Active process inspection confirms the daily-driver runner, tunnel client, and MCP daemon execute from `/Users/dogan/Desktop/chatgpt-system`; the LaunchAgent was reinstalled from Desktop before deleting the old clone/worktrees.
- Home checkout scan found only `/Users/dogan/Desktop/chatgpt-system` after cleanup.

The final publication claim will use a fresh clean exact-head gate after this state commit. Node/TypeScript and Swift are deliberately run sequentially; concurrent cold builds are not release evidence.

## Hosted acceptance state

- PR #41 (`fix/final-hardening-release` -> `main`) is open. Its first published head was `55c41895b2f62e8a63381c4f4875105f3d149564`.
- On that exact head, Node 22 and Node 24 passed. macOS-native failed once in the success-path close/signal race and then passed completely on an exact-head rerun.
- Local commits `05dc036` and `2dccbb3` supersede that published head and are not yet pushed. PR #41 must be updated only after the successor exact-head local release gate passes.
- Because `origin/main` is still `7aece8f5...`, PR #41 intentionally contains both the already-local Phase 3 merge and the final hardening sprint.
- Hosted evidence after the update must bind to the new exact PR head and require Node 22, Node 24, and macOS-native success plus a clean merge state.

## Next exact step

1. Run docs contract tests and `git diff --check` for this state update, then commit only `docs/PROJECT_STATE.md`.
2. Run the complete release gate sequentially on that exact successor SHA: TypeScript build + full Node suite; production audit; Owner >30s acceptance; real PTY; Swift; branch diff-check; clean status. Long commands use managed-process status polling; hosted status uses one-shot queries, never blocking watchers.
3. Run final branch-scope/security review and checkpoint Project Continuity against the exact verified Desktop head.
4. Push the verified successor to the existing PR #41 and verify remote head/base/server-side diff.
5. Require exact-head hosted Node 22, Node 24, and macOS-native CI success plus clean merge state using one-shot polling.
6. Squash-merge only the verified PR head, synchronize Desktop `main`, rerun the complete local release gate sequentially on the merge commit, and require hosted `main` CI success on the same merge commit.
7. Delete the merged feature branch locally/remotely, verify only clean `main` remains, checkpoint `chatgpt-system-desktop` as `completed`, and declare v1 complete.

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
- No implementation blocker remains. The remaining external gate is hosted CI on the successor PR head after the final exact-head local verification.
