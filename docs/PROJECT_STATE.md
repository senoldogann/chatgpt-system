# chatgpt-system — Active Project State

Last updated: 2026-09-16

Status: **Computer Use flow-performance design is approved; Plan A has not yet been written.**

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
- Design commits before this state update: `f7a9fbc`, `710d650`, `6528c04`

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

## Constraints

- Do not develop on `main`.
- Preserve all unfamiliar dirty/review worktrees.
- Do not consume Codex usage for comparative Computer Use runs in this slice.
- Do not add a second model, hidden planner, Sky dependency, or speculative persistent REPL.
- Do not weaken authority, TCC, credentials, CAPTCHA, takeover, emergency-stop, stale-target, focus, or verification behavior.
- Do not silently restart normal Chrome or substitute Browser Runtime for explicit Computer Use.
- Do not push, open a PR, merge, deploy, replace the helper, or restart the healthy tunnel without separate authorization and fresh evidence.

## Next exact step

1. The user requested handoff to another agent and authorized continuation into Plan A; do not repeat completed brainstorming questions.
2. Resume the exact feature alias `chatgpt-system-computer-flow-performance`, then reconcile Git/worktree reality before mutation.
3. Read the `writing-plans` skill and create Plan A at `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`.
4. Plan A must define exact files, typed schemas, privacy-safe digest rules, required versus optional Agent Mode batches, tests, RED/GREEN commands, commit boundaries, and continuity checkpoints.
5. Dispatch the independent plan-document reviewer and resolve blocking findings, up to three review iterations.
6. Commit the approved Plan A and checkpoint exact branch/worktree/HEAD.
7. Do not begin implementation until the plan handoff gate is complete.

## Completion stages

- `design_approved`: current stage
- `plan_a_approved`: pending
- `benchmark_baseline_complete`: pending
- `candidate_ready_for_deployment`: pending
- `real_mac_acceptance_complete`: pending
- `slice_complete`: pending
