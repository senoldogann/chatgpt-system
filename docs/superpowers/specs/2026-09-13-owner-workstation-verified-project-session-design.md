# Owner Workstation + Verified Project Session Design

Date: 2026-09-13
Status: design draft for user review

## Problem

`chatgpt-system` v1 already has the core capabilities needed for a personal daily-driver Mac: Personal Admin, Owner Runtime shell/PTY, Computer Use, full-host JavaScript, Project Continuity, typed Git tools, and freshness-bound `project_check` evidence. The remaining gap is not raw capability; it is product composition and enforcement.

The desired product contract is:

1. ChatGPT should behave like a trusted local user on the owner's private Mac, without repeated MCP-level permission friction.
2. Development must be local-first: code, tests, builds, and acceptance run locally before any push/PR; only then may GitHub publication happen, followed by merge and merged-branch cleanup.
3. A fresh agent must recover exactly where prior work stopped before mutating a registered project.
4. The Mac should be prepared for unattended use where macOS legitimately permits it, without bypassing TCC, Keychain authentication policy, SIP, FileVault/login, or `sudo`/root boundaries.

This design composes existing subsystems instead of replacing them.

## Non-goals

- Do not introduce root privilege, password piping, `sudo -S`, SIP bypass, TCC database modification, Keychain authentication bypass, or login/FileVault bypass.
- Do not create a second project-memory system; Project Continuity remains authoritative semantic handoff storage.
- Do not create a second verification store; `ProjectCheckService` remains the freshness-bound source of local verification evidence.
- Do not remove or redesign Browser Runtime in this work. Browser-vs-Computer-Use simplification is a separate follow-up decision.
- Do not constrain Owner shell/PTY to Project-only behavior; full current-user host access is an explicit owner requirement.

## Product principles

### Owner authority

On an explicitly configured private workstation, ChatGPT gets the practical capabilities of the logged-in macOS user through existing Admin + Owner Runtime mechanisms. This is not root authority and does not defeat OS security controls.

### Local-first publication

GitHub is the publication/review/final-CI stage, not the primary development environment. A push from a registered project must prove a clean non-main branch and fresh local verification for the exact repository state being published.

### Continuity before mutation

Registered projects are resumed from Project Continuity before typed project mutation or publication. Git/worktree reality remains stronger than stored semantic context.

### Unattended readiness, not bypass

The system should minimize interactive prompts by preparing stable identities and app-owned credentials ahead of time. It must not bypass macOS security boundaries.

## Architecture

The change has three focused components.

### 1. Owner Workstation preset

Add one explicit configuration preset, named `owner-workstation`, for the trusted private-Mac deployment. The preset expands to existing gates rather than inventing a new authority profile.

The preset enables:

- Personal Admin
- Owner Runtime
- host terminal command capability
- persistent PTY capability through Owner Runtime
- Computer Use
- full-host JavaScript for Computer Use

The existing individual flags remain available and existing secure defaults remain unchanged. The preset is opt-in and must be reported explicitly in setup/diagnostic output.

The preset does **not** imply Browser Runtime. Browser configuration remains independently controlled.

Expected setup semantics:

```text
--owner-workstation
  => personalAdmin = true
  => ownerRuntime = true
  => terminal = true
  => computerUse = true
  => fullHostJs = true
```

Configuration validation must still enforce all existing dependency relationships and fail closed if a required component is unavailable.

### 2. Verified Project Session publish gate

A registered project publication must combine two authorities:

- a Project Continuity resume context proving the agent resumed the exact registered project/worktree; and
- Admin authority proving remote-write capability.

This should not weaken the existing rule that Git remote writes require Admin authority. Instead, publication becomes a two-context operation: project scope/continuity plus owner remote-write authority.

A new `ProjectPublishGate` performs the following checks before `git_push` reaches the remote:

1. The target repository/worktree is a registered Project Continuity worktree.
2. The caller presents a currently valid resume context created by `project_resume` for that exact registered project. A generic Project lease created through `session_authority_start` is not sufficient for the continuity requirement.
3. The caller also presents an active Admin lease.
4. The current branch is named and is not `main`.
5. The working tree is clean, including staged, unstaged, and untracked state.
6. `ProjectCheckService.report()` for the exact repository reports `PASS`.
7. The verification evidence matches the current HEAD and working-tree digest. Existing `ProjectCheckService` freshness semantics are reused; any post-verification change automatically produces `STALE` and blocks publication.
8. Existing Git remote URL restrictions, hooks disabling, config inspection, no-force behavior, and current-branch-only push restrictions remain intact.

The gate must return actionable policy errors such as:

- `PROJECT_RESUME_REQUIRED`
- `LOCAL_VERIFICATION_REQUIRED`
- `LOCAL_VERIFICATION_STALE`
- `WORKTREE_NOT_CLEAN`
- `MAIN_PUSH_DENIED`

