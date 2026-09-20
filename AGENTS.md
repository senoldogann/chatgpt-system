# chatgpt-system Agent Protocol

These rules apply to every agent working in this repository.

## Continuation boot sequence

When the user says `chatgpt-system kaldığı yerden devam et`, `continue chatgpt-system`, or an equivalent continuation request, do not ask the user to restate prior work unless recovery below is genuinely insufficient.

1. If Project Continuity tools are available, call `project_resume` with the exact alias `chatgpt-system-desktop`. Never fuzzy-match or invent another alias. The authoritative checkout is `/Users/dogan/Desktop/chatgpt-system`.
2. Read `docs/PROJECT_STATE.md`.
3. Inspect current repository reality before editing: `git status`, current branch/HEAD and recent `git log`; inspect `git diff` for a dirty candidate worktree. Also inspect worktree ownership when concurrent work is possible.
4. Reconcile sources in this order of authority:
   - **Git/worktree reality** — actual HEAD, branch, dirty files, commits, worktrees, and test output.
   - **Project Continuity checkpoint** — latest semantic goal, decisions, active-worktree note, and next step.
   - **`docs/PROJECT_STATE.md`** — bounded human/agent handoff cache.
   - **Current plan/spec** — intended sequence and architecture.
   - Older chat/history — context only, never stronger than current repository evidence.
5. Read only the currently relevant plan/spec sections, then continue from `Next exact step` after reconciling it with Git.
6. If the recorded active worktree is dirty and may belong to another active agent, treat it as owned by that agent. Never reset, clean, revert, overwrite, or delete another agent's work. Use a separate worktree/branch for independent work.

If `project_resume` is unavailable or the alias is not registered, continue using `docs/PROJECT_STATE.md` plus Git reconciliation and explicitly note that continuity storage was unavailable. Do not guess missing state.

## Handoff and checkpoint discipline

`docs/PROJECT_STATE.md` is a handoff cache, not the sole source of truth. Keep it short and current. Update it after a meaningful milestone or state change and always before ending a work session or handing work to another agent.

A **meaningful milestone** includes:

- user direction or scope changes;
- an architectural/security decision;
- a RED root cause becoming known;
- a GREEN fix/feature commit;
- a significant verification gate;
- a blocker or unexpected failure;
- PR creation, review findings, merge, or deployment;
- switching the active branch/worktree or ownership.

Every update must leave a concrete `Next exact step`, not a vague reminder. Record exact branch/worktree/HEAD when relevant, current RED/GREEN state, verification evidence, blockers, and invariants that must survive continuation. Never put secrets, credentials, screenshots, OCR/AX document content, typed sensitive text, or raw native pointers in this file.

If Project Continuity tools are available, pair the file update with `project_checkpoint` after the same meaningful milestones and before ending a work session. The checkpoint should contain the same goal/next-step semantics but may additionally name the current active worktree in its bounded detail. Do not claim a checkpoint happened unless the call succeeded.

## ChatGPT Web / developer-MCP resilience

Hosted ChatGPT Web state can fail independently of the local tunnel/runtime. Preserve recoverability instead of treating every UI symptom as a local crash.

- Create a proactive **risk checkpoint** with `project_checkpoint` before a sequence expected to require roughly 8 or more sequential MCP calls, a long hosted wait/poll cycle, or a risky transition where losing the current conversation would force the user to reconstruct intent. Keep the checkpoint bounded and non-sensitive, with the current goal, latest completed milestone, exact branch/worktree/HEAD when relevant, blocker, and `Next exact step`.
- Before long builds/tests or multi-project workloads, remember that a tunnel command can have a shorter `response_timeout` than the configured connection TTL. When an Admin terminal lease is already appropriate, use `process_start` followed by short `process_status` / cursor-based `process_logs` calls rather than one long synchronous shell/tool call. For Project-only work use bounded `project_exec` checks without authority escalation. An INFO-level `command response deadline reached` is dropped-response evidence, not proof of daemon failure. Never increase `max_concurrent_requests` without queue/dispatcher capacity evidence.
- For an incident with a known timestamp, use `npm run diagnose:chatgpt -- --minutes 30 --at <offset-aware-ISO-time>` and compare the sanitized response-deadline/stdio events with passive `/health/mcp` and `/health?details=true` observations if the existing listener provides them. Current health cannot establish past health, and the retained log tail may omit old events.
- Prefer existing bounded batch tools and parallel independent read-only calls over unnecessary serial model yields.- Prefer existing bounded batch tools and parallel independent read-only calls over unnecessary serial model yields. Examples include `fs_apply_patch_set` for independent guarded patches and `computer_run` for one validated physical-input program. Never widen authority merely to batch work; batching must stay inside the authority the operation already requires.
- If ChatGPT returns `This conversation does not support developer MCPs`, treat that as product-surface/tool-routing unavailability. Stop making local-change claims, do not repeatedly retry the unavailable developer-MCP namespace, and do not substitute container access for the user's Mac. If the current conversation no longer exposes the app/tools, hand off to a **new supported standard text chat** in the same Project. Once developer MCP capability returns, call `project_resume` for the exact alias before any project mutation, then reconcile Git/worktree reality.
- `Connection interrupted. Waiting for the complete answer` is not by itself evidence that the local daemon, tunnel, or MCP child failed. Do not restart an otherwise healthy tunnel solely for this UI symptom. Use `npm run diagnose:chatgpt` near the incident time to classify bounded local evidence, then act on the specific failure boundary.
- Before removing a worktree that was ever used as a ChatGPT tunnel/runtime target, run `npm run diagnose:chatgpt`. If the diagnostic reports runtime source `managed-worktree`, do not remove that worktree until the tunnel/profile has been repointed and a fresh diagnostic no longer reports the managed worktree as active. For `other` or `unknown`, inspect before cleanup rather than guessing.

