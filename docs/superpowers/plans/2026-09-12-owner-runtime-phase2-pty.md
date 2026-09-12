# Owner Runtime Phase 2 Interactive PTY Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent interactive PTY sessions for locally approved Admin Owner Runtime sessions without weakening `terminal_run`, `shell_run`, Project/User authority, audit privacy, or daemon cleanup guarantees.

**Architecture:** Keep PTY as a separate additive Owner Runtime subsystem. A lazy `node-pty` backend supplies the real pseudo-terminal; one shared `TerminalSessionSupervisor` owns session registry, bounded output, native PID/process-group lifecycle, and daemon cleanup; an authority-scoped `TerminalSessionService` enforces Admin + Owner Runtime + cwd visibility and content-free audit metadata; six strict MCP tools expose opaque session handles only.

**Tech Stack:** TypeScript/Node.js 22+, MCP TypeScript SDK v2, Zod 4, exact `node-pty@1.2.0-beta.15`, Vitest 4, macOS/Linux PTY prebuilds, existing `PathPolicy`, `AuditLogger`, runtime shutdown, authority, and Git/CI conventions.

**Spec:** `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`

## Global Constraints

- PTY is available only to an active `admin` lease while `ownerRuntime.enabled === true`; Project/User stay denied.
- Existing `terminal_run` and `shell_run` public behavior must not change.
- The MCP caller cannot choose the shell executable, environment, raw OS PID/process-group ID, arbitrary signal, or detached mode.
- Sessions run as the current OS user and do not bypass TCC, sudo, Keychain, SIP, or OS authentication.
- Raw PTY input/output must never be copied into persistent audit or Project Continuity metadata.
- Session runtime has no product wall-clock deadline while the daemon is alive; retained terminal output, write payloads, session count, and protocol fields remain bounded.
- Sessions survive expiry/revocation of the creating Admin lease but are rediscoverable/manageable only by a later active Admin Owner Runtime lease.
- Daemon shutdown must gracefully terminate every owned PTY process group and force-kill after the configured grace period if needed.
- No session persists across daemon restart.
- Phase 2 must not change Computer Runtime action/runtime ceilings; that is Phase 3.
- Preserve unrelated worktrees and never modify `main` directly.

## Dependency decision

Use **exact** `node-pty@1.2.0-beta.15` for Phase 2. Do not use a caret range.

Reasoning/evidence:

- upstream stable `node-pty@1.1.0` has a known macOS `spawn-helper` execute-bit packaging defect;
- the fix is present in the 1.2 beta publish path;
- `1.2.0-beta.15` ships platform prebuilds and was smoke-tested on this Apple Silicon Mac with Node `v26.7.0` using a fresh temporary npm project;
- that smoke proved a real TTY (`-t 0`), interactive `write`, output `read`, `resize(100, 30)`, and clean exit;
- installation succeeded without relying on repository-local build scripts, which matters because CI deliberately uses `npm ci --ignore-scripts`.

If the exact package later fails Node 22/24 Linux CI or macOS CI, do not replace the PTY architecture. Treat dependency compatibility as the failing evidence and evaluate the next official `1.2.0-beta.*` exact version separately.

---

### Task 1: Add the lazy PTY backend and prove the real native dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/terminal-pty-backend.ts`
- Create: `tests/terminal-pty-backend.test.ts`
- Create: `tests/terminal-pty-real.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces `TerminalPtyBackend.spawn(input): Promise<TerminalPtyHandle>`.
- `TerminalPtyHandle` exposes internal-only `pid`, `cols`, `rows`, `write`, `resize`, `onData`, `onExit`, and `kill` operations; none are MCP output types.
- The production backend dynamically imports `node-pty` only on first PTY creation so disabled/default runtimes do not eagerly load a native addon.

- [ ] **Step 1: Write the failing backend contract test**

```ts
it("does not load node-pty until spawn and maps the PTY handle without exposing it publicly", async () => {
  const backend = new NodePtyBackend(async () => fakeNodePtyModule);
  const handle = await backend.spawn({
    file: "/bin/zsh",
    args: ["-l"],
    cwd: "/tmp",
    env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
    cols: 120,
    rows: 30,
  });
  expect(fakeSpawn).toHaveBeenCalledOnce();
  expect(handle.pid).toBe(4242);
});
```

- [ ] **Step 2: Run the backend test and verify RED**

Run: `npx vitest run tests/terminal-pty-backend.test.ts`

Expected: FAIL because `terminal-pty-backend.ts` does not exist.

- [ ] **Step 3: Add the exact dependency and minimal lazy adapter**

`package.json` dependency:

```json
"node-pty": "1.2.0-beta.15"
```

Core adapter shape:

```ts
export interface TerminalPtyExit {
  exitCode: number;
  signal?: number;
}

