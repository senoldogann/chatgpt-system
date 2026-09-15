# ChatGPT Web Project Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ChatGPT project work survive hosted Web-stream/developer-MCP capability loss without false local-failure claims, while adding safe diagnostics for genuine local tunnel/runtime failures.

**Architecture:** Reuse Project Continuity as the only semantic handoff store, strengthen model/agent guidance for proactive risk checkpoints and first-action resume, and add a standalone privacy-safe macOS diagnostic script for the existing daily-driver. Do not modify ChatGPT hosted behavior or add automatic restart/watchdog behavior; instead classify local evidence and preserve a deterministic new-chat recovery path.

**Tech Stack:** Node.js >=22, ESM JavaScript, TypeScript 6, MCP SDK v2, Zod 4, Vitest 5, macOS launchd/process table, existing Project Continuity and daily-driver logs.

**Spec:** `docs/superpowers/specs/2026-09-15-chatgpt-web-project-resilience-design.md`

## Global Constraints

- Work only on non-`main` branch `feat/chatgpt-web-resilience` in the managed worktree created from `main@e15b46bce852a47a6369c845114127d14659b402`.
- Preserve the historical dirty `feat/computer-use-perception-reliability` worktree exactly.
- Do not modify its owned paths: `docs/CHATGPT_INTEGRATION.md`, `docs/PROJECT_STATE.md`, `scripts/setup-daily-driver.mjs`, `tests/setup-daily-driver.test.ts`.
- Project Continuity remains the only semantic project-handoff store; add no duplicate persistent state.
- Diagnostics must never emit credentials, request IDs, tunnel IDs, client instance IDs, PIDs, raw process commands, raw logs, file contents, browser data, typed text, screenshots/OCR/AX content, or authority lease IDs.
- Do not automatically restart the tunnel for `Connection interrupted` or `This conversation does not support developer MCPs`.
- Do not widen authority merely to batch operations.
- Existing TCC, authority, Browser-vs-Computer, CAPTCHA/anti-bot, Git publication, and verification contracts remain unchanged.
- Do not push, open a PR, merge, or deploy without explicit user authorization for that remote action.

## Execution preflight

The implementation worktree already exists. Baseline verification from the exact starting commit must remain recorded as:

```text
npm run check
114 passed test files + 1 skipped
722 passed tests + 2 skipped
0 failures
```

A direct `npm test` without the build step is not the authoritative baseline because the real-runner tests depend on built artifacts. The repository gate is `npm run check`.

---

### Task 1: Add privacy-safe connection diagnostics

**Files:**
- Create: `scripts/diagnose-chatgpt-connection.mjs`
- Create: `tests/chatgpt-connection-diagnostics.test.ts`
- Modify: `package.json`

**Interfaces:**
- Export `parseDiagnosticArgs(argv)`.
- Export `parseTunnelWindow(stdoutText, nowMs, windowMs)`.
- Export `parseLaunchAgentStatus(text, exitCode)`.
- Export `classifyRuntimeSource(commandPath, homeDir)`.
- Export `classifyConnectionEvidence(evidence)`.
- CLI prints only one JSON object matching the spec's bounded public shape.

- [ ] **Step 1: Write RED classifier tests**

Add fixture-only tests for:

```ts
expect(classifyConnectionEvidence({
  dailyDriver: { loaded: true, running: true, neverExited: true },
  tunnel: { forwardedCommandCount: 12, warningCount: 0, errorCount: 0, stdioFailureCount: 0, recentActivity: true },
  runtime: { source: "stable-runtime", distCliPresent: true, nodeModulesPresent: true, zodPresent: true },
  stderr: { recent: false, dependencyFailureSignature: false },
})).toBe("LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE");
```

