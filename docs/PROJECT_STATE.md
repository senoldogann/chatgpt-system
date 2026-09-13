# chatgpt-system — Active Project State

Last updated: 2026-09-13T21:55+03:00
Status: **v2 design active; implementation has not started.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile against Git/worktree reality first, then read the active spec/plan.

## Current goal

Design and then implement the next hardening slice around three owner requirements:

1. explicit Owner Workstation daily-driver mode giving ChatGPT practical full current-user local capability through existing Admin + Owner Runtime gates;
2. fail-closed local-first publication so typed `git_push` requires fresh local verification for the exact state being published;
3. continuity-aware project publication so a fresh agent must have resumed the exact registered project before typed remote publication.

Also make the trusted Mac suitable for unattended operation where macOS permits it: stable Computer Runtime identity plus non-interactive access to `chatgpt-system`'s own daily-driver Keychain credential. No TCC/Keychain-authentication/SIP/FileVault/login/sudo bypass is allowed.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`.
- Active branch: `design/owner-workstation-verified-project-session`.
- Branch base: clean synchronized `main` at `57e7a9ebc3bb3be555b6bab3a228b40d833425f1`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Active design spec: `docs/superpowers/specs/2026-09-13-owner-workstation-verified-project-session-design.md`.
- Implementation plan: not yet written; Superpowers requires user review/approval of the committed spec first.

## Approved design decisions

- Add one explicit `owner-workstation` preset that expands to existing Personal Admin + Owner Runtime + terminal + Computer Use + full-host JS gates. General/default secure behavior remains unchanged. Browser Runtime is not implicitly enabled.
- Owner Runtime stays full current-user host capability, not root and not an OS sandbox.
- Unattended readiness means stable pre-authorized identities and app-owned credentials, not bypassing macOS security controls.
- Reuse existing `ProjectCheckService` freshness evidence; do not create a second verification store.
- Typed `git_push` becomes the hard runtime publication boundary: Admin authority + exact `project_resume` Project lease + non-main clean tree + fresh PASS for current HEAD/working-tree digest.
- Add an in-memory `ContinuityResumeRegistry` populated only by `project_resume`; generic Project leases do not satisfy the publication continuity requirement.
- Keep existing `authorityLeaseId` on `git_push` as the Admin lease and add required `projectAuthorityLeaseId` for the resume-produced Project lease.
- Daily-driver Keychain reads should use the dedicated `chatgpt-system-keychain-helper` rather than `/usr/bin/security`; app-owned secrets must not add user-presence requirements.
- Browser-vs-Computer-Use simplification is deferred until after this slice and will be decided by real Chrome workflow benchmarks.

## Verification / evidence gathered during design

- `main` was clean and synchronized with `origin/main` at `57e7a9e...` before creating the design branch.
- `ProjectCheckService` already stores PASS/FAIL evidence bound to exact `head` + `workingTreeDigest` and reports changed state as `STALE`; the new publication gate can reuse it.
- Current `git_push` requires Admin and restricts pushes to the current validated branch and credential-free GitHub origin, but does not currently require fresh local verification or continuity-resume evidence.
- Current daily-driver stores the control-plane credential through `chatgpt-system-keychain-helper` but reads it at runtime through `/usr/bin/security`.
- Current Computer Runtime installer already has fixed bundle identity, strict signature checks, designated-requirement preservation, stable-signing detection, and refusal to silently substitute ad-hoc signing.

## Next exact step

Commit the design spec and this handoff update on `design/owner-workstation-verified-project-session`. Then the user reviews the written spec. After explicit approval, invoke Superpowers `writing-plans` and create `docs/superpowers/plans/2026-09-13-owner-workstation-verified-project-session.md`. Do not implement runtime code before that plan is approved for execution.

## Lifecycle invariants

- Code/tests/builds stay local on a non-`main` branch until full local verification is fresh and green.
- GitHub is publication/review/final CI only.
- Exact-head hosted checks must pass before merge.
- After merge: synchronize local `main`, verify the merge, delete proven merged local/remote branches and unused worktrees, and finish clean.
- Meaningful milestones update both this file and Project Continuity when available.
- Preserve `origin/feat/computer-use-bridge` until its three unmerged documentation commits are explicitly classified, merged, or otherwise preserved.
