# Computer Runtime v2 Slice 4 Full-Host JS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the explicitly enabled Admin-only `computer_run_js` full Node.js power path without weakening Slice 3 computer safety, daemon fault containment, secret hygiene, or shutdown guarantees.

**Architecture:** Each `computer_run_js` call acquires the shared `ComputerRuntime` program lane before a child exists, then launches one fresh fixed Node runner process with `shell:false`, a sanitized environment, inherited stdout/stderr pipes, one private Node IPC channel, and its own POSIX process group. Source travels only over stdin. The fixed runner executes source inside one eval Worker so `process.exit()` and uncaught user-code failures cannot terminate the runner bridge or daemon; the runner mediates a private worker `computer` RPC to the parent daemon. The parent services only the existing Slice 3 low-level Computer Runtime vocabulary. Semantic `find`/`exists`, OCR, stale-target recovery, and retry/recovery policy remain Slice 5.

**Tech Stack:** Node.js 22+, TypeScript 6, Node `child_process` + `worker_threads`, MCP TypeScript SDK v2, Zod v4, Vitest, existing Swift/macOS Computer Runtime v2 helper.

**Spec:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md` and `docs/superpowers/plans/2026-09-09-computer-runtime-v2-roadmap.md`

## Global Constraints

- Slice 4 starts from exact `origin/main` SHA `25a66964738a1dbf71519e0ae0421c322d656a7c` on branch `feat/computer-runtime-v2-full-host-js` in `/private/tmp/chatgpt-system-computer-runtime-v2-slice4`.
- `--enable-full-host-js` is disabled by default and is valid only together with `--enable-computer-use`; MCP cannot enable either capability.
- `computer_run_js` requires an active Admin lease and the explicit full-host-JS gate.
- Full-host JS is intentionally **not a sandbox**. It runs as the current OS user and may use normal Node filesystem, network, package, `require`, dynamic `import`, and `child_process` APIs.
- Source never appears in argv, environment, audit metadata, stable error messages, or runner filenames; source is sent only through runner stdin.
- Runner environment reuses `sanitizedChildEnvironment`; daemon/tunnel secret variables such as `CONTROL_PLANE_API_KEY` are not inherited automatically.
- Hard operator maxima are `maxJsSourceBytes = 262144`, `maxJsRuntimeMs = 30000`, and `maxJsOutputBytes = 1048576`; startup configuration may lower these limits but not raise them.
- `timeoutMs` supplied through MCP may only lower the configured JS runtime budget.
- One JS program holds the existing shared physical-action lane for its entire lifetime. Direct physical tools and another JS program must not interleave with it.
- A real mouse takeover or fixed `Control + Option + Command + Escape` emergency chord aborts the entire JS program even if user source attempts to catch the RPC rejection.
- On every runner timeout, request cancellation, takeover, failure, or daemon shutdown, best-effort input release and owned runner process-group cleanup are mandatory.
- Normal descendants inherit the runner process group and are terminated with it. A deliberately detached/daemonized descendant is outside the process-group guarantee because full-host JS is not a security sandbox; documentation must state this rather than claim impossible containment.
- `process.exit()` or a worker crash may fail the current JS call but must never terminate the daemon.
- Successful JS results must be JSON-serializable. Combined stdout, stderr, and serialized return value must stay within `maxJsOutputBytes`; overflow terminates the runner and returns `COMPUTER_OUTPUT_LIMIT`.
- JS exception messages, stacks, stderr, source, return values, coordinates, screen/AX text, native stderr, request IDs, and authority lease IDs are absent from audit.
- Slice 4 adds no `computer.find`, `computer.exists`, Vision/OCR, semantic target resolution, autonomous retry ladder, or stale-target recovery.
- Browser Runtime remains the preferred semantic web path and all existing Node 22/24, browser, process, authority, and native tests must remain green.
- No reset, rebase, force checkout, force push, or unrelated refactor.

---

### Task 1: Full-host JS configuration, capability reporting, and setup gate

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli.ts`
- Modify: `src/computer-runtime.ts`
- Modify: `src/server.ts`
- Modify: `src/system-environment.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Test: `tests/computer-config.test.ts`
- Test: `tests/cli-command.test.ts`
- Test: `tests/computer-runtime.test.ts`
- Test: `tests/system-environment.test.ts`
- Test: `tests/setup-chatgpt-tunnel.test.ts`
- Test: `tests/computer-mcp.test.ts`

**Interfaces:**
- Produces `ComputerUseConfig.fullHostJsEnabled`, `maxJsSourceBytes`, `maxJsRuntimeMs`, `maxJsOutputBytes`.
- Produces `ConfigOverrides.fullHostJsEnabled` and CLI flag `--enable-full-host-js`.
- Produces categorical `computerUse.fullHostJsEnabled` in `system_capabilities`, `system_environment`, and `computer_health`.

- [ ] **Step 1: Write RED configuration and capability tests**

Add exact expectations for the disabled defaults and explicit trusted override:

```ts
expect(config.computerUse).toMatchObject({
  enabled: false,
  fullHostJsEnabled: false,
  maxJsSourceBytes: 262_144,
  maxJsRuntimeMs: 30_000,
  maxJsOutputBytes: 1_048_576,
});