Also cover `DAILY_DRIVER_UNAVAILABLE`, `LOCAL_RUNTIME_DEPENDENCY_FAILURE`, `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE`, and `INSUFFICIENT_EVIDENCE`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- --run tests/chatgpt-connection-diagnostics.test.ts
```

Expected: FAIL because the script/exports do not exist.

- [ ] **Step 3: Implement pure parsing/classification helpers**

Implement strict argument parsing with default 15 minutes and accepted range 1..120. Parse only JSON-line timestamp/level/message from tunnel stdout; count forwarded commands, WARN, ERROR, and stdio failure messages. Never retain or return other fields.

Classify runtime source by normalized command path:

```text
~/.chatgpt-system/runtime/...      -> stable-runtime
~/.chatgpt-system/worktrees/...    -> managed-worktree
other absolute path                -> other
missing/unresolved                  -> unknown
```

- [ ] **Step 4: Implement host evidence collection**

Use `spawnSync` with fixed absolute `/bin/launchctl` and `/bin/ps`, read bounded daily-driver logs, derive only sanitized booleans/counts, and check runtime dependencies with `existsSync`. Do not return command lines or PIDs.

Use stderr file mtime to determine whether its contents are recent; only then detect the bounded `ERR_MODULE_NOT_FOUND` + `zod` signature.

- [ ] **Step 5: Add npm entrypoint**

Add:

```json
"diagnose:chatgpt": "node scripts/diagnose-chatgpt-connection.mjs"
```

- [ ] **Step 6: Run focused tests GREEN**

Run the focused test and confirm all cases pass.

- [ ] **Step 7: Run real diagnostic smoke test**

Run:

```bash
npm run diagnose:chatgpt
```

Verify output contains only the public schema fields and no raw identifiers/commands/log lines.

- [ ] **Step 8: Commit Task 1**

Stage only the three Task 1 files and commit:

```text
feat: add safe ChatGPT connection diagnostics
```

---

### Task 2: Harden Continuity and agent behavior for hosted capability loss

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/project-continuity-tool-registration.ts`
- Modify: `src/server.ts`
- Modify: `tests/project-continuity-tool-registration.test.ts`
- Modify: `tests/project-continuity-docs.test.ts`
- Modify: `tests/system-environment.test.ts` only if needed for description-contract coverage

**Interfaces:**
- No schema/storage changes.
- `project_checkpoint` description adds proactive risk-checkpoint guidance.
- `project_resume` description states it is the first project tool after capability returns in a new/recovered chat.
- `system_capabilities` / `system_environment` descriptions distinguish product-surface MCP loss from local failure and prohibit repeated unavailable-namespace retry/local-host substitution.

- [ ] **Step 1: Write RED model-guidance tests**

Require `project_checkpoint` description to match phrases equivalent to `long`, `tool-heavy`/`remote-sensitive`, and capability loss between messages.

Require `project_resume` description to match `after developer MCP capability returns` and `before project mutation`.

Extend docs contract expectations so `AGENTS.md` contains:

- `risk checkpoint`;
- new supported chat handoff for product-surface loss;
- no repeated unavailable-namespace retry;
- batching/parallelism without authority widening;
- diagnostic guard before removing a tunnel-active managed worktree.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- --run tests/project-continuity-tool-registration.test.ts tests/project-continuity-docs.test.ts tests/system-environment.test.ts
```

Expected: FAIL on the new guidance assertions.

- [ ] **Step 3: Update tool descriptions minimally**

Change descriptions only; do not change continuity schemas/services/store.

- [ ] **Step 4: Add `AGENTS.md` resilience protocol**

Add a concise section covering:

1. proactive risk checkpoint before roughly 8+ sequential MCP calls, long hosted polling, or a risky transition;
2. existing bounded batch tools/parallel independent reads preferred over serial yields;
3. no authority widening just for batching;
4. exact product-surface failure string -> stop local claims, do not repeatedly retry, move to a new supported standard chat and `project_resume` once tools return;
5. `Connection interrupted` alone is not evidence of local failure;
6. `npm run diagnose:chatgpt` before tunnel-related worktree cleanup; active `managed-worktree` source blocks removal.

- [ ] **Step 5: Run focused tests GREEN**

Re-run Task 2 focused tests.

- [ ] **Step 6: Commit Task 2**

Commit:

```text
feat: harden project handoff against MCP surface loss
```

---

### Task 3: Document the no-@ and Web-stream recovery path

**Files:**
- Create: `docs/CHATGPT_WEB_RESILIENCE.md`
- Modify: `README.md`
- Modify: `tests/chatgpt-integration-docs.test.ts`

**Interfaces:**
- README links to the focused resilience runbook.
- Existing `docs/CHATGPT_INTEGRATION.md` remains untouched because another preserved worktree owns concurrent changes there.

- [ ] **Step 1: Write RED docs contract tests**

Require README + resilience runbook to contain:

- exact product-surface error string;
- `Connection interrupted. Waiting for the complete answer`;
- `npm run diagnose:chatgpt`;
- if `@chatgpt-system-local` is absent, use a new supported standard text chat in the same Project rather than repeated `@` attempts;
- first project action after recovery is `project_resume`;
- do not restart a healthy tunnel solely because of either hosted symptom;
- do not use container fallback as the user's Mac;
- custom app absence across new supported chats is product/account/routing evidence, not a reason to weaken local security.

- [ ] **Step 2: Run focused docs test and verify RED**

Run:

```bash
npm test -- --run tests/chatgpt-integration-docs.test.ts
```

Expected: FAIL because the new runbook and wording do not yet exist.

- [ ] **Step 3: Write the resilience runbook**

Structure:

1. symptom classifier table;
2. normal same-chat recovery when tools still exist;
3. no-`@` recovery via new chat in same Project;
4. connection-interrupted recovery;
5. safe local diagnostic interpretation;
6. worktree cleanup guard;
7. evidence to capture privately for OpenAI Support;
8. explicit non-actions (no blind restart, no container substitution, no security weakening).

- [ ] **Step 4: Update README**

Replace the current recovery wording that depends on reselecting/`@mention` with a two-path contract: reuse current chat if the app is actually available; otherwise create a new supported standard chat in the same Project and resume exact Continuity state.

Link `docs/CHATGPT_WEB_RESILIENCE.md`.

- [ ] **Step 5: Run focused docs test GREEN**

Re-run the docs test.

- [ ] **Step 6: Commit Task 3**

Commit:

```text
docs: add ChatGPT Web resilience runbook
```

---

### Task 4: Verify exact branch state and checkpoint handoff

**Files:**
- No production file changes expected unless verification reveals a defect.

- [ ] **Step 1: Review branch diff**

Confirm changes are limited to the planned files and do not touch preserved dirty-worktree-owned files.

- [ ] **Step 2: Run focused regression suite**

Run:

```bash
npm test -- --run tests/chatgpt-connection-diagnostics.test.ts tests/project-continuity-tool-registration.test.ts tests/project-continuity-docs.test.ts tests/system-environment.test.ts tests/chatgpt-integration-docs.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run full repository gate**

Run:

```bash
npm run check
git diff --check
```

Expected: zero failures/errors.

- [ ] **Step 4: Run real safe diagnostic again**

Run:

```bash
npm run diagnose:chatgpt
```

Confirm it remains sanitized and classifies the current daily-driver without raw identifiers.

- [ ] **Step 5: Commit any final verification-only documentation correction if required**

No empty or cosmetic commit. If no correction is required, leave the previous commits as the final branch history.

- [ ] **Step 6: Run freshness-bound project verification**

Ensure worktree dependencies are available inside the Project sandbox, then run `project_check` on exact final `HEAD` + working-tree digest. Remove temporary ignored dependency material afterward and confirm the branch is clean.

- [ ] **Step 7: Update Project Continuity**

Checkpoint exact branch/worktree/HEAD, test evidence, diagnostic smoke result, preserved-worktree invariants, and next publication step.

- [ ] **Step 8: Stop at publication gate**

Do not push or create a PR without explicit user authorization for remote publication.
