# Owner Runtime Phase 1 — Full-Host Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Admin-only Owner Runtime gate and an unrestricted, cancellable one-shot `shell_run` tool that executes the real local login shell without the existing command allowlist or arbitrary command-duration/output-kill ceilings.

**Architecture:** Keep `terminal_run` and Project/User behavior unchanged. Add `AppConfig.ownerRuntime`, one shared `OwnerShellSupervisor` that owns all active shell process groups, and an authority-scoped `OwnerShellService` that enforces Admin/gate/path/audit policy before delegating to the supervisor. Register a separate high-risk `shell_run` MCP tool. The shell executes as the current OS user with `shell:false` at the Node spawn boundary (`configuredShell -lc <script>`), keeps daemon secrets out of the inherited environment, retains bounded stdout/stderr tails instead of killing on output volume, and is closed by MCP cancellation, explicit timeout, or the normal runtime-shutdown sequence.

**Tech Stack:** TypeScript 6, Node.js 22/24, MCP SDK, Zod, native `child_process.spawn`, existing `PathPolicy`/`AuditLogger`/authority runtime, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md`

## Global Constraints

- Owner Runtime is disabled by default.
- Owner Runtime requires the existing `admin` authority profile plus explicit startup enablement; do not add a fourth authority profile.
- Project and User authority must remain unable to execute host shell/PTY operations.
- Existing `terminal_run` remains allowlisted, `shell:false`, timeout-bounded, and backward-compatible.
- `shell_run` is full-host execution as the current OS user and is not an OS sandbox.
- Do not automatically forward daemon/tunnel/authority secret environment values to shell children.
- Do not persist raw shell script, stdout, stderr, or environment values in audit metadata.
- Omitted `timeoutMs` means no Owner Runtime wall-clock deadline; a caller-supplied finite timeout remains supported.
- Large stdout/stderr must truncate retained in-memory tails without killing the shell process.
- Cancellation/timeout/shutdown must terminate the owned process group; no indefinite execution may become unstoppable.
- Memory/protocol/script-size bounds remain; this phase removes arbitrary productivity ceilings, not containment.
- No raw OS PID is exposed through MCP.
- Use TDD: RED test, minimal GREEN implementation, focused tests, then commit.
- Do not modify or merge `main` directly; implementation occurs in an isolated feature worktree/branch and merges only after explicit user authorization and exact-head CI.

---

## File Structure

**Create**

- `src/owner-shell-supervisor.ts` — shared process ownership, bounded tail retention, timeout/abort handling, process-group cleanup, and daemon-wide `close()`.
- `src/owner-shell-service.ts` — authority-scoped Admin/gate/path/script validation plus content-free audit around the shared supervisor.
- `src/owner-shell-tool-registration.ts` — strict `shell_run` MCP schema, Admin/gate resolution through `createScopedRuntime`, cancellation propagation, safe error payloads.
- `tests/owner-shell-supervisor.test.ts` — deterministic lifecycle tests for output retention, timeout/cancel cleanup, and shutdown.
- `tests/owner-shell-service.test.ts` — authority/gate/path/script/audit policy plus harmless real-shell syntax and secret-isolation tests.
- `tests/owner-shell-mcp.test.ts` — real MCP policy/schema/integration tests.
- `tests/owner-shell-audit.test.ts` — explicit no-content audit regression tests.

**Modify**

- `src/config.ts` — Owner Runtime config/env/override/default shell path.
- `src/cli-command.ts` — `--enable-owner-runtime`, `--owner-shell-path` parsing.
- `src/cli.ts` — help/startup status.
- `src/system-environment.ts` — categorical Owner Runtime readiness.
- `src/errors.ts` — stable Owner Runtime lifecycle errors.
- `src/scoped-runtime.ts` — bind `OwnerShellService` to current authority roots/profile plus the shared supervisor.
- `src/runtime-shutdown.ts` — close active Owner shell process groups during daemon shutdown.
- `src/tool-output-schemas.ts` — Owner Runtime capability/environment and `shell_run` output schemas.
- `src/server.ts` — create the shared supervisor, register the MCP tool, and expose categorical capability output.
- `scripts/setup-chatgpt-tunnel.mjs` — persist Owner Runtime startup flags into the ChatGPT tunnel profile.
- `tests/cli-command.test.ts`
- `tests/owner-runtime-config.test.ts`
- `tests/system-environment.test.ts`
- `tests/runtime-shutdown.test.ts`
- `tests/http-transport.test.ts`
- `tests/authority-catalog.test.ts`
- `tests/setup-chatgpt-tunnel.test.ts`
- `README.md`
- `SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/CHATGPT_INTEGRATION.md`
- `docs/PROJECT_STATE.md` — only in the final handoff task after exact-head verification.

---

### Task 1: Add the explicit Owner Runtime configuration gate

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli.ts`
- Modify: `src/system-environment.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/server.ts`
- Test: `tests/cli-command.test.ts`
- Test: `tests/owner-runtime-config.test.ts`
- Test: `tests/system-environment.test.ts`

