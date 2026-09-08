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
- Child environment is sanitized; never spread the daemon environment wholesale.
- `cwd` must resolve inside active authority roots through existing `PathPolicy` symlink protections.
- MCP never accepts or returns an OS PID, process-group ID, or arbitrary signal name.
- `maxManagedProcesses` default: `32`.
- `maxProcessLogBytesPerStream` default: `131072` bytes.
- `processStopGraceMs` default: `3000` ms.
- Unknown and unauthorized process IDs both return `PROCESS_NOT_FOUND`.
- Process registry and logs are in-memory only.
- Existing `terminal_run` behavior remains backward-compatible.
- Every production behavior change follows RED -> GREEN -> exact-head CI verification.

---

### Task 1: Shared Child Execution Policy and Process Limits

**Files:**
- Create: `src/process-policy.ts`
- Create: `tests/process-policy.test.ts`
- Modify: `src/process-service.ts`
- Modify: `src/config.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `tests/control-config.test.ts`
- Modify: `tests/process-service.test.ts`

**Interfaces:**

```ts
export function validateProcessInvocation(
  terminal: { enabled: boolean; commands: string[] },
  command: string,
  args: string[],
): void;

export function sanitizedChildEnvironment(
  source?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
```

`LimitsConfig` gains `maxManagedProcesses`, `maxProcessLogBytesPerStream`, and `processStopGraceMs`.

- [ ] **Step 1: Write RED policy/config tests**

Prove disabled terminal, executable paths, non-allowlisted commands, and NUL arguments are rejected through the new shared helper:

```ts
expect(() => validateProcessInvocation({ enabled: false, commands: ["node"] }, "node", [])).toThrow(PolicyError);
expect(() => validateProcessInvocation({ enabled: true, commands: ["node"] }, "/usr/bin/node", [])).toThrow(PolicyError);
expect(() => validateProcessInvocation({ enabled: true, commands: ["node"] }, "sh", [])).toThrow(PolicyError);
expect(() => validateProcessInvocation({ enabled: true, commands: ["node"] }, "node", ["bad\0arg"])).toThrow(PolicyError);
```

In `tests/control-config.test.ts`, assert `loadConfig()` defaults the new limits to `32`, `131072`, `3000`, and accepts positive-integer values from:

```text
CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES
CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM
CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS
```

Also assert `sanitizedChildEnvironment()` keeps only the existing safe keys plus `CI=1` and `NO_COLOR=1`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/process-policy.test.ts tests/control-config.test.ts tests/process-service.test.ts
```

Expected: FAIL because `process-policy.ts` and the new limit fields do not exist.

- [ ] **Step 3: Implement the minimum extraction**

Move only the existing command/argument/environment rules from `ProcessService` into `src/process-policy.ts`. Update `ProcessService.run()` to call `validateProcessInvocation()` and use `sanitizedChildEnvironment()` before spawning.

Extend `EnvSchema`, `LimitsConfig`, `loadConfig()`, and `systemCapabilitiesOutputSchema` with the three process limits.

- [ ] **Step 4: Verify GREEN and regression suite**

```bash
npm test -- tests/process-policy.test.ts tests/control-config.test.ts tests/process-service.test.ts
npm test
```

Expected: PASS; one-shot `terminal_run` behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/process-policy.ts src/process-service.ts src/config.ts src/tool-output-schemas.ts tests/process-policy.test.ts tests/control-config.test.ts tests/process-service.test.ts
git commit -m "refactor: share child process execution policy"
```

---

### Task 2: Shared Process Supervisor Core, Registry, and Tail Logs

**Files:**
- Create: `src/process-supervisor.ts`
- Create: `tests/process-supervisor.test.ts`
- Modify: `src/errors.ts`

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

export interface ProcessSupervisorOptions {
  limits: Pick<LimitsConfig,
    "maxManagedProcesses" |
    "maxProcessLogBytesPerStream" |
    "processStopGraceMs"
  >;
  audit: AuditLogger;
  platform?: NodeJS.Platform;
  now?: () => number;
  newProcessId?: () => string;
  spawnProcess?: ManagedSpawn;
  signalProcess?: ManagedSignal;
}

export class ProcessSupervisor {
  constructor(options: ProcessSupervisorOptions);
  start(input: { command: string; args: string[]; cwd: string }): Promise<ManagedProcessSummary>;
  descriptors(): ManagedProcessDescriptor[];
  status(processId: string): ManagedProcessSummary | undefined;
  logs(processId: string): ManagedProcessLogs | undefined;
  stop(processId: string): Promise<ManagedProcessSummary | undefined>;
  close(): Promise<void>;
}
```

`ManagedSpawn`/`ManagedSignal` are narrow internal function types declared in `process-supervisor.ts`; production defaults wrap Node `spawn`/`process.kill`, while tests inject them only when real OS behavior cannot deterministically force an edge case.

- [ ] **Step 1: Write RED tests for start, identity, natural exit, logs, and capacity**

Use harmless real Node children where possible:

```ts
const started = await supervisor.start({
  command: "node",
  args: ["-e", "console.log('ready'); console.error('warn'); setTimeout(() => {}, 5000)"],
  cwd: root,
});
expect(started.processId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
expect(JSON.stringify(started)).not.toMatch(/\bpid\b/i);
```

Separate tests prove:

- pre-spawn error leaves no registry entry;
- natural exit becomes `exited`;
- stdout/stderr tails truncate oldest bytes independently;
- retained `bytes` never exceeds `maxProcessLogBytesPerStream`;
- running records are never evicted;
- completed records are evicted oldest-started first when capacity is needed;
- all-running capacity exhaustion throws `LIMIT_EXCEEDED`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/process-supervisor.test.ts
```

Expected: FAIL because `ProcessSupervisor` does not exist.

- [ ] **Step 3: Implement byte-tail buffer and opaque registry**

Use `randomBytes(32).toString("base64url")` for production IDs. Keep OS PID/process-group data only in private record state. Public summaries/descriptors/logs never contain it.

Register a child only after `spawn`. On `error` before successful spawn, reject and leave no externally visible record.

- [ ] **Step 4: Implement lifecycle/capacity updates**

On `close`, store `exitedAt`, `exitCode`, `signal`, and state `exited` unless termination intent was set by stop/shutdown.

Before new starts, evict only completed records oldest-started first. Never evict running records.

- [ ] **Step 5: Verify GREEN and full suite**

```bash
npm test -- tests/process-supervisor.test.ts
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/process-supervisor.ts src/errors.ts tests/process-supervisor.test.ts
git commit -m "feat: add managed process supervisor core"
```

---

### Task 3: Scope-Aware Managed Process Facade and Stop Semantics

**Files:**
- Create: `src/managed-process-service.ts`
- Create: `tests/managed-process-service.test.ts`
- Modify: `src/process-supervisor.ts`
- Modify: `src/errors.ts`

**Interfaces:**

```ts
export class ProcessNotFoundError extends AppError {
  constructor(message?: string);
}

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

`ProcessNotFoundError` uses stable code `PROCESS_NOT_FOUND` and contains no hidden process metadata.

- [ ] **Step 1: Write RED authority/scope tests**

Prove:

- User/Project terminal-disabled facades cannot `start` (`POLICY_DENIED`);
- Admin starts allowlisted `node`;
- `sh` and `/usr/bin/node` remain `POLICY_DENIED`;
- start cwd outside scope is `POLICY_DENIED`;
- a terminal-disabled/narrow facade returns an empty list for records it cannot manage;
- direct status/logs/stop for unknown **or unauthorized** IDs all return `PROCESS_NOT_FOUND`;
- a compatible later Admin facade can manage a process created under an earlier Admin lease.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/managed-process-service.test.ts
```

Expected: FAIL because the facade and stable error do not exist.

- [ ] **Step 3: Implement scope filtering without an oracle**

`start()` calls `validateProcessInvocation()` and resolves `cwd` through the current `PathPolicy` before delegating.

For later access, define an internal async manageability check:

1. if terminal capability is disabled, return `false`;
2. if descriptor command is not in current allowlist, return `false`;
3. attempt `policy.resolve(descriptor.cwd)`; if it fails, return `false`;
4. otherwise the record is manageable.

Do **not** call `validateProcessInvocation()` for lookup, because its `POLICY_DENIED` result would reveal that a hidden process exists. Unknown and unauthorized direct lookups both throw `ProcessNotFoundError`.

- [ ] **Step 4: Write RED stop tests**

Cover:

- completed process stop is idempotent with no signal;
- cooperative running child gets SIGTERM and reaches `stopped`;
- uncooperative child escalates to SIGKILL after `processStopGraceMs`;
- shutdown uses the same private termination path;
- no public method accepts PID or signal.

- [ ] **Step 5: Implement process-group termination**

On POSIX, spawn managed children with `detached: true` and privately signal the process group by negative PID. On non-POSIX, signal only the direct child. The MCP/user surface never accepts the target or signal.

Mark termination intent before signaling so the close handler records `stopped`. Await close after SIGTERM; after `processStopGraceMs`, send SIGKILL if still running, then await close.

- [ ] **Step 6: Verify GREEN and full suite**

```bash
npm test -- tests/managed-process-service.test.ts tests/process-supervisor.test.ts
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/managed-process-service.ts src/process-supervisor.ts src/errors.ts tests/managed-process-service.test.ts tests/process-supervisor.test.ts
git commit -m "feat: enforce authority scope for managed processes"
```

---

### Task 4: Runtime Ownership and Clean Shutdown

**Files:**
- Create: `src/runtime-shutdown.ts`
- Create: `tests/runtime-services.test.ts`
- Create: `tests/runtime-shutdown.test.ts`
- Modify: `src/server.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/cli.ts`
- Modify: `tests/process-service.test.ts`

**Interfaces:**

`RuntimeServices` gains:

```ts
processSupervisor: ProcessSupervisor;
```

`ScopedRuntime` gains:

```ts
processes: ManagedProcessService;
```

`ScopedRuntimeBase` gains the already-created shared `processSupervisor`; `createScopedRuntime()` never constructs a supervisor.

Shutdown helper:

```ts
export async function closeRuntimeResources(input: {
  runtime: Pick<RuntimeServices, "processSupervisor">;
  control?: ControlServerHandle;
  closeTransport: () => Promise<void>;
  reportError?: (phase: "processes" | "control" | "transport", error: unknown) => void;
}): Promise<void>;
```

- [ ] **Step 1: Write RED shared-runtime ownership test**

Create one `RuntimeServices`, two independently scoped Admin runtimes, start through one and observe through the other. A separately created top-level runtime must not share the registry.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/runtime-services.test.ts
```

- [ ] **Step 3: Wire exactly one supervisor per runtime**

Instantiate `ProcessSupervisor` only in `createRuntimeServices(config)`. Pass it through `ScopedRuntimeBase` into `ManagedProcessService`.

Update existing direct `createScopedRuntime()` tests such as `tests/process-service.test.ts` to supply the single explicit supervisor fixture rather than triggering a hidden fallback.

- [ ] **Step 4: Write RED shutdown-order/cleanup tests**

Start a long-running child, call `closeRuntimeResources()`, and assert:

1. managed processes are stopped first;
2. control close still runs if process cleanup reports an error;
3. transport close still runs if earlier cleanup reports an error;
4. no startup PID sweep/persistence path is introduced.

- [ ] **Step 5: Implement shutdown helper and wire CLI**

Both stdio and HTTP shutdown call `closeRuntimeResources()`. Each cleanup phase is attempted in order and reported with a fixed phase label; one failure must not prevent later cleanup.

- [ ] **Step 6: Verify GREEN and full suite**

```bash
npm test -- tests/runtime-services.test.ts tests/runtime-shutdown.test.ts tests/process-service.test.ts
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/runtime-shutdown.ts src/server.ts src/scoped-runtime.ts src/cli.ts tests/runtime-services.test.ts tests/runtime-shutdown.test.ts tests/process-service.test.ts
git commit -m "feat: own managed processes in shared runtime"
```

---

### Task 5: MCP Contracts for Five Process Tools

**Files:**
- Create: `tests/process-mcp.test.ts`
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `tests/authority-catalog.test.ts`

**Interfaces:**

Add output schemas for one process summary, process list, and process logs. Register exactly:

```text
process_start
process_list
process_status
process_logs
process_stop
```

Every input schema is `z.object(...).strict()` and includes `authorityLeaseId`. No process schema accepts PID, signal, env, shell, detached, or arbitrary process-control fields.

- [ ] **Step 1: Write RED catalog/schema tests**

Using a real MCP client/catalog handshake, assert the five names are present and that extra fields such as `pid`, `signal`, `shell`, `env`, or `detached` are rejected rather than silently stripped.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/process-mcp.test.ts tests/authority-catalog.test.ts
```

- [ ] **Step 3: Add schemas and tool handlers**

Annotations:

- list/status/logs: read-only, non-destructive;
- start: non-idempotent mutation;
- stop: destructive but idempotent.

Handlers use existing `withAuthority(runtime, authorityLeaseId)` and call `.processes` on the resulting scoped runtime.

- [ ] **Step 4: Add RED/GREEN integration behaviors**

Through the real MCP server plus locally minted leases, prove:

1. Admin `process_start` succeeds for harmless Node fixture;
2. status sees it;
3. logs return stdout/stderr tails;
4. second compatible Admin lease manages it after first lease ends;
5. User start is `POLICY_DENIED`;
6. User direct lookup is `PROCESS_NOT_FOUND`;
7. stop is idempotent;
8. structured output contains no OS PID.

- [ ] **Step 5: Run focused and full suites**

```bash
npm test -- tests/process-mcp.test.ts tests/authority-catalog.test.ts
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/tool-output-schemas.ts tests/process-mcp.test.ts tests/authority-catalog.test.ts
git commit -m "feat: expose managed process MCP tools"
```

---

### Task 6: Audit Privacy and Security Regression Tests

**Files:**
- Create: `tests/process-audit.test.ts`
- Modify: `src/process-supervisor.ts`
- Modify: `tests/process-service.test.ts`

**Interfaces:**

New audit actions:

```text
process.start
process.stop
```

Allowed metadata: command basename, argument count, coarse lifecycle state if useful. Forbidden metadata: opaque process ID, OS PID/group ID, argument values, environment values, stdout/stderr, authority lease ID.

- [ ] **Step 1: Write RED audit privacy test**

Start/stop a child whose argument/output contains unique sentinel strings. Read the JSONL audit file and assert none of these appear:

```text
opaque processId
SECRET_ARGUMENT_SENTINEL
SECRET_OUTPUT_SENTINEL
authority lease ID
```

Assert `process.start` and `process.stop` exist with only allowed metadata.

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/process-audit.test.ts
```

- [ ] **Step 3: Add sanitized audit records**

Record start only after successful spawn and stop only after termination completes. Do not wrap the entire child lifetime in `audit.run()`, and never serialize the private process record into metadata.

- [ ] **Step 4: Verify regressions**

```bash
npm test -- tests/process-audit.test.ts tests/process-service.test.ts tests/authority-approval-mcp.test.ts
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/process-supervisor.ts tests/process-audit.test.ts tests/process-service.test.ts
git commit -m "test: harden managed process audit privacy"
```

---

### Task 7: Documentation, Exact-Head CI, PR, and Real Mac Acceptance

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `.env.example`

- [ ] **Step 1: Update public documentation and env examples**

Document the five tools and exact environment defaults:

```text
CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES=32
CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM=131072
CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS=3000
```

Explicitly document: no raw PID management, no OS sandbox, no persistence guarantee across daemon crash, Admin remains current-user not root.

- [ ] **Step 2: Run final local verification**

```bash
npm run check
```

- [ ] **Step 3: Verify GitHub Actions for the exact head**

Require success for:

- Node 22;
- Node 24;
- macOS native broker build/install/self-verify;
- ChatGPT tunnel setup smoke.

A green run from an earlier commit does not count.

- [ ] **Step 4: Full security diff review against `main`**

Search specifically for:

- `shell: true` or shell-string execution;
- PID/process-group fields in MCP input/output;
- unbounded process/log storage;
- `...process.env` or equivalent broad inheritance;
- user-controlled signal/detached/process-group options;
- process IDs, lease IDs, args, env, or logs in audit metadata;
- duplicate `ProcessSupervisor` construction.

Any finding starts a new RED/GREEN cycle before proceeding.

- [ ] **Step 5: Open a draft PR against `main`**

PR body records architecture, security boundaries, exact-head CI, and manual Mac checklist.

- [ ] **Step 6: Manual Mac acceptance on exact branch head**

With Secure MCP Tunnel running from the branch:

1. locally authorize Admin through Touch ID;
2. `process_start` a harmless inline Node fixture under `/Users/dogan/chatgpt-system` that prints `process-ready` and remains alive without modifying files;
3. `process_status` reports `running` unless intentionally immediate-exit fixture;
4. `process_logs` contains `process-ready`;
5. `process_stop` reports `stopped`;
6. second `process_stop` returns the same final state without failure;
7. a User lease cannot start the fixture (`POLICY_DENIED`) and cannot directly inspect the known ID (`PROCESS_NOT_FOUND`);
8. Admin `sh` remains `POLICY_DENIED`;
9. end all leases.

- [ ] **Step 7: Mark PR ready and merge only with final evidence**

Update PR body/comment with exact-head automated + manual evidence, mark ready for review, and merge to `main` with an expected-head guard only after final verification remains valid.
