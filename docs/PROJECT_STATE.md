# chatgpt-system — Active Project State

Last updated: 2026-09-13T23:34+03:00
Status: **Tasks 1-7 implementation/local acceptance complete; final exact-state verification is next, with publication awaiting explicit user authorization.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile Git/worktree reality first, then read the active spec and plan.

## Current goal

Implement the approved Owner Workstation + Verified Project Session slice:

1. explicit Owner Workstation daily-driver mode with practical full current-user local capability;
2. unattended readiness through stable Computer Runtime identity and non-interactive access to `chatgpt-system`'s own Keychain credential, without macOS security bypass;
3. fail-closed local-first typed publication requiring fresh verification for the exact state being pushed;
4. exact `project_resume` provenance before registered-project typed publication.

## Active workspace

- Authoritative registered checkout: `/Users/dogan/Desktop/chatgpt-system`, now on `feat/owner-workstation-verified-project-session`.
- Active implementation/publication branch: `feat/owner-workstation-verified-project-session`.
- Preserved managed implementation worktree: `/Users/dogan/.chatgpt-system/worktrees/e4eaca835975a22d75cc3e7778bb895500595d13b544a96d350c557d9edad976/71bcabad-7ca8-4a45-8788-fc44ff0e2fcf`, detached at `eb05294a81f63fcf9b83ae35ae21f9e5667784ea` so the branch can be checked out at the registered publication worktree without deleting the isolated worktree before merge.
- Managed worktree ID: `71bcabad-7ca8-4a45-8788-fc44ff0e2fcf`.
- Implementation worktree started from exact planning HEAD `a90fdc5f3a2b99ac7bbf85be3f45206a3d2fdafc`.
- Branch base: clean synchronized `main` at `57e7a9ebc3bb3be555b6bab3a228b40d833425f1`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Active design spec: `docs/superpowers/specs/2026-09-13-owner-workstation-verified-project-session-design.md`.
- Active implementation plan: `docs/superpowers/plans/2026-09-13-owner-workstation-verified-project-session.md`.
- Task 1 Owner Workstation preset is committed at `31ec3d2`.
- Task 2 unattended Keychain path is committed at `7233fd9`.
- Task 3 Owner Workstation readiness status is committed at `762af40`.
- Task 4 Continuity resume registry is committed at `5d1e273`.
- Task 5 freshness-bound publish gate is committed at `ce2a99f`.
- Task 6 dual-authority MCP publication wiring is committed at `e02f85b`.
- Final workflow/docs commit before this state-only transition checkpoint: `eb05294a81f63fcf9b83ae35ae21f9e5667784ea`.

## Completed

- Approved design and seven-task implementation plan committed at `a90fdc5f3a2b99ac7bbf85be3f45206a3d2fdafc`.
- Project Continuity alias `chatgpt-system-desktop` resumed and reconciled against live Git/worktree state.
- Superpowers-managed implementation worktree created from the exact planning commit.
- `npm ci` completed with 0 reported vulnerabilities.
- Focused baseline regression tests, the full Node/TypeScript gate, and the macOS Computer Runtime suite are GREEN after minimal remediation.
- Task 1 Owner Workstation preset completed and committed at `31ec3d2`.
- Task 2 dedicated Keychain store/read/delete path completed and committed at `7233fd9`.
- Task 3 deterministic/passive Owner Workstation readiness status completed and committed at `762af40`.
- Task 4 bounded in-memory resume-context evidence completed and committed at `5d1e273`.
- Task 5 freshness-bound publish gate and exact verified-HEAD Git push completed and committed at `ce2a99f`.
- Task 6 dual-authority `git_push`, resumed-worktree identity revalidation, and MCP integration coverage completed and committed at `e02f85b`.

## Current state

- Initial `npm run check` reproduced two baseline failures before Task 1.
- `tests/project-continuity-docs.test.ts` failed because the planning handoff rewrite removed required live-state headings.
- `tests/terminal-session-supervisor.test.ts` failed under the harness `TERM=dumb`; `sanitizedTerminalEnvironment()` preserved that value even though `NodePtyBackend` advertises `xterm-256color`.
- Focused control proved the terminal suite passes with `TERM=xterm-256color` and fails with `TERM=dumb`.
- Minimal remediation restores the required handoff structure and pins the spawned PTY environment to the backend's declared terminal type.
- Task 1 implemented the explicit `--owner-workstation` preset as a pure config transformation and single tunnel flag; secure defaults and Browser independence remain intact.