**Interfaces:**

```ts
export interface OwnerRuntimeConfig {
  enabled: boolean;
  shellPath: string;
  maxScriptBytes: number;
}

export interface AppConfig {
  // existing fields...
  ownerRuntime: OwnerRuntimeConfig;
}

export interface ConfigOverrides {
  // existing fields...
  ownerRuntimeEnabled?: boolean;
  ownerShellPath?: string;
}

export const OWNER_SHELL_MAX_SCRIPT_BYTES = 262_144;
```

Environment:

```text
CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME=true|false|1|0
CHATGPT_SYSTEM_OWNER_SHELL_PATH=/absolute/path
```

CLI:

```text
--enable-owner-runtime
--owner-shell-path <absolute-path>
```

`system_capabilities.ownerRuntime` and `system_environment.ownerRuntime`:

```ts
{ enabled: boolean }
```

Owner Runtime startup rule: `ownerRuntime.enabled === true` requires `personalAdmin.enabled === true`.

- [ ] **Step 1: Write RED configuration and CLI tests**

Add focused expectations to `tests/cli-command.test.ts`:

```ts
expect(parseCliCommand([
  "stdio",
  "--personal-admin",
  "--enable-owner-runtime",
  "--owner-shell-path",
  "/bin/sh",
])).toMatchObject({
  kind: "server",
  overrides: {
    personalAdminEnabled: true,
    ownerRuntimeEnabled: true,
    ownerShellPath: "/bin/sh",
  },
});

expect(() => parseCliCommand([
  "stdio",
  "--owner-shell-path",
  "/bin/sh",
])).toThrow(/enable-owner-runtime/i);

expect(() => parseCliCommand([
  "authorize",
  "admin",
  "--enable-owner-runtime",
])).toThrow();
```

Create `tests/owner-runtime-config.test.ts` with:

```ts
const disabled = await loadConfig({
  roots: [root],
  personalAdminEnabled: true,
});
expect(disabled.ownerRuntime.enabled).toBe(false);

const enabled = await loadConfig({
  roots: [root],
  personalAdminEnabled: true,
  ownerRuntimeEnabled: true,
  ownerShellPath: "/bin/sh",
});
expect(enabled.ownerRuntime).toMatchObject({
  enabled: true,
  shellPath: expect.any(String),
  maxScriptBytes: OWNER_SHELL_MAX_SCRIPT_BYTES,
});

await expect(loadConfig({
  roots: [root],
  ownerRuntimeEnabled: true,
  ownerShellPath: "/bin/sh",
})).rejects.toThrow(/personal admin/i);
```

Update `tests/system-environment.test.ts`:

```ts
expect(result.ownerRuntime).toEqual({ enabled: true });
expect(JSON.stringify(result)).not.toContain("CONTROL_PLANE_API_KEY");
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/cli-command.test.ts tests/owner-runtime-config.test.ts tests/system-environment.test.ts
```

Expected: FAIL because `ownerRuntime` config/flags/output do not exist.

- [ ] **Step 3: Implement config and validation**

In `src/config.ts`, add:

```ts
export const OWNER_SHELL_MAX_SCRIPT_BYTES = 262_144;

export interface OwnerRuntimeConfig {
  enabled: boolean;
  shellPath: string;
  maxScriptBytes: number;
}
```

Extend `AppConfig`, `ConfigOverrides`, and `EnvSchema`:

```ts
ownerRuntime: OwnerRuntimeConfig;

ownerRuntimeEnabled?: boolean;
ownerShellPath?: string;

CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME: z.enum(["true", "false", "1", "0"]).optional(),
CHATGPT_SYSTEM_OWNER_SHELL_PATH: z.string().optional(),
```

Use a platform-aware default helper:

```ts
export function defaultOwnerShellPath(current: NodeJS.Platform = process.platform): string {
  return current === "darwin" ? "/bin/zsh" : "/bin/sh";
}
```

When Owner Runtime is enabled, require an absolute configured shell path, resolve it through `realpath`, and fail startup if it cannot be resolved. The MCP request never chooses a shell executable.

Construct:

