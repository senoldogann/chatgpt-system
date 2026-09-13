# Final Hardening Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four remaining hardening findings and finish a verified v1 release.

**Architecture:** Keep each change inside its existing subsystem. Audit logging owns persistence semantics and rotation; the Playwright backend bounds diagnostic strings before retention; the Computer native supervisor owns bounded graceful-to-forced shutdown; HTTP config rejects non-loopback binding unless the operator explicitly acknowledges that deployment mode.

**Tech Stack:** TypeScript 6, Node.js 22/24, Vitest 4, Playwright, Swift/macOS Computer Runtime, MCP HTTP/stdio.

**Spec:** `docs/superpowers/specs/2026-09-13-final-hardening-release-design.md`

## Global Constraints

- No new authority profile, execution surface, native protocol method, built-in TLS stack, or unrelated dependency upgrade.
- Audit active-file budget: exactly 16 MiB, plus one `.1` rotated generation.
- Browser retained diagnostic text: 2,048 chars; retained URL-like strings: 16,384 chars.
- Native-helper shutdown: graceful EOF, grace, TERM, grace, forced stop, final bounded grace.
- Non-loopback HTTP requires `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true`.
- Bearer authentication remains mandatory for HTTP.
- Every production change uses RED -> GREEN tests and a separate commit.

---

### Task 1: Audit outcome integrity and bounded storage

**Files:**
- Modify: `src/audit.ts`
- Create: `tests/audit-resilience.test.ts`
- Compatibility: existing audit tests

**Interfaces:** Keep `AuditLogger.record()` and `AuditLogger.run()` public signatures. Constructor may gain testable persistence/options hooks.

- [ ] **Step 1: Add RED outcome-separation tests**

Test a wrapped side effect that succeeds while audit persistence fails; `run()` must still resolve with the operation result and execute the side effect once. Test an operation error plus audit failure; `run()` must rethrow the original operation error, not the storage error.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx vitest run tests/audit-resilience.test.ts tests/audit-error-redaction.test.ts
```

- [ ] **Step 3: Implement best-effort auditing inside `run()`**

Use separate operation and persistence control flow: catch operation failure, best-effort record it, rethrow the same error; on success, best-effort record success and return the result. Direct `record()` still rejects when storage itself fails. Fallback diagnostics are fixed/content-free.

- [ ] **Step 4: Add RED rotation/concurrency tests**

Use a small test-only max size. Concurrent records through one logger must produce complete JSONL lines while keeping active file and `.1` within the configured limit. A single encoded line larger than the limit must make direct `record()` reject without creating an oversized active file.

- [ ] **Step 5: Implement serialized rotation**

Serialize writes per logger. Before append, measure encoded bytes; if `activeSize + lineSize` exceeds the limit, replace old `.1`, move active to `.1`, then append to a fresh active file. Production default is 16 MiB; keep parent/file permissions private.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run tests/audit-resilience.test.ts tests/audit-error-redaction.test.ts tests/process-audit.test.ts tests/browser-audit.test.ts tests/computer-audit.test.ts tests/owner-shell-audit.test.ts tests/terminal-session-audit.test.ts tests/project-exec-audit.test.ts
npm run build
git diff --check
```

Commit: `fix: preserve operation outcomes when audit storage fails`.

---

### Task 2: Bound Browser diagnostics before retention

**Files:**
- Modify: `src/playwright-browser-backend.ts`
- Modify: `tests/playwright-browser-backend.test.ts`
- Compatibility: browser service/MCP/audit tests

**Interfaces:** Add optional backend test/config values `maxDiagnosticMessageChars` and `maxDiagnosticUrlChars`; defaults 2,048 and 16,384. Public browser result shapes do not change.

- [ ] **Step 1: Add RED backend-retention tests**

Emit oversized console text, request failure text, request/response URLs, runtime-source URL, and initiator URL through the existing fake Playwright events. Read `backend.consoleErrors()` / `backend.networkErrors()` directly and assert every retained field already satisfies the configured backend limit.

- [ ] **Step 2: Confirm RED**

```bash
npx vitest run tests/playwright-browser-backend.test.ts
```

- [ ] **Step 3: Implement capture-time bounding**

