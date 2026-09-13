# Owner Runtime Phase 3 Computer Ceilings & Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove development-era Computer Runtime action/time productivity ceilings for locally approved Admin Owner Runtime while preserving payload/memory/recovery bounds and deterministic cancellation, takeover, emergency-stop, TCC, and shutdown safety.

**Architecture:** Keep the existing persistent Computer Runtime helper, physical-input lane, `computer_run`, and `computer_run_js` architecture. Owner semantics are activated only when the caller is Admin and the startup Owner Runtime gate is enabled; non-Owner Admin behavior retains the legacy action/runtime caps for compatibility. `computer_run` gains request-cancellation propagation and bounded returned step retention, while `computer_run_js` gains a true no-deadline mode by making the runner timeout optional. No new computer-session abstraction, video stream, native protocol, or TCC bypass is introduced.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Zod, Vitest, existing Swift macOS Computer Runtime helper, GitHub Actions macOS/Node CI.

**Spec:** `docs/superpowers/specs/2026-09-12-owner-runtime-full-host-development-design.md` sections 9-12, 18.4, 19 Phase 3.

## Global Constraints

- Owner semantics require a locally approved `admin` authority lease **and** `ownerRuntime.enabled === true`; Project/User remain unchanged.
- `computer_run` and `computer_run_js` keep their existing public names and core contracts.
- Do not weaken the existing Computer Runtime helper, AX-first recovery, physical-input serialization, takeover detection, or fixed emergency chord.
- Remove only productivity ceilings: the legacy `100` action cap and `30_000 ms` run/JS cap must not limit Owner mode.
- Omitted Owner timeout means **no local wall-clock deadline**. An explicitly supplied finite timeout remains authoritative.
- Keep bounded MCP/frame size, JS source size, JS stdout/stderr/result bytes, screenshot bytes, observation elements/chars, audit metadata, and retained action-result memory.
- Keep `maxAutomaticRetriesPerAction = 2`; recovery retries are correctness containment, not a productivity ceiling.
- No raw typed text, screenshot/OCR/AX content, JS source/output, credentials, environment values, PIDs, or signals may be persisted in audit/continuity.
- Request cancellation must stop further program work; local waits must be abortable; an already-issued native RPC remains an atomic bounded operation under the existing `requestTimeoutMs`, after which no further action may start and input cleanup must run.
- User takeover, the fixed emergency chord, explicit finite timeout, daemon shutdown, and runtime shutdown remain authoritative regardless of Owner mode.
- Do not bypass macOS TCC, Accessibility, Screen Recording, Keychain, SIP, sudo, or OS authentication.
- Do not change Browser Runtime, shell/PTTY, Git, or Project Exec behavior in this phase.
- No direct edits to `main`; all implementation remains in `feat/owner-runtime-phase3-computer-ceilings` until a separately authorized merge.

---

## File Structure

**Core runtime / policy**
- Modify `src/config.ts` — keep legacy caps; add fixed protocol/result-retention constants and explicit finite-timeout technical bound.
- Modify `src/computer-errors.ts` only if a stable cancellation code proves necessary during TDD; prefer existing stable errors unless tests demonstrate ambiguity.
- Modify `src/computer-types.ts` — add bounded-step-result metadata to `ComputerRunResult`.
- Modify `src/computer-runtime.ts` — Owner-mode `computer_run`, request cancellation, bounded step retention, Owner-aware local program waits.
- Modify `src/scoped-computer-service.ts` — inject Owner mode and forward MCP `AbortSignal` without auditing it.
- Modify `src/scoped-runtime.ts` — construct scoped computer service with Owner Runtime gate state.
- Modify `src/computer-tool-registration.ts` — forward MCP request cancellation into `computer_run`.

**Full-host JS**
- Modify `src/computer-js-runtime.ts` — Owner no-deadline semantics; preserve legacy cap outside Owner mode.
- Modify `src/computer-js-runner-supervisor.ts` — optional timeout timer; keep process-group termination and output bounds.
- Modify `src/computer-js-tool-registration.ts` — Owner-aware explicit-timeout schema and unchanged AbortSignal propagation.

**Public output schema**
- Modify `src/tool-output-schemas.ts` — bound `computer_run.steps` and expose whether retained step results were truncated.