```ts
ownerRuntime: {
  enabled: overrides.ownerRuntimeEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME),
  shellPath: resolvedOwnerShellPath,
  maxScriptBytes: OWNER_SHELL_MAX_SCRIPT_BYTES,
},
```

After config creation:

```ts
if (config.ownerRuntime.enabled && !config.personalAdmin.enabled) {
  throw new Error("Owner Runtime requires Personal Admin to be explicitly enabled.");
}
```

Do **not** make `--enable-owner-runtime` imply `--personal-admin`.

- [ ] **Step 4: Implement CLI parsing/help and categorical reporting**

In `src/cli-command.ts`:

```ts
let ownerRuntimeEnabled = false;
let ownerShellPath: string | undefined;

if (arg === "--enable-owner-runtime") {
  ownerRuntimeEnabled = true;
  overrides.ownerRuntimeEnabled = true;
  continue;
}
if (arg === "--owner-shell-path") {
  ownerShellPath = takeValue(argv, index, arg);
  index += 1;
  continue;
}

if (ownerShellPath !== undefined) {
  if (!ownerRuntimeEnabled) throw new Error("--owner-shell-path requires --enable-owner-runtime.");
  overrides.ownerShellPath = ownerShellPath;
}
```

In `src/cli.ts`:

```text
--enable-owner-runtime            Enable Admin-only unrestricted owner shell/PTY capabilities. Disabled by default.
--owner-shell-path <path>         Trusted login shell executable; requires --enable-owner-runtime. Default on macOS: /bin/zsh.
```

In `src/system-environment.ts`, add and return:

```ts
ownerRuntime: { enabled: config.ownerRuntime.enabled },
```

In `src/tool-output-schemas.ts`, add matching `ownerRuntime` objects to `systemCapabilitiesOutputSchema` and `systemEnvironmentOutputSchema`.

In `src/server.ts`, return:

```ts
ownerRuntime: { enabled: runtime.config.ownerRuntime.enabled },
```

Do not expose shell history or child environment.

- [ ] **Step 5: Run focused tests and build**

```bash
npx vitest run tests/cli-command.test.ts tests/owner-runtime-config.test.ts tests/system-environment.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/config.ts src/cli-command.ts src/cli.ts src/system-environment.ts src/tool-output-schemas.ts src/server.ts tests/cli-command.test.ts tests/owner-runtime-config.test.ts tests/system-environment.test.ts
git commit -m "feat: add owner runtime startup gate"
```

---

### Task 2: Implement shared shell ownership and authority-scoped execution

**Files:**
- Create: `src/owner-shell-supervisor.ts`
- Create: `src/owner-shell-service.ts`
- Modify: `src/errors.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/server.ts`
- Modify: `src/runtime-shutdown.ts`
- Test: `tests/owner-shell-supervisor.test.ts`
- Test: `tests/owner-shell-service.test.ts`
- Test: `tests/runtime-shutdown.test.ts`

**Interfaces:**

```ts
export interface OwnerShellExecutionInput {
  shellPath: string;
  script: string;
  cwd: string;
  timeoutMs?: number | null;
  signal?: AbortSignal;
}

export interface OwnerShellRunInput {
  script: string;
  cwd?: string;
  timeoutMs?: number | null;
  signal?: AbortSignal;
}

export interface OwnerShellRunResult {
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutBytesSeen: number;
  stderrBytesSeen: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
}

export interface OwnerShellBackend {
  run(input: OwnerShellExecutionInput): Promise<OwnerShellRunResult>;
  close(): Promise<void>;
}
```

Stable errors:

```ts
OWNER_RUNTIME_DISABLED
SHELL_FAILED
SHELL_CANCELLED
```

`ScopedRuntime` gains:

```ts
shell: OwnerShellService;
```

`RuntimeServices` gains:

```ts
ownerShellSupervisor: OwnerShellSupervisor;
```

- [ ] **Step 1: Write RED supervisor lifecycle tests**

Create `tests/owner-shell-supervisor.test.ts`. Follow the existing `ProcessSupervisor` test style with injected spawn/signal functions. Prove:

```ts
// Output tail truncates but execution is not killed for output volume.
expect(result.stdoutBytesSeen).toBeGreaterThan(result.stdout.length);
expect(result.stdoutTruncated).toBe(true);
expect(result.exitCode).toBe(0);

// Abort targets the owned process group on POSIX.
controller.abort();
expect(signals).toContainEqual({ target: -fakePid, signal: "SIGTERM" });
await expect(runPromise).rejects.toMatchObject({ code: "SHELL_CANCELLED" });

// Explicit timeout is an execution outcome, not a protocol failure.
expect(timedResult.timedOut).toBe(true);
expect(signals).toContainEqual({ target: -fakePid, signal: "SIGTERM" });

// Shutdown closes all active owned groups.
await supervisor.close();
expect(signals).toContainEqual({ target: -fakePid, signal: "SIGTERM" });
```