await expect(loadConfig({
  roots: [process.cwd()],
  fullHostJsEnabled: true,
})).rejects.toThrow(/computer use/i);

const enabled = await loadConfig({
  roots: [process.cwd()],
  computerUseEnabled: true,
  fullHostJsEnabled: true,
});
expect(enabled.computerUse.fullHostJsEnabled).toBe(true);
```

Add CLI tests proving `--enable-full-host-js` sets only the full-host override and setup tests proving it is rejected unless `--enable-computer-use` is present.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npx vitest run tests/computer-config.test.ts tests/cli-command.test.ts tests/computer-runtime.test.ts tests/system-environment.test.ts tests/setup-chatgpt-tunnel.test.ts tests/computer-mcp.test.ts
```

Expected: failures because the full-host config fields/flag/capability values do not exist yet.

- [ ] **Step 3: Implement bounded startup configuration**

Add constants in `src/config.ts`:

```ts
export const COMPUTER_MAX_JS_SOURCE_BYTES = 262_144;
export const COMPUTER_MAX_JS_RUNTIME_MS = 30_000;
export const COMPUTER_MAX_JS_OUTPUT_BYTES = 1_048_576;
```

Extend `ComputerUseConfig`:

```ts
fullHostJsEnabled: boolean;
maxJsSourceBytes: number;
maxJsRuntimeMs: number;
maxJsOutputBytes: number;
```

Add environment inputs whose `.max(...)` values equal the constants so operators may lower but not raise the hard bounds:

```ts
CHATGPT_SYSTEM_ENABLE_FULL_HOST_JS: z.enum(["true", "false", "1", "0"]).optional(),
CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES: z.coerce.number().int().positive().max(COMPUTER_MAX_JS_SOURCE_BYTES).optional(),
CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS: z.coerce.number().int().positive().max(COMPUTER_MAX_JS_RUNTIME_MS).optional(),
CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES: z.coerce.number().int().positive().max(COMPUTER_MAX_JS_OUTPUT_BYTES).optional(),
```

Build the config into a local object, then fail closed before return:

```ts
if (config.computerUse.fullHostJsEnabled && !config.computerUse.enabled) {
  throw new Error("Full-host JS requires Computer Runtime to be explicitly enabled.");
}
```

`system_capabilities`, `system_environment`, and Computer Runtime health report the real boolean and no secret values.

- [ ] **Step 4: Wire trusted CLI/tunnel setup**

Parse `--enable-full-host-js` in `src/cli-command.ts` and `scripts/setup-chatgpt-tunnel.mjs`. Tunnel setup must throw if full-host JS is requested without `--enable-computer-use`; it must add both flags explicitly to the child command and print categorical enablement only.

- [ ] **Step 5: Run focused tests GREEN**

Run the same Vitest command. Expected: all selected files pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/config.ts src/cli-command.ts src/cli.ts src/computer-runtime.ts src/server.ts src/system-environment.ts src/tool-output-schemas.ts scripts/setup-chatgpt-tunnel.mjs tests/computer-config.test.ts tests/cli-command.test.ts tests/computer-runtime.test.ts tests/system-environment.test.ts tests/setup-chatgpt-tunnel.test.ts tests/computer-mcp.test.ts
git diff --cached --check
git commit -m "feat: gate full-host computer JavaScript"
```

---

### Task 2: Add an exclusive low-level Computer program session

**Files:**
- Modify: `src/computer-runtime.ts`
- Test: `tests/computer-runtime.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ComputerProgramSession {
  execute(action: ComputerAction): Promise<unknown>;
  listApps(): Promise<unknown>;
  activeWindow(): Promise<unknown>;
  screenshot(): Promise<{ pngBase64: string; width: number; height: number }>;
}