export interface TerminalPtyHandle {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: TerminalPtyExit) => void): { dispose(): void };
}

export interface TerminalPtyBackend {
  spawn(input: {
    file: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
  }): Promise<TerminalPtyHandle>;
}
```

`NodePtyBackend` must use a dependency-injected/dynamic importer so importing `server.ts` does not eagerly initialize the native addon.

- [ ] **Step 4: Add the real PTY smoke test**

The test must open `/bin/sh` or `/bin/zsh`, prove stdin is a TTY, write one bounded line, resize, observe the response, and exit cleanly. It must use the actual `node-pty` package, not a fake.

Representative assertion:

```ts
expect(output).toContain("TTY:yes");
expect(output).toContain("VALUE:hello");
expect(handle.cols).toBe(100);
expect(handle.rows).toBe(30);
```

- [ ] **Step 5: Make macOS hosted CI run the real PTY smoke explicitly**

Add after dependency install in `macos-native`:

```yaml
- name: Test Owner Runtime PTY native binding
  run: npx vitest run tests/terminal-pty-real.test.ts
```

The normal Node 22/24 Ubuntu `npm run check` also runs this test, proving both supported Node lines can load the packaged PTY binary.

- [ ] **Step 6: Verify GREEN and dependency integrity**

Run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npx vitest run tests/terminal-pty-backend.test.ts tests/terminal-pty-real.test.ts
npm run build
npm audit --omit=dev
```

Expected: all PASS and audit reports `0 vulnerabilities`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/terminal-pty-backend.ts tests/terminal-pty-backend.test.ts tests/terminal-pty-real.test.ts .github/workflows/ci.yml
git commit -m "feat: add owner terminal pty backend"
```

---

### Task 2: Implement bounded output cursoring and the shared session supervisor

**Files:**
- Modify: `src/config.ts`
- Create: `src/terminal-output-buffer.ts`
- Create: `src/terminal-session-supervisor.ts`
- Create: `tests/terminal-output-buffer.test.ts`
- Create: `tests/terminal-session-supervisor.test.ts`

**Interfaces:**
- Add fixed resource-containment values to `OwnerRuntimeConfig`:
  - `maxTerminalSessions: 32`
  - `maxTerminalOutputBytes: 262_144`
  - `maxTerminalInputBytes: 65_536`
- Produces `TerminalSessionSupervisor` methods: `open`, `descriptors`, `status`, `read`, `write`, `resize`, `stop`, `close`.
- Public supervisor summaries never include a PID.
- Output cursors are monotonic **event sequences**, not byte offsets.

- [ ] **Step 1: Write RED tests for the output ring**

Cover:

```ts
buffer.append("alpha"); // seq 1
buffer.append("beta");  // seq 2
expect(buffer.read(0)).toMatchObject({ data: "alphabeta", nextSequence: 2, truncatedBefore: false });
expect(buffer.read(1)).toMatchObject({ data: "beta", nextSequence: 2, truncatedBefore: false });
```

Also prove:

- byte retention never exceeds `maxTerminalOutputBytes`;
- old complete chunks are dropped first;
- one oversized UTF-8 chunk keeps a valid UTF-8 tail instead of splitting a continuation byte;
- `truncatedBefore=true` when the requested cursor predates retained data;
- reads at `nextSequence` return empty data without duplication.

- [ ] **Step 2: Implement `TerminalOutputBuffer` minimally**

Each retained entry is:

```ts
interface TerminalOutputChunk {
  sequence: number;
  data: string;
  bytes: number;
  prefixTruncated: boolean;
}
```

The buffer owns the current sequence and total retained byte count. It never persists content to disk.

- [ ] **Step 3: Write RED supervisor lifecycle tests**

Use a fake `TerminalPtyBackend` and injected clock/session-ID/signal functions. Prove:

- opaque 32-byte base64url session ID;
- registry capacity evicts oldest completed session first and never evicts running sessions;
- real output events increment cursor order;
- write and resize delegate only while running;
- natural exit becomes `exited`;
- explicit stop becomes `stopped`;
- close is idempotent for an already completed session;
- SIGTERM is sent to the negative PTY PID on POSIX, followed by SIGKILL only after grace expiry;
- daemon `close()` stops every running session;
- raw PID is absent from every returned summary/read object.

- [ ] **Step 4: Implement the supervisor**

Use these public types:

```ts
export type TerminalSessionState = "running" | "exited" | "stopped";