Also prove SIGKILL follows when the fake child does not close within `processStopGraceMs`.

- [ ] **Step 2: Run supervisor tests and verify RED**

```bash
npx vitest run tests/owner-shell-supervisor.test.ts
```

Expected: FAIL because the supervisor does not exist.

- [ ] **Step 3: Add stable Owner Runtime errors**

In `src/errors.ts`:

```ts
export class OwnerRuntimeDisabledError extends AppError {
  constructor() {
    super(
      "Owner Runtime is disabled. Restart with --enable-owner-runtime or CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME=true.",
      "OWNER_RUNTIME_DISABLED",
      { retryable: false },
    );
  }
}

export class OwnerShellFailedError extends AppError {
  constructor() {
    super("Owner shell execution could not be started or managed.", "SHELL_FAILED", { retryable: true });
  }
}

export class OwnerShellCancelledError extends AppError {
  constructor(reason: "abort" | "shutdown") {
    super("Owner shell execution was cancelled.", "SHELL_CANCELLED", { reason, retryable: true });
  }
}
```

Never embed raw shell stderr/script in these messages.

- [ ] **Step 4: Implement `OwnerShellSupervisor` bounded retention**

Use a byte-aware tail buffer that counts all bytes seen but retains only the newest configured bytes:

```ts
class TailBuffer {
  private value = Buffer.alloc(0);
  private seen = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer): void {
    this.seen += chunk.byteLength;
    const combined = Buffer.concat([this.value, chunk]);
    if (combined.byteLength <= this.maxBytes) {
      this.value = combined;
      return;
    }
    this.truncated = true;
    this.value = Buffer.from(combined.subarray(combined.byteLength - this.maxBytes));
  }

  snapshot() {
    return {
      content: this.value.toString("utf8"),
      bytesSeen: this.seen,
      truncated: this.truncated,
    };
  }
}
```

Do not kill a process because output exceeded the retained tail size.

- [ ] **Step 5: Implement supervisor spawn, timeout, abort, and shutdown**

`OwnerShellSupervisor` implements `OwnerShellBackend` and its constructor should support deterministic injection:

```ts
export interface OwnerShellSupervisorOptions {
  maxRetainedBytesPerStream: number;
  processStopGraceMs: number;
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  signalProcess?: (target: number, signal: NodeJS.Signals) => void;
}
```

For each run, spawn only the service-provided trusted shell path:

```ts
spawn(input.shellPath, ["-lc", input.script], {
  cwd: input.cwd,
  shell: false,
  env: sanitizedChildEnvironment(),
  stdio: ["ignore", "pipe", "pipe"],
  detached: platform !== "win32",
});
```

Track active children in a private set/map so `close()` can cancel every owned run. Public APIs never return PID.

Lifecycle rules:

1. normal non-zero exit returns a normal `OwnerShellRunResult`;
2. omitted/null `timeoutMs` installs no timer;
3. finite timeout marks the run `timedOut=true`, terminates the process group, waits for close, and returns the bounded result;
4. MCP `AbortSignal` terminates the group and rejects with `SHELL_CANCELLED` after cleanup;
5. `close()` terminates every active group and makes in-flight promises reject with `SHELL_CANCELLED` reason `shutdown`;
6. send `SIGTERM`, wait `processStopGraceMs`, then `SIGKILL` if still alive;
7. on POSIX signal `-pid`; on Windows signal the child PID;
8. pre-spawn or lifecycle-management failures become `SHELL_FAILED` without raw error leakage.

Use:

```ts
function signalTarget(child: ChildProcess, platform: NodeJS.Platform): number | undefined {
  if (child.pid === undefined) return undefined;
  return platform === "win32" ? child.pid : -child.pid;
}
```

- [ ] **Step 6: Write RED authority/gate/path/audit service tests**

Create `tests/owner-shell-service.test.ts` using a temporary directory and `/bin/sh` in test config:

```ts
await expect(projectScoped.shell.run({ script: "printf no" }))
  .rejects.toMatchObject({ code: "POLICY_DENIED" });

await expect(adminButDisabled.shell.run({ script: "printf no" }))
  .rejects.toMatchObject({ code: "OWNER_RUNTIME_DISABLED" });

const result = await adminScoped.shell.run({
  script: "printf 'alpha' | tr a-z A-Z; printf 'file-ok' > redirected.txt",
  cwd: root,
});
expect(result.stdout).toContain("ALPHA");
expect(await readFile(path.join(root, "redirected.txt"), "utf8")).toBe("file-ok");
```