Use distinct policy error codes `PROJECT_RESUME_REQUIRED`, `LOCAL_VERIFICATION_REQUIRED`, `LOCAL_VERIFICATION_STALE`, `WORKTREE_NOT_CLEAN`, and `MAIN_PUSH_DENIED` so each denial cause is observable and testable.

#### Resume-context representation

The runtime needs to distinguish a Project lease minted by `project_resume` from a generic Project lease. Use an in-memory `ContinuityResumeRegistry` keyed by opaque lease identity, populated only by `ProjectContinuityService.resume()`. The registry records bounded metadata only: project ID, alias, record version, registered canonical worktree, and lease lifetime.

It must not persist lease secrets, raw file content, screenshots, OCR/AX content, or credentials. An expired/revoked Project lease makes the associated resume context invalid.

This avoids creating another user-facing token and lets the existing Project lease returned by `project_resume` act as the resume proof.

#### Typed Git mutation behavior

For registered projects, `AGENTS.md` continues to require resume/reconciliation before every project mutation. Runtime enforcement in this slice is intentionally limited to the irreversible publication boundary: `git_push`. Other typed Git writes keep their existing authority behavior in this slice; they are not silently re-scoped.

The `git_push` MCP schema keeps the existing `authorityLeaseId` as the Admin remote-write lease and adds required `projectAuthorityLeaseId`, which must be the active Project lease returned by `project_resume` for the exact registered project. `cwd` remains unchanged. This preserves the existing Admin remote-write contract while adding exact-project continuity proof.

### 3. Unattended readiness

Unattended readiness prepares the trusted Mac once so normal later operation does not repeatedly depend on the owner being physically present.

#### Stable Computer Runtime identity

The existing fixed bundle path, bundle identifier, code-signing validation, designated-requirement preservation, and refusal to silently downgrade to ad-hoc signing remain the foundation. `owner-workstation` readiness should explicitly require a stable signed Computer Runtime for unattended mode.

The readiness check should report, at minimum:

- Computer Runtime installed
- fixed bundle identifier verified
- strict signature verified
- stable designated requirement verified
- Accessibility readiness
- Screen Recording readiness
- Computer Use health

Permission checks are passive. The system may guide the owner through one-time macOS authorization but must not edit the TCC database or fake authorization.

#### App-owned Keychain credential path

The daily-driver control-plane credential is owned by `chatgpt-system`, so its storage/read path should be designed for non-interactive service use without adding `userPresence`.

Current behavior stores the secret through `chatgpt-system-keychain-helper` but reads it later through `/usr/bin/security`. The revised design uses the dedicated helper for both `store` and `read` operations so the same controlled implementation owns credential access. The daily-driver install records the exact helper path it built and the LaunchAgent runner invokes that helper path for reads instead of `/usr/bin/security`.

The helper must:

- read the credential only for the fixed account/service identifiers used by the daily-driver runtime, or otherwise apply the existing bounded input validation;
- emit only the requested credential to stdout on successful `read`;
- never log the credential;
- preserve 0600/private local state rules around surrounding runtime files;
- avoid `kSecAccessControlUserPresence` or equivalent interactive-presence requirements for this app-owned secret;
- fail closed if Keychain denies access.

If explicit application ACL/trusted-application binding is added, it must bind access to the intended stable helper/runtime identity and be covered by macOS-native tests. The implementation must not weaken unrelated Keychain items or attempt to read credentials created by other applications.

`owner-workstation` setup/status should surface whether the app-owned credential can be read non-interactively.

## Project lifecycle contract

The project-wide lifecycle remains:

```text
project_resume
  -> reconcile Git/worktree reality
  -> create/switch focused non-main branch
  -> local implementation
  -> focused tests
  -> broader/local full verification
  -> clean tree + fresh project_check PASS
  -> git_push using resumed Project context + Admin authority
  -> open PR
  -> exact-head hosted CI
  -> merge
  -> synchronize local main
  -> verify merge
  -> delete merged local/remote feature branch and unused worktree
  -> checkpoint continuity
  -> finish on clean main
```

The implementation must not add automatic remote publication after tests. Push remains an explicit agent action and PR/merge still require the user's existing authorization policy.

## Continuity contract

A resumed agent follows this ordering:

1. `project_resume(<exact alias>)`
2. inspect Git status, branch, HEAD, recent commits, relevant diffs/worktrees
3. read `docs/PROJECT_STATE.md`
4. read the current spec/plan relevant to the next step
5. reconcile sources using Git/worktree reality as highest authority
6. continue from the concrete `Next exact step`

Meaningful milestones still require both `docs/PROJECT_STATE.md` update and `project_checkpoint` when available. The new runtime publish gate uses resume state as evidence that the session entered through this continuity path; it does not treat stored semantic text as stronger than current Git reality.

## Data and trust boundaries

No new persistent secret store is introduced.