export interface TerminalSessionSummary {
  sessionId: string;
  cwd: string;
  state: TerminalSessionState;
  cols: number;
  rows: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: number | null;
  outputSequence: number;
}

export interface TerminalSessionReadResult {
  sessionId: string;
  state: TerminalSessionState;
  data: string;
  bytes: number;
  nextSequence: number;
  truncatedBefore: boolean;
}
```

Spawn the trusted configured shell as `shellPath` with `args: ["-l"]`. Build the child environment from `sanitizedChildEnvironment()`, remove `undefined` values, and set `TERM=xterm-256color` if not already present.

- [ ] **Step 5: Verify supervisor GREEN**

Run:

```bash
npx vitest run tests/terminal-output-buffer.test.ts tests/terminal-session-supervisor.test.ts
npm run build
```

Expected: PASS with no timer/unhandled-rejection warnings.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/terminal-output-buffer.ts src/terminal-session-supervisor.ts tests/terminal-output-buffer.test.ts tests/terminal-session-supervisor.test.ts
git commit -m "feat: add owner terminal session supervisor"
```

---

### Task 3: Add Admin/Owner authority, visibility, stable errors, and content-free audit

**Files:**
- Modify: `src/errors.ts`
- Create: `src/terminal-session-service.ts`
- Create: `tests/terminal-session-service.test.ts`
- Create: `tests/terminal-session-audit.test.ts`

**Interfaces:**
- `TerminalSessionService` wraps the shared supervisor per active authority scope.
- Unknown and unauthorized session IDs both map to `TERMINAL_SESSION_NOT_FOUND`.
- Write/resize on a completed session maps to `TERMINAL_SESSION_CLOSED`.
- Capacity maps to `TERMINAL_SESSION_LIMIT`; backend/lifecycle failures map to `TERMINAL_SESSION_FAILED`.

- [ ] **Step 1: Add RED authority/visibility tests**

Prove all of the following:

```ts
Project -> POLICY_DENIED
User -> POLICY_DENIED
Admin + ownerRuntime disabled -> OWNER_RUNTIME_DISABLED
Admin + ownerRuntime enabled -> open succeeds
```

Then create a session with Admin lease A, expire/revoke A, create Admin lease B, and prove B can list/read/write/close the existing session because ownership is daemon/runtime based rather than lease-token based.

- [ ] **Step 2: Add stable error classes**

Implement:

```text
TERMINAL_SESSION_NOT_FOUND
TERMINAL_SESSION_CLOSED
TERMINAL_SESSION_LIMIT
TERMINAL_SESSION_FAILED
```

Messages must be generic and must not contain PTY output, input, PID, session ID, native addon error text, or environment values.

- [ ] **Step 3: Implement service validation**

`open`:

- require Admin + Owner Runtime;
- resolve `cwd` through the active `PathPolicy`;
- default `cols=120`, `rows=30`;
- require integer `1..1000` dimensions.

`write`:

- require a manageable running session;
- require UTF-8 byte length `1..maxTerminalInputBytes`.

`read`:

- allow running or completed sessions;
- accept optional non-negative `afterSequence`;
- reject a cursor ahead of the current output sequence as a stable policy/input error rather than silently clamping.

`resize`:

- only running sessions;
- same `1..1000` bounds.

`close`:

- safe/idempotent for an existing completed session.

- [ ] **Step 4: Add RED audit privacy tests**

Use unique markers for PTY input/output and assert the audit file contains none of them and no session ID/PID. Allowed metadata:

```text
terminal.session.open: cols, rows, state
terminal.session.read: outputByteCount, truncated
terminal.session.write: inputByteCount
terminal.session.resize: cols, rows
terminal.session.close: state
```

- [ ] **Step 5: Implement audit wrapping and verify GREEN**

Run:

```bash
npx vitest run tests/terminal-session-service.test.ts tests/terminal-session-audit.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/errors.ts src/terminal-session-service.ts tests/terminal-session-service.test.ts tests/terminal-session-audit.test.ts
git commit -m "feat: secure owner terminal session service"
```

---

### Task 4: Expose the six strict MCP tools and wire runtime shutdown

**Files:**
- Create: `src/terminal-session-tool-registration.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/server.ts`
- Modify: `src/runtime-shutdown.ts`
- Create: `tests/terminal-session-mcp.test.ts`
- Modify: `tests/http-transport.test.ts`
- Modify: `tests/runtime-shutdown.test.ts`
- Modify: `tests/authority-mcp.test.ts`

**Interfaces:**

Register exactly:

```text
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
```

No raw PID/signal/shell/environment tool fields are permitted.

- [ ] **Step 1: Write the RED catalog/schema test**

Expected input shapes:

```ts
open:   { authorityLeaseId, cwd?, cols?, rows? }
read:   { authorityLeaseId, sessionId, afterSequence? }
write:  { authorityLeaseId, sessionId, data }
resize: { authorityLeaseId, sessionId, cols, rows }
close:  { authorityLeaseId, sessionId }
list:   { authorityLeaseId }
```

Every schema is `.strict()` and uses the existing minimum lease/session ID bounds.

- [ ] **Step 2: Add output schemas**

Expose `TerminalSessionSummary`, `TerminalSessionReadResult`, and `{ sessions: TerminalSessionSummary[] }` only. Never include native PID or backend details.

- [ ] **Step 3: Wire one shared supervisor into `RuntimeServices`**

`createRuntimeServices` creates:

```ts
const terminalSessionSupervisor = new TerminalSessionSupervisor({
  backend: new NodePtyBackend(),
  maxSessions: config.ownerRuntime.maxTerminalSessions,
  maxOutputBytes: config.ownerRuntime.maxTerminalOutputBytes,
  processStopGraceMs: config.limits.processStopGraceMs,
});
```

`createScopedRuntime` creates a `TerminalSessionService` using the same shared supervisor and `authority.profile === "admin"`.

- [ ] **Step 4: Register the six MCP tools**

Annotations:

- `read` and `list`: read-only, non-destructive, open-world false;
- `open`, `write`, `resize`, `close`: non-read-only; `open`/`write`/`close` are destructive/open-world because they can execute or control arbitrary terminal activity.

Pass MCP request cancellation only where an operation can await lifecycle work (`open`/`close` if needed); ordinary `read`/`write`/`resize` stay bounded synchronous/short operations.

- [ ] **Step 5: Make daemon shutdown own PTY cleanup**

Add shutdown phase:

```text
terminal-sessions
```

Run it before generic managed processes/browser teardown. Verify shutdown attempts every resource even if PTY cleanup throws, matching existing best-effort shutdown semantics.

- [ ] **Step 6: Verify authority and transport behavior**

Prove through real MCP calls:

- Project/User cannot list or operate sessions;
- disabled Admin gets `OWNER_RUNTIME_DISABLED`;
- enabled Admin can open/list/read/write/resize/close;
- unexpected fields fail schema validation;
- `terminal_run` and `shell_run` existing tests remain unchanged/green;
- HTTP tool catalog includes all six PTY tools with explicit annotations/output schemas.

Run:

```bash
npx vitest run tests/terminal-session-mcp.test.ts tests/http-transport.test.ts tests/runtime-shutdown.test.ts tests/authority-mcp.test.ts tests/owner-shell-mcp.test.ts
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/terminal-session-tool-registration.ts src/tool-output-schemas.ts src/scoped-runtime.ts src/server.ts src/runtime-shutdown.ts tests/terminal-session-mcp.test.ts tests/http-transport.test.ts tests/runtime-shutdown.test.ts tests/authority-mcp.test.ts
git commit -m "feat: expose owner terminal sessions over mcp"
```

---

### Task 5: Prove the real interactive Owner Runtime workflow

**Files:**
- Create: `tests/terminal-session-integration.test.ts`
- Modify: `tests/terminal-pty-real.test.ts` if the shared fixture can be reused without weakening the Task 1 smoke

**Interfaces:**
- Uses the public MCP surface only for lifecycle assertions.
- Uses a real `node-pty` backend, not the fake supervisor backend.

- [ ] **Step 1: Write a RED real-session integration test**

The test must:

1. create an enabled Personal Admin runtime;
2. mint Admin lease A;
3. `terminal_session_open` in a temporary directory;
4. write a harmless command that proves `test -t 0`, prints a unique marker, and runs `stty size`;
5. poll bounded `terminal_session_read` calls using `nextSequence` until the marker appears;
6. resize and prove the next `stty size` reflects the new dimensions;
7. verify a second read at the same `nextSequence` does not duplicate previous retained output;
8. revoke/end Admin A;
9. mint Admin B and prove `terminal_session_list` rediscovers the same opaque session;
10. write/read another command through B;
11. close the session and verify terminal state is `stopped` or already `exited` without exposing a PID;
12. confirm audit contains neither command/input markers nor PTY output markers.

Use bounded test deadlines only to prevent a hung test. Do not add a product runtime deadline to the PTY session.

- [ ] **Step 2: Add daemon-shutdown integration evidence**

Open a PTY running a shell child that remains active, call `closeRuntimeResources`, and assert the PTY exit callback fires within the existing stop grace + test margin and no running session remains.

- [ ] **Step 3: Run focused acceptance repeatedly**

Run:

```bash
npx vitest run tests/terminal-pty-real.test.ts tests/terminal-session-integration.test.ts
```

Then repeat the integration test at least five times to detect cursor/exit timing flakes before the full suite.

- [ ] **Step 4: Commit**

```bash
git add tests/terminal-session-integration.test.ts tests/terminal-pty-real.test.ts
git commit -m "test: cover owner terminal session integration"
```

---

### Task 6: Update operator/security docs, handoff state, and exact-head gates

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `docs/PROJECT_STATE.md`
- Test: `tests/coding-harness-docs.test.ts`
- Test: `tests/project-continuity-docs.test.ts`

**Interfaces:**
- No new startup flag: existing `--personal-admin --enable-owner-runtime` enables both `shell_run` and PTY sessions.
- Documentation must distinguish one-shot shell from persistent terminal session semantics.

- [ ] **Step 1: Update docs with the exact trust boundary**

Document:

```text
terminal_run         structured allowlisted one-shot
shell_run            unrestricted Owner one-shot
terminal_session_*   unrestricted Owner persistent PTY
```

State explicitly:

- session IDs are opaque daemon-local handles, not PIDs;
- sessions die on daemon restart/shutdown;
- a later Admin Owner lease can rediscover an existing session;
- Project/User cannot discover or operate sessions;
- terminal input/output is not durable audit content;
- retained PTY memory is bounded;
- PTY does not grant root or bypass OS authentication;
- exact `node-pty` dependency is native infrastructure, not a second terminal agent.