Also create a temporary executable not present in `config.terminal.commands` and invoke its absolute path from the shell script. It must run successfully.

- [ ] **Step 7: Implement the authority-scoped `OwnerShellService`**

The service owns no child processes; it validates policy and delegates to the shared supervisor:

```ts
export class OwnerShellService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly supervisor: OwnerShellBackend,
    private readonly config: OwnerRuntimeConfig,
    private readonly adminEnabled: boolean,
  ) {}

  async run(input: OwnerShellRunInput): Promise<OwnerShellRunResult> {
    if (!this.adminEnabled) throw new PolicyError("Owner Runtime shell requires an Admin authority lease.");
    if (!this.config.enabled) throw new OwnerRuntimeDisabledError();
    const scriptBytes = Buffer.byteLength(input.script, "utf8");
    if (scriptBytes === 0 || input.script.includes("\u0000")) throw new PolicyError("Owner shell script is invalid.");
    if (scriptBytes > this.config.maxScriptBytes) throw new LimitError("Owner shell script exceeded configured byte limit.");
    const cwd = await this.policy.resolve(input.cwd ?? ".");
    const digest = createHash("sha256").update(input.script).digest("hex");
    return this.audit.run(
      "shell.run",
      this.policy.display(cwd),
      () => this.supervisor.run({
        shellPath: this.config.shellPath,
        script: input.script,
        cwd,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      { scriptByteCount: scriptBytes, scriptSha256: digest },
    );
  }
}
```

No script/output/environment content enters audit metadata.

- [ ] **Step 8: Bind one shared supervisor into runtime/scopes**

In `src/server.ts`, construct once:

```ts
const ownerShellSupervisor = new OwnerShellSupervisor({
  maxRetainedBytesPerStream: config.limits.maxCommandOutputBytes,
  processStopGraceMs: config.limits.processStopGraceMs,
});
```

Expose it on `RuntimeServices` and `ScopedRuntimeBase`.

In `src/scoped-runtime.ts`:

```ts
shell: new OwnerShellService(
  policy,
  base.audit,
  base.ownerShellSupervisor,
  base.config.ownerRuntime,
  authority.profile === "admin",
),
```

Do not derive authority from caller-provided fields.

- [ ] **Step 9: Wire runtime shutdown**

Extend `RuntimeShutdownPhase` with `"owner-shell"` and close it before the existing managed-process/browser phases:

```ts
await attempt("owner-shell", () => input.runtime.ownerShellSupervisor.close());
```

Update `tests/runtime-shutdown.test.ts` to prove shutdown calls the Owner shell close hook and still continues to later cleanup phases if it throws.

- [ ] **Step 10: Add real-process output/secret/no-default-timeout tests**

In `tests/owner-shell-service.test.ts`, set a small retained output limit and prove a large command exits normally with truncation metadata.

Set a fake daemon secret and assert it is absent:

```ts
process.env.CONTROL_PLANE_API_KEY = "owner-shell-secret-canary";
const env = await adminScoped.shell.run({
  script: "printf '%s' \"${CONTROL_PLANE_API_KEY-unset}\"",
});
expect(env.stdout).toBe("unset");
```

Set legacy `config.limits.commandTimeoutMs` to an intentionally tiny value, then execute a shell command longer than that **without** `timeoutMs`; it must complete. This proves Owner Runtime does not inherit `terminal_run`'s timeout ceiling without waiting 60 seconds in CI.

- [ ] **Step 11: Run focused tests and build**

```bash
npx vitest run tests/owner-shell-supervisor.test.ts tests/owner-shell-service.test.ts tests/runtime-shutdown.test.ts tests/process-service.test.ts tests/process-supervisor.test.ts
npm run build
```

Expected: all PASS; existing terminal/process tests remain unchanged.

- [ ] **Step 12: Commit Task 2**

```bash
git add src/owner-shell-supervisor.ts src/owner-shell-service.ts src/errors.ts src/scoped-runtime.ts src/server.ts src/runtime-shutdown.ts tests/owner-shell-supervisor.test.ts tests/owner-shell-service.test.ts tests/runtime-shutdown.test.ts
git commit -m "feat: add owner full-host shell runtime"
```

---

### Task 3: Expose `shell_run` through strict MCP policy and safe output

**Files:**
- Create: `src/owner-shell-tool-registration.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/server.ts`
- Create: `tests/owner-shell-mcp.test.ts`
- Create: `tests/owner-shell-audit.test.ts`
- Modify: `tests/http-transport.test.ts`
- Modify: `tests/authority-catalog.test.ts`

