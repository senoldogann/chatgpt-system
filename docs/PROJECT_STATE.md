# chatgpt-system — Active Project State

Last updated: 2026-09-16

Status: **Plan A round-2 independent approval was not obtained because this ChatGPT surface exposes no reviewer/subagent dispatch capability. On 2026-09-16 the user explicitly waived that pre-implementation review gate and ordered implementation to start. The waiver is recorded without claiming `Approved`; Task 1 TDD implementation is now authorized.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank it.

## Current goal

Make ChatGPT Web/Desktop Computer Use fast and fluid through measurement-first, backwards-compatible improvements while preserving the working runtime, public `computer_*` contracts, and all authority, TCC, takeover, recovery, and verification invariants.

Live Codex comparison is deferred to conserve the user's Codex usage. This slice uses absolute reliability, latency, boundary-count, and safety gates.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`
- Continuity alias: `chatgpt-system-desktop`
- Active managed worktree: `/Users/dogan/.chatgpt-system/worktrees/e4eaca835975a22d75cc3e7778bb895500595d13b544a96d350c557d9edad976/c0b6df28-5082-4d9d-819a-011c2e21233e`
- Managed worktree ID: `c0b6df28-5082-4d9d-819a-011c2e21233e`
- Branch: `design/computer-use-flow-performance`
- Base: clean published `main@96d76b2810c7442a70dae5502065ff5bd15a2f99`
- Design commits before Plan A: `f7a9fbc`, `710d650`, `6528c04`, `cf35308`, `b811810`
- Original Plan A content commit: `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878` (`docs: add computer use flow benchmark plan`)
- Review-resolution commits: `46cb9a3842e458aca358ed125613bca9b452d442` (`docs: address computer flow plan review`), `2a8e434d14fff70eb86425e35f8f3fedf9aaf386` (`docs: tighten computer flow plan assertions`), and `36694d0e4f6d348842353252990487e164c989ae` (`docs: harden computer flow plan review contract`)
- Exact revised Plan A content for round 2: `36694d0e4f6d348842353252990487e164c989ae`
- Exact revised Plan A SHA-256: `91be19caf98e17fe2d2d94b55655ca3f0f6a962684bd5f8ce8695dfa1f474186`

Do not modify, clean, reset, remove, or repurpose other existing worktrees. This managed worktree is the only worktree owned by the current task.

## Completed

### Approved design

- Spec: `docs/superpowers/specs/2026-09-16-computer-use-flow-performance-design.md`
- Target surface: ChatGPT Web/Desktop custom app
- Execution policy: Optimistic Verified Batching
- Benchmark: five controlled Chrome scenarios plus one native macOS scenario
- Modes: scripted Runtime Mode and ChatGPT-driven Agent Mode with separate metrics
- Safety records: closed enums plus trusted categorical oracle assertions; no raw UI, OCR/AX, editable, screenshot, label, coordinate, secret, or lease content
- Deterministic gate: at least 57/60 per completed mode, no scenario below 9/10, and all safety counters zero
- Real-Mac gate: three eligible repetitions per selected workflow after separately authorized exact-artifact installation
- Planning gate: Plan A builds benchmark/baseline infrastructure; Plan B is written only after baseline evidence selects one exact bottleneck and objective effect rule

The spec passed an independent three-turn review. The final review status was Approved with no blocking issues.

## Verification

### Baseline evidence

From the clean managed worktree before task changes:

- `npm ci`: completed; 0 vulnerabilities reported
- `npm run check`: PASS
- TypeScript build: PASS
- Vitest: 117 files passed, 1 skipped; 735 tests passed, 2 skipped

No Computer Runtime behavior, installed helper, tunnel process, plugin registration, or public MCP schema has been changed.

## Current state

### Plan A status and review evidence