**Tests / acceptance**
- Modify `tests/computer-config.test.ts`.
- Modify `tests/computer-runtime.test.ts`.
- Modify `tests/computer-mcp.test.ts`.
- Modify `tests/computer-js-runtime.test.ts`.
- Modify `tests/computer-js-mcp.test.ts`.
- Modify `tests/computer-js-runner-supervisor.test.ts`.
- Modify `tests/computer-js-integration.test.ts` where existing long-run/cancellation fixtures need the optional-timeout type.
- Create `tests/owner-computer-runtime-phase3-integration.test.ts` — >100-action Owner acceptance, bounded result retention, real JS >30s env-gated acceptance.
- Modify `.github/workflows/ci.yml` — run the env-gated >30s Owner JS acceptance on macOS-native CI only.

**Docs / handoff**
- Modify `README.md`.
- Modify `SECURITY.md`.
- Modify `docs/ARCHITECTURE.md`.
- Modify `docs/CHATGPT_INTEGRATION.md`.
- Modify `docs/PROJECT_STATE.md` only after fresh acceptance evidence exists.

---

### Task 1: Define Owner-vs-legacy execution policy and bounded result contract

**Files:**
- Modify: `src/config.ts`
- Modify: `src/computer-types.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/computer-config.test.ts`
- Test: `tests/computer-runtime.test.ts`

**Interfaces:**
- Produces `COMPUTER_MAX_RUN_STEP_RESULTS = 256` as a memory/protocol retention bound, not an execution-count limit.
- Produces `COMPUTER_MAX_EXPLICIT_RUNTIME_MS = 2_147_483_647`, matching Node's safe timer range for an optional explicit deadline; omitted timeout remains unbounded in Owner mode.
- Keeps existing `maxActionProgramActions`, `maxActionProgramRuntimeMs`, and `maxJsRuntimeMs` config fields as **legacy non-Owner caps** so existing deployments/config fixtures do not break.
- Extends `ComputerRunResult` with `stepsTruncated: boolean` and caps public `steps` to `COMPUTER_MAX_RUN_STEP_RESULTS`.

- [ ] **Step 1: Write RED config/output-contract tests**

Add tests equivalent to:

```ts
import {
  COMPUTER_MAX_EXPLICIT_RUNTIME_MS,
  COMPUTER_MAX_RUN_STEP_RESULTS,
} from "../src/config.js";
import { computerRunOutputSchema } from "../src/tool-output-schemas.js";

expect(COMPUTER_MAX_RUN_STEP_RESULTS).toBe(256);
expect(COMPUTER_MAX_EXPLICIT_RUNTIME_MS).toBe(2_147_483_647);

expect(computerRunOutputSchema.safeParse({
  state: "completed",
  completedCount: 300,
  actionCount: 300,
  steps: Array.from({ length: 257 }, (_, index) => ({
    index,
    type: "pointer_position",
    state: "completed",
  })),
  stepsTruncated: true,
}).success).toBe(false);
```

Also assert the existing three legacy limit fields still load with their current defaults/config overrides.

- [ ] **Step 2: Run RED tests**

Run:

```bash
npx vitest run tests/computer-config.test.ts tests/computer-runtime.test.ts
```

Expected: FAIL because the two constants and `stepsTruncated` contract do not exist yet.

- [ ] **Step 3: Add the fixed containment constants without deleting legacy config**

In `src/config.ts` add:

```ts
export const COMPUTER_MAX_RUN_STEP_RESULTS = 256;
export const COMPUTER_MAX_EXPLICIT_RUNTIME_MS = 2_147_483_647;
```

Do **not** delete or repurpose:

```ts
maxActionProgramActions
maxActionProgramRuntimeMs
maxJsRuntimeMs
```

They remain the compatibility limits used outside Owner mode.

- [ ] **Step 4: Extend the result type and schema**

In `src/computer-types.ts` make the result shape explicit:

```ts
export interface ComputerRunResult {
  state: "completed" | "completed_unverified";
  completedCount: number;
  actionCount: number;
  steps: ComputerRunStepResult[];
  stepsTruncated: boolean;
  finalObservation?: unknown;
}
```

In `src/tool-output-schemas.ts` use the fixed retention bound:

