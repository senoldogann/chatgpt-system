# chatgpt-system — Active Project State

Last updated: 2026-09-16

Status: **Plan A review round 1 returned `Needs Changes`; all seven blocking/important findings were addressed in revised Plan A content ending at `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`. Final independent approval is still pending round 2. Implementation has not started.**

This file is a bounded handoff cache. Git/worktree reality and Project Continuity records outrank it.

## Current goal

Make ChatGPT Web/Desktop Computer Use fast and fluid through measurement-first, backwards-compatible improvements while preserving the working runtime, public `computer_*` contracts, and all authority, TCC, takeover, recovery, and verification invariants.

Live Codex comparison is deferred to conserve the user's Codex usage. This slice uses absolute reliability, latency, boundary-count, and safety gates.

## Active worktree

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`
- Continuity alias: `chatgpt-system-desktop`
- Active managed worktree: `/Users/dogan/.chatgpt-system/worktrees/e4eaca835975a22d75cc3e7778bb895500595d13b544a96d350c557d9edad976/c0b6df28-5082-4d9d-819a-011c2e21233e`
- Managed worktree ID: `c0b6df28-5082-4d9d-819a-011c2e21233e`
- Branch: `design/computer-use-flow-performance`
- Base: clean published `main@96d76b2810c7442a70dae5502065ff5bd15a2f99`
- Design commits before Plan A: `f7a9fbc`, `710d650`, `6528c04`, `cf35308`, `b811810`
- Original Plan A content commit: `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878` (`docs: add computer use flow benchmark plan`)
- Review-resolution commits: `46cb9a3842e458aca358ed125613bca9b452d442` (`docs: address computer flow plan review`) and `2a8e434d14fff70eb86425e35f8f3fedf9aaf386` (`docs: tighten computer flow plan assertions`)
- Exact revised Plan A content for round 2: `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`

Do not modify, clean, reset, remove, or repurpose other existing worktrees. This managed worktree is the only worktree owned by the current task.

## Approved design

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

## Baseline evidence

From the clean managed worktree before task changes:

- `npm ci`: completed; 0 vulnerabilities reported
- `npm run check`: PASS
- TypeScript build: PASS
- Vitest: 117 files passed, 1 skipped; 735 tests passed, 2 skipped

No Computer Runtime behavior, installed helper, tunnel process, plugin registration, or public MCP schema has been changed.

## Plan A status and review evidence

- Plan: `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`
- Original Plan A content commit: `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878`.
- Independent review round 1 returned `Needs Changes` with seven findings: lossy audit completeness, missing independent native oracle, Task 1/Task 2 scenario dependency, objective-specific comparison request typing, closed recovery/mapping gaps, weak Chrome process-preservation semantics, and stale final-HEAD verification sequencing.
- Review findings were resolved across `46cb9a3842e458aca358ed125613bca9b452d442` and the final assertion-consistency follow-up `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`. Exact revised Plan A content for round 2 is `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`; the original `359756...` content is obsolete for approval purposes.
- Agent audit evidence is now explicitly positive-only because `ScopedComputerService.safeRecord()` / `AuditLogger.recordBestEffort()` can lose records without rolling back operations. Exact Agent `computerToolCallCount` and completeness-dependent absence assertions remain `unavailable/lossy_audit_source`; observed forbidden activity still invalidates a run.
- Scenario 6 now plans a minimally extended fixture-only, content-safe external native oracle; Runtime/Agent completion can no longer self-certify through `ComputerRuntime`/AX observation. Production native helper/core/host behavior remains outside Plan A.
- Task 1 now owns the six-scenario registry/provenance plus exhaustive versioned error/scroll mappings. Objective comparison input is a caller-preselected discriminated union with required runtime selector or reliability category.
- Chrome preservation now requires every pre-existing main-process ID to survive (`pre ⊆ post`); partial replacement fails.
- Tasks 6/7 now commit PROJECT_STATE before running the fresh `project_check`; any later repository edit invalidates that evidence and requires a rerun on the new final HEAD.
- Final self-review of the revised plan found no undefined named benchmark types, no `TBD`/`TODO`/`FIXME`/placeholder markers, no stale pre-review rules, and exactly one Task 1 creation of `scenarios.ts` with Task 2 explicitly not recreating/modifying it.
- Only planning documentation changed in this review-resolution turn. No benchmark/runtime/native implementation, installed helper, tunnel, Browser Runtime, public MCP schema, or Chrome process was changed.
- Implementation tests/builds were not run in this docs-only review-resolution turn; no fresh implementation PASS is claimed.
- Independent final approval is **not complete**. Round 2 must independently review exact revised Plan A content at `2a8e434d14fff70eb86425e35f8f3fedf9aaf386` and return `Approved` before Task 1 begins.

## Constraints

- Do not develop on `main`.
- Preserve all unfamiliar dirty/review worktrees.
- Do not consume Codex usage for comparative Computer Use runs in this slice.
- Do not add a second model, hidden planner, Sky dependency, or speculative persistent REPL.
- Do not weaken authority, TCC, credentials, CAPTCHA, takeover, emergency-stop, stale-target, focus, or verification behavior.
- Do not silently restart normal Chrome or substitute Browser Runtime for explicit Computer Use.
- Do not push, open a PR, merge, deploy, replace the helper, or restart the healthy tunnel without separate authorization and fresh evidence.

## Next exact step

1. Do not begin Task 1 implementation while the revised Plan A lacks final independent `Approved` status.
2. Run independent review round 2 against exact revised Plan A commit `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`, using only:
   - `docs/superpowers/specs/2026-09-16-computer-use-flow-performance-design.md`
   - `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`
3. Reviewer must specifically verify the seven round-1 corrections and the full approved-spec coverage. Do not use the original `359756...` plan content as the reviewed artifact.
4. If round 2 returns blocking/important findings, resolve them and rerun review; maximum three total rounds. Require final status `Approved`.
5. After approval, reconcile exact Git/worktree/Continuity reality and hand off the explicit execution choice. Do not auto-start implementation from the planning/review handoff.
6. Push/PR/merge/deployment/helper replacement/tunnel/normal-Chrome restart remain separately unauthorized.

## Completion stages

- `design_approved`: complete
- `plan_a_self_reviewed`: complete for revised Plan A at `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`
- `plan_a_review_round_1`: `Needs Changes`; seven findings resolved; exact reviewed-content target `2a8e434d14fff70eb86425e35f8f3fedf9aaf386`
- `plan_a_approved`: blocked pending round-2 independent `Approved` status
- `benchmark_baseline_complete`: pending
- `candidate_ready_for_deployment`: pending
- `real_mac_acceptance_complete`: pending
- `slice_complete`: pending
