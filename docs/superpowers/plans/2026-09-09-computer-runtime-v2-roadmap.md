# Computer Runtime v2 Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each slice task-by-task. Each slice gets its own exact implementation plan before code changes begin.

**Goal:** Deliver a fast native macOS computer-control runtime for ChatGPT with AX-first perception, smooth visible physical input, local multi-action execution, full Node.js power mode, bounded verification/recovery, and serious real-Mac/Web acceptance.

**Architecture:** `chatgpt-system` remains the TypeScript authority/policy/MCP control plane. A new Swift background helper owns deterministic macOS perception/actuation through Accessibility, AppKit/CoreGraphics, ScreenCaptureKit, and Vision. Typed `computer_run` is the routine fast path; `computer_run_js` is an explicitly enabled, unsandboxed full-Node child process that talks to the same computer runtime over private parent-child IPC.

**Tech Stack:** TypeScript 6, Node.js 22/24, Swift 6, macOS 14+ for the new computer helper, Accessibility APIs, AppKit, CoreGraphics, ScreenCaptureKit, Vision, Vitest, Swift Testing/XCTest through SwiftPM, GitHub Actions macOS CI.

**Spec:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`

## Global Constraints

- Browser Runtime remains the preferred semantic path for normal web automation.
- Computer Runtime is disabled by default and all screen/host operations except categorical `computer_health` require Admin authority.
- `computer_run_js` additionally requires explicit startup `--enable-full-host-js`.
- Full-host JavaScript is intentionally **not a sandbox** and runs with the current macOS user's ordinary permissions.
- Full-host JavaScript never receives implicit root/sudo privilege and must not automatically inherit daemon/tunnel/authority secrets.
- The native helper is deterministic infrastructure only: no LLM, autonomous planner, OODA loop, plugin manager, or second reasoning agent.
- Physical mutations are serialized through one action lane.
- User takeover and the fixed `Control+Option+Command+Escape` emergency chord cannot be disabled by MCP input.
- AX observations omit current editable/secure values; screenshots may naturally contain visible pixels.
- No raw AX pointers, OS PIDs, typed text, screenshot bytes, OCR text, JS source/output, lease IDs, or secret environment values enter audit metadata.
- Exact-head Node 22, Node 24, and macOS-native CI must be green before every slice merge.
- Every slice ends with post-merge `main` CI verification before the next slice begins.

---

## Delivery sequence

### Slice 1: Native host foundation

**Deliverable:** A standalone, tested Swift helper that speaks strict bounded NDJSON over stdio and can report categorical readiness, discover active/running apps, produce bounded AX observations, and capture a bounded PNG screenshot. No physical input yet.

**Merge gate:** Swift package build/tests green locally and in macOS CI; helper app bundle stages with stable bundle identifier; no TypeScript MCP surface yet.

**Detailed plan:** `docs/superpowers/plans/2026-09-09-computer-runtime-v2-slice1-native-host-foundation.md`

### Slice 2: Physical input + verification

**Deliverable:** Focus/open-app, smooth pointer trajectory, click/double-click, drag, scroll, keyboard/hotkeys, held-input cleanup, pointer takeover, fixed emergency chord, and deterministic verification primitives.

**Merge gate:** Native fixture tests prove exact pointer endpoints, bounded motion timing, action serialization, focus checks, state verification, takeover interruption, and cleanup on error/timeout/shutdown.

### Slice 3: TypeScript ComputerRuntime + MCP

**Deliverable:** Native helper supervisor/client, startup feature gate, Admin-only policy, low-level computer MCP tools, typed `computer_run`, stable errors/output schemas/audit rules, and daemon shutdown integration.

**Merge gate:** Node 22/24 tests prove strict schemas, lease policy, native protocol validation, helper crash/restart handling, bounded typed action execution, and existing browser/process behavior unchanged.

### Slice 4: Full Node.js runner

**Deliverable:** `--enable-full-host-js`, isolated owned Node child runner, private `computer` RPC, normal Node `require`/dynamic import/fs/network/child_process capability, timeout/cancel/process-tree cleanup, bounded output, and `computer_run_js` MCP surface.

**Merge gate:** Tests prove Node scripts can combine normal Node APIs with computer actions, `process.exit()` kills only the runner, timeout kills owned descendants, daemon secrets are not inherited automatically, and script/output content is absent from audit.

### Slice 5: Recovery + performance hardening

**Deliverable:** Observation cache/digests, `waitUntilChanged`, OCR fallback through Vision, stale-target recovery, bounded retry ladder, performance instrumentation, and fast-path tuning.

**Merge gate:** Disposable fixture intentionally causes stale/failed semantic targets; runtime recovers within configured budgets or returns `COMPUTER_NEEDS_REPLAN`. AX-only paths avoid screenshot/OCR. Measured warm-path latencies are recorded without content.

### Slice 6: Serious acceptance + freeze

**Deliverable:** Production-like local install/restart flow plus evidence-based acceptance against disposable fixture, Finder, TextEdit, Xcode, System Settings, Chromium, full Node runner, and fresh ChatGPT Web MCP.

**Merge/freeze gate:** All CI green, no held input after failures, Web -> plugin/tunnel -> local runtime -> visible physical Mac action proven, speed/reliability measured, regressions fixed only from evidence. If daily-driver quality is insufficient, revise or remove instead of keeping it merely because implementation was expensive.

---

## Branch and PR policy

1. The approved spec/roadmap land first.
2. Each implementation slice starts from the then-current `origin/main`, never from a stale historical computer-use branch.
3. Use one reviewable feature branch per slice, for example `feat/computer-runtime-v2-native-foundation`.
4. Never reuse or rebase the old `feat/computer-use-bridge` implementation branch into this work.
5. TDD first where behavior is testable; permission-dependent physical tests use simulated adapters in CI and real-Mac acceptance after merge.
6. Every PR records exact head SHA and CI evidence before merge.
7. Post-merge `main` CI must be green before beginning the next slice.

## Acceptance philosophy

A successful API call is not sufficient evidence. For computer actions, acceptance requires observed UI state change or an explicit deterministic verification result. Performance claims require measured local timings. Recovery claims require injected failures. Cleanup claims require proving no input remains held and owned children are gone. The subsystem is frozen only after those claims survive real Mac and fresh ChatGPT Web E2E testing.