Validate positive limits in the constructor. Truncate diagnostic free text before insertion and bound every URL-like field before insertion into `diagnosticsByPageId`. Keep `BrowserService` output sanitization unchanged as defense in depth.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/playwright-browser-backend.test.ts tests/browser-service.test.ts tests/browser-mcp.test.ts tests/browser-audit.test.ts tests/browser-error-normalization.test.ts
npm run build
git diff --check
```

Commit: `fix: bound browser diagnostics at capture`.

---

### Task 3: Bound native-helper shutdown through forced escalation

**Files:**
- Modify: `src/computer-native-supervisor.ts`
- Modify: `tests/computer-native-supervisor.test.ts`
- Compatibility: native client, runtime shutdown, computer MCP tests

**Interfaces:** No public API or protocol change. One internal termination routine owns the full shutdown sequence.

- [ ] **Step 1: Add RED uncooperative-child tests**

Extend the fake child so termination signals are recorded and close can be withheld. Normal `close()` must progress through graceful wait, TERM, then forced termination when the child remains alive. Fatal client invalidation must use the same escalation and must not produce an unhandled promise rejection. A cooperative child must stop before the forced step.

- [ ] **Step 2: Confirm RED**

```bash
npx vitest run tests/computer-native-supervisor.test.ts
```

- [ ] **Step 3: Centralize bounded termination**

Use close-event state rather than Node's `child.killed` flag to decide whether the process actually exited. Normal close awaits the sequence; fatal invalidation starts the same sequence with its promise explicitly handled. Keep all process-control choices internal.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/computer-native-supervisor.test.ts tests/computer-native-client.test.ts tests/runtime-shutdown.test.ts tests/computer-mcp.test.ts
npm run build
git diff --check
```

Commit: `fix: force-stop uncooperative computer helpers`.

---

### Task 4: Fail closed on non-loopback HTTP

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli.ts`
- Modify: `src/transport.ts` only as needed for shared host classification
- Modify: `tests/cli-command.test.ts`
- Modify: config/HTTP transport tests
- Modify: `README.md`, `SECURITY.md`, `docs/CHATGPT_INTEGRATION.md`

**Interfaces:** Add `ConfigOverrides.allowNonLoopbackHttp?: boolean`, `AppConfig.http.allowNonLoopback: boolean`, env `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP`, and CLI `--allow-non-loopback-http`.

- [ ] **Step 1: Add RED config/CLI tests**

Default `host=0.0.0.0` must reject. The same host with explicit override must load. `127.0.0.1`, `::1`, and `localhost` remain allowed without override. Env opt-in and CLI parsing/help must be covered.

- [ ] **Step 2: Implement the configuration guard**

Use one shared loopback-host classifier. Resolve `host`, `port`, token and explicit acknowledgement in config; reject non-loopback when acknowledgement is false. Transport still requires the bearer token and still applies localhost Host/Origin validation for loopback.

- [ ] **Step 3: Update operator docs**

State that the new flag is only an acknowledgement for deployments already protected by an authenticated TLS reverse proxy; it does not provide TLS and does not weaken bearer auth.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/cli-command.test.ts tests/control-config.test.ts tests/http-transport.test.ts tests/setup-chatgpt-tunnel.test.ts
npm run build
git diff --check
```

Commit: `fix: require opt-in for non-loopback http`.

---

### Task 5: Final release verification and publication

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PROJECT_STATE.md`
- Other operator docs only if Task 4 did not already capture the final wording.

- [ ] **Step 1: Run the pre-state full local gate sequentially**

Do not run Node and Swift suites concurrently on this machine.

```bash
npm run check
npm audit --omit=dev
CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1 npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
npx vitest run tests/terminal-pty-real.test.ts
swift test --package-path native/macos-computer-runtime
git diff --check origin/main...HEAD
```

- [ ] **Step 2: Update architecture/state and commit**

Record the four hardening boundaries, exact local head, test counts and the remaining hosted-CI publication gate. Do not claim CI results before they exist.

- [ ] **Step 3: Rerun the full exact-head gate**

After the state commit, rerun every command from Step 1 and require a clean worktree.

- [ ] **Step 4: Final scope/security review**

Confirm there is no authority widening, new execution surface, bearer-auth weakening, native protocol/TCC identity change, or unrelated dependency/lockfile change, and that each finding has direct regression coverage.

- [ ] **Step 5: Continuity checkpoint, branch publication and PR**

Checkpoint the exact verified branch head, then publish only `fix/final-hardening-release`, open one PR to `main`, and verify server-side SHA/diff match local evidence.

- [ ] **Step 6: Hosted exact-head gate**

Require Node 22, Node 24, and macOS-native SUCCESS plus clean merge state on the exact PR head. Any additional commit invalidates prior CI evidence and requires a fresh exact-head run.

- [ ] **Step 7: Merge and post-merge verification**

Merge only the verified head, synchronize local `main`, rerun the full local gate sequentially on the merge commit, and verify hosted `main` CI on that exact commit.

- [ ] **Step 8: Close v1**

Checkpoint Project Continuity as completed with the final merged/published SHA and verification evidence. No additional feature work is implied after this release.
