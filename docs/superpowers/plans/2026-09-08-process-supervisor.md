# Managed Process Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class, authority-scoped management of long-lived local development processes through `process_start`, `process_list`, `process_status`, `process_logs`, and `process_stop`.

**Architecture:** Keep `ProcessService` as the one-shot `terminal_run` executor. Add one shared `ProcessSupervisor` per `RuntimeServices` instance for lifecycle/registry/log ownership, plus an authority-scoped `ManagedProcessService` facade that reuses the active lease's `PathPolicy` and terminal allowlist on every call. No raw PID management surface, no shell mode, no disk-persisted registry.

**Tech Stack:** Node.js >=22, TypeScript ESM, `node:child_process`, MCP SDK, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-process-supervisor-design.md`

## Global Constraints

- `Project` and `User` authority remain unable to execute terminal/process tools.
- `Admin` authority runs as the current OS user, never root.
- Executable paths are rejected; command must be an allowlisted basename.
- `shell: false` for all process execution.
- Child environment is sanitized; do not copy the daemon environment wholesale.
- `cwd` must resolve inside active authority roots through existing `PathPolicy` symlink protections.
- MCP never accepts or returns an OS PID, process-group ID, or arbitrary signal name.
- `maxManagedProcesses` default: `32`.
- `maxProcessLogBytesPerStream` default: `131072` bytes.
- `processStopGraceMs` default: `3000` ms.
- Unknown and unauthorized process IDs both return `PROCESS_NOT_FOUND`.
- Process registry and logs are in-memory only.
- Existing `terminal_run` behavior must remain backward-compatible.
- Every production behavior change follows RED -> GREEN -> exact-head CI verification.

---

### Task 1: Shared Child Execution Policy and Process Limits

**Files:**
- Create: `src/process-policy.ts`
- Modify: `src/process-service.ts`
- Modify: `src/config.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/process-policy.test.ts`
- Test: `tests/config.test.ts` or the existing config-focused test file
- Test: `tests/process-service.test.ts`

**Interfaces:**
- Produces `validateProcessInvocation(terminal: { enabled: boolean; commands: string[] }, command: string, args: string[]): void`.
- Produces `sanitizedChildEnvironment(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`.
- Extends `LimitsConfig` with `maxManagedProcesses`, `maxProcessLogBytesPerStream`, and `processStopGraceMs`.
- Existing `ProcessService.run()` consumes the shared policy helpers with no behavior change.

- [ ] **Step 1: Write failing policy/config tests**

Create focused tests proving:

```ts
expect(() => validateProcessInvocation({ enabled: false, commands: ["node"] }, "node", [])).toThrow(PolicyError);
expect(() => validateProcessInvocation({ enabled: true, commands: ["node"] }, "/usr/bin/node", [])).toThrow(PolicyError);
expect(() => validateProcessInvocation({ enabled: true, commands: ["node"] }, "sh", [])).toThrow(PolicyError);
expect(() => validateProcessInvocation({ enabled: true, commands: ["node"] }, "node", ["bad\0arg"])).toThrow(PolicyError);
```

Also assert the sanitized environment keeps only the existing safe keys plus `CI=1` and `NO_COLOR=1`, and that `loadConfig()` defaults the new limits to `32`, `131072`, and `3000` while parsing the three new environment variables as positive integers.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/process-policy.test.ts tests/process-service.test.ts tests/config.test.ts
```

Expected: FAIL because `process-policy.ts` and the new limit fields do not exist yet.

- [ ] **Step 3: Implement the minimum shared policy extraction**

`src/process-policy.ts` should contain the existing command/argument/environment rules extracted from `ProcessService`, not new policy:

```ts
export function validateProcessInvocation(
  terminal: { enabled: boolean; commands: string[] },
  command: string,
  args: string[],
): void;

export function sanitizedChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv;
```

Update `ProcessService.run()` to call these helpers before resolving `cwd` and spawning.

Extend `EnvSchema`, `LimitsConfig`, `loadConfig()`, and `systemCapabilitiesOutputSchema` with the three exact process limits from the spec.

- [ ] **Step 4: Run focused tests and full suite**

Run:

```bash
npm test -- tests/process-policy.test.ts tests/process-service.test.ts tests/config.test.ts
npm test
```

Expected: PASS; existing one-shot terminal tests remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/process-policy.ts src/process-service.ts src/config.ts src/tool-output-schemas.ts tests/process-policy.test.ts tests/process-service.test.ts tests/config.test.ts
git commit -m "refactor: share child process execution policy"
```

---

### Task 2: Shared Process Supervisor Core, Registry, and Tail Logs

**Files:**
- Create: `src/process-supervisor.ts`
- Modify: `src/errors.ts`
- Test: `tests/process-supervisor.test.ts`

**Interfaces:**

```ts
export type ManagedProcessState = "running" | "exited" | "stopped";

export interface ManagedProcessSummary {
  processId: string;
  command: string;
  argCount: number;
  cwd: string;
  state: ManagedProcessState;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
}

export interface ManagedProcessLogs {
  processId: string;
  stdout: { content: string; bytes: number; truncated: boolean };
  stderr: { content: string; bytes: number; truncated: boolean };
}

export interface ManagedProcessDescriptor {
  processId: string;
  command: string;
  cwd: string;
}

export class ProcessSupervisor {
  start(input: { command: string; args: string[]; cwd: string }): Promise<ManagedProcessSummary>;
  descriptors(): ManagedProcessDescriptor[];
  status(processId: string): ManagedProcessSummary | undefined;
  logs(processId: string): ManagedProcessLogs | undefined;
  stop(processId: string): Promise<ManagedProcessSummary | undefined>;
  close(): Promise<void>;
}
```

Constructor receives only the operational dependencies/config it owns: limits, audit logger, clock/random hooks when needed for deterministic tests, and an injectable spawn/signal boundary where real process behavior is otherwise impractical to force.

- [ ] **Step 1: Write RED tests for start, opaque IDs, natural exit, and logs**

Use real harmless Node child processes where possible:

```ts
const started = await supervisor.start({
  command: "node",
  args: ["-e", "console.log('ready'); console.error('warn'); setTimeout(() => {}, 5000)"],
  cwd: root,
});
expect(started.processId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
expect(JSON.stringify(started)).not.toContain("pid");
```

Add separate tests for natural exit and per-stream tail truncation where the retained `bytes` never exceeds the configured bound and `truncated=true` after overflow.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/process-supervisor.test.ts
```

Expected: FAIL because `ProcessSupervisor` and `ProcessNotFoundError` do not exist.

- [ ] **Step 3: Implement bounded tail buffer and registry**

Implement a private byte-tail buffer that:

- appends `Buffer` chunks;
- discards oldest bytes beyond `maxProcessLogBytesPerStream`;
- tracks whether truncation ever occurred;
- decodes with Node UTF-8 replacement semantics at read time.

Generate process IDs with `randomBytes(32).toString("base64url")`. Do not store OS PID in public summary objects. Register only after the child emits `spawn`; on pre-spawn `error`, reject and leave no record.

- [ ] **Step 4: Implement natural lifecycle updates and registry capacity**

On child `close`, update one immutable record to `exited` unless stop/shutdown initiated termination. Store close timestamp, exit code, and signal.

Capacity behavior:

- never evict running records;
- before a new start, evict completed records oldest-started first until capacity exists;
- if all `maxManagedProcesses` records are running, throw `LimitError`.

- [ ] **Step 5: Run focused tests and exact full suite**

```bash
npm test -- tests/process-supervisor.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/process-supervisor.ts src/errors.ts tests/process-supervisor.test.ts
git commit -m "feat: add managed process supervisor core"
```

---

### Task 3: Scope-Aware Managed Process Facade and Stop Semantics

**Files:**
- Create: `src/managed-process-service.ts`
- Modify: `src/process-supervisor.ts`
- Modify: `src/scoped-runtime.ts`
- Test: `tests/managed-process-service.test.ts`
- Test: `tests/process-supervisor.test.ts`

**Interfaces:**

```ts
export class ManagedProcessService {
  constructor(
    policy: PathPolicy,
    terminal: { enabled: boolean; commands: string[] },
    supervisor: ProcessSupervisor,
  );

  start(command: string, args: string[], cwdInput: string): Promise<ManagedProcessSummary>;
  list(): Promise<{ processes: ManagedProcessSummary[] }>;
  status(processId: string): Promise<ManagedProcessSummary>;
  logs(processId: string): Promise<ManagedProcessLogs>;
  stop(processId: string): Promise<ManagedProcessSummary>;
}
```

`ScopedRuntime` gains `processes: ManagedProcessService`. The facade must re-check the current lease on **every** list/status/logs/stop operation by validating terminal capability, command allowlist membership, and that the stored canonical cwd is inside the current `PathPolicy` roots.

- [ ] **Step 1: Write RED authorization tests**

Cover:

- Project/User scoped runtime cannot `start`.
- Admin can start allowlisted `node`.
- `sh` and `/usr/bin/node` remain denied.
- out-of-scope cwd is denied.
- a User lease sees an empty `process_list` and direct lookup returns `PROCESS_NOT_FOUND`.
- a compatible second Admin lease can inspect/stop a process after the first Admin lease is revoked.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/managed-process-service.test.ts
```

Expected: FAIL because the facade does not exist.

- [ ] **Step 3: Implement scope filtering and non-oracle lookup**

Use `PathPolicy.resolve(storedCanonicalCwd)` as the scope check; do not compare path strings manually. For a record that is unknown **or** fails current-scope validation, throw the same `ProcessNotFoundError` with code `PROCESS_NOT_FOUND` and no metadata about the hidden process.

`list()` filters unauthorized descriptors before asking the supervisor for summaries and sorts newest-started first.

- [ ] **Step 4: Write RED tests for stop behavior**

Cover:

- known completed process: stop is idempotent and sends no signal;
- running cooperative child: SIGTERM -> close -> `stopped`;
- uncooperative child: after `processStopGraceMs`, SIGKILL is attempted;
- MCP/user input never supplies a signal name or OS PID.

- [ ] **Step 5: Implement process-group stop**

On POSIX spawn with `detached: true`; signal the group with negative private PID internally. On non-POSIX, signal only the direct child. Never expose this identifier.

`stop()` marks termination intent before signaling so the eventual close state is `stopped`, waits at most `processStopGraceMs`, escalates to SIGKILL when required, then awaits close.

- [ ] **Step 6: Run focused and full tests**

```bash
npm test -- tests/managed-process-service.test.ts tests/process-supervisor.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/managed-process-service.ts src/process-supervisor.ts src/scoped-runtime.ts tests/managed-process-service.test.ts tests/process-supervisor.test.ts
git commit -m "feat: enforce authority scope for managed processes"
```

---

### Task 4: Runtime Ownership and Clean Shutdown

**Files:**
- Modify: `src/server.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/cli.ts`
- Test: `tests/runtime-services.test.ts` or existing runtime-wiring test
- Test: `tests/cli-shutdown.test.ts`

**Interfaces:**

`RuntimeServices` gains:

```ts
processSupervisor: ProcessSupervisor;
```

`createRuntimeServices()` creates exactly one shared supervisor. `createScopedRuntime()` receives that same supervisor and returns a scope facade; it must never construct a second supervisor.

- [ ] **Step 1: Write RED shared-runtime test**

Assert two independently created scoped Admin runtimes from the same `RuntimeServices` can see the same supervisor-owned process, while separate top-level `RuntimeServices` instances cannot.

- [ ] **Step 2: Verify RED**

Run the focused runtime test. Expected: FAIL because the runtime does not own a supervisor.

- [ ] **Step 3: Wire one supervisor into runtime/scoped runtime**

Create the singleton in `createRuntimeServices(config)` and pass it through `createScopedRuntime()`.

- [ ] **Step 4: Write RED clean-shutdown test**

Start a long-running harmless Node child, call the runtime/CLI close path, and assert the child reaches `stopped`/close within a bounded interval.

- [ ] **Step 5: Implement shutdown ordering**

For both stdio and HTTP shutdown:

1. stop/close the shared `processSupervisor`;
2. close the local authority control socket;
3. close MCP transport/server;
4. exit.

If supervisor cleanup fails, log a sanitized shutdown error but continue closing the remaining local services. Do not persist or sweep PIDs on next startup.

- [ ] **Step 6: Run focused and full tests**

```bash
npm test -- tests/runtime-services.test.ts tests/cli-shutdown.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/scoped-runtime.ts src/cli.ts tests/runtime-services.test.ts tests/cli-shutdown.test.ts
git commit -m "feat: own managed processes in shared runtime"
```

---

### Task 5: MCP Contracts for Five Process Tools

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/process-mcp.test.ts`
- Test: `tests/http-transport.test.ts` or existing catalog test

**Interfaces:**

Add strict schemas for `ManagedProcessSummary`, process-list output, and logs output. Register exactly:

- `process_start`
- `process_list`
- `process_status`
- `process_logs`
- `process_stop`

Every input includes `authorityLeaseId`. No schema includes PID, signal, env, shell, detached, or arbitrary process-control fields.

- [ ] **Step 1: Write RED catalog/schema tests**

Connect a real MCP client and assert all five names are present. Validate that extra keys such as `{ pid: 123 }`, `{ signal: "SIGKILL" }`, `{ shell: true }`, or `{ env: {...} }` are rejected by strict input schemas.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/process-mcp.test.ts
```

Expected: FAIL because the tools are not registered.

- [ ] **Step 3: Add output schemas and tool registrations**

Annotations:

- `process_list`, `process_status`, `process_logs`: read-only, non-destructive.
- `process_start`: non-idempotent mutation.
- `process_stop`: destructive/idempotent.

Handlers resolve the active lease through the existing `withAuthority(runtime, authorityLeaseId)` path and call `.processes` on the scoped runtime.

- [ ] **Step 4: Add MCP integration behavior tests**

With a locally minted Admin lease through the shared runtime, verify:

1. `process_start` Node fixture succeeds;
2. `process_status` sees it;
3. `process_logs` returns output;
4. second compatible Admin lease can manage it after ending first lease;
5. User lease cannot start/inspect it;
6. `process_stop` is idempotent;
7. no returned structured content contains an OS PID.

- [ ] **Step 5: Run focused and full suites**

```bash
npm test -- tests/process-mcp.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/tool-output-schemas.ts tests/process-mcp.test.ts tests/http-transport.test.ts
git commit -m "feat: expose managed process MCP tools"
```

---

### Task 6: Audit Privacy and Regression Hardening

**Files:**
- Modify: `src/process-supervisor.ts`
- Test: `tests/process-audit.test.ts`
- Test: `tests/process-service.test.ts`

**Interfaces:**

Audit events introduced:

```text
process.start
process.stop
```

Allowed metadata: command basename, argument count, coarse state where useful. Forbidden metadata: opaque process ID, OS PID/group ID, argument values, environment values, stdout/stderr, authority lease ID.

- [ ] **Step 1: Write RED audit-privacy tests**

Start and stop a child whose argument/output contains unique sentinel strings. Read the JSONL audit file and assert none of these appear:

```text
opaque processId
SECRET_ARGUMENT_SENTINEL
SECRET_OUTPUT_SENTINEL
authority lease ID
```

Assert the command basename and argument count are present for start/stop audit records.

- [ ] **Step 2: Verify RED**

Run the audit test and confirm it fails for the missing events, not for fixture mistakes.

- [ ] **Step 3: Add sanitized audit events**

Use `AuditLogger` without wrapping the entire long-lived process lifetime in `audit.run()`. Record start after successful spawn and stop after termination completes. Never serialize the process record itself as audit metadata.

- [ ] **Step 4: Run regression tests**

```bash
npm test -- tests/process-audit.test.ts tests/process-service.test.ts tests/authority-approval-mcp.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/process-supervisor.ts tests/process-audit.test.ts tests/process-service.test.ts
git commit -m "test: harden managed process audit privacy"
```

---

### Task 7: Documentation, CI, PR, and Real Mac Acceptance

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-09-08-process-supervisor.md` only to mark completed checkboxes if project convention requires it

**Interfaces:**
- Public tool names and exact config defaults must match the implementation/spec.
- Docs must explicitly state: no raw PID management, no OS sandbox, no persistence across daemon crash, and Admin/current-user boundary.

- [ ] **Step 1: Update docs and environment examples**

Document the five process tools and:

```text
CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES=32
CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM=131072
CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS=3000
```

Do not claim orphan cleanup after `SIGKILL`/crash.

- [ ] **Step 2: Run final verification on exact head**

```bash
npm run check
```

Then verify GitHub Actions for the exact commit head:

- Node 22: success
- Node 24: success
- macOS native build/install/self-verify: success

Do not rely on a prior commit's green run.

- [ ] **Step 3: Security diff review**

Review the full branch diff against `main` and specifically search for regressions in:

- `shell: true` or shell-string execution;
- PID fields in MCP schemas/output;
- unbounded arrays/buffers;
- environment spreading (`...process.env`);
- user-controlled signal/detached/process-group inputs;
- process IDs, lease IDs, args, env, or logs in audit metadata;
- duplicate `ProcessSupervisor` construction.

Fix any finding via a new RED/GREEN cycle before proceeding.

- [ ] **Step 4: Open a draft PR against `main`**

PR summary must include architecture, security boundaries, automated CI evidence, and a manual Mac checklist. Keep draft until physical acceptance completes.

- [ ] **Step 5: Manual Mac acceptance**

With the Secure MCP Tunnel running on the exact branch head:

1. `node dist/cli.js authorize admin` and approve Touch ID.
2. In ChatGPT, `process_start` a harmless Node fixture from `/Users/dogan/chatgpt-system`, e.g. an inline Node process that prints `process-ready` and stays alive without modifying files.
3. `process_status` -> `running` (unless fixture intentionally exits immediately).
4. `process_logs` -> contains `process-ready`.
5. `process_stop` -> `stopped`.
6. second `process_stop` -> same final state with no failure.
7. new User lease cannot start or directly inspect the process (`POLICY_DENIED` for start, `PROCESS_NOT_FOUND` for lookup).
8. Admin `sh` remains `POLICY_DENIED`.
9. End all leases.

- [ ] **Step 6: Mark PR ready only after acceptance**

Record exact-head CI and manual results in the PR body/comment, then mark ready for review. Merge to `main` only after the same evidence remains valid for the final head.
