# chatgpt-system — Active Project State

Last updated: 2026-09-13T00:15+03:00
Status: Owner Runtime Phase 3 Computer Runtime ceilings/cancellation implementation is locally complete and pre-state verified on an isolated feature branch. Final state commit + exact-head re-verification remain before any publication gate.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Finish **Owner Runtime Phase 3 — Computer Runtime ceilings/cancellation** as a reviewable branch. Owner/Admin mode removes development-era Computer Runtime productivity ceilings while preserving legacy non-Owner behavior, bounded payload/memory/recovery, deterministic cancellation/cleanup, takeover/emergency behavior, stable-helper/TCC readiness, and the existing native helper architecture.

## Active workspace

- Stable project root / continuity anchor: `/Users/dogan/chatgpt-system` on `main`.
- Stable merged baseline: `main@7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- `origin/main` matches the same Phase 2 merge baseline.
- Active Phase 3 managed worktree: `/Users/dogan/.chatgpt-system/worktrees/d0a0a546782faa2c9a9906345e9290c84508aad64b304746b50965bb2ff58ef1/8cae9810-41f3-4aa6-9c3e-61ef564ffdab`.
- Active Phase 3 branch: `feat/owner-runtime-phase3-computer-ceilings`.
- Pre-state verified Phase 3 HEAD: `d80d32c95ccfdfe094b9700426ca951491a64a01`.
- Approved design: `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`.
- Phase 3 implementation plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase3-computer-ceilings.md`.
- Project Continuity exact alias: `chatgpt-system`; semantic continuity remains anchored to the stable root worktree.

## Completed

### Owner Runtime Phase 1 — unrestricted one-shot shell

- PR #39 merged as `0195a432bae370eb36dedf65056c874634f805dc`.
- Added explicit Owner Runtime gate and unrestricted one-shot `shell_run` while keeping `terminal_run` narrow.

### Owner Runtime Phase 2 — persistent interactive PTY

- PR #40 reviewed head `b929564b9d57f191f142700fe6643ae6ee45ae65` passed local/hosted acceptance.
- PR #40 squash-merged as `7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- Stable main/origin main match that commit.
- PTY remains a distinct Admin + Owner Runtime subsystem; Project/User are unchanged.

### Owner Runtime Phase 3 — implementation milestones

Phase 3 followed the committed RED → GREEN plan and is split into reviewable commits:

- `23b7557` — Phase 3 implementation plan and planning state.
- `4f976dd` — fixed containment contract: bounded returned-step tail and explicit-timeout technical bound while retaining legacy config fields.
- `a96cb73` — Owner `computer_run`: remove legacy action/deadline ceilings, preserve explicit timeout, propagate MCP cancellation, abort local waits, keep cleanup authoritative.
- `77eaafc` — Owner `computer_run_js`: true omitted-timeout/no-deadline mode, optional runner timer, Owner-aware explicit timeout schema, preserve AbortSignal/process-group cleanup.
- `0acd31e` — regression tests locking returned-memory, retry, source/output, and audit-redaction containment.
- `d80d32c` — Phase 3 long-run acceptance, macOS-native CI long-run step, and operator/security/architecture documentation.

## Current state

```text
Admin + ownerRuntime.enabled
        |
        +-- computer_run
        |     - may execute beyond legacy 100-action cap
        |     - omitted timeout => no local program deadline
        |     - explicit finite timeout remains authoritative
        |     - MCP AbortSignal aborts local waits and prevents later actions
        |     - an already-issued native RPC remains one atomic bounded request
        |     - held-input cleanup remains best-effort authoritative
        |     - exact completed/action counts retained
        |     - only a fixed 256-step summary tail is returned
        |
        +-- computer_run_js
              - omitted timeout => no local runner deadline
              - explicit finite timeout remains authoritative
              - MCP AbortSignal still terminates owned runner/process group
              - Owner-dispatched local wait is not capped by legacy 30s
              - source/stdout/stderr/result byte bounds remain unchanged
```

Non-Owner Admin compatibility is intentionally preserved:

- `maxActionProgramActions` still caps non-Owner `computer_run`.
- `maxActionProgramRuntimeMs` still supplies/clamps non-Owner run deadlines.
- `maxJsRuntimeMs` still supplies/clamps non-Owner `computer_run_js` deadlines and MCP schema.
- Project/User authority remains narrow and unchanged.

The implementation does **not** add another Computer Runtime session, remote desktop/video stream, new native cancel protocol, or TCC bypass. The existing persistent native helper, physical-input lane, AX-first recovery, stale-target handling, takeover monitor, fixed emergency chord, and shutdown ordering remain the architecture.

## Containment and cancellation invariants