- Plan: `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`
- Original Plan A content commit: `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878`.
- Independent review round 1 returned `Needs Changes` with seven findings: lossy audit completeness, missing independent native oracle, Task 1/Task 2 scenario dependency, objective-specific comparison request typing, closed recovery/mapping gaps, weak Chrome process-preservation semantics, and stale final-HEAD verification sequencing.
- Review findings were resolved across `46cb9a3842e458aca358ed125613bca9b452d442` and `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`. A fresh pre-round-2 self-review then produced `36694d0e4f6d348842353252990487e164c989ae`, which is now the only exact Plan A content eligible for round-2 approval; the original `359756...` and earlier revised content are obsolete for approval purposes.
- Agent audit evidence is now explicitly positive-only because `ScopedComputerService.safeRecord()` / `AuditLogger.recordBestEffort()` can lose records without rolling back operations. Exact Agent `computerToolCallCount` and completeness-dependent absence assertions remain `unavailable/lossy_audit_source`; observed forbidden activity still invalidates a run.
- Scenario 6 now plans a minimally extended fixture-only, content-safe external native oracle; Runtime/Agent completion can no longer self-certify through `ComputerRuntime`/AX observation. Production native helper/core/host behavior remains outside Plan A.
- Task 1 now owns the six-scenario registry/provenance plus exhaustive versioned error/scroll mappings. Objective comparison input is a caller-preselected discriminated union with required runtime selector or reliability category.
- Chrome preservation now requires every pre-existing main-process ID to survive (`pre ⊆ post`); partial replacement fails.
- Tasks 6/7 now commit PROJECT_STATE before running the fresh `project_check`; any later repository edit invalidates that evidence and requires a rerun on the new final HEAD.
- Pre-round-2 self-review additionally made signed-run HMAC verification mandatory before evaluator/CLI arithmetic, persisted Scenario 4/5 recovery-contract evidence as a required assertion, required complete signed reliability regression-guard scenario sets, and made flow objective eligibility require every authoritative metric used by the selected rule. Comparison also rejects self-inconsistent or top-level-mismatched runtime build identities.
- Current product/tool inspection found no independent reviewer/subagent dispatch action in this ChatGPT surface. The installed `requesting-code-review` workflow explicitly requires subagent dispatch, so no round-2 `Approved` result was fabricated.
- Final self-review of the revised plan found no undefined named benchmark types, no `TBD`/`TODO`/`FIXME`/placeholder markers, no stale pre-review rules, and exactly one Task 1 creation of `scenarios.ts` with Task 2 explicitly not recreating/modifying it.
- Only planning documentation changed in this review-resolution turn. No benchmark/runtime/native implementation, installed helper, tunnel, Browser Runtime, public MCP schema, or Chrome process was changed.
- Implementation tests/builds were not run in this docs-only review-resolution turn; no fresh implementation PASS is claimed.
- Independent final approval is **not complete** and no `Approved` result is claimed. The user explicitly waived the missing round-2 approval gate on 2026-09-16 and authorized Task 1 implementation to begin. The waiver does not relax any technical, privacy, safety, TDD, verification, or deployment boundary.

## Blockers / uncertainties

- Independent round-2 review remains unavailable on this product surface; the user explicitly waived only that pre-implementation gate, so this is no longer an implementation blocker.
- Implementation-level plan defects, if discovered during RED/GREEN execution, remain open uncertainties and must be handled without weakening constraints.

## Invariants

- Do not develop on `main`.
- Preserve all unfamiliar dirty/review worktrees.
- Do not consume Codex usage for comparative Computer Use runs in this slice.
- Do not add a second model, hidden planner, Sky dependency, or speculative persistent REPL.
- Do not weaken authority, TCC, credentials, CAPTCHA, takeover, emergency-stop, stale-target, focus, or verification behavior.
- Do not silently restart normal Chrome or substitute Browser Runtime for explicit Computer Use.
- Do not push, open a PR, merge, deploy, replace the helper, or restart the healthy tunnel without separate authorization and fresh evidence.

## Next exact step

1. Treat the missing round-2 independent review as **user-waived, not approved**; retain the exact pre-waiver review target identity `36694d0e4f6d348842353252990487e164c989ae` / SHA-256 `91be19caf98e17fe2d2d94b55655ca3f0f6a962684bd5f8ce8695dfa1f474186` for auditability.
2. Begin Task 1 from `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md` using inline `superpowers:executing-plans` plus strict RED → GREEN TDD.
3. First create the four Task 1 test files, run the exact focused Vitest command, and verify RED for the intended missing benchmark modules before creating production benchmark TypeScript.
4. Implement only the minimal Task 1 contract/mappings/scenarios/canonical/identity/evaluator surface, then run the exact strict typecheck and focused GREEN tests before the Task 1 commit.
5. Keep push/PR/merge/deployment/helper replacement/tunnel/normal-Chrome restart separately unauthorized.

## Completion stages

- `design_approved`: complete
- `plan_a_self_reviewed`: complete for latest revised Plan A at `36694d0e4f6d348842353252990487e164c989ae` / SHA-256 `91be19caf98e17fe2d2d94b55655ca3f0f6a962684bd5f8ce8695dfa1f474186`
- `plan_a_review_round_1`: `Needs Changes`; seven findings resolved; pre-round-2 self-review hardenings complete; exact round-2 reviewed-content target `36694d0e4f6d348842353252990487e164c989ae`
- `plan_a_approved`: **not obtained**; pre-implementation round-2 review gate explicitly waived by the user on 2026-09-16; do not report this as `Approved`
- `benchmark_baseline_complete`: pending
- `candidate_ready_for_deployment`: pending
- `real_mac_acceptance_complete`: pending
- `slice_complete`: pending