- [ ] **Step 2: Update `PROJECT_STATE.md`**

Record:

- Phase 1 merged as `main@0195a432bae370eb36dedf65056c874634f805dc`;
- Phase 2 branch/worktree path;
- dependency decision and local Node 26/macOS smoke evidence;
- exact Phase 2 commits and focused test results;
- next remote-write/PR gate;
- Phase 3 remains out of scope.

- [ ] **Step 3: Run docs tests and placeholder scan**

Run:

```bash
npx vitest run tests/coding-harness-docs.test.ts tests/project-continuity-docs.test.ts
python3 -c 'from pathlib import Path; p=Path("docs/superpowers/plans/2026-09-12-owner-runtime-phase2-pty.md"); terms=["T"+"BD","TO"+"DO","implement "+"later","fill in "+"details"]; hits=[t for t in terms if t in p.read_text()]; raise SystemExit(f"placeholder terms: {hits}") if hits else None'
```

Expected: tests PASS and placeholder scan returns no plan defects.

- [ ] **Step 4: Run the complete local exact-head gate**

Run in this exact order:

```bash
npm run check
npm audit --omit=dev
swift test --package-path native/macos-computer-runtime
git diff --check origin/main...HEAD
git status --short --branch
```

Expected:

- all Node/TypeScript tests PASS, with only the existing environment-gated Existing-Chrome skip if still applicable;
- production audit reports `0 vulnerabilities`;
- Swift native tests PASS;
- diff check is clean;
- worktree is clean after the final state commit.

- [ ] **Step 5: Review `origin/main...HEAD` before publication**

Reject publication if review finds any of:

- Project/User PTY widening;
- `terminal_run`/`shell_run` semantic regression;
- raw PID/signal/environment/shell-path input exposed through MCP;
- PTY input/output/session ID copied into audit/continuity;
- unbounded output/session registry;
- running-session eviction;
- missing daemon cleanup;
- dependency range broader than exact `1.2.0-beta.15` without new evidence;
- Phase 3 Computer Runtime changes mixed into this branch.

- [ ] **Step 6: Commit the docs/state handoff**

```bash
git add README.md SECURITY.md docs/ARCHITECTURE.md docs/CHATGPT_INTEGRATION.md docs/PROJECT_STATE.md
git commit -m "docs: finalize owner runtime phase 2"
```

Because this commit changes HEAD, rerun the full exact-head gate after the commit before claiming completion.

- [ ] **Step 7: Checkpoint Project Continuity and stop at the remote gate**

Checkpoint exact head, local verification, dependency evidence, remaining uncertainty, and the next action.

Do **not** push/open a PR/merge `main` unless the user explicitly authorizes the corresponding remote mutation. When authorized, publish the exact head, wait for Node 22, Node 24, and macOS-native CI on that same SHA, verify server-side diff scope and `mergeStateStatus=CLEAN`, then stop again before `main` merge unless merge authorization is explicit.

---

## Self-review checklist

- Spec coverage: PTY registry, open/read/write/resize/list/close, later-Admin visibility, bounded output, daemon cleanup, content-free audit, real interactive acceptance, and Project/User denial are all assigned to explicit tasks.
- Scope: no Phase 3 Computer Runtime limit changes and no new IDE/compiler abstraction.
- Dependency: one exact native PTY package; default runtime lazily loads it only when a PTY is opened.
- Type consistency: `TerminalSessionSummary`, `TerminalSessionReadResult`, `TerminalPtyBackend`, and six MCP tool names are defined once and reused consistently.
- Lifecycle: session records remain daemon-owned after creator lease expiry; running records are never evicted; shutdown uses group SIGTERM→SIGKILL semantics.
- Privacy: raw PTY input/output, native PID, session ID, environment, and shell path stay out of persistent audit/continuity.
- Verification: real native PTY tests run on Node 22/24 Linux through the normal test matrix and explicitly on macOS CI; local Mac smoke remains part of acceptance.