Persistent data remains:

- existing Project Continuity SQLite/state
- existing Project Check verification evidence
- existing app-owned Keychain credential
- existing audit metadata

New resume-session metadata is in memory only and must be bounded to the lifetime of the associated authority lease/runtime process.

Audit records may include operation names, project/branch digests, verification status, and denial reason. They must not include credentials, file contents, typed sensitive text, screenshots, OCR/AX document content, raw Keychain values, or authority lease secrets.

## Failure behavior

All new enforcement is fail closed.

- Owner Workstation preset requested but a required gate/config dependency is invalid: startup/setup fails with a precise message.
- Stable Computer Runtime unavailable for unattended-ready status: setup/status reports not ready; it does not silently use ad-hoc identity as equivalent.
- Keychain app-owned credential cannot be read: daily-driver startup fails without leaking the secret.
- Registered project has no active resume context: push denied.
- Local verification absent, failed, unavailable, or stale: push denied.
- Working tree dirty: push denied.
- Current branch is `main`: push denied through the typed publication path.
- Admin authority absent/expired: push denied.

Owner shell remains intentionally powerful and is not an OS sandbox. These project publication guards protect the typed publication workflow; they do not pretend to make arbitrary full-host shell access impossible. Agent protocol and product safety remain additional layers.

## Testing strategy

Implementation follows TDD.

### Owner Workstation preset

Tests must prove:

- preset expands to exactly the intended existing gates;
- individual flags still work;
- default behavior remains secure/off;
- browser is not implicitly enabled;
- invalid combinations still fail closed;
- setup output clearly reports Owner Workstation and trust boundaries.

### Resume-session gate

Tests must prove:

- `project_resume` registers a resume context;
- a generic Project lease does not satisfy it;
- wrong project/worktree does not satisfy it;
- expired/revoked lease invalidates it;
- no authority lease secret is persisted.

### Publish gate

Tests must prove push is denied for:

- no resume context;
- no Admin authority;
- `main`;
- dirty/staged/untracked tree;
- verification NOT_RUN;
- verification FAIL;
- verification UNAVAILABLE;
- verification STALE after HEAD change;
- verification STALE after working-tree change.

Tests must prove push succeeds only for:

- exact registered project resume context;
- active Admin authority;
- non-main current branch;
- clean tree;
- current `ProjectCheckService` PASS evidence;
- allowed credential-free GitHub origin;
- current branch pushed without force/refspec freedom.

### Unattended readiness / Keychain

Tests must prove:

- dedicated helper supports bounded `store` and `read`;
- runner no longer shells out to `/usr/bin/security` for normal credential reads;
- read failures do not leak Keychain stderr/secret material;
- stable Computer Runtime identity is distinguished from ad-hoc development identity;
- readiness output is deterministic and machine-testable.

Where real macOS Keychain/TCC behavior cannot be safely exercised in generic unit CI, use native integration tests on macOS plus deterministic unit tests around command construction, status interpretation, and redaction.

## Documentation updates

Implementation should update at least:

- `AGENTS.md` — preserve local-first + continuity boot sequence; document typed publish gate semantics.
- `README.md` — document Owner Workstation as the recommended private-Mac daily-driver profile.
- `SECURITY.md` — clarify unattended readiness vs bypass and the dual-context publication model.
- relevant setup docs for daily-driver/Computer Runtime.
- `docs/PROJECT_STATE.md` at each meaningful milestone.

Documentation must not claim macOS permissions are bypassed.

## Success criteria

The work is complete when all of the following are true:

1. One explicit Owner Workstation preset configures the approved personal-Mac capabilities while defaults remain unchanged.
2. The Computer Runtime unattended-readiness path requires and reports stable identity rather than treating ad-hoc signing as equivalent.
3. The app-owned daily-driver credential can be read through the dedicated Keychain helper without requiring interactive user-presence policy configured by this project.
4. A registered project cannot use typed `git_push` unless it has an active exact-project resume context, active Admin authority, a non-main clean branch, and fresh `project_check` PASS evidence for the exact HEAD + working-tree digest.
5. Changing HEAD or working-tree state after verification makes publication fail until local verification is rerun successfully.
6. Existing current-branch-only/no-force/GitHub-origin Git restrictions remain intact.
7. Project Continuity remains the single semantic handoff mechanism and meaningful milestones remain checkpointed.
8. Focused tests, full local repository verification, native macOS verification where applicable, and production audit all pass before publication.
9. Only after local completion is the branch pushed, reviewed in a PR, exact-head hosted checks passed, merged, synchronized to local `main`, and the merged branch/worktree cleaned up.

## Deferred follow-up

After this slice is stable, separately benchmark ChatGPT Web Agent + Computer Use against existing Browser Runtime on real Chrome workflows. That evidence will decide whether Browser Runtime should remain, become secondary, or be removed. It is intentionally outside this implementation plan.