```ts
steps: z.array(z.object({
  index: z.number().int().nonnegative(),
  type: computerRunStepTypeSchema,
  state: z.literal("completed"),
}).strict()).max(COMPUTER_MAX_RUN_STEP_RESULTS),
stepsTruncated: z.boolean(),
```

Keep every existing observation/screenshot/JS-output bound unchanged.

- [ ] **Step 5: Run focused tests and TypeScript build**

Run:

```bash
npx vitest run tests/computer-config.test.ts tests/computer-runtime.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/config.ts src/computer-types.ts src/tool-output-schemas.ts tests/computer-config.test.ts tests/computer-runtime.test.ts
git commit -m "refactor: define owner computer containment bounds"
```

---

### Task 2: Remove Owner `computer_run` action/runtime ceilings and propagate cancellation

**Files:**
- Modify: `src/computer-runtime.ts`
- Modify: `src/scoped-computer-service.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/computer-tool-registration.ts`
- Test: `tests/computer-runtime.test.ts`
- Test: `tests/computer-mcp.test.ts`
- Test: `tests/computer-audit.test.ts`

**Interfaces:**
- Add exported internal execution options:

```ts
export interface ComputerRunExecutionOptions {
  ownerMode?: boolean;
  signal?: AbortSignal;
}
```

- Keep public MCP input unchanged: `{ actions, finalObservation?, timeoutMs? }`.
- `ScopedComputerService` receives `ownerRuntimeEnabled` from `createScopedRuntime` and converts the public call into `ComputerRuntime.run(input, { ownerMode, signal })`.
- `computer_run` handler forwards `ctx.mcpReq.signal`; the signal itself is never included in audit metadata.

- [ ] **Step 1: Write RED runtime tests for Owner and legacy modes**

Add tests equivalent to:

```ts
it("executes more than the legacy action cap in Owner mode", async () => {
  const { runtime: subject } = runtime(undefined, { maxActionProgramActions: 3 });
  const result = await subject.run({
    actions: Array.from({ length: 101 }, () => ({ type: "pointer_position" as const })),
    finalObservation: "none",
  }, { ownerMode: true });
  expect(result.completedCount).toBe(101);
  expect(result.actionCount).toBe(101);
});

it("preserves the legacy action cap outside Owner mode", async () => {
  const { runtime: subject } = runtime(undefined, { maxActionProgramActions: 1 });
  await expect(subject.run({
    actions: [{ type: "pointer_position" }, { type: "pointer_position" }],
    finalObservation: "none",
  })).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
});
```

Add deterministic fake-clock tests proving:

```ts
// owner + omitted timeout: elapsed logical time may exceed maxActionProgramRuntimeMs
// owner + explicit timeout: exact supplied deadline still stops the run
// non-owner + omitted/large timeout: legacy maxActionProgramRuntimeMs still applies
```

- [ ] **Step 2: Write RED cancellation tests**

Use an `AbortController` and a run containing a local `wait` followed by a physical action. Abort during the wait and assert:

```ts
expect(native.calls.map((call) => call.method)).not.toContain("click");
expect(native.calls.map((call) => call.method)).toContain("release_inputs");
```

Add MCP registration coverage that captures the `computer_run` handler context and asserts the same `AbortSignal` reaches the scoped/runtime call, matching the already-proven `computer_run_js` pattern.

- [ ] **Step 3: Run RED tests**

Run:

```bash
npx vitest run tests/computer-runtime.test.ts tests/computer-mcp.test.ts tests/computer-audit.test.ts
```

Expected: FAIL because runtime has no Owner execution options and `computer_run` does not forward the MCP signal.

- [ ] **Step 4: Implement Owner-aware deadline/action policy**

In `src/computer-runtime.ts`, use a second internal options parameter:

```ts
async run(
  input: ComputerRunInput,
  options: ComputerRunExecutionOptions = {},
): Promise<ComputerRunResult> {
  const ownerMode = options.ownerMode === true;

  if (!ownerMode && input.actions.length > this.config.maxActionProgramActions) {
    throw new ComputerError("COMPUTER_OUTPUT_LIMIT");
  }

  let deadline: number | undefined;
  if (input.timeoutMs !== undefined) {
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0 ||
        input.timeoutMs > COMPUTER_MAX_EXPLICIT_RUNTIME_MS) invalid();
    const effective = ownerMode
      ? input.timeoutMs
      : Math.min(input.timeoutMs, this.config.maxActionProgramRuntimeMs);
    deadline = this.now() + effective;
  } else if (!ownerMode) {
    deadline = this.now() + this.config.maxActionProgramRuntimeMs;
  }
  // Owner + omitted timeout intentionally leaves deadline undefined.
}
```

Every loop boundary checks `options.signal?.aborted` before starting another action. For a local wait, race the configured sleep with the abort signal instead of sleeping uninterruptibly. For an already-issued native RPC, keep the existing native request as one atomic bounded operation; after it returns, re-check the signal before recording completion or starting any next action.

- [ ] **Step 5: Keep returned step memory bounded**

Retain at most `COMPUTER_MAX_RUN_STEP_RESULTS` step summaries while continuing to execute all actions. Use a fixed-size tail:

```ts
const steps: ComputerRunResult["steps"] = [];
let stepsTruncated = false;

function retainStep(step: ComputerRunStepResult): void {
  if (steps.length === COMPUTER_MAX_RUN_STEP_RESULTS) {
    steps.shift();
    stepsTruncated = true;
  }
  steps.push(step);
}
```

Return true counts independently of retention:

```ts
return {
  state,
  completedCount,
  actionCount,
  steps,
  stepsTruncated,
  ...(finalResult !== undefined ? { finalObservation: finalResult } : {}),
};
```

No execution is rejected merely because the returned step tail is full.

- [ ] **Step 6: Wire Owner mode and MCP AbortSignal through the scoped layer**

`ScopedComputerService` constructor becomes:

```ts
constructor(
  private readonly service: ScopedComputerBackend,
  private readonly audit: AuditLogger,
  private readonly adminEnabled: boolean,
  private readonly ownerRuntimeEnabled: boolean,
) {}
```

Its `run` method accepts signal separately from audited metadata and calls:

```ts
this.service.run(publicInput, {
  ownerMode: this.ownerRuntimeEnabled,
  ...(signal ? { signal } : {}),
});
```

`createScopedRuntime` passes:

```ts
new ScopedComputerService(
  base.computer,
  base.audit,
  authority.profile === "admin",
  base.config.ownerRuntime.enabled === true,
)
```

The lease-free health service uses `ownerRuntimeEnabled = false` because it never executes a run.

Change the MCP handler to receive `ctx` and pass only `ctx.mcpReq.signal` as runtime-only state.

- [ ] **Step 7: Preserve audit privacy and counts**

Keep audit metadata limited to numeric/categorical fields:

```ts
{ actionCount: input.actions.length }
{ completedCount: result.completedCount }
```

Do not record action bodies, typed text, coordinates beyond existing categorical target metadata, signal objects, or retained step contents.

- [ ] **Step 8: Run focused tests and build**

Run:

```bash
npx vitest run tests/computer-runtime.test.ts tests/computer-mcp.test.ts tests/computer-audit.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/computer-runtime.ts src/scoped-computer-service.ts src/scoped-runtime.ts src/computer-tool-registration.ts tests/computer-runtime.test.ts tests/computer-mcp.test.ts tests/computer-audit.test.ts
git commit -m "feat: remove owner computer run ceilings"
```

---

### Task 3: Give Owner `computer_run_js` a true no-deadline mode

**Files:**
- Modify: `src/computer-runtime.ts`
- Modify: `src/computer-js-runtime.ts`
- Modify: `src/computer-js-runner-supervisor.ts`
- Modify: `src/computer-js-tool-registration.ts`
- Test: `tests/computer-js-runtime.test.ts`
- Test: `tests/computer-js-runner-supervisor.test.ts`
- Test: `tests/computer-js-mcp.test.ts`
- Test: `tests/computer-js-integration.test.ts`

**Interfaces:**
- `ComputerJsRunnerRequest.timeoutMs` becomes optional:

```ts
timeoutMs?: number;
```

- `ComputerJsRuntimeConfig` includes only the additional Owner gate state it needs:

```ts
ownerRuntime: { enabled: boolean };
```

