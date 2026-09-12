# chatgpt-system — Active Project State

Last updated: 2026-09-12T23:31+03:00
Status: Owner Runtime Phase 2 is merged and fully verified on `main`; Phase 3 Computer Runtime ceilings/cancellation is planned in an isolated branch and production implementation has not started.

This file is a handoff cache, not the sole source of truth. A resumed agent must reconcile it against Git/worktree reality and the latest Project Continuity checkpoint before editing.

## Current goal

Execute **Owner Runtime Phase 3 — Computer Runtime ceilings/cancellation** from the approved Owner Runtime design. Remove the development-era 100-action and 30-second productivity ceilings only for locally approved Admin Owner Runtime while preserving payload/memory/recovery bounds, request cancellation, takeover/emergency behavior, stable-helper/TCC readiness, and daemon cleanup.

## Active workspace

- Stable project root / continuity anchor: `/Users/dogan/chatgpt-system` on `main`.
- Stable merged baseline: `main@7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- `origin/main` matches the same merge commit.
- Phase 2 PR: `#40`, squash-merged after exact-head CI verification.
- Phase 2 reviewed head: `b929564b9d57f191f142700fe6643ae6ee45ae65`.
- Phase 2 historical managed worktree was cleanly removed after merge; the local squash-source branch is intentionally preserved because safe `git branch -d` does not consider squash ancestry merged.
- Active Phase 3 managed worktree: `/Users/dogan/.chatgpt-system/worktrees/d0a0a546782faa2c9a9906345e9290c84508aad64b304746b50965bb2ff58ef1/8cae9810-41f3-4aa6-9c3e-61ef564ffdab`.
- Active Phase 3 branch: `feat/owner-runtime-phase3-computer-ceilings`.
- Phase 3 branch base: exact merged `main@7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- Approved design: `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`.
- Phase 3 plan: `docs/superpowers/plans/2026-09-12-owner-runtime-phase3-computer-ceilings.md`.
- Project Continuity exact alias: `chatgpt-system`; continuity remains anchored to the stable root worktree.

## Completed

### Owner Runtime Phase 1 — unrestricted one-shot shell

- Merged through PR #39 as `0195a432bae370eb36dedf65056c874634f805dc`.
- Added explicit Owner Runtime gate, unrestricted `shell_run`, bounded retained output, cancellation/process-group cleanup, and content-free audit while keeping `terminal_run` narrow.

### Owner Runtime Phase 2 — persistent interactive PTY

- Final PR #40 exact head `b929564b9d57f191f142700fe6643ae6ee45ae65` passed local and hosted acceptance with `mergeStateStatus=CLEAN`.
- PR #40 was squash-merged as `7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- Stable root `main` was fast-forwarded and matches `origin/main`.
- Public PTY surface is exactly:

```text
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
```

- PTYs are Admin + Owner Runtime only, daemon-owned rather than lease-owned, rediscoverable by a later Admin lease, hidden from Project/User, bounded in memory/input/session count, content-free in audit, and terminated as process groups on daemon shutdown.
- Existing `terminal_run` and one-shot `shell_run` semantics were not widened.

### Phase 2 post-merge verification

Fresh verification on exact merged `main@7aece8f5cb1b4397de04704a41b95626a0b8e887` after `npm ci --ignore-scripts`:

- TypeScript build: PASS.
- Node/TypeScript tests: `614/614` PASS + `1` environment-gated skip across `105` passing test files + `1` skipped file.
- Real PTY focused acceptance: `3/3` PASS.
- `npm audit --omit=dev`: `0` vulnerabilities.
- Swift macOS Computer Runtime: `164/164` PASS.
- Stable root `main` worktree: clean and synchronized with `origin/main`.
- Hosted `main` CI run `34709058304` on exact merge commit: Node 22 SUCCESS, Node 24 SUCCESS, macOS-native SUCCESS, including Owner Runtime PTY native binding.

The initial combined `npm run check` post-merge attempt exceeded the local terminal tool's 60-second transport limit; build and `npm test` were rerun separately and both completed successfully. This was a tool transport timeout, not a product test failure.

### Phase 3 planning

- Approved design explicitly defines Phase 3 as:
  - remove arbitrary Owner Computer Runtime action/runtime hard maxima;
  - preserve payload/memory/recovery bounds;
  - strengthen request cancellation cleanup where needed;
  - verify stable helper/TCC readiness;
  - add long local computer/JS acceptance.
- A fresh isolated Phase 3 worktree/branch was created from merged main.
- Phase 3 baseline in that worktree after `npm ci --ignore-scripts`:
  - TypeScript build PASS;
  - Node/TypeScript `614/614` PASS + `1` environment-gated skip.
- Current hard-ceiling map is confirmed:
  - `maxActionProgramActions = 100`;
  - `maxActionProgramRuntimeMs = 30_000`;
  - `maxJsRuntimeMs = 30_000`;
  - `computer_run` does not currently receive the MCP request `AbortSignal`;
  - `computer_run_js` already receives MCP cancellation and terminates its runner process group;
  - `maxAutomaticRetriesPerAction = 2` remains a correctness bound and must not be removed.