ComputerRuntime.withExclusiveProgram<T>(
  work: (session: ComputerProgramSession) => Promise<T>,
): Promise<T>
```

- `execute(...)` accepts only the existing `ComputerAction` union from Slice 3. No semantic target APIs are introduced.

- [ ] **Step 1: Write RED lane/release tests**

Add tests proving: one exclusive program prevents a concurrent direct `click` from entering the native client; two programs serialize; `session.execute({type:"move_mouse", ...})` does not deadlock by reacquiring the same lane; and the program finalizer calls `release_inputs` on success and failure.

Representative assertion:

```ts
const program = subject.withExclusiveProgram(async (session) => {
  await session.execute({ type: "move_mouse", x: 10, y: 20 });
  await blocked;
  return "done";
});
const direct = subject.click({ x: 30, y: 40 });
await new Promise((resolve) => setImmediate(resolve));
expect(events).toEqual(["move_mouse"]);
releaseBlocked();
await expect(program).resolves.toBe("done");
await direct;
expect(events).toContain("click");
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
npx vitest run tests/computer-runtime.test.ts
```

Expected: compile/test failure because `withExclusiveProgram` and `ComputerProgramSession` do not exist.

- [ ] **Step 3: Implement non-reentrant session execution**

Refactor only what is required so the outer lane is acquired once. Use existing `preparedAction(...)` validation. The session executes prepared actions directly against `native.request(...)` rather than calling public physical methods that reacquire the lane.

Core shape:

```ts
async withExclusiveProgram<T>(work: (session: ComputerProgramSession) => Promise<T>): Promise<T> {
  this.requireEnabled();
  return this.physicalLane.run(async () => {
    this.requireEnabled();
    const session = this.createProgramSession();
    try {
      return await work(session);
    } finally {
      await this.releaseInputsBestEffort();
    }
  });
}
```

`session.execute` uses the existing action preparation/validation path, including bounded local wait handling, observation output validation, native request timeout, and shutdown checks. It never exposes raw native request methods.

- [ ] **Step 4: Run focused tests GREEN**

```bash
npx vitest run tests/computer-runtime.test.ts
```

- [ ] **Step 5: Commit Task 2**

```bash
git add src/computer-runtime.ts tests/computer-runtime.test.ts
git diff --cached --check
git commit -m "feat: add exclusive computer program session"
```

---

### Task 3: Define strict private JS runner protocol and fixed runner entrypoint

**Files:**
- Create: `src/computer-js-protocol.ts`
- Create: `src/computer-js-runner.ts`
- Test: `tests/computer-js-runner.test.ts`

**Interfaces:**
- Runner-to-daemon messages:

```ts
type RunnerMessage =
  | { type: "rpc"; id: string; method: ComputerJsRpcMethod; params: unknown }
  | { type: "complete"; resultJson?: string }
  | { type: "worker_exit"; exitCode: number };
```

- Daemon-to-runner RPC response:

```ts
type RunnerRpcResponse =
  | { type: "rpc_result"; id: string; ok: true; result: unknown }
  | { type: "rpc_result"; id: string; ok: false; error: { code: string; message: string } };