**Interfaces:**

MCP input:

```ts
{
  authorityLeaseId: string;
  script: string;
  cwd?: string;
  timeoutMs?: number | null;
}
```

MCP output:

```ts
{
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutBytesSeen: number;
  stderrBytesSeen: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
}
```

Tool annotations:

```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
}
```

- [ ] **Step 1: Write RED MCP policy/catalog tests**

In `tests/owner-shell-mcp.test.ts`, create a runtime fixture with Personal Admin and Owner Runtime toggles. Prove:

```ts
expect(projectCall).toMatchObject({ isError: true });
expect(projectCall.content[0].text).toContain("POLICY_DENIED");

expect(disabledAdminCall.content[0].text).toContain("OWNER_RUNTIME_DISABLED");

expect(enabledAdminCall.structuredContent).toMatchObject({
  exitCode: 0,
  stdout: expect.stringContaining("OWNER_OK"),
  timedOut: false,
});

expect(terminalRunShCall.content[0].text).toContain("POLICY_DENIED");
```

Also call `shell_run` with a short explicit timeout and assert the structured result has `timedOut: true` rather than surfacing a raw process error.

Update exact tool catalog/annotations expectations in `tests/http-transport.test.ts` and `tests/authority-catalog.test.ts` to include `shell_run` without removing existing tools.

- [ ] **Step 2: Run MCP tests and verify RED**

```bash
npx vitest run tests/owner-shell-mcp.test.ts tests/http-transport.test.ts tests/authority-catalog.test.ts
```

Expected: FAIL because `shell_run` is not registered.

- [ ] **Step 3: Add `shellRunOutputSchema`**

In `src/tool-output-schemas.ts`:

```ts
export const shellRunOutputSchema = z.object({
  cwd: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutBytesSeen: nonNegativeInt,
  stderrBytesSeen: nonNegativeInt,
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  timedOut: z.boolean(),
}).strict();
```

Do not add script or PID fields.

- [ ] **Step 4: Implement dedicated Owner shell tool registration**

Create `src/owner-shell-tool-registration.ts` following the existing `computer-js-tool-registration.ts` cancellation/error-sanitization pattern.

Use `createScopedRuntime(runtime, authority).shell` so the service receives authoritative roots/profile rather than trusting MCP fields.

Register:

```ts
server.registerTool(
  "shell_run",
  {
    description: "Run arbitrary full-host login-shell syntax as the current user inside a locally approved Admin Owner Runtime session. This is not OS-sandboxed.",
    inputSchema: z.object({
      authorityLeaseId: z.string().min(40),
      script: z.string().min(1).max(runtime.config.ownerRuntime.maxScriptBytes),
      cwd: z.string().min(1).max(16_384).optional(),
      timeoutMs: z.number().int().positive().nullable().optional(),
    }).strict(),
    outputSchema: shellRunOutputSchema,
    annotations: mutationAnnotations,
  },
  async ({ authorityLeaseId, script, cwd, timeoutMs }, ctx) => safeCall(() => {
    const authority = runtime.authority.resolve(authorityLeaseId);
    return createScopedRuntime(runtime, authority).shell.run({
      script,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
    });
  }),
);
```

For unknown internal errors, return only a generic `SHELL_FAILED`/generic owner-shell message. Do not surface raw spawn stderr, script, or environment in the MCP error payload.

Register `registerOwnerShellTool(server, runtime)` from `src/server.ts` near other execution tools.

- [ ] **Step 5: Add audit no-content regression tests**

In `tests/owner-shell-audit.test.ts`, execute a script containing a unique secret-like marker and unique stdout/stderr markers. Read the test audit file and assert:

```ts
expect(auditText).toContain("shell.run");
expect(auditText).toContain("scriptByteCount");
expect(auditText).toContain("scriptSha256");
expect(auditText).not.toContain(secretScriptMarker);
expect(auditText).not.toContain(stdoutMarker);
expect(auditText).not.toContain(stderrMarker);
expect(auditText).not.toContain("authorityLeaseId");
```

- [ ] **Step 6: Run focused MCP/audit tests**

```bash
npx vitest run tests/owner-shell-mcp.test.ts tests/owner-shell-audit.test.ts tests/http-transport.test.ts tests/authority-catalog.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/owner-shell-tool-registration.ts src/tool-output-schemas.ts src/server.ts tests/owner-shell-mcp.test.ts tests/owner-shell-audit.test.ts tests/http-transport.test.ts tests/authority-catalog.test.ts
git commit -m "feat: expose owner shell over mcp"
```

---

