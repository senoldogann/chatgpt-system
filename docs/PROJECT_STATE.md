# chatgpt-system — Active Project State

Last updated: 2026-09-16

Status: **Plan A benchmark infrastructure and previous readiness are complete; Task 7 real-Mac baseline is BLOCKED. S1 passed 7/10 runs against the required 9/10. Fixture-transport diagnostics were committed but the Chrome navigation failure is not fixed. Full Runtime/Agent baseline, bottleneck selection, Plan B and final acceptance remain incomplete. Independent Plan A round-2 review was explicitly waived, not Approved. A fresh exact-final-HEAD project_check recheck remains UNAVAILABLE because the Docker project-sandbox is unavailable.**

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
- Implementation code HEAD immediately preceding the readiness-state commit: `8613a824396087559b877f0d1e558aad32588ab9`
- Last verified clean readiness HEAD before Task 7: `2368ee6cc8589b15b24979380256b9cd35757dd7`.
- Diagnostic code commit: `086f371` — not an accepted baseline or navigation fix; new exact-HEAD readiness is needed before a fresh baseline.

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
- Task 4 Runtime baseline hardening follow-up: `a46367d3f3ed04202bc99a42544e7bed657b26cc` — bounded asynchronous web-oracle completion polling, accessible scoped-scroll readiness, stale-cache refresh before stale refusal, fresh bounded weak-AX visual-point derivation, and native self-activation/frontmost synchronization. This followed a failed diagnostic Runtime baseline and changes no production helper/core/host behavior.
- Task 4 S1 diagnostic follow-up: `8613a824396087559b877f0d1e558aad32588ab9` — wait for the current fixture session oracle before trusting the reused page heading; derive non-applicable Runtime zero-tolerance counters only from a complete direct trace with no relevant actions, retaining unavailable metrics when evidence is insufficient. Two focused regressions RED then GREEN; the signed ten-run mock integration check passed. No production helper/core/host changes.
- Task 5: `a0923e01baf142302fae5767e9a04c4dc4651f96` — deterministic CLI, ignored local result artifacts, signed evaluate/compare flow, reliability guards, operator runbook.

## Current state

The implementation intentionally extends the deterministic native **fixture only** so Scenario 6 has an independent content-safe completion oracle. Production Computer Runtime/helper/core/host behavior and public `computer_*` contracts were not changed by Plan A. No installed daily-driver helper was replaced or installed during readiness verification.

## Verification

### Task 6 readiness verification

All commands below were run on clean implementation code HEAD `8613a824396087559b877f0d1e558aad32588ab9` after the S1 diagnostic follow-up.

### Focused benchmark/fixture gates

- `npx vitest run tests/computer-use-flow-benchmark-contract.test.ts tests/computer-use-flow-scenarios.test.ts tests/computer-use-flow-identity.test.ts tests/computer-use-flow-web-fixture.test.ts tests/computer-use-flow-native-fixture-oracle.test.ts tests/computer-use-flow-host-oracle.test.ts tests/computer-use-flow-agent-collector.test.ts tests/computer-use-flow-runtime-mode.test.ts tests/computer-use-flow-evaluator.test.ts tests/computer-use-flow-cli.test.ts tests/macos-computer-runtime-fixture-package.test.ts --maxWorkers=1`: PASS — 11/11 test files, 81/81 tests.

### Repository, security, and native gates

- `npx tsc -p benchmarks/computer-use-flow-performance/tsconfig.json --noEmit`: PASS.
- `npm run build`: PASS.
- `npm run check`: PASS — 126 test files passed, 2 skipped; 808 tests passed, 3 skipped.
- `npm audit --omit=dev`: PASS — 0 vulnerabilities.
- `npm run test:computer:macos`: PASS — 219 Swift/XCTest tests, 0 failures.
- `npm run build:computer:macos`: PASS.
- `npm run build:computer-fixture:macos`: PASS.
- `npm run package:computer-fixture:macos`: PASS; the deterministic fixture bundle was built and staged inside the worktree only.
- Worktree remained clean after all build/test/package gates.

These gates prove implementation/readiness correctness. They do **not** constitute recorded Plan A baseline results, deployment authorization, installed-helper replacement, or real-Mac acceptance for a future optimized candidate.