```

- Allowed private RPC methods are only:

```text
observe
screenshot
pointer_position
list_apps
active_window
open_app
focus_app
move_mouse
click
drag
scroll
type_text
press_key
wait
wait_for_frontmost
wait_for_text
wait_until_changed
release_inputs
```

- [ ] **Step 1: Write RED runner tests**

Use a real child process built from `dist/computer-js-runner.js`. Prove source supplied through stdin can:

```js
const fs = require("node:fs");
const imported = await import("./fixture-module.mjs");
console.log("runner-output");
return { exists: fs.existsSync("."), imported: imported.value };
```

Also prove `process.exit(7)` produces a worker-exit notification without killing the parent test process; an uncaught exception does not expose its stack through the protocol; malformed worker messages cause runner failure rather than arbitrary parent RPC; and `computer.find` / `computer.exists` are absent.

- [ ] **Step 2: Run build + focused test and confirm RED**

```bash
npm run build
npx vitest run tests/computer-js-runner.test.ts
```

Expected: failure because runner/protocol files are absent.

- [ ] **Step 3: Implement strict protocol schemas**

Use Zod `.strict()` discriminated unions for every process-IPC message. IDs are random base64url strings generated inside the runner proxy. Unknown message types, methods, duplicate IDs, or malformed responses terminate the runner with a generic internal failure.

- [ ] **Step 4: Implement the fixed runner and Worker wrapper**

The runner reads all stdin before starting user source. User source is never in argv/env/path. Spawn one Worker with `{ eval: true, stdout: true, stderr: true }`. The generated worker wrapper:

```js
const { parentPort } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");
const virtualFile = path.join(process.cwd(), "__chatgpt_system_run_js__.cjs");
const userRequire = createRequire(virtualFile);
const pending = new Map();

const computer = Object.freeze({
  observe: () => rpc("observe", {}),
  screenshot: () => rpc("screenshot", {}),
  pointerPosition: () => rpc("pointer_position", {}),
  listApps: () => rpc("list_apps", {}),
  activeWindow: () => rpc("active_window", {}),
  openApp: (input) => rpc("open_app", input),
  focusApp: (input) => rpc("focus_app", input),
  moveMouse: (input) => rpc("move_mouse", input),
  click: (input) => rpc("click", input),
  drag: (input) => rpc("drag", input),
  scroll: (input) => rpc("scroll", input),
  typeText: (input) => rpc("type_text", input),
  pressKey: (input) => rpc("press_key", input),
  wait: (durationMs) => rpc("wait", { durationMs }),
  waitForFrontmost: (input) => rpc("wait_for_frontmost", input),
  waitForText: (input) => rpc("wait_for_text", input),
  waitUntilChanged: (input) => rpc("wait_until_changed", input),
  releaseInputs: () => rpc("release_inputs", {}),
});
```

Execute source inside an async function receiving `computer`, `require`, `module`, `exports`, `__filename`, and `__dirname`. This gives ordinary CommonJS `require`, top-level-style `await`/`return` within the program body, and cwd-relative dynamic `import()` from the eval Worker. Before completion, serialize the result with `JSON.stringify`; reject cyclic values and BigInt as a generic JS failure. Treat `undefined` as no result.

- [ ] **Step 5: Run build + runner tests GREEN**

```bash
npm run build
npx vitest run tests/computer-js-runner.test.ts
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/computer-js-protocol.ts src/computer-js-runner.ts tests/computer-js-runner.test.ts
git diff --cached --check
git commit -m "feat: add isolated computer JavaScript runner"
```

---

### Task 4: Add per-call runner supervisor with timeout, cancellation, output bounds, and process-group cleanup

**Files:**
- Create: `src/computer-js-runner-supervisor.ts`
- Modify: `src/computer-errors.ts`
- Test: `tests/computer-js-runner-supervisor.test.ts`
- Test: `tests/computer-errors.test.ts`

**Interfaces:**

```ts
export interface ComputerJsRunnerResult {
  stdout: string;
  stderr: string;
  result?: unknown;
}

export interface ComputerJsRunnerRequest {
  source: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onRpc: (method: ComputerJsRpcMethod, params: unknown) => Promise<unknown>;
}

export class ComputerJsRunnerSupervisor {
  run(request: ComputerJsRunnerRequest): Promise<ComputerJsRunnerResult>;
  close(): Promise<void>;
}
```

Add stable errors: `COMPUTER_JS_DISABLED`, `COMPUTER_JS_FAILED`, `COMPUTER_JS_TIMEOUT`.

- [ ] **Step 1: Write RED supervisor tests**

Inject spawn/signal adapters as `ProcessSupervisor` already does. Prove:

1. command is `process.execPath` and args contain only fixed runner path;
2. `shell:false`, `stdio:["pipe","pipe","pipe","ipc"]`, sanitized environment, POSIX `detached:true`;
3. source bytes are written only to stdin;
4. source over configured bytes is rejected before spawn;
5. `CONTROL_PLANE_API_KEY` and a canary env are absent;
6. combined stdout/stderr/result overflow yields `COMPUTER_OUTPUT_LIMIT` and kills the group;
7. timeout yields `COMPUTER_JS_TIMEOUT` and SIGTERM then SIGKILL group cleanup when required;
8. `AbortSignal` cancellation kills the group and yields generic `COMPUTER_JS_FAILED`;
9. runner exit/crash before completion yields `COMPUTER_JS_FAILED` but a later call can start fresh;
10. `close()` rejects new work and terminates an active runner idempotently.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx vitest run tests/computer-js-runner-supervisor.test.ts tests/computer-errors.test.ts
```