- `ComputerRuntime.withExclusiveProgram` gains internal `{ ownerMode?: boolean }` so JS-dispatched local waits are not rejected by the old `30_000 ms` cap in Owner mode.
- Non-Owner full-host JS retains `maxJsRuntimeMs` behavior for compatibility.

- [ ] **Step 1: Write RED JS runtime tests**

Replace the current "clamps timeout" expectation with explicit owner/non-owner cases:

```ts
const owner = await fixture({ ownerRuntimeEnabled: true, maxJsRuntimeMs: 250 });
await owner.runtime.run({ source: "return 1;" });
await owner.runtime.run({ source: "return 2;", timeoutMs: 999 });
expect(owner.supervisor.calls.map((call) => call.timeoutMs)).toEqual([undefined, 999]);

const legacy = await fixture({ ownerRuntimeEnabled: false, maxJsRuntimeMs: 250 });
await legacy.runtime.run({ source: "return 1;" });
await legacy.runtime.run({ source: "return 2;", timeoutMs: 999 });
expect(legacy.supervisor.calls.map((call) => call.timeoutMs)).toEqual([250, 250]);
```

Also add a test that an Owner JS `computer.execute({ type: "wait", durationMs: 30_001 })` is accepted while the equivalent non-Owner program remains bounded by the legacy max.

- [ ] **Step 2: Write RED supervisor tests for omitted timeout**

Use a short-running real/fake runner and assert no execution timer is required when `timeoutMs` is absent:

```ts
await expect(supervisor.run({
  source: "return 42;",
  cwd,
  onRpc: async () => ({}),
})).resolves.toMatchObject({ result: 42 });
```

Keep the existing explicit-timeout SIGTERM→SIGKILL test unchanged to prove finite timeout remains authoritative.

- [ ] **Step 3: Write RED MCP-schema tests**

When `ownerRuntime.enabled === true`, a finite timeout greater than `30_000` but less than/equal to `COMPUTER_MAX_EXPLICIT_RUNTIME_MS` must pass schema validation. When Owner Runtime is disabled, preserve the existing `maxJsRuntimeMs` schema maximum.

Continue asserting `ctx.mcpReq.signal` is forwarded unchanged.

- [ ] **Step 4: Run RED tests**

Run:

```bash
npx vitest run tests/computer-js-runtime.test.ts tests/computer-js-runner-supervisor.test.ts tests/computer-js-mcp.test.ts tests/computer-js-integration.test.ts
```

Expected: FAIL because timeout is currently mandatory inside the supervisor and Owner runs are clamped to `maxJsRuntimeMs`.

- [ ] **Step 5: Implement optional supervisor timer**

Change the request type:

```ts
export interface ComputerJsRunnerRequest {
  source: string;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onTerminate?: () => void;
  onRpc: (method: ComputerJsRpcMethod, params: unknown) => Promise<unknown>;
}
```

Only allocate the timer when a finite timeout exists:

```ts
if (request.timeoutMs !== undefined) {
  timer = setTimeout(
    () => finishError(new ComputerError("COMPUTER_JS_TIMEOUT")),
    request.timeoutMs,
  );
  timer.unref();
}
```

Abort handling, output byte accounting, child-group SIGTERM/SIGKILL escalation, and `onTerminate -> session.cancel()` remain unchanged.

- [ ] **Step 6: Implement Owner-aware JS timeout selection**

In `ComputerJsRuntime.run`:

```ts
const ownerMode = this.config.ownerRuntime.enabled === true;
let timeoutMs: number | undefined;

if (input.timeoutMs !== undefined) {
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0 ||
      input.timeoutMs > COMPUTER_MAX_EXPLICIT_RUNTIME_MS) {
    throw new ComputerError("COMPUTER_PROTOCOL_INVALID");
  }
  timeoutMs = ownerMode
    ? input.timeoutMs
    : Math.min(input.timeoutMs, this.config.computerUse.maxJsRuntimeMs);
} else if (!ownerMode) {
  timeoutMs = this.config.computerUse.maxJsRuntimeMs;
}
```

Call:

```ts
this.computer.withExclusiveProgram(work, { ownerMode });
```

so `computer.execute({ type: "wait", durationMs: ... })` follows the same Owner semantics.