### Task 4: Wire Owner Runtime into ChatGPT setup and operator documentation

**Files:**
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**

ChatGPT setup accepts:

```text
--enable-owner-runtime
--owner-shell-path <absolute-path>
```

Generated server command contains the same flags. Setup must reject `--enable-owner-runtime` without `--personal-admin`, and reject `--owner-shell-path` without `--enable-owner-runtime`.

- [ ] **Step 1: Write RED setup profile tests**

Add tests to `tests/setup-chatgpt-tunnel.test.ts` proving:

```ts
const setup = buildSetup([
  "--root", root,
  "--tunnel-id", "tunnel_test",
  "--personal-admin",
  "--enable-owner-runtime",
  "--owner-shell-path", "/bin/sh",
]);
expect(setup.mcpCommand).toContain("--personal-admin");
expect(setup.mcpCommand).toContain("--enable-owner-runtime");
expect(setup.mcpCommand).toContain("--owner-shell-path");
expect(setup.mcpCommand).toContain("/bin/sh");

expect(() => buildSetup([
  "--root", root,
  "--tunnel-id", "tunnel_test",
  "--enable-owner-runtime",
])).toThrow(/personal-admin/i);
```

- [ ] **Step 2: Run setup test and verify RED**

```bash
npx vitest run tests/setup-chatgpt-tunnel.test.ts
```

Expected: FAIL because the new setup flags are unknown.

- [ ] **Step 3: Implement setup propagation**

In `scripts/setup-chatgpt-tunnel.mjs`:

- parse `--enable-owner-runtime` and `--owner-shell-path`;
- require Personal Admin for Owner Runtime;
- require Owner Runtime when custom shell path is supplied;
- append flags to the generated MCP child command;
- show Owner Runtime state in doctor/setup output without displaying environment content.

- [ ] **Step 4: Update docs with the trust boundary and daily-driver command**

Document the intended private workstation setup, for example:

```bash
npm run setup:chatgpt -- \
  --root /Users/dogan/chatgpt-system \
  --tunnel-id <id> \
  --personal-admin \
  --enable-owner-runtime \
  --enable-browser \
  --enable-computer-use \
  --enable-full-host-js \
  --force \
  --doctor
```

Keep `--enable-terminal` documented separately because `terminal_run` remains the structured allowlisted tool; Owner Runtime does not redefine it.

`SECURITY.md` must explicitly state:

```text
Owner Runtime shell is arbitrary host execution as the current user.
It is not a sandbox.
Project/User cannot access it.
Enabling Personal Admin alone does not enable Owner Runtime.
```

`docs/ARCHITECTURE.md` should show:

```text
Admin lease + ownerRuntimeEnabled
  -> shell_run
  -> configured login shell
  -> shared OwnerShellSupervisor
  -> owned process group
  -> bounded output tails
```

`docs/CHATGPT_INTEGRATION.md` should explain when ChatGPT should prefer structured `terminal_run` versus unrestricted `shell_run`.

- [ ] **Step 5: Run docs/setup compatibility tests**

```bash
npx vitest run tests/setup-chatgpt-tunnel.test.ts tests/cli-command.test.ts tests/system-environment.test.ts tests/coding-harness-docs.test.ts tests/project-continuity-docs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add scripts/setup-chatgpt-tunnel.mjs tests/setup-chatgpt-tunnel.test.ts README.md SECURITY.md docs/ARCHITECTURE.md docs/CHATGPT_INTEGRATION.md
git commit -m "docs: wire owner runtime daily driver setup"
```

---

### Task 5: Prove Phase 1 end-to-end, update handoff state, and prepare the PR gate

**Files:**
- Modify: `docs/PROJECT_STATE.md`
- Modify only if evidence requires a fix: Phase 1 source/tests from Tasks 1–4.

**Interfaces:**
- No new API in this task.
- Produces exact-head evidence and a current continuation handoff.

- [ ] **Step 1: Run the focused Owner Runtime acceptance suite**

```bash
npx vitest run \
  tests/owner-shell-supervisor.test.ts \
  tests/owner-shell-service.test.ts \
  tests/owner-shell-mcp.test.ts \
  tests/owner-shell-audit.test.ts \
  tests/runtime-shutdown.test.ts \
  tests/authority-mcp.test.ts \
  tests/authority-approval-mcp.test.ts \
  tests/process-service.test.ts \
  tests/process-supervisor.test.ts \
  tests/setup-chatgpt-tunnel.test.ts \
  tests/http-transport.test.ts
```

Acceptance requires all of the following evidence:

1. Project/User shell attempts fail before process spawn.
2. Admin without Owner Runtime gate returns `OWNER_RUNTIME_DISABLED`.
3. Admin + Owner Runtime runs pipes, redirects, compound shell syntax, absolute/nonallowlisted executables.
4. `terminal_run` still rejects nonallowlisted shell execution.
5. Shell cwd can be outside the bootstrap project root because Admin scope is `/`, subject to OS permissions.
6. Child environment lacks a daemon-secret canary.
7. Output beyond retained tail bounds does not kill the command and reports truncation/bytes seen.
8. A run without `timeoutMs` is unaffected by legacy `commandTimeoutMs`.
9. Explicit timeout terminates the owned process group and returns `timedOut=true`.
10. MCP abort terminates the owned process group and fails with categorical `SHELL_CANCELLED` if the transport still receives a response.
11. Daemon shutdown closes every active Owner shell group before later process/browser cleanup.
12. Audit contains script digest/byte count but no script/stdout/stderr/lease content.

- [ ] **Step 2: Run full repository verification**

Run in this exact order:

```bash
npm run check
npm audit --omit=dev
git diff --check origin/main...HEAD
git status --short --branch
```

Expected:

```text
npm run check: PASS
npm audit --omit=dev: 0 vulnerabilities
git diff --check: no output / exit 0
worktree: clean after the state commit below and final rerun
```

- [ ] **Step 3: Update `docs/PROJECT_STATE.md` with Phase 1 reality**

Replace the old “awaiting next capability” state with bounded current information:

```text
Current goal: Owner Runtime implementation
Current phase: Phase 1 full-host shell
Branch/worktree: exact current feature branch/worktree
Completed: config gate, shared shell supervisor, scoped shell policy, shell_run MCP, setup/docs
Verification: exact test counts and commands from this head
Next exact step: push/open PR, wait Node 22/24 + macOS-native CI, review diff, obtain explicit merge authorization
```

Do not store shell script contents, output, environment values, secrets, or lease IDs.

- [ ] **Step 4: Commit the handoff state**

```bash
git add docs/PROJECT_STATE.md
git commit -m "docs: update owner runtime phase 1 state"
```

- [ ] **Step 5: Rerun exact-head verification after the state commit**

Because the HEAD changed, rerun:

```bash
npm run check
npm audit --omit=dev
git diff --check origin/main...HEAD
git status --short --branch
```

Do not reuse pre-state-commit evidence as exact-head proof.

- [ ] **Step 6: Review the final diff before publishing**

```bash
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

Review specifically for:

- no change that widens Project/User host execution;
- `terminal_run` remains allowlisted;
- no shell script/output content in audit;
- no PID exposure;
- no output-volume kill path in `shell_run`;
- cancellation and runtime-shutdown process-group cleanup present;
- no accidental package-lock/dependency change in Phase 1;
- docs match actual flags/tool names.

- [ ] **Step 7: Publish through a feature PR, not direct `main` mutation**

After explicit remote-write authorization in the execution session:

```text
push current feature branch
open PR: "Add Owner Runtime full-host shell"
wait exact-head Node 22 / Node 24 / macOS-native CI
verify server-side diff scope and mergeStateStatus=CLEAN
stop before merge unless the user explicitly authorizes the main merge
```

- [ ] **Step 8: Checkpoint Project Continuity**

Persist only bounded semantic state:

```text
goal: Owner Runtime Phase 1
status: active until merge, completed after verified merge
nextStep: merge gate or Phase 2 PTY plan after merge
verificationSummary: exact-head local + hosted CI evidence
```

Do not persist lease IDs or shell content.

---

## Phase 1 Definition of Done

Phase 1 is complete only when:

- Owner Runtime is opt-in and requires Personal Admin + Admin lease;
- Project/User remain unable to use host shell;
- `terminal_run` behavior is unchanged;
- `shell_run` accepts arbitrary shell syntax and executables as the current user;
- no command allowlist applies to `shell_run`;
- no default/legacy command wall-clock timeout applies when `timeoutMs` is omitted;
- stdout/stderr retention is bounded without terminating commands for volume alone;
- explicit timeout/MCP abort/daemon shutdown terminate the owned process group;
- daemon-secret canaries are absent from inherited child environment;
- audit contains only content-free script digest/size/lifecycle metadata;
- ChatGPT tunnel setup can explicitly enable the capability;
- full Node 22/24 repository tests and macOS-native CI remain green;
- exact-head PR review/CI completes before merge.

After Phase 1 is merged and post-merge verification is green, write the separate **Phase 2 — Interactive PTY** implementation plan from the approved Owner Runtime spec. Do not mix PTY implementation into this Phase 1 PR.