- [ ] **Step 3: Implement one-fresh-child-per-call lifecycle**

Spawn:

```ts
spawn(process.execPath, [runnerEntrypoint], {
  cwd,
  shell: false,
  env: sanitizedChildEnvironment(),
  stdio: ["pipe", "pipe", "pipe", "ipc"],
  detached: process.platform !== "win32",
});
```

Do not pass `source`, authority data, tunnel credentials, or user-provided executable/Node flags in argv/env. Capture stdout/stderr with one combined byte counter. The serialized completion result counts against the same budget.

Termination follows the existing owned-process pattern: POSIX signals target `-child.pid`; Windows falls back to the child. Attempt `SIGTERM`, wait configured grace, then `SIGKILL`. Run this cleanup after every terminal outcome, including successful completion, so ordinary descendants cannot outlive a completed program.

- [ ] **Step 4: Make takeover fatal at the supervisor boundary**

If `onRpc` throws `COMPUTER_USER_TAKEOVER`, immediately record it as the primary failure, terminate the runner group, and reject the whole run with that same stable code. Do not send a catchable RPC failure back to Worker source. Other stable computer errors may be returned through `rpc_result` so program logic can catch them deliberately.

- [ ] **Step 5: Run focused tests GREEN**

```bash
npx vitest run tests/computer-js-runner-supervisor.test.ts tests/computer-errors.test.ts
```

- [ ] **Step 6: Commit Task 4**

```bash
git add src/computer-js-runner-supervisor.ts src/computer-errors.ts tests/computer-js-runner-supervisor.test.ts tests/computer-errors.test.ts
git diff --cached --check
git commit -m "feat: supervise full-host computer JavaScript"
```

---

### Task 5: Compose the runner with the exclusive Computer Runtime session

**Files:**
- Create: `src/computer-js-runtime.ts`
- Create: `src/computer-js-rpc.ts`
- Modify: `src/server.ts`
- Test: `tests/computer-js-runtime.test.ts`

**Interfaces:**

```ts
export interface ComputerJsRunInput {
  source: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ComputerJsRuntime {
  run(input: ComputerJsRunInput): Promise<ComputerJsRunnerResult>;
  close(): Promise<void>;
}
```

`computer-js-rpc.ts` parses every runner request with strict Zod schemas and maps it to `ComputerProgramSession.execute(...)`, `listApps()`, `activeWindow()`, or `screenshot()`.

- [ ] **Step 1: Write RED composition tests**

Prove the gate is independent and fail-closed:

```ts
await expect(disabled.run({ source: "return 1" }))
  .rejects.toMatchObject({ code: "COMPUTER_JS_DISABLED" });
```

With both gates enabled, prove runner `onRpc("click", ...)` becomes the existing typed `ComputerAction`, two concurrent JS runs serialize before spawning, direct computer input waits behind JS, omitted cwd uses `config.roots[0]`, relative cwd resolves from that root, absolute cwd is allowed for Admin full-host mode, and nonexistent/non-directory cwd fails before runner spawn.

- [ ] **Step 2: Run focused test and confirm RED**

```bash
npx vitest run tests/computer-js-runtime.test.ts
```

- [ ] **Step 3: Implement strict RPC dispatch**

Each method schema is `.strict()` and reuses the same bounds as the MCP/runtime layer. Convert methods to existing actions, for example:

```ts
case "click":
  return session.execute({ type: "click", ...parsed.params });
case "wait":
  return session.execute({ type: "wait", durationMs: parsed.params.durationMs });
case "active_window":
  return session.activeWindow();
```