- [ ] **Step 7: Make the MCP timeout schema Owner-aware**

Use a dynamic schema:

```ts
const timeoutSchema = runtime.config.ownerRuntime.enabled
  ? z.number().int().positive().max(COMPUTER_MAX_EXPLICIT_RUNTIME_MS)
  : z.number().int().positive().max(runtime.config.computerUse.maxJsRuntimeMs);
```

Keep source-size and output-size schemas exactly bounded as before.

- [ ] **Step 8: Run focused tests and build**

Run:

```bash
npx vitest run tests/computer-js-runtime.test.ts tests/computer-js-runner-supervisor.test.ts tests/computer-js-mcp.test.ts tests/computer-js-integration.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/computer-runtime.ts src/computer-js-runtime.ts src/computer-js-runner-supervisor.ts src/computer-js-tool-registration.ts tests/computer-js-runtime.test.ts tests/computer-js-runner-supervisor.test.ts tests/computer-js-mcp.test.ts tests/computer-js-integration.test.ts
git commit -m "feat: allow owner computer js without deadline"
```

---

### Task 4: Prove containment/recovery invariants did not widen

**Files:**
- Modify: `tests/computer-runtime.test.ts`
- Modify: `tests/computer-js-mcp.test.ts`
- Modify: `tests/computer-js-runner-supervisor.test.ts`
- Modify: `tests/computer-slice5-integration.test.ts`
- Modify: `tests/computer-audit.test.ts`

**Interfaces:**
- No new production interface is expected in this task.
- This task is a regression gate: unlimited **productivity duration/count** must not become unlimited memory, payload, retries, or audit content.

- [ ] **Step 1: Add bounded returned-step regression**

Run an Owner program with at least `COMPUTER_MAX_RUN_STEP_RESULTS + 44` cheap fake-native actions and assert:

```ts
expect(result.completedCount).toBe(300);
expect(result.actionCount).toBe(300);
expect(result.steps).toHaveLength(COMPUTER_MAX_RUN_STEP_RESULTS);
expect(result.stepsTruncated).toBe(true);
expect(result.steps.at(-1)?.index).toBe(299);
```

This proves the execution count is not capped by the result-memory cap.

- [ ] **Step 2: Preserve retry-budget containment**

Keep/extend Slice 5 assertions showing semantic retry budget cannot exceed `2` and recovery remains bounded:

```ts
await expect(dispatchComputerJsRpc(session, "resolve", {
  target: { by: "text", text: "Run" },
  retryBudget: 3,
})).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
```

Do not alter `maxAutomaticRetriesPerAction` or retry schemas.

- [ ] **Step 3: Preserve JS source/output bounds**

Keep existing oversized-source MCP rejection and combined stdout/stderr/result overflow test. Add Owner Runtime enabled to those fixtures so the test proves Owner mode does **not** bypass the bounds.

- [ ] **Step 4: Preserve observation/screenshot bounds and audit redaction**

Run existing Computer Runtime observation/screenshot limit tests plus audit tests under Owner-enabled config and assert no action body, typed text, screenshot data, JS source, stdout/stderr, or AbortSignal is serialized to audit.

- [ ] **Step 5: Run containment regression set**

Run:

```bash
npx vitest run \
  tests/computer-runtime.test.ts \
  tests/computer-js-mcp.test.ts \
  tests/computer-js-runner-supervisor.test.ts \
  tests/computer-slice5-integration.test.ts \
  tests/computer-audit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add tests/computer-runtime.test.ts tests/computer-js-mcp.test.ts tests/computer-js-runner-supervisor.test.ts tests/computer-slice5-integration.test.ts tests/computer-audit.test.ts
git commit -m "test: lock owner computer containment invariants"
```

---

### Task 5: Add Phase 3 long-run acceptance and stable-helper/TCC release gate