Two Task 7 diagnostic Runtime collections have failed acceptance and are not accepted baselines. The first six-scenario run exposed completion/recovery/focus defects and led to fix `a46367d3f3ed04202bc99a42544e7bed657b26cc`. A later S1-only signed run on the previous readiness HEAD had 0/10 eligible successes, five completion passes, five failures and one timeout; its missing safety-counter provenance and reused-heading race led to focused RED regressions and fix `8613a824396087559b877f0d1e558aad32588ab9`. No Agent collection started. All previous ignored local artifacts remain diagnostic only; new baseline runs require a new final readiness HEAD/build identity.

Task 7 current evidence: A signed S1 batch on clean readiness `2368ee6cc8589b15b24979380256b9cd35757dd7` recorded 7/10 eligible successes against mandatory 9/10; failures occurred on repetitions 4, 5, 10, without reported safety failures or assertion unavailability. A diagnostic-only one-off observed `documentRequestReceived=false` and `pageReadyEventReceived=false`, so the fixture received no document GET; Chrome navigation cause is not proven. A further physical diagnostic was platform safety-blocked and not rerouted. Diagnostic tests RED then GREEN; focused 36/36 PASS; TypeScript PASS; full repo check 810 passed / 2 skipped; audit 0 vulnerabilities; native 219/219, release builds and fixture package PASS, all before diagnostic commit `086f371` on identical staged source. This does not establish final-HEAD readiness or S1 acceptance. No Agent Mode was started.

The exact-final-HEAD `project_check` detect/run/report recheck at `e2ca6ae9c10542cb829b3678ace2f777f33c54ec` found the required `package-script:check` (`npm run check`) but returned `UNAVAILABLE` in the Docker project-sandbox, with freshness matching the HEAD and working-tree digest and no working-tree change. This is not a PASS and does not authorize a new baseline.
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
- No accepted baseline exists; prior recorded runs are diagnostic only. A future Plan B objective must be selected only from eligible signed baseline evidence.
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

The last accepted readiness was verified on `2368ee6...`. A fresh exact-final-HEAD `project_check` recheck on `e2ca6ae...` remains `UNAVAILABLE` because the Docker project-sandbox is unavailable; restore that environment on a supported authorized host and rerun detect/run/report before any new baseline. The physical diagnostic was safety-blocked; do not bypass it.

**Next exact step: address the blocked S1 navigation, not another unverified baseline.** Establish why Chrome's completed-unverified `command+l → type_text → return` sometimes produces no fixture GET using permitted categorical evidence, without bypassing the physical diagnostic safety block. Only a proven defect justifies a RED test, minimal fix, fresh clean-HEAD verification and one signed S1 rerun (at least 9/10). If the cause remains unknown or that rerun fails, close the engineering attempt as blocked rather than looping. S2–S6 and Agent S1–S5 remain gated, and no objective is selected without eligible signed baseline evidence.

1. Only after the S1 defect is proven and fixed with a fresh clean readiness HEAD, bind that HEAD and installed-helper lineage to a new baseline build identity without installing or replacing the helper.
2. Run all six Runtime Mode batches on the real Mac: one discarded warm-up plus ten recorded runs per scenario.
3. Evaluate the complete Runtime set and require at least `57/60`, every scenario at least `9/10`, every required Runtime assertion authoritative, and zero safety counters.
4. Run mandatory Agent Mode web S1–S5 batches one controlled fixture at a time through the normal custom-app Computer Use surface, without Browser Runtime, `computer_run_js`, shell/process/filesystem shortcuts, Codex, or model-authored success evidence.
5. Select one eligible baseline bottleneck plus one preselected future Plan B objective, or record explicit `no_eligible_bottleneck` and return to design.

## Completion stages

- `design_approved`: complete.
- `plan_a_self_reviewed`: complete for revised Plan A `36694d0e4f6d348842353252990487e164c989ae` / SHA-256 `91be19caf98e17fe2d2d94b55655ca3f0f6a962684bd5f8ce8695dfa1f474186`.
- `plan_a_review_round_1`: `Needs Changes`; findings resolved.
- `plan_a_approved`: **not obtained**; independent round-2 pre-implementation gate explicitly waived by the user; do not report as `Approved`.
- `plan_a_implementation_ready`: previously verified on clean readiness `2368ee6...`; diagnostic code and this handoff update require fresh final-HEAD verification before any new baseline.
- `benchmark_baseline_complete`: pending.
- `candidate_ready_for_deployment`: pending.
- `real_mac_acceptance_complete`: pending.
- `slice_complete`: pending.