Unknown methods or fields return `COMPUTER_PROTOCOL_INVALID`. No semantic aliases or raw native methods are exposed.

- [ ] **Step 4: Implement `ComputerJsRuntime.run`**

Validate UTF-8 source bytes before acquiring the lane. Resolve cwd deterministically without using `PathPolicy`, because full-host JS is intentionally not root-confined after authorization. Verify the initial cwd exists and is a real directory. Bound timeout with:

```ts
const timeoutMs = input.timeoutMs === undefined
  ? config.maxJsRuntimeMs
  : Math.min(input.timeoutMs, config.maxJsRuntimeMs);
```

Then acquire the lane before child creation:

```ts
return computer.withExclusiveProgram((session) => supervisor.run({
  source: input.source,
  cwd,
  timeoutMs,
  ...(input.signal ? { signal: input.signal } : {}),
  onRpc: (method, params) => dispatchComputerJsRpc(session, method, params),
}));
```

- [ ] **Step 5: Wire one shared `ComputerJsRuntime` into `RuntimeServices`**

Allow dependency injection for tests, just like native/browser services. There must be one runner supervisor per daemon so shutdown can cancel whichever invocation is active.

- [ ] **Step 6: Run focused tests GREEN**

```bash
npx vitest run tests/computer-js-runtime.test.ts
```

- [ ] **Step 7: Commit Task 5**

```bash
git add src/computer-js-runtime.ts src/computer-js-rpc.ts src/server.ts tests/computer-js-runtime.test.ts
git diff --cached --check
git commit -m "feat: compose JavaScript with computer runtime"
```

---

### Task 6: Register Admin-only `computer_run_js` with strict MCP cancellation and redacted audit

**Files:**
- Create: `src/computer-js-tool-registration.ts`
- Create: `src/scoped-computer-js-service.ts`
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/computer-js-mcp.test.ts`
- Modify: `tests/computer-audit.test.ts`

**Interfaces:**

MCP input:

```ts
{
  authorityLeaseId: string;
  source: string;
  cwd?: string;
  timeoutMs?: number;
}
```

MCP success output:

```ts
{
  stdout: string;
  stderr: string;
  result?: unknown;
}
```

- [ ] **Step 1: Write RED MCP/policy/audit tests**

Prove the tool is in the catalog only as `computer_run_js`; rejects unknown fields; rejects Project/User authority before runner work; rejects Admin when full-host JS is disabled; succeeds for enabled Admin; passes `ctx.mcpReq.signal` into runtime; and output schema accepts only bounded stdout/stderr plus optional result.

Audit canary test source:

```js
console.log("STDOUT_SECRET_CANARY");
console.error("STDERR_SECRET_CANARY");
return { secret: "RESULT_SECRET_CANARY" };
```

After the call, assert the audit log contains `computer.run_js` and outcome/duration but none of source, stdout, stderr, return content, cwd, lease ID, runner RPC IDs, native request IDs, or JS exception text.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx vitest run tests/computer-js-mcp.test.ts tests/computer-audit.test.ts
```

- [ ] **Step 3: Implement scoped service and safe error mapping**

`ScopedComputerJsService` checks `adminEnabled` before invoking runtime and records only constructed metadata. On error, audit only the stable `AppError.code`. Never copy thrown message/stack/stdout/stderr into audit.

- [ ] **Step 4: Register MCP handler with request cancellation**

Use the MCP v2 handler context:

```ts
async ({ authorityLeaseId, source, cwd, timeoutMs }, ctx) => safeCall(() =>
  computerJsFor(runtime, authorityLeaseId).run({
    source,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
  }),
)
```

The tool annotations are mutation-capable/open-world and explicitly state that full-host JS is not sandboxed.

- [ ] **Step 5: Run focused tests GREEN**

```bash
npx vitest run tests/computer-js-mcp.test.ts tests/computer-audit.test.ts
```

- [ ] **Step 6: Commit Task 6**

```bash
git add src/computer-js-tool-registration.ts src/scoped-computer-js-service.ts src/server.ts src/tool-output-schemas.ts tests/computer-js-mcp.test.ts tests/computer-audit.test.ts
git diff --cached --check
git commit -m "feat: expose Admin full-host computer JavaScript"
```

---

### Task 7: Integrate shutdown ordering and prove no runner/input survives