**Files:**
- Create: `tests/owner-computer-runtime-phase3-integration.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- Standard test path proves >100-action Owner execution quickly with a fake/native fixture.
- Environment variable `CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1` enables the deliberate >30-second real JS acceptance; it is not enabled in the ordinary fast unit-test run.
- Release acceptance still uses the existing stable installed helper and existing lease-free `computer_health`; no new TCC API or bypass is added.

- [ ] **Step 1: Create the fast Phase 3 integration test**

The default test must construct an Owner-enabled runtime and prove in one scenario:

```ts
const actions = Array.from({ length: 101 }, () => ({ type: "pointer_position" as const }));
const result = await computer.run({ actions, finalObservation: "none" }, { ownerMode: true });
expect(result.completedCount).toBe(101);
expect(result.actionCount).toBe(101);
```

Also prove an explicit small timeout still fails cleanly and input cleanup remains observable.

- [ ] **Step 2: Add the env-gated real >30-second JS test**

Use the real `ComputerJsRunnerSupervisor` and fixed runner entrypoint. Gate the test:

```ts
const longIt = process.env.CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE === "1" ? it : it.skip;

longIt("runs Owner JavaScript past the legacy 30 second ceiling without an implicit deadline", async () => {
  const started = performance.now();
  const result = await runtime.run({
    source: `
      await new Promise((resolve) => setTimeout(resolve, 31_000));
      return { completed: true };
    `,
  });
  expect(performance.now() - started).toBeGreaterThanOrEqual(30_000);
  expect(result.result).toEqual({ completed: true });
});
```

This test must use Owner Runtime enabled and **omit** `timeoutMs`.

- [ ] **Step 3: Add one macOS-native CI acceptance step**

After dependency install/build and before packaging completion, run only the targeted long test with:

```yaml
- name: Test Owner Runtime long computer acceptance
  run: CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1 npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