- `COMPUTER_MAX_RUN_STEP_RESULTS = 256` is a memory/protocol retention bound, not an execution-count bound.
- `COMPUTER_MAX_EXPLICIT_RUNTIME_MS = 2_147_483_647` bounds optional explicit timer values; Owner omitted timeout remains intentionally unbounded by a product wall-clock deadline.
- `maxAutomaticRetriesPerAction = 2` remains a correctness/recovery bound.
- JS source, combined stdout/stderr/result, screenshots, observations, MCP/native frames, and other protocol/memory payloads remain bounded.
- MCP cancellation prevents additional `computer_run` work and makes local waits abortable.
- A native request already handed to the helper is not preempted by killing the helper; it remains bounded by `requestTimeoutMs`, after which cancellation prevents another action and cleanup runs.
- `computer_run_js` cancellation continues to terminate the owned runner process group and cancel its exclusive computer session.
- User takeover, the fixed emergency chord, explicit timeout, daemon/runtime shutdown, and input release remain authoritative in Owner mode.
- Audit/continuity must not persist action bodies, typed text, screenshots, OCR/AX content, JS source/output, AbortSignal objects, credentials, environment values, native request IDs, PIDs, or signals.
- No TCC, Accessibility, Screen Recording, sudo, Keychain, SIP, or OS-authentication bypass is introduced.

## Verification

Pre-state verification evidence on `d80d32c95ccfdfe094b9700426ca951491a64a01`:

Fresh local evidence after Task 5 commit:

- `npm run build`: PASS.
- `npm test`: `628/628` PASS + `2` intentional/environment-gated skips across `106` passing test files + `1` skipped file.
- `npm audit --omit=dev`: `0` vulnerabilities.
- Fast Phase 3 acceptance: `2/2` PASS + `1` long-run skip.
- Deliberate long Owner acceptance with `CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1`: `3/3` PASS; no-timeout Owner JavaScript ran `31.351s`, beyond the legacy 30s ceiling.
- Swift macOS Computer Runtime: `164/164` PASS.
- `git diff --check origin/main...HEAD`: PASS.
- Feature worktree was clean before this `PROJECT_STATE.md` edit.

Live real-Mac release gate, checked fresh during the same pre-state verification:

```text
installed helper available: true
tccIdentityStable: true
computer_health.state: running
accessibilityTrusted: true
screenCaptureAuthorized: true
eventListenAuthorized: true
eventPostAuthorized: true
fullHostJsEnabled: true
```

Only categorical/content-free readiness was recorded. No screen/UI content, credentials, environment values, or native identifiers are persisted here.

## Hosted acceptance state

- No Phase 3 branch publication/PR/hosted CI claim exists yet.
- `.github/workflows/ci.yml` now adds one macOS-native Owner Runtime long computer acceptance step; the 31-second acceptance is intentionally not duplicated across both Linux Node matrix jobs.
- Hosted Node 22/24 and macOS-native evidence must bind to the exact published Phase 3 SHA after publication.

## Next exact step

1. Run docs contract tests, plan placeholder scan, and `git diff --check` for this state update.
2. Commit only `docs/PROJECT_STATE.md` as the final local handoff commit.
3. Because HEAD changes, rerun the full exact-head gate on the successor SHA:
   - `npm run build`;
   - `npm test`;
   - `npm audit --omit=dev`;
   - fast Phase 3 acceptance;
   - deliberate >30s Owner acceptance;
   - Swift macOS Computer Runtime tests;
   - `git diff --check origin/main...HEAD`;
   - clean status.
4. Re-check live installed-helper/TCC categorical readiness.
5. Review `git diff --stat`, `git diff --name-only`, commit log, and final worktree status against Phase 3 scope.
6. Checkpoint Project Continuity with the exact final local SHA and evidence.
7. Stop at remote publication authorization. Do not push/create PR or merge main unless the user explicitly authorizes the corresponding remote-write step; main merge remains a separate explicit gate.

## Invariants

- Stable `main` is not directly edited.
- Project/User authority stays narrow.
- Owner semantics require Admin plus the explicit Owner Runtime startup gate.
- `terminal_run`, `shell_run`, PTY, Browser Runtime, Git, and Project Exec semantics are outside Phase 3 scope.
- Existing Computer Runtime native protocol/helper architecture is preserved.
- Productivity ceilings may be removed only in Owner mode; payload/memory/recovery/TCC/takeover/emergency/shutdown containment remains bounded and authoritative.
- Preserve unfamiliar/other-agent worktrees.
- No history rewrite, deployment, remote publication, or main merge without the appropriate explicit authorization.

## Blockers / uncertainties

- No local implementation or verification blocker is currently known.
- Hosted Phase 3 CI is not yet available because the branch has not been published.
- The existing native protocol has no mid-request cancel message. Phase 3 intentionally treats an already-issued native request as one atomic bounded operation instead of adding a new native cancellation protocol in this phase.
- Final completion/publication claims must use the successor exact HEAD after this state file is committed and the full gate is rerun.