**Files:**
- Modify: `src/runtime-shutdown.ts`
- Modify: `src/cli.ts`
- Test: `tests/runtime-shutdown.test.ts`
- Modify: `tests/computer-js-runtime.test.ts`

**Interfaces:**
- `RuntimeShutdownPhase` adds `computer-js` before `computer`.
- Shutdown order becomes: `computer-js -> computer -> processes -> browser -> control -> transport`.

- [ ] **Step 1: Write RED shutdown tests**

Expected sequence:

```ts
expect(calls).toEqual([
  "computer-js",
  "computer",
  "processes",
  "browser",
  "control",
  "transport",
]);
```

Add an integration-style test where an active JS run is blocked in Worker code, shutdown begins, runner group termination completes, then `ComputerRuntime.close()` releases held input and native host closes. Failures in JS cleanup must still allow later shutdown phases to run.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx vitest run tests/runtime-shutdown.test.ts tests/computer-js-runtime.test.ts
```

- [ ] **Step 3: Implement ordered cleanup**

`closeRuntimeResources` first calls `runtime.computerJs.close()`, then existing `runtime.computer.close()`. `ComputerJsRuntime.close()` marks closing synchronously, refuses new runs, and delegates to idempotent supervisor cleanup. Do not move native input release later than process/browser cleanup.

- [ ] **Step 4: Run focused tests GREEN**

```bash
npx vitest run tests/runtime-shutdown.test.ts tests/computer-js-runtime.test.ts
```

- [ ] **Step 5: Commit Task 7**

```bash
git add src/runtime-shutdown.ts src/cli.ts tests/runtime-shutdown.test.ts tests/computer-js-runtime.test.ts
git diff --cached --check
git commit -m "fix: stop computer JavaScript before native shutdown"
```

---

### Task 8: Real runner integration, boundary tests, docs, and CI contract

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Create: `tests/computer-js-integration.test.ts`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`

**Interfaces:**
- CI must exercise the real built `dist/computer-js-runner.js` on Node 22 and 24.
- Documentation explicitly labels full-host JS as owner-trust, non-sandboxed, secret-sanitized, bounded, process-contained best effort.

- [ ] **Step 1: Add real integration tests**

Use temporary cwd fixtures and the real runner/supervisor. Cover:

1. `require("node:fs")` reads a harmless fixture;
2. `await import("./fixture-module.mjs")` resolves from requested cwd;
3. one source program performs local loop/condition logic and a fake parent-mediated `computer.click` RPC;
4. an ordinary spawned descendant is terminated at program finalization;
5. `process.exit(7)` fails only the call, then a second call succeeds;
6. timeout kills an ordinary long-lived descendant;
7. env canaries `CONTROL_PLANE_API_KEY` and `CHATGPT_SYSTEM_TEST_CANARY` are absent while HOME/PATH remain available;
8. source is absent from child argv/env and audit;
9. stdout/stderr/return are available to the successful caller but absent from audit;
10. initial cwd omitted/relative/absolute semantics match Task 5.

- [ ] **Step 2: Run integration tests under the local Node and confirm behavior**

```bash
npm run build
npx vitest run tests/computer-js-integration.test.ts tests/setup-chatgpt-tunnel.test.ts
```

- [ ] **Step 3: Update docs without overstating containment**

Document:

```text
--enable-computer-use --enable-full-host-js
```

State explicitly that scripts run as the current macOS user, can use normal Node APIs, and are not root-confined or OS-sandboxed. State that the daemon strips its secret-bearing environment by default, source is stdin-only, normal descendants are cleaned through the owned process group, and deliberately detached/daemonized descendants cannot be claimed as sandbox-contained.

Keep Slice 5 items listed as absent: semantic target resolver, `find`/`exists`, Vision OCR, stale-target recovery, recovery ladder.

- [ ] **Step 4: Strengthen CI contract**

Node 22/24 `npm run check` already executes the real integration test. Add a lightweight built-runner smoke step only if needed to make `dist/computer-js-runner.js` packaging/entrypoint existence explicit; do not duplicate the full test suite unnecessarily.

