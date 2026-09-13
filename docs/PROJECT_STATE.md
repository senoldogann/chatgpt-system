# chatgpt-system — Active Project State

Last updated: 2026-09-13T22:10+03:00
Status: **v2 design and implementation plan complete; implementation has not started.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile Git/worktree reality first, then read the active spec and plan.

## Current goal

Implement the approved Owner Workstation + Verified Project Session slice:

1. explicit Owner Workstation daily-driver mode with practical full current-user local capability;
2. unattended readiness through stable Computer Runtime identity and non-interactive access to `chatgpt-system`'s own Keychain credential, without macOS security bypass;
3. fail-closed local-first typed publication requiring fresh verification for the exact state being pushed;
4. exact `project_resume` provenance before registered-project typed publication.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`.
- Current planning branch: `design/owner-workstation-verified-project-session`.
- Branch base: clean synchronized `main` at `57e7a9ebc3bb3be555b6bab3a228b40d833425f1`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Active design spec: `docs/superpowers/specs/2026-09-13-owner-workstation-verified-project-session-design.md`.
- Active implementation plan: `docs/superpowers/plans/2026-09-13-owner-workstation-verified-project-session.md`.
- Runtime implementation code has not started.

## Approved design decisions

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

## Planning verification

- Current design branch was created from clean synchronized main.
- Existing `ProjectCheckService` was verified to bind evidence to exact `HEAD` + `workingTreeDigest` and automatically report changed state as `STALE`.
- Existing `git_push` was verified to require Admin/current branch/GitHub origin but not yet continuity or local-verification freshness.
- Existing daily-driver was verified to store through `chatgpt-system-keychain-helper` but read via `/usr/bin/security`; the plan removes that split path.
- Existing Computer Runtime installer already verifies fixed bundle identity, strict signature, stable designated requirement, and refuses silent stable-to-ad-hoc downgrade.
- Plan self-review covered spec mapping, placeholder scan, and interface/type consistency.

## Next exact step

Commit the amended approved spec, implementation plan, and this state update on `design/owner-workstation-verified-project-session`. Then hand execution to the chosen agent. That agent must resume `chatgpt-system-desktop`, reconcile the clean planning commit, invoke Superpowers `using-git-worktrees`, create `feat/owner-workstation-verified-project-session`, run the baseline gates from the plan, and execute Task 1 with TDD. Do not push or open a PR during implementation.

## Lifecycle invariants

- Code/tests/builds/acceptance remain local until final fresh verification is green.
- GitHub is publication/review/final CI only.
- Exact-head hosted checks must pass before merge.
- After merge: synchronize local `main`, verify the merge, delete proven merged local/remote implementation branches and unused worktrees, and finish clean.
- Meaningful milestones update both this file and Project Continuity when available.
- Preserve `origin/feat/computer-use-bridge` until its three unmerged documentation commits are explicitly classified, merged, or otherwise preserved.