```

Do not enable the 31-second test in both Node matrix jobs; one hosted macOS proof is sufficient and avoids tripling CI cost.

- [ ] **Step 4: Document Owner-vs-containment semantics**

Update operator docs with the exact contract:

```text
Owner Runtime + Admin:
- computer_run: no 100-action cap and no implicit 30s program deadline
- computer_run_js: no implicit 30s runner deadline
- explicit timeout: still authoritative
- request cancellation: stops queued/future work and aborts local waits
- native action already in flight: remains bounded by requestTimeoutMs, then cleanup/fail-closed handling runs
- takeover/emergency/shutdown: always authoritative
- payload/output/screenshot/observation/retry/result-retention limits: still bounded
```

State that this is low-latency tool-call/local-fast-path control, not a video-streaming session.

- [ ] **Step 5: Define the real-Mac TCC acceptance gate in docs**

Before calling Phase 3 complete on a real Mac, require:

```text
setup/doctor state: tccIdentityStable == true
computer_health.accessibilityTrusted == true
computer_health.screenCaptureAuthorized == true
computer_health.eventListenAuthorized == true
computer_health.eventPostAuthorized == true
```

If any field is false, do not bypass TCC. Use normal System Settings permission flow and restart the installed helper/daemon as documented, then re-check.

- [ ] **Step 6: Run focused acceptance without the 31-second gate**

Run:

```bash
npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
npm run build
```

Expected: fast tests PASS and the long test is exactly one intentional environment-gated skip.

- [ ] **Step 7: Run the deliberate long acceptance locally once**

Run:

```bash
CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1 npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
```

Expected: the >30-second Owner JS case PASS, not `COMPUTER_JS_TIMEOUT`.

- [ ] **Step 8: Verify real-Mac helper/TCC readiness using existing surfaces**

Run the existing setup/doctor path and then query the running plugin's existing lease-free `computer_health`. Acceptance requires stable helper identity and all four readiness booleans true. Do not modify permissions programmatically.

- [ ] **Step 9: Commit Task 5**

```bash
git add .github/workflows/ci.yml tests/owner-computer-runtime-phase3-integration.test.ts README.md SECURITY.md docs/ARCHITECTURE.md docs/CHATGPT_INTEGRATION.md
git commit -m "test: add owner computer long-run acceptance"
```

---

### Task 6: Final exact-head verification and handoff state

**Files:**
- Modify: `docs/PROJECT_STATE.md`

**Interfaces:**
- No production interface changes.
- Final evidence must bind to the exact feature-branch HEAD after the state commit; stale pre-commit results are not sufficient.

- [ ] **Step 1: Run the full pre-state gate**

Run:

```bash
npm run build
npm test
npm audit --omit=dev
npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1 npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
swift test --package-path native/macos-computer-runtime
git diff --check origin/main...HEAD
git status --short --branch
```

Expected:
- all non-gated Node/TS tests PASS;
- ordinary suite has only documented environment-gated skips;
- deliberate >30s Owner acceptance PASS;
- production audit 0 vulnerabilities;
- Swift 164/164 or the then-current exact count PASS;
- diff check clean;
- no unrelated dirty files.

- [ ] **Step 2: Perform the real-Mac health gate**

Record only categorical/content-free evidence:

```text
tccIdentityStable: true
accessibilityTrusted: true
screenCaptureAuthorized: true
eventListenAuthorized: true
eventPostAuthorized: true
```

Do not persist screenshots, AX/OCR content, typed text, environment values, or credentials.

- [ ] **Step 3: Update `docs/PROJECT_STATE.md`**

Record:
- Phase 2 merged baseline `7aece8f5cb1b4397de04704a41b95626a0b8e887`;
- Phase 3 branch and exact current HEAD;
- Owner/no-deadline behavior;
- legacy non-Owner compatibility behavior;
- cancellation boundary and cleanup semantics;
- retained payload/memory/retry bounds;
- local long acceptance and TCC health evidence;
- next gate: final review/publication only, no merge without separate authorization.

- [ ] **Step 4: Run docs contract and placeholder checks**

Run:

```bash
npx vitest run tests/project-continuity-docs.test.ts
python3 -c 'from pathlib import Path; p=Path("docs/superpowers/plans/2026-09-12-owner-runtime-phase3-computer-ceilings.md"); terms=["T"+"BD","TO"+"DO","implement "+"later","fill in "+"details","Similar "+"to","similar "+"to"]; hits=[(i,l) for i,l in enumerate(p.read_text().splitlines(),1) if any(t in l for t in terms)]; print(hits); raise SystemExit(bool(hits))'
git diff --check
```

Expected: docs tests PASS, placeholder scan returns no matches, diff check clean.

- [ ] **Step 5: Commit the handoff state**

```bash
git add docs/PROJECT_STATE.md
git commit -m "docs: complete owner runtime phase 3 handoff"
```

- [ ] **Step 6: Re-run the full exact-head gate after the state commit**

Repeat the Step 1 commands on the new exact HEAD. The final completion claim must use this run, not the pre-state evidence.

- [ ] **Step 7: Review branch scope before publication**

Verify:

```bash
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git log --oneline origin/main..HEAD
git status --short --branch
```

Confirm:
- no Browser/shell/PTTY/Git/Project Exec semantic widening;
- no native protocol expansion unless TDD proved it unavoidable and separately reviewed;
- no change to retry budget `2`;
- no removal of payload/memory/TCC/takeover/emergency bounds;
- worktree clean.

- [ ] **Step 8: Project Continuity checkpoint**

Checkpoint the exact branch HEAD, fresh local evidence, remaining uncertainties, and publication/merge gate. Do not store authority lease IDs or other secrets.

- [ ] **Step 9: Stop at publication authorization**

If local exact-head evidence is green, report the branch head and verification. Push/PR may proceed only under the user's publication authorization; merge remains a separate explicit gate.

---

## Self-Review Checklist

Before execution, confirm all of the following:

- Spec §9: existing persistent helper/local-fast-path architecture is preserved; no second session/video system added.
- Spec §10: Owner `computer_run` no longer has a 100-action or implicit 30s limit.
- Spec §10: Owner `computer_run_js` no longer has an implicit 30s limit.
- Spec §10: explicit finite timeout remains supported and authoritative.
- Spec §10: source/output/screenshot/observation/protocol/result-retention memory remains bounded.
- Spec §10: automatic semantic recovery remains capped at `2`.
- Spec §11: MCP cancellation reaches both run paths; local waits are abortable; runner process groups are terminated; held input cleanup remains mandatory.
- Spec §11: takeover/emergency/shutdown remain authoritative.
- Spec §12: stable helper/TCC readiness is verified, never bypassed.
- Spec §18.4: >100 actions, >30s no-timeout, finite timeout, cancellation, bounded memory, and bounded recovery all have explicit acceptance evidence.
- Phase 4 Codex-class feature-worktree/browser/Git/PR continuity scenario is **not** pulled into Phase 3.