- [ ] **Step 5: Run full repository verification**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
npm run test:computer:macos
npm run package:computer:macos
npm run package:computer-fixture:macos
git diff --check origin/main...HEAD
git diff --check
rg -n "Vision|VNRecognize|OCR|ocr|recovery|Recovery|computer\.find|computer\.exists" src native/macos-computer-runtime/Sources
```

Expected: all commands pass; the boundary grep has no Slice 5 implementation hits in production sources.

- [ ] **Step 6: Commit Task 8**

```bash
git add .github/workflows/ci.yml README.md docs/CHATGPT_INTEGRATION.md tests/computer-js-integration.test.ts tests/setup-chatgpt-tunnel.test.ts
git diff --cached --check
git commit -m "ci: verify full-host computer JavaScript"
```

---

### Task 9: Real-Mac acceptance, exact-head PR, merge, and post-merge gate

**Files:**
- No production file changes unless a reproducible Critical/Important defect is found.
- Local acceptance helpers may remain untracked and must not be committed unless intentionally promoted as repository tests.

**Interfaces:**
- Final feature HEAD is immutable during exact-head CI evidence collection.
- Required PR/main jobs remain `test (22)`, `test (24)`, and `macos-native`.

- [ ] **Step 1: Fresh state and stable helper readiness**

Verify branch/worktree, HEAD, `origin/main`, divergence, staged/unstaged/untracked sets. Verify installed helper passive health and strict codesign before physical acceptance.

- [ ] **Step 2: Real-Mac full-host JS acceptance**

With a fresh Admin lease and full-host JS explicitly enabled in an acceptance-only daemon/profile, run a harmless source that uses normal Node `fs` plus existing low-level `computer` RPC against the disposable fixture. Verify visible action + deterministic fixture state change. Do not use Slice 5 semantic helpers.

Then prove physical mouse takeover and the fixed emergency chord abort the **whole JS program**, release held input, kill the runner group, and leave subsequent `computer_health` healthy.

- [ ] **Step 3: Fresh final verification after physical acceptance**

Re-run every Task 8 full verification command plus targeted runner tests, environment canary tests, audit privacy tests, timeout/descendant cleanup tests, cancellation tests, and `git diff --check`.

- [ ] **Step 4: Exact final diff review**

Review only Slice 4 changes versus `origin/main`. Fix only reproducible Critical/Important production findings, using RED test -> minimal fix -> focused GREEN -> full GREEN. Do not perform nice-to-have refactors.

- [ ] **Step 5: Push without force and open exact-head PR**

Record feature SHA, push current branch without force, open a PR to `main`, and require the PR head SHA to equal the reviewed SHA.

Required exact-head PR CI:

```text
test (22) SUCCESS
test (24) SUCCESS
macos-native SUCCESS
```

- [ ] **Step 6: Squash merge with expected-head guard**

Immediately before merge, re-read PR head and all required conclusions. Squash merge only with an expected-head/match-head guard. No merge while any required check is pending or failed.

- [ ] **Step 7: Post-merge exact-main CI**

Fetch `origin/main`, record the exact squash merge SHA, and require a `push` CI run on that same SHA:

```text
test (22) SUCCESS
test (24) SUCCESS
macos-native SUCCESS
```

Only then declare Slice 4 PASS. Do not begin Slice 5 before this gate is complete.

---

## Plan Self-Review

- **Spec coverage:** explicit gate, full Node APIs, stdin-only source, private computer RPC, cwd/env semantics, source/runtime/output bounds, process/worker isolation, process-group cleanup, `process.exit()` isolation, request cancellation, takeover fatality, Admin MCP policy, audit privacy, shutdown order, Node 22/24 CI, real-Mac acceptance, exact-head merge, and post-merge CI are each assigned to a task.
- **Slice boundary:** no task implements semantic `find`/`exists`, OCR, Vision, stale-target recovery, or autonomous retry; those remain Slice 5.
- **Containment honesty:** process-group cleanup is guaranteed for ordinary descendants, not deliberately detached processes; full-host JS remains explicitly non-sandboxed.
- **Type consistency:** `ComputerProgramSession`, `ComputerJsRunnerRequest`, `ComputerJsRunnerResult`, `ComputerJsRuntime`, private RPC method names, and MCP input/output names are defined once and reused by later tasks.
- **No placeholder work:** every task specifies exact files, RED test intent, implementation shape, GREEN command, and commit gate.
