# chatgpt-system Agent Protocol

Use this minimal workflow for repository agents. Preserve the security and publication boundaries below; do not introduce approval loops for already authorized work.

## Continuation boot sequence

For a `chatgpt-system` continuation, call `project_resume` once with the exact alias `chatgpt-system-desktop`. The authoritative checkout is `/Users/dogan/Desktop/chatgpt-system`. Read `docs/PROJECT_STATE.md` once for relevant handoff context. Inspect `git status`, branch/HEAD and recent `git log` before editing; inspect `git diff` only for dirty files and worktree ownership when concurrent work is possible. Reuse results instead of repeating unchanged queries.

Reconcile in order: **Git/worktree reality** > **Project Continuity** > **docs/PROJECT_STATE.md** > current **plan/spec** > older chats. Use the current, relevant `Next exact step`, not obsolete historical entries. If continuation tooling is unavailable, use Git and the handoff file without inventing a checkpoint. Treat uncertain dirty worktrees as owned by another agent.

Defer Admin authority until needed; reuse a valid Admin lease. If Persistent Owner Mode is enabled and no lease is available, call `persistent_owner_mode` with `operation: "status"` once. Do not call `session_authority_start` on every turn or action. Every privileged call requires an actual valid `authorityLeaseId`; do not invent or expose it. A Project lease never grants Admin capabilities.

Local continuation and checkpoint inspect worktree identity/state without contacting origin; remote verification is explicit when publication or accurate current remote state requires it. Cached remote refs must never be described as freshly verified.

## Handoff and checkpoint discipline

Project Continuity is the primary working record. Use `project_checkpoint` only for a meaningful change or handoff: a material decision, verified deliverable, owner/worktree transfer, changed blocker, or a genuinely high-risk irreversible operation whose context could be lost. A meaningful milestone is not every command, failing test, ordinary build, or unchanged status query. Avoid duplicate checkpoint records for the same state; group completed work and verification into one record before handoff. Do not checkpoint based on MCP call count, elapsed time, or each tool-heavy sequence.

A checkpoint before handoff records the actual branch/HEAD, verified results, blockers and `Next exact step`; never claim one unless it succeeds. Update `docs/PROJECT_STATE.md` for a significant decision, handoff or delivery only; do not duplicate every small step. Never store credentials, secrets, screenshots, OCR/AX content or sensitive typed text in either record.

## ChatGPT Web / developer-MCP resilience

Use a **risk checkpoint** only before an exceptional irreversible transition with material recovery risk, not as a mandatory prelude to ordinary tests or tool calls. Prefer one bounded batch tool and parallel independent read-only operations, but do not widen authority merely to batch work. For genuinely long native commands, use `process_start`, `process_status`, and `process_logs` with bounded polling when the Admin lane is already authorized; use `project_exec` for Project-only commands. A response deadline is not proof of daemon failure.

If ChatGPT says `This conversation does not support developer MCPs`, do not repeatedly retry the unavailable namespace or substitute a container for the user's Mac. Continue in a new supported standard text chat in the same Project and call `project_resume` before mutation after capability returns. `Connection interrupted. Waiting for the complete answer` alone does not establish local failure; do not restart a healthy tunnel. Use `npm run diagnose:chatgpt` near the incident time and distinguish historical evidence from present health.

Before removing a runtime-linked worktree, run `npm run diagnose:chatgpt`: if its source is `managed-worktree`, do not remove that worktree until the runtime has been repointed and verified. Leave unknown runtime sources untouched. No cleanup or restart is implicit in continuation.

## Concurrent-agent safety

Never reset, clean, revert, overwrite, or delete another agent's work. Do not reuse unfamiliar dirty worktrees, delete unknown untracked files, or broadly clean shared runtime state. Inspect branch/worktree ownership before changing another agent's branch; isolate independent work where necessary. Preserve Git history: no force-push, history rewrite, unapproved destructive cleanup, or branch-protection bypass.

## Repository lifecycle rules

Develop directly on `main` by default in the authoritative checkout; create a branch only when the user explicitly requests one or publication/isolation requires it. Do not develop directly on `main` when another active owner may be using it. Keep commits limited to owned changes. Commit, push, PR, merge, and deployment are separate operations; do not infer authorization for live deployment from publication authorization.

For publication, use a non-`main` clean worktree and fresh `project_check` PASS for exact `HEAD` and `workingTreeDigest`, including every required Node and native lane. Typed `git_push` requires the exact resumed Project authority lease and active Admin `authorityLeaseId`; do not replace a failed sandbox gate with an unauthorized host fallback. Reverify after any HEAD or worktree change. Wait for actual hosted CI conclusions and merge conditions; avoid long `--watch` commands. Preserve branch protection, file confinement, optimistic write checks, approval/authority boundaries, data-loss guards, and fail-closed behavior. Live deployment requires explicit user authorization.

## Risk-tiered development and verification

Classify by the highest risk. For a bug, reproduce it with a failing automated test before the fix; run focused tests while implementing. Do not weaken a security contract to make tests pass.

### Tier 1: Low risk

For documentation or a narrow change without runtime, security or data impact, run relevant focused tests and record a short status at handoff. Publication still requires the complete gate.

### Tier 2: Normal risk

For a feature or bug fix, run focused tests during implementation and full repository verification at completion (`npm run check`) after the final source change.

### Tier 3: Critical risk

For security, authority, data loss, publication or deployment changes, retain comprehensive verification, permission regression tests, full repository checks, applicable native tests and exact-HEAD evidence. File security, user takeover, Keychain/TCC and release boundaries remain fail-closed.

Check actual command exit codes; a green summary followed by abnormal termination is not PASS. Before push/PR, fresh `project_check` PASS must match exact `HEAD` and `workingTreeDigest`. Never claim an unrun test passed.