Approved design decisions remain:

- `owner-workstation` is explicit opt-in and composes existing gates rather than inventing a new authority profile.
- The preset enables Personal Admin, Owner Runtime, terminal/PTY, local Docker Project Exec, Computer Use, and full-host JS. Browser Runtime remains independent and is not implicitly enabled.
- Project Exec was added to the preset during implementation planning because the mandatory fresh `project_check PASS` publish gate uses the existing local Docker Project Exec backend; without it, the preset could not satisfy its own publication contract.
- Owner Runtime stays full current-user host capability, not root and not an OS sandbox.
- Unattended readiness means stable pre-authorized identity and app-owned credentials; no TCC DB, Keychain-authentication, SIP, FileVault/login, or sudo/root bypass.
- The app-owned daily-driver credential will use the dedicated native Keychain helper for store/read/delete; runtime reads must fail rather than prompt interactively.
- Reuse existing `ProjectCheckService` HEAD + `workingTreeDigest` freshness evidence; do not create another verification store.
- Add bounded in-memory `ContinuityResumeRegistry`, populated only by `project_resume`; generic Project leases do not prove continuity.
- Typed `git_push` requires active Admin `authorityLeaseId` plus exact resumed Project `projectAuthorityLeaseId`, non-main clean tree, and fresh PASS.
- Final Git push sends the exact verified commit, while preserving current-branch/GitHub-origin/no-force restrictions.
- Browser-vs-Computer-Use simplification remains deferred until a later real Chrome benchmark slice.

## Plan structure

The approved plan is split into seven TDD review gates:

1. Owner Workstation preset.
2. Non-interactive app-owned Keychain path.
3. Deterministic unattended-readiness status.
4. Bounded resume-context registry.
5. Freshness-bound Project Publish Gate.
6. Dual-authority `git_push` MCP wiring.
7. Documentation, full local acceptance, continuity checkpoint, typed publication, exact-head CI/merge, and branch/worktree cleanup.

Execution must start with Superpowers `using-git-worktrees`, creating isolated branch/worktree `feat/owner-workstation-verified-project-session` from the commit containing the plan. Use `subagent-driven-development` by preference, or `executing-plans` for inline execution.

## Verification