- Detailed Phase 3 implementation plan is written and self-reviewed; production code has not been changed.

## Current state

Phase 2 is no longer an active branch-delivery task; it is merged stable reality. Phase 3 is at the **implementation-plan gate** in the isolated feature worktree.

The Phase 3 plan intentionally separates productivity ceilings from containment:

```text
Admin + Owner Runtime
        |
        +-- computer_run
        |     - no 100-action execution cap
        |     - no implicit 30s owner deadline
        |     - explicit finite timeout still authoritative
        |     - MCP cancellation stops future work / local waits
        |     - returned step summaries remain memory-bounded
        |
        +-- computer_run_js
              - no implicit 30s owner deadline
              - explicit finite timeout still authoritative
              - existing AbortSignal -> runner group termination retained
              - source/output/result byte limits retained
```

Non-Owner Admin compatibility remains deliberately narrow: the existing legacy action/runtime caps continue to apply when the Owner Runtime startup gate is not enabled.

The plan does **not** add a second Computer Runtime session abstraction, remote-desktop/video streaming, a new native protocol, or any TCC bypass. Phase 4 Codex-class end-to-end engineering acceptance remains separate.

## Next exact step

1. Commit the Phase 3 implementation plan and this planning-state handoff as one docs-only milestone on `feat/owner-runtime-phase3-computer-ceilings`.
2. Re-run docs contract, placeholder scan, `git diff --check`, and clean worktree verification on that planning head.
3. Checkpoint Project Continuity with the exact planning commit.
4. Begin Task 1 of `docs/superpowers/plans/2026-09-12-owner-runtime-phase3-computer-ceilings.md` using RED → GREEN TDD.
5. Keep each task independently reviewable and committed before advancing.
6. Stop before remote publication/main merge unless the relevant authorization gate is satisfied; main merge remains separately explicit.

## Invariants

- Project/User authority remains narrow.
- Owner semantics require both an Admin authority lease and the explicit Owner Runtime startup gate.
- `terminal_run`, `shell_run`, PTY, Browser Runtime, Git, and Project Exec semantics are out of Phase 3 scope.
- Existing persistent native Computer Runtime helper, physical-input lane, AX-first recovery, verification, takeover detection, and fixed emergency chord remain the architecture.
- Owner productivity limits may be removed, but MCP/frame size, JS source/output/result bytes, screenshot bytes, observation bounds, result-retention memory, and other protocol/memory containment remain bounded.
- `maxAutomaticRetriesPerAction = 2` remains bounded.
- Omitted Owner timeout means no local wall-clock deadline; explicit finite timeout remains authoritative.
- Request cancellation must prevent further program work and abort local waits. An already-issued native RPC remains one atomic operation bounded by the existing native `requestTimeoutMs`; after it returns, cancellation must prevent the next action and cleanup must run.
- Takeover, emergency stop, daemon/runtime shutdown, and held-input release remain authoritative regardless of Owner mode.
- No TCC, Accessibility, Screen Recording, sudo, Keychain, SIP, or OS-authentication bypass.
- Raw computer content, typed text, screenshots, OCR/AX text, JS source/output, credentials, environment values, PIDs, signals, and authority secrets must not enter persistent audit/continuity.
- Stable `main` is not directly edited; feature work stays isolated.
- Preserve unfamiliar/other-agent worktrees. No history rewrite or deployment without explicit authorization.

## Verification

- Stable `main`/`origin/main`: `7aece8f5cb1b4397de04704a41b95626a0b8e887`.
- Phase 2 post-merge local Node/TS: `614/614` PASS + `1` skip.
- Phase 2 post-merge PTY acceptance: `3/3` PASS.
- Phase 2 post-merge production audit: `0 vulnerabilities`.
- Phase 2 post-merge Swift: `164/164` PASS.
- Hosted merged-main CI: Node 22 SUCCESS, Node 24 SUCCESS, macOS-native SUCCESS.
- Phase 3 branch baseline build: PASS.
- Phase 3 branch baseline Node/TS: `614/614` PASS + `1` skip.
- Phase 3 plan placeholder scan: PASS after removing a self-matching scan command.
- Current planning diff whitespace check: PASS.

## Blockers / uncertainties

- No known planning blocker.
- Exact implementation details for bounded returned `computer_run` step summaries are specified in the plan and must be validated by TDD before becoming product contract.
- MCP cancellation cannot preempt a native RPC already handed to the existing helper without a larger native-protocol/lifecycle change. Phase 3 therefore treats an issued native request as an atomic bounded operation and guarantees no subsequent action starts after cancellation; TDD must verify this boundary and held-input cleanup.
- Stable helper/TCC readiness must be re-verified during final real-Mac Phase 3 acceptance. Do not infer current permission state from older Slice 5 evidence.
