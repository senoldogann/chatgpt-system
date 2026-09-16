# chatgpt-system — Active Project State

Last updated: 2026-09-16

Status: **Plan A benchmark/readiness implementation Tasks 1–5 are committed and all Task 6 pre-readiness verification gates are green. The missing independent Plan A round-2 review was explicitly waived by the user and remains recorded as waived, not `Approved`. This document records the implementation code HEAD immediately preceding the readiness-state commit; the final readiness commit must still receive a fresh exact-HEAD `project_check` before baseline execution starts.**

This file is a handoff cache, not the sole source of truth. Git/worktree reality and Project Continuity records outrank it.

## Current goal

Make ChatGPT Web/Desktop Computer Use fast and fluid through measurement-first, backwards-compatible improvements while preserving the working runtime, public `computer_*` contracts, and all authority, TCC, takeover, recovery, verification, and held-input cleanup invariants.

Live Codex comparison remains deferred. Plan A now provides the measurement/baseline layer; Plan B is written only after baseline evidence selects one eligible bottleneck and one preselected objective rule.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`
- Project Continuity alias: `chatgpt-system-computer-flow-performance`
- Main Continuity alias: `chatgpt-system-desktop`
- Branch: `design/computer-use-flow-performance`
- Base: clean published `main@96d76b2810c7442a70dae5502065ff5bd15a2f99`
- Exact revised Plan A content: `36694d0e4f6d348842353252990487e164c989ae`
- Exact revised Plan A SHA-256: `91be19caf98e17fe2d2d94b55655ca3f0f6a962684bd5f8ce8695dfa1f474186`
- Implementation code HEAD immediately preceding the readiness-state commit: `a0923e01baf142302fae5767e9a04c4dc4651f96`

Do not modify, clean, reset, remove, or repurpose other existing worktrees. Do not push, open a PR, merge, deploy, replace the installed helper, restart the healthy tunnel, or restart normal Chrome without separate authorization.

## Completed

### Approved design and Plan A review state

- Spec: `docs/superpowers/specs/2026-09-16-computer-use-flow-performance-design.md`
- Plan: `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`
- The design spec passed its independent review and was Approved.
- Plan A independent review round 1 returned `Needs Changes`; its seven blocking/important findings were resolved in the revised plan.
- Independent Plan A round-2 approval was not available on this product surface. The user explicitly waived only that pre-implementation review gate on 2026-09-16. No `Approved` result is claimed or implied.

### Plan A implementation Tasks 1–5

- Task 1: `8ff3ed5e1f4d5d6f8984374ddb497c76a9854092` — benchmark contract, scenario registry, closed mappings, canonical signed records, build/machine identity, evaluator/comparison rules.
- Task 2: `c900ae7ece823952f8e808fe9129c12105979da4` — deterministic web fixtures plus fixture-only native oracle support and package tests.
- Task 3: `2381c274629e5f2bab7d517240e50c21b7caec12` — loss-aware Agent collector and strict read-only Chrome host oracle.
- Task 4: `96d86070eb4fdee3cd62782750edcfdf7d213aa2` — scripted Runtime Mode, benchmark-owned native trace, real-Mac harness, recovery-contract evidence, measurement-boundary discipline.
- Task 5: `a0923e01baf142302fae5767e9a04c4dc4651f96` — deterministic CLI, ignored local result artifacts, signed evaluate/compare flow, reliability guards, operator runbook.

The implementation intentionally extends the deterministic native **fixture only** so Scenario 6 has an independent content-safe completion oracle. Production Computer Runtime/helper/core/host behavior and public `computer_*` contracts were not changed by Plan A. No installed daily-driver helper was replaced or installed during readiness verification.

## Task 6 readiness verification

All commands below were run after Tasks 1–5 were committed at clean implementation code HEAD `a0923e01baf142302fae5767e9a04c4dc4651f96`.

### Focused benchmark/fixture gates

- `npx vitest run tests/computer-use-flow-benchmark-contract.test.ts tests/computer-use-flow-scenarios.test.ts tests/computer-use-flow-identity.test.ts tests/computer-use-flow-web-fixture.test.ts tests/computer-use-flow-native-fixture-oracle.test.ts tests/computer-use-flow-host-oracle.test.ts tests/computer-use-flow-agent-collector.test.ts tests/computer-use-flow-runtime-mode.test.ts tests/computer-use-flow-evaluator.test.ts tests/computer-use-flow-cli.test.ts tests/macos-computer-runtime-fixture-package.test.ts --maxWorkers=1`: PASS — 11/11 test files, 72/72 tests.

### Repository, security, and native gates

- `npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit`: PASS.
- `npm run build`: PASS.
- `npm run check`: PASS — 126 test files passed, 2 skipped; 799 tests passed, 3 skipped.
- `npm audit --omit=dev`: PASS — 0 vulnerabilities.
- `npm run test:computer:macos`: PASS — 219 Swift/XCTest tests, 0 failures.
- `npm run build:computer:macos`: PASS.
- `npm run build:computer-fixture:macos`: PASS.
- `npm run package:computer-fixture:macos`: PASS; the deterministic fixture bundle was built and staged inside the worktree only.
- Worktree remained clean after all build/test/package gates.

These gates prove implementation/readiness correctness. They do **not** constitute recorded Plan A baseline results, deployment authorization, installed-helper replacement, or real-Mac acceptance for a future optimized candidate.

## Evidence model and remaining limitations

- Runtime Mode owns exact benchmark direct-call/native-RPC, physical-action, recovery, verification, and safety evidence from benchmark-owned trace boundaries.
- Scenario 1 Chrome preservation uses the strict read-only `pre ⊆ post` process oracle; raw process identifiers are not persisted.
- Scenario 6 completion is authoritative only from the independent fixture-owned oracle. Runtime/AX success cannot self-certify it.
- Agent Mode global audit remains best-effort and positive-only. Missing audit lines prove nothing about absence or exact counts.
- `computerToolCallCount` remains unavailable with `lossy_audit_source` under the current audit surface.
- Completeness-dependent absence assertions such as `browser_runtime_absent` remain unavailable from audit silence unless a genuinely lossless trusted source appears.
- Agent model round trips and Agent end-to-end timing remain unavailable without trustworthy correlation/start evidence.
- Scenario 4/5 Agent recovery-contract evidence remains unavailable from the current lossy audit unless a lossless `trusted_mcp_trace` exists.
- Therefore affected Agent gates may be explicitly `incomplete`; unavailable evidence is never converted to zero, success, or synthetic `57/60`.
- Observed forbidden activity remains authoritative negative evidence and invalidates the run.

## Blockers / uncertainties

- Independent Plan A round-2 review remains absent but was explicitly waived for implementation; it must never be rewritten as `Approved`.
- No recorded baseline has been run yet. The benchmark objective for a future Plan B must be selected only from eligible signed baseline evidence.
- Deployment, helper replacement, tunnel lifecycle actions, push/PR/merge, and normal Chrome restart remain separately unauthorized.

## Invariants

- Do not develop on `main`.
- Preserve all unfamiliar dirty/review worktrees.
- Do not consume Codex usage for comparative Computer Use runs in this slice.
- Do not add a second model, hidden planner, Sky dependency, or speculative persistent REPL.
- Do not weaken authority, TCC, credentials, CAPTCHA, takeover, emergency-stop, stale-target, focus, verification, or held-input cleanup behavior.
- Do not silently restart normal Chrome or substitute Browser Runtime/Playwright for explicit Computer Use.
- Do not use `computer_run_js`, shell/process/filesystem shortcuts, or model-authored success evidence during mandatory Agent baseline runs.
- Do not push, open a PR, merge, deploy, replace the helper, or restart the healthy tunnel without separate authorization and fresh evidence.

## Next exact step

After this readiness-state commit receives the required fresh exact-final-HEAD `project_check` and Continuity checkpoint:

**Next exact step: run Plan A baseline batches.**

1. Bind the exact Task 6 readiness HEAD and clean worktree to the baseline build identity without installing or replacing a helper.
2. Run all six Runtime Mode batches on the real Mac: one discarded warm-up plus ten recorded runs per scenario.
3. Evaluate the complete Runtime set and require at least `57/60`, every scenario at least `9/10`, every required Runtime assertion authoritative, and zero safety counters.
4. Run mandatory Agent Mode web S1–S5 batches one controlled fixture at a time through the normal custom-app Computer Use surface, without Browser Runtime, `computer_run_js`, shell/process/filesystem shortcuts, Codex, or model-authored success evidence.
5. Select one eligible baseline bottleneck plus one preselected future Plan B objective, or record explicit `no_eligible_bottleneck` and return to design.

## Completion stages

- `design_approved`: complete.
- `plan_a_self_reviewed`: complete for revised Plan A `36694d0e4f6d348842353252990487e164c989ae` / SHA-256 `91be19caf98e17fe2d2d94b55655ca3f0f6a962684bd5f8ce8695dfa1f474186`.
- `plan_a_review_round_1`: `Needs Changes`; findings resolved.
- `plan_a_approved`: **not obtained**; independent round-2 pre-implementation gate explicitly waived by the user; do not report as `Approved`.
- `plan_a_implementation_ready`: pending final readiness-state commit plus fresh exact-HEAD `project_check`.
- `benchmark_baseline_complete`: pending.
- `candidate_ready_for_deployment`: pending.
- `real_mac_acceptance_complete`: pending.
- `slice_complete`: pending.