- Current design branch was created from clean synchronized main.
- Existing `ProjectCheckService` was verified to bind evidence to exact `HEAD` + `workingTreeDigest` and automatically report changed state as `STALE`.
- Existing `git_push` was verified to require Admin/current branch/GitHub origin but not yet continuity or local-verification freshness.
- Existing daily-driver was verified to store through `chatgpt-system-keychain-helper` but read via `/usr/bin/security`; the plan removes that split path.
- Existing Computer Runtime installer already verifies fixed bundle identity, strict signature, stable designated requirement, and refuses silent stable-to-ad-hoc downgrade.
- Plan self-review covered spec mapping, placeholder scan, and interface/type consistency.
- Initial `npm run check`: RED at planning HEAD; 643 tests passed, 2 failed, and 2 were skipped.
- Focused RED evidence: handoff document contract failed on missing `## Completed`; terminal supervisor failed with received `TERM=dumb` instead of `xterm-256color`.
- Focused baseline regression: `2` files and `9/9` tests PASS.
- `npm run check`: TypeScript build PASS; `107` Vitest files passed, `1` intentionally skipped; `645` tests passed, `2` intentionally skipped.
- `npm run test:computer:macos`: Swift build PASS; `164/164` tests PASS.
- Task 1 RED evidence: 4 expected failures for unknown/missing `--owner-workstation` behavior.
- Task 1 focused GREEN: `tests/cli-command.test.ts`, `tests/owner-runtime-config.test.ts`, and `tests/setup-chatgpt-tunnel.test.ts` = `53/53` PASS.
- Task 1 TypeScript build: PASS.
- Task 2 RED: 7 expected failures proved runner/setup/native helper lacked dedicated read/delete/helper-path wiring.
- Task 2 focused GREEN: 18/18 tests PASS, including real macOS Keychain store/read/delete integration.
- Task 2 native broker release build: PASS.
- Task 3 focused GREEN: `23/23` tests PASS; TypeScript build PASS.
- Task 4 focused GREEN: `24/24` continuity tests PASS; TypeScript build PASS. Successful resumes register exact worktree metadata; generic/failed leases do not; registry evicts oldest after 256 contexts and stores lease digests rather than raw IDs.
- Task 5 focused GREEN: `21/21` publish-gate/Git/ProjectCheck tests PASS; TypeScript build PASS; `git diff --check` PASS. Stale branch/HEAD and dirty/main/non-PASS states fail closed.
- Task 6 GREEN: dual-authority/resume/continuity core `21/21` PASS, transport/Git-boundary `6/6` PASS, updated authority schema `7/7` PASS, resumed-worktree replacement regression `10/10` PASS, and TypeScript build PASS. Generic/wrong/revoked authority fails closed; valid dual authority with fresh PASS reaches the final remote policy boundary.
- Real `npm run owner-workstation:status` executed without prompts: stable Computer Runtime and all four passive permission booleans are true; credential readiness is currently false because the newly built stable Keychain helper has not yet been installed into the user home by Task 7 setup.
- Diagnostic timing proved the only transient failure was the cold Swift build exceeding Vitest default 5s; helper store/read/delete themselves completed in ~0.13s total. Native integration test now uses the repository-wide 30s integration budget.
- Task 7 combined focused acceptance: `17/17` files and `139/139` tests PASS.
- Task 7 full repository gate: TypeScript build PASS; Vitest `112` files PASS + `1` intentionally skipped; `688` tests PASS + `2` intentionally skipped.
- Production dependency audit: `npm audit --omit=dev` reports `0` vulnerabilities.
- macOS authority broker release build: PASS.
- macOS Computer Runtime native suite: `164/164` PASS.
- Real PTY acceptance: `3/3` PASS. Owner Computer Runtime Phase 3: `2` PASS + `1` intentional skip.
- Real daily-driver acceptance: LaunchAgent reinstall PASS; existing app-owned Keychain credential reused non-interactively; no API key written to the LaunchAgent plist.
- Real `owner-workstation:status`: `ready=true`; Computer Runtime availability/stable TCC identity/bundle/signature all true; Accessibility, Screen Recording, event-listen, and event-post all true; credential readable non-interactively=true.
- The first combined focused run exposed only docs-contract drift plus an integration timeout budget under parallel load; both were corrected without weakening security behavior, then the full focused gate passed.
- Final workflow/docs commit: `eb05294` (`docs: finalize owner workstation workflow`).
- Publication worktree transition: the clean managed worktree was detached at `eb05294`; the authoritative registered checkout was switched to the feature branch at the same exact commit; a fresh `project_resume` revalidated the registered worktree identity and observed a clean tree with the feature branch unpublished.

## Next exact step

Commit this state-only publication-preparation checkpoint, then run `npm run check` on the resulting exact final HEAD. If PASS, checkpoint Project Continuity with the final local verification evidence, obtain a fresh `project_resume` lease for that record version, run `project_check` `run` + `report` on `/Users/dogan/Desktop/chatgpt-system`, and require `overallStatus=PASS` for the exact final `HEAD` + clean-tree digest. Then stop before typed `git_push` until the user explicitly authorizes push/PR.

## Invariants

- Code/tests/builds/acceptance remain local until final fresh verification is green.
- GitHub is publication/review/final CI only.
- Exact-head hosted checks must pass before merge.
- After merge: synchronize local `main`, verify the merge, delete proven merged local/remote implementation branches and unused worktrees, and finish clean.
- Meaningful milestones update both this file and Project Continuity when available.
- Preserve `origin/feat/computer-use-bridge` until its three unmerged documentation commits are explicitly classified, merged, or otherwise preserved.

## Blockers / uncertainties

- No baseline blocker remains after the focused, full Node/TypeScript, and native macOS gates passed.
- Tasks 1-7 implementation and local acceptance are complete. Final exact-state `npm run check` + Continuity/`project_check` evidence remain before publication; push/PR still requires explicit user authorization.
- `origin/feat/computer-use-bridge` remains intentionally untouched.