The safe recovery path for a product-surface failure is therefore:

1. leave the unavailable namespace alone instead of retrying it in a loop;
2. use a new supported standard text chat in the same Project if the current chat cannot expose the custom app;
3. once the developer MCP surface is present again, `project_resume` the exact alias;
4. reconcile Git/worktree reality and continue from the checkpointed `Next exact step`.

This protocol mitigates hosted capability/stream loss; it does not claim to repair ChatGPT's composer, `@` picker, WebSocket stream, or hosted turn orchestrator from local code.

## Concurrent-agent safety

- Assume an unfamiliar dirty worktree may be owned by another agent until proven otherwise.
- Do not reuse an active dirty worktree for independent work.
- Do not run broad cleanup in shared `~/.chatgpt-system` state.
- Do not delete untracked files from another worktree merely because they look temporary.
- Prefer an isolated worktree for independent features/fixes.
- Before merging or rebasing across another agent's branch, inspect its state and preserve its changes.

## Repository lifecycle rules

These are project-wide mandatory rules for every agent and every change:

1. **Local-first development and verification.** Implement code, tests, documentation, migrations, and release checks locally on a non-`main` branch/worktree. Run the relevant focused tests and the complete repository verification gate locally. Only when the local tree is clean and every required check passes may the branch be pushed and a PR opened. Merge only a PR whose exact head passed the required hosted checks.
2. **Branch cleanup after merge.** After a verified PR is merged, synchronize local `main`, verify the merge, then delete the merged feature/fix branch locally and remotely when it is no longer needed. Never force-delete a dirty/unmerged branch or a branch/worktree that may belong to another agent.
3. **Keep the project clean.** Keep the authoritative checkout and managed worktrees free of unrelated generated files, stale branches, abandoned worktrees, and accidental changes. Before handoff/completion, require `git status` to be clean, remove only proven-unused agent-owned worktrees/branches, and preserve unfamiliar work.
4. **Do not block on remote watchers.** For hosted CI/release status, do not use long-running `--watch`/follow commands that can hit agent transport time limits. Use short one-shot status queries and poll again as needed. A tool/transport timeout is never evidence that CI failed; read the actual hosted job conclusion before acting. Long local commands should use managed-process execution with explicit status/log polling when available.
5. **Typed publication is dual-authority and freshness-bound.** For a registered project, `git_push` requires an active Admin `authorityLeaseId`, the exact active Project lease returned by `project_resume` as `projectAuthorityLeaseId`, a non-`main` clean worktree, and fresh `project_check` PASS evidence for the exact `HEAD` + `workingTreeDigest`. Generic Project leases do not satisfy continuity provenance. After any HEAD or worktree change, rerun verification before publication.

Do not develop directly on `main`. Do not use a remote/PR as the primary test environment. A PR is the publication/review gate after local completion, not a substitute for local verification.

## Engineering gates

- For bugs/security findings: evidence/root cause → failing automated test → minimal fix → focused verification → regression/full gate.
- For features: follow the approved plan/spec and preserve existing safety invariants.
- Fresh verification is required before PASS/completion claims.
- Do not weaken a contract, permission boundary, takeover behavior, or fail-closed path merely to make a test pass.
- Do not push, merge to `main`, rewrite shared history, or deploy production changes without explicit user authorization for that action.
- If a plan conflicts with verified current behavior or safety requirements, stop and resolve the conflict rather than forcing the plan.
