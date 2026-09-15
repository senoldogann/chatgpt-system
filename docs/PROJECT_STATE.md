# chatgpt-system — Active Project State

Last updated: 2026-09-16

Status: **Plan A is written and self-reviewed; independent plan review is blocked because this product surface exposes no reviewer/subagent dispatch capability. Implementation has not started.**

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
- Plan A content commit: `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878` (`docs: add computer use flow benchmark plan`)

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
- Plan content commit: `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878`
- Scope remains benchmark/baseline only; no Runtime, MCP, Browser Runtime, or native helper implementation was started.
- Repository mapping reused the existing Coding Harness patterns, Computer Runtime contracts, categorical audit, and deterministic native fixture.
- Agent evidence is fail-closed: the existing audit is used only for categories it actually records; missing turn correlation/direct verification evidence is `unavailable`, never inferred as pass. Required unavailable Agent assertions make the scenario gate `incomplete`.
- Chrome preservation uses a planned benchmark-owned read-only host-process oracle; raw process identifiers remain in memory and are not persisted.
- Runtime-build identity is bound to exact Git commit, clean working-tree digest domain, TypeScript artifact hash, installed-helper executable hash, protocol version, and a coarse non-identifying machine-class hash.
- Self-review against the approved spec found and resolved: incomplete Agent-result provenance, missing Chrome process oracle, missing metric fields, objective-comparison type mismatch, optionalized native regression gate, undefined plan interfaces, and underspecified artifact identity.
- Final self-review scan found no missing required spec coverage, no `TBD`/`TODO`/`FIXME`/placeholder markers, and no undefined named benchmark types.
- `git diff --cached --check` passed before the Plan A content commit.
- Independent plan review is **not complete**. The installed `writing-plans` skill has no embedded plan-document-reviewer prompt, and the available reviewer guidance requires dispatching an independent subagent; this chat surface exposes no such dispatch tool. No `Approved` result was fabricated.

## Constraints

- Do not develop on `main`.
- Preserve all unfamiliar dirty/review worktrees.
- Do not consume Codex usage for comparative Computer Use runs in this slice.
- Do not add a second model, hidden planner, Sky dependency, or speculative persistent REPL.
- Do not weaken authority, TCC, credentials, CAPTCHA, takeover, emergency-stop, stale-target, focus, or verification behavior.
- Do not silently restart normal Chrome or substitute Browser Runtime for explicit Computer Use.
- Do not push, open a PR, merge, deploy, replace the helper, or restart the healthy tunnel without separate authorization and fresh evidence.

## Next exact step

1. Do not begin Task 1 implementation while the independent Plan A review gate is unresolved.
2. On a reviewer-capable surface, dispatch an independent reviewer with only:
   - `docs/superpowers/specs/2026-09-16-computer-use-flow-performance-design.md`
   - `docs/superpowers/plans/2026-09-16-computer-use-flow-performance-benchmark.md`
3. Resolve every blocking reviewer finding and rerun the complete independent review, up to three rounds.
4. Require final reviewer status `Approved`; do not substitute this self-review for that gate.
5. After independent approval, reconcile Git/worktree reality, update this state plus `chatgpt-system-computer-flow-performance` continuity, and hand off the explicit execution choice. Do not automatically start implementation from this planning chat.
6. Push/PR/merge/deployment/helper replacement/tunnel restart remain separately unauthorized.

## Completion stages

- `design_approved`: complete
- `plan_a_self_reviewed`: complete at Plan A content commit `359756ea9fc3bec10f5a42b2dac6b0a0a5d86878`
- `plan_a_approved`: blocked pending independent reviewer capability/status
- `benchmark_baseline_complete`: pending
- `candidate_ready_for_deployment`: pending
- `real_mac_acceptance_complete`: pending
- `slice_complete`: pending
