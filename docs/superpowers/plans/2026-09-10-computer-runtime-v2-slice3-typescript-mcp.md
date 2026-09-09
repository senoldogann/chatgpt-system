# Computer Runtime v2 Slice 3 TypeScript + MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the accepted macOS Computer Runtime v2 helper to the TypeScript control plane with explicit startup enablement, strict native-host lifecycle/protocol handling, Admin-scoped MCP tools, typed `computer_run`, privacy-safe audit, stable daily-driver signing/install, and shutdown integration.

**Architecture:** `chatgpt-system` keeps one existing `AuthorityManager` and one shared `RuntimeServices`. A dedicated `ComputerNativeSupervisor` owns exactly one fixed-path native helper child and a strict `ComputerNativeClient` speaks protocol-v1 NDJSON over private stdio pipes. `ComputerRuntime` owns direct typed operations plus one FIFO physical-action lane; `ScopedComputerService` adds Admin policy and safe audit; `computer-tool-registration.ts` exposes the MCP catalog without duplicating policy.

**Tech Stack:** TypeScript 6, Node.js 22/24, Zod 4, MCP server v2, Vitest 3, Swift 6, SwiftPM, AppKit/CoreGraphics existing native helper, macOS `codesign` / `security`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-computer-runtime-v2-slice3-typescript-mcp-design.md`

## Global Constraints

- Base is exact accepted Slice 2 main: `789c4a05a55310995fb0b2744dc8e7c17daf4408`.
- Computer use remains disabled by default; production opt-in is `--enable-computer-use`.
- Fixed accepted bundle ID remains `com.senoldogann.chatgpt-system.computer-runtime`.
- Fixed default installed bundle path is `~/.chatgpt-system/ChatGPTSystemComputerRuntime.app`.
- MCP may not choose the native executable path, signing identity, event tag, takeover tolerance, protocol version, or safety-disable switches.
- `computer_health` is lease-free and categorical; every other `computer_*` operation requires Admin authority.
- No application allowlist is added for Admin computer control.
- TypeScript mirrors native protocol-v1 frame limits: request `262144` bytes, response `12582912` bytes.
- Native message/stderr text is never surfaced verbatim as an MCP-safe error.
- Direct MCP does not expose raw `mouse_down` / `mouse_up`; those remain available only inside one bounded `computer_run` with unconditional final input cleanup.
- `computer_run` performs no automatic retry and no transactional rollback claim.
- Screenshot bytes are returned as MCP image content, not duplicated into structured JSON.
- Audit must not contain typed text, wait-for-text strings, AX/UI document text, screenshots, raw coordinates, native request IDs, lease IDs, native stderr, or raw native error messages.
- CI/staging may remain ad-hoc signed; stable daily-driver install must not silently fall back to ad-hoc signing.
- TCC is never edited/reset/bypassed or actively requested by the runtime.
- No Slice 4/5 scope: no `computer_run_js`, full-host JS runner, Vision OCR, semantic target resolver, stale-target recovery ladder, autonomous planner/OODA loop, or computer TCP/Unix listener.
- Existing Browser Runtime and managed-process behavior must remain green.
- Required PR/post-merge CI jobs: `test (22)`, `test (24)`, `macos-native`.

---

## File Structure

### New TypeScript modules

- `src/computer-types.ts`: shared protocol/domain types, constants, native method/result shapes, `ComputerAction` discriminated union.
- `src/computer-errors.ts`: stable computer error codes/messages and safe native-error normalization.
- `src/computer-native-client.ts`: request ID generation, NDJSON framing, response validation/correlation, timeout bookkeeping.
- `src/computer-native-supervisor.ts`: fixed helper path derivation, lazy child start/coalescing, crash/poison handling, bounded stderr tail, close lifecycle.
- `src/computer-runtime.ts`: direct operation methods, physical FIFO lane, typed `computer_run`, output/domain bounds and finalization.
- `src/scoped-computer-service.ts`: Admin authorization and privacy-safe audit records.
- `src/computer-tool-registration.ts`: strict MCP Zod schemas, tool annotations, success/error/image result encoding.

### New setup/tests

- `scripts/setup-macos-computer-runtime.mjs`: stable signing identity selection, package/install verification, atomic install planning.
- `tests/computer-errors.test.ts`
- `tests/computer-native-client.test.ts`
- `tests/computer-native-supervisor.test.ts`
- `tests/computer-runtime.test.ts`
- `tests/computer-audit.test.ts`
- `tests/computer-mcp.test.ts`
- `tests/computer-config.test.ts`
- `tests/setup-macos-computer-runtime.test.ts`

### Existing files modified

- `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemPermissionReader.swift` or the actual `PermissionReading` implementation file discovered by `rg`.
- `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- matching native health tests under `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/`.
- `src/config.ts`
- `src/cli-command.ts`
- `src/cli.ts`
- `src/server.ts`
- `src/scoped-runtime.ts`
- `src/runtime-shutdown.ts`
- `src/tool-output-schemas.ts`
- `scripts/setup-chatgpt-tunnel.mjs`
- `package.json`
- `.github/workflows/ci.yml` only if the new contract requires an explicit step not already covered by `npm run check` / existing macOS packaging commands.
- `README.md`
- `docs/CHATGPT_INTEGRATION.md`

---

### Task 1: Add passive physical-input readiness to native health

**Files:**
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Modify: actual `PermissionReading` protocol/implementation file found with `rg -n "protocol PermissionReading|struct SystemPermissionReader" native/macos-computer-runtime/Sources`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Test: existing health tests under `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/HostServiceTests.swift`

**Interfaces:**
- Produces native health result fields `eventListenAuthorized: Bool` and `eventPostAuthorized: Bool` in protocol v1.
- Keeps existing `state`, `accessibilityTrusted`, and `screenCaptureAuthorized` unchanged.
- Uses passive CoreGraphics preflight only; no `CGRequest*` API.

- [ ] **Step 1: Locate exact permission protocol/implementation and current health model**

Run:

```bash
rg -n "protocol PermissionReading|SystemPermissionReader|struct ComputerHealth" native/macos-computer-runtime/Sources native/macos-computer-runtime/Tests
```

Expected: exact source paths for protocol, system reader, model, and health tests.

- [ ] **Step 2: Write failing Swift health tests**

Add assertions equivalent to:

```swift
let permissions = StubPermissionReader(
    accessibilityTrusted: true,
    screenCaptureAuthorized: true,
    eventListenAuthorized: false,
    eventPostAuthorized: true
)
let response = await service.handle(.init(protocolVersion: 1, requestId: "health-1", method: "health", params: .object([:])))
let health = try decodeResult(response, as: ComputerHealth.self)
XCTAssertFalse(health.eventListenAuthorized)
XCTAssertTrue(health.eventPostAuthorized)
```

Also add a source guard test or repository grep assertion proving `CGRequestListenEventAccess` and `CGRequestPostEventAccess` are absent.

- [ ] **Step 3: Run focused native tests and verify RED**

Run:

```bash
swift test --package-path native/macos-computer-runtime --filter HostServiceTests
```

Expected: compile/test failure because the new health fields/readers do not yet exist.

- [ ] **Step 4: Implement minimal passive readiness plumbing**

Extend the permission abstraction with:

```swift
func eventListenAuthorized() -> Bool
func eventPostAuthorized() -> Bool
```

System implementation must use:

```swift
CGPreflightListenEventAccess()
CGPreflightPostEventAccess()
```

Extend `ComputerHealth` and `ComputerHostService.health` to include both values.

- [ ] **Step 5: Run focused + full native tests**

Run:

```bash
swift test --package-path native/macos-computer-runtime --filter HostServiceTests
swift test --package-path native/macos-computer-runtime
rg -n "CGRequestListenEventAccess|CGRequestPostEventAccess" native/macos-computer-runtime/Sources
```

Expected: focused/full GREEN; final `rg` has zero matches.

- [ ] **Step 6: Commit**

```bash
git add native/macos-computer-runtime/Sources native/macos-computer-runtime/Tests
git commit -m "feat: report computer input readiness"
```

---

### Task 2: Add computer-use config, CLI gate, capabilities and tunnel flag

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli.ts`
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Test: `tests/computer-config.test.ts`
- Test: `tests/cli-command.test.ts`
- Test: `tests/setup-chatgpt-tunnel.test.ts`
- Test: `tests/authority-mcp.test.ts` or existing capabilities test file

**Interfaces:**
- Produces `ComputerUseConfig` on `AppConfig`:

```ts
export interface ComputerUseConfig {
  enabled: boolean;
  hostBundlePath: string;
  requestTimeoutMs: number;
  maxObservationElements: number;
  maxObservationChars: number;
  maxScreenshotBytes: number;
  maxActionProgramActions: number;
  maxActionProgramRuntimeMs: number;
}
```

- Adds `ConfigOverrides.computerUseEnabled?: boolean`.
- CLI `--enable-computer-use` sets the override true.
- `system_capabilities.computerUse` is `{ enabled: boolean; fullHostJsEnabled: false }`.
- Tunnel setup mirrors the same explicit flag into generated MCP command.

- [ ] **Step 1: Write failing config/CLI/tunnel tests**

Add tests equivalent to:

```ts
const config = await loadConfig({ roots: [root] });
expect(config.computerUse.enabled).toBe(false);
expect(config.computerUse.hostBundlePath).toBe(path.join(home, ".chatgpt-system", "ChatGPTSystemComputerRuntime.app"));

expect(parseCliCommand(["stdio", "--enable-computer-use"])).toMatchObject({
  kind: "server",
  overrides: { computerUseEnabled: true },
});

const setup = buildTunnelSetup(["--root", root, "--tunnel-id", "tunnel_12345678", "--enable-computer-use"], {}, context);
expect(setup.mcpCommand).toContain("--enable-computer-use");
```

Add system-capabilities assertion for `fullHostJsEnabled: false`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/computer-config.test.ts tests/cli-command.test.ts tests/setup-chatgpt-tunnel.test.ts tests/authority-mcp.test.ts
```

Expected: FAIL because computer config/flag/capability do not exist.

- [ ] **Step 3: Implement config defaults and parsing**

Add environment keys only for trusted startup configuration where needed, but keep MCP unable to alter them. Default exact values:

```ts
{
  enabled: false,
  hostBundlePath: path.join(homeDir, ".chatgpt-system", "ChatGPTSystemComputerRuntime.app"),
  requestTimeoutMs: 10_000,
  maxObservationElements: 500,
  maxObservationChars: 262_144,
  maxScreenshotBytes: 8_388_608,
  maxActionProgramActions: 100,
  maxActionProgramRuntimeMs: 30_000,
}
```

Add CLI/help/logging support for `--enable-computer-use` and tunnel flag propagation.

- [ ] **Step 4: Implement capabilities schema/result**

Extend `systemCapabilitiesOutputSchema` with:

```ts
computerUse: z.object({
  enabled: z.boolean(),
  fullHostJsEnabled: z.literal(false),
})
```

Populate from config only; expose no helper/signing path.

- [ ] **Step 5: Run focused + full Node checks**

```bash
npm test -- tests/computer-config.test.ts tests/cli-command.test.ts tests/setup-chatgpt-tunnel.test.ts tests/authority-mcp.test.ts
npm run check
```

Expected: GREEN.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/cli-command.ts src/cli.ts src/server.ts src/tool-output-schemas.ts scripts/setup-chatgpt-tunnel.mjs tests
 git commit -m "feat: add computer use startup gate"
```

---

### Task 3: Implement stable computer errors and strict native protocol client

**Files:**
- Create: `src/computer-types.ts`
- Create: `src/computer-errors.ts`
- Create: `src/computer-native-client.ts`
- Create: `tests/computer-errors.test.ts`
- Create: `tests/computer-native-client.test.ts`

**Interfaces:**
- `COMPUTER_PROTOCOL_VERSION = 1`
- `COMPUTER_MAX_REQUEST_LINE_BYTES = 262_144`
- `COMPUTER_MAX_RESPONSE_BYTES = 12_582_912`
- `ComputerError extends AppError`
- `normalizeComputerNativeError(code: string): ComputerError`
- `ComputerNativeClient.request(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>`
- Client receives already-owned writable/readable streams; it does not spawn processes itself.
- Client exposes `close(error?: ComputerError): void` to reject all pending requests and stop accepting responses.

- [ ] **Step 1: Write failing stable-error tests**

Test exact safe mapping:

```ts
expect(normalizeComputerNativeError("COMPUTER_TIMEOUT")).toMatchObject({
  code: "COMPUTER_TIMEOUT",
  message: "Computer operation timed out.",
});
expect(() => normalizeComputerNativeError("NATIVE_SECRET_STACK")).toThrowError(/protocol/i);
```

Ensure no native message argument is accepted by the public normalization function.

- [ ] **Step 2: Write failing protocol-client tests with in-memory streams**

Cover:

```ts
it("correlates two out-of-order valid responses by opaque requestId", ...)
it("rejects oversized request before writing", ...)
it("poisons on oversized response line", ...)
it("poisons on malformed JSON", ...)
it("poisons on protocolVersion mismatch", ...)
it("poisons on unknown or duplicate requestId", ...)
it("maps allowlisted native code without surfacing native message", ...)
it("outer timeout closes the client and rejects pending calls", ...)
```

Use `PassThrough` streams so tests do not need a real child.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- tests/computer-errors.test.ts tests/computer-native-client.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement strict types/errors/client**

Use `randomBytes(32).toString("base64url")` for request IDs. Serialize one request per line and reject if `Buffer.byteLength(line, "utf8") > 262_144`.

Incrementally buffer stdout bytes until `\n`; reject/poison if one frame exceeds `12_582_912`. Parse JSON, validate exact response envelope with Zod, require `protocolVersion === 1`, and require exactly one pending request ID.

Public error messages come only from a constant map in `computer-errors.ts`.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- tests/computer-errors.test.ts tests/computer-native-client.test.ts
```

Expected: GREEN.

- [ ] **Step 6: Commit**

```bash
git add src/computer-types.ts src/computer-errors.ts src/computer-native-client.ts tests/computer-errors.test.ts tests/computer-native-client.test.ts
git commit -m "feat: add strict computer native client"
```

---

### Task 4: Implement dedicated lazy native supervisor

**Files:**
- Create: `src/computer-native-supervisor.ts`
- Create: `tests/computer-native-supervisor.test.ts`

**Interfaces:**

```ts
export interface ComputerNativeSupervisorOptions {
  enabled: boolean;
  hostBundlePath: string;
  requestTimeoutMs: number;
  spawnImpl?: ComputerSpawn;
  now?: () => number;
}

export class ComputerNativeSupervisor {
  healthState(): "disabled" | "stopped" | "running" | "unavailable";
  request(method: ComputerNativeMethod, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}
```

Fixed executable is always `path.join(hostBundlePath, "Contents", "MacOS", "chatgpt-system-computer-runtime")`.

- [ ] **Step 1: Write failing supervisor tests**

Cover:

```ts
it("does not spawn while disabled", ...)
it("spawns the fixed executable with shell false and private pipes", ...)
it("coalesces concurrent first starts", ...)
it("fails all pending requests when child exits", ...)
it("starts a fresh child on a later call after crash", ...)
it("marks timed-out/protocol-poisoned child unusable", ...)
it("bounds stderr tail without exposing it from request errors", ...)
it("close is idempotent and prevents later lazy restart", ...)
```

Inject a fake child/spawn implementation. Assert no MCP-controlled path parameter exists.

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- tests/computer-native-supervisor.test.ts
```

Expected: FAIL because supervisor does not exist.

- [ ] **Step 3: Implement minimal lifecycle**

Maintain one `startPromise` to coalesce starts and one current child/client. Spawn contract:

```ts
spawnImpl(executablePath, [], {
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
})
```

On child `exit`/`error`, close current client with `COMPUTER_UNAVAILABLE`, clear ownership, and permit a later fresh start unless closing.

Outer client timeout/protocol corruption must poison the child; supervisor terminates it and future calls start a new one.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- tests/computer-native-supervisor.test.ts tests/computer-native-client.test.ts
```

Expected: GREEN.

- [ ] **Step 5: Commit**

```bash
git add src/computer-native-supervisor.ts tests/computer-native-supervisor.test.ts
git commit -m "feat: supervise computer native host"
```

---

### Task 5: Implement ComputerRuntime direct operations and FIFO physical lane

**Files:**
- Modify: `src/computer-types.ts`
- Create: `src/computer-runtime.ts`
- Create: `tests/computer-runtime.test.ts`

**Interfaces:**

`ComputerRuntime` constructor consumes `ComputerNativeSupervisor` plus `ComputerUseConfig`.

Direct methods:

```ts
health()
observe()
screenshot()
pointerPosition()
openApp(input)
focusApp(input)
moveMouse(input)
click(input)
drag(input)
scroll(input)
typeText(input)
pressKey(input)
releaseInputs()
waitForFrontmost(input)
waitForText(input)
waitUntilChanged(input)
```

Mutation methods use one FIFO lane; read-only methods do not.

- [ ] **Step 1: Define failing direct-operation tests**

Use a fake supervisor recording calls. Cover exact native method mapping, defaults and lane behavior:

```ts
expect(await runtime.click({ x: 10, y: 20, count: 2 })).toEqual(...);
expect(fake.calls[0]?.method).toBe("double_click");

const first = runtime.moveMouse(...blocked...);
const second = runtime.click(...);
expect(fake.maxConcurrentPhysical).toBe(1);

await Promise.all([runtime.observe(), runtime.pointerPosition()]);
expect(fake.readOnlyOverlapObserved).toBe(true);
```

Validate screenshot decoded byte count and observation bounds again in TypeScript.

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- tests/computer-runtime.test.ts
```

Expected: FAIL because runtime is absent.

- [ ] **Step 3: Implement FIFO lane and direct mappings**

Use a promise-chain/mutex abstraction private to `ComputerRuntime`:

```ts
private physicalChain: Promise<void> = Promise.resolve();

private inPhysicalLane<T>(fn: () => Promise<T>): Promise<T> {
  const result = this.physicalChain.then(fn, fn);
  this.physicalChain = result.then(() => undefined, () => undefined);
  return result;
}
```

Do not use the lane for `health`, `observe`, `screenshot`, `pointerPosition`, or wait-only calls outside a run.

- [ ] **Step 4: Add strict runtime-side domain validation**

Re-check native-compatible limits: finite coordinates, scroll integer `[-10000,10000]`, motion mode enum, selector/text lengths, screenshot bytes `<= config.maxScreenshotBytes`, observation serialized length `<= config.maxObservationChars` and element count `<= config.maxObservationElements`.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- tests/computer-runtime.test.ts
```

Expected: GREEN.

- [ ] **Step 6: Commit**

```bash
git add src/computer-types.ts src/computer-runtime.ts tests/computer-runtime.test.ts
git commit -m "feat: add computer runtime direct actions"
```

---

### Task 6: Add typed `computer_run` executor with deadline and final cleanup

**Files:**
- Modify: `src/computer-types.ts`
- Modify: `src/computer-runtime.ts`
- Modify: `tests/computer-runtime.test.ts`

**Interfaces:**

Define discriminated `ComputerAction` union for:

```text
observe
pointer_position
open_app
focus_app
move_mouse
click
double_click
mouse_down
mouse_up
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

Add:

```ts
run(input: {
  actions: ComputerAction[];
  finalObservation?: "none" | "active_window" | "observe";
  timeoutMs?: number;
}): Promise<ComputerRunResult>
```

- [ ] **Step 1: Write failing run tests**

Cover exact spec semantics:

```ts
it("validates every action before any native mutation", ...)
it("holds one physical lane across all steps", ...)
it("rejects more than configured max actions", ...)
it("uses one absolute deadline", ...)
it("clamps native request timeout to remaining run time", ...)
it("stops on first failed step with no automatic retry", ...)
it("reports completed side effects without rollback claim", ...)
it("allows mouse_down/up only inside run", ...)
it("always release_inputs after hold-capable or physical work on success", ...)
it("always release_inputs after failed physical program", ...)
it("supports finalObservation none active_window observe", ...)
it("marks completed_unverified if final observation alone fails", ...)
it("never echoes typed text in step summaries", ...)
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- tests/computer-runtime.test.ts
```

Expected: new run tests FAIL.

- [ ] **Step 3: Implement action pre-validation and absolute deadline**

Compute once:

```ts
const deadline = performance.now() + boundedRuntimeMs;
```

Before each step:

```ts
const remainingMs = Math.floor(deadline - performance.now());
if (remainingMs <= 0) throw new ComputerError("COMPUTER_TIMEOUT");
```

Pass `Math.min(config.requestTimeoutMs, remainingMs)` as the outer supervisor request timeout.

- [ ] **Step 4: Implement sequential action dispatch and failure details**

Stop at the first thrown `ComputerError`; attach only safe details:

```ts
{
  failedStepIndex,
  failedActionType,
  completedCount,
  actionCount,
}
```

No text/coordinates/request IDs.

- [ ] **Step 5: Implement unconditional finalizer for physical/hold-capable programs**

Use `try/finally`. If any physical action ran or a hold-capable action was present, issue best-effort native `release_inputs` before releasing the TypeScript lane. A finalizer failure must not replace the original error, but should produce safe audit metadata later.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- tests/computer-runtime.test.ts
```

Expected: GREEN.

- [ ] **Step 7: Commit**

```bash
git add src/computer-types.ts src/computer-runtime.ts tests/computer-runtime.test.ts
git commit -m "feat: add typed computer action runner"
```

---

### Task 7: Add Admin-scoped computer service and privacy-safe audit

**Files:**
- Create: `src/scoped-computer-service.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/server.ts`
- Create: `tests/computer-audit.test.ts`
- Modify: authority/runtime tests as needed

**Interfaces:**
- `ScopedRuntime` gains `computer: ScopedComputerService`.
- `ScopedRuntimeBase` gains the shared `computer: ComputerRuntime`.
- `createScopedRuntime()` never constructs a second `ComputerRuntime`; it wraps the shared one with `adminEnabled = authority.profile === "admin"`.
- `ScopedComputerService` methods mirror `ComputerRuntime` methods and enforce Admin before operation.

- [ ] **Step 1: Write failing policy tests**

Prove Project/User deny before fake runtime request and Admin succeeds:

```ts
await expect(project.computer.observe()).rejects.toMatchObject({ code: "POLICY_DENIED" });
expect(fakeRuntime.calls).toHaveLength(0);
await expect(admin.computer.observe()).resolves.toBeDefined();
```

Also assert only the base runtime owns one `ComputerRuntime` instance.

- [ ] **Step 2: Write failing audit-redaction tests**

Invoke `typeText`, `waitForText`, coordinate actions and failing native calls with canary values:

```text
SECRET_TYPED_CANARY
SECRET_WAIT_CANARY
NATIVE_STDERR_CANARY
REQUEST_ID_CANARY
LEASE_ID_CANARY
```

Read audit JSONL and assert none appear. Assert safe metadata such as action name, outcome, duration, errorCode and actionCount does appear.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- tests/computer-audit.test.ts tests/authority-mcp.test.ts
```

Expected: FAIL because scoped computer service/wiring does not exist.

- [ ] **Step 4: Implement explicit safe audit wrapper**

Do not call generic `AuditLogger.run()` for computer operations. Record success/error with `audit.record()` using constructed metadata only. On errors store `errorCode` from `AppError.code`, never `error.message`.

- [ ] **Step 5: Wire one shared runtime**

`createRuntimeServices()` creates exactly one `ComputerNativeSupervisor` and one `ComputerRuntime`. `createScopedRuntime()` only wraps it.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- tests/computer-audit.test.ts tests/authority-mcp.test.ts
```

Expected: GREEN.

- [ ] **Step 7: Commit**

```bash
git add src/scoped-computer-service.ts src/scoped-runtime.ts src/server.ts tests/computer-audit.test.ts tests/authority-mcp.test.ts
git commit -m "feat: enforce computer admin policy and audit"
```

---

### Task 8: Register strict MCP computer tools and structured/image outputs

**Files:**
- Create: `src/computer-tool-registration.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/server.ts`
- Create: `tests/computer-mcp.test.ts`
- Modify: `tests/http-transport.test.ts` if the catalog/annotation expectations enumerate all tools

**Interfaces:**
- `registerComputerTools(server: McpServer, runtime: ComputerToolRuntime): void`
- `computer_health` is no-lease.
- Every other tool input has `authorityLeaseId: z.string().min(40)` and `.strict()` object schemas.
- Direct catalog exactly matches spec; no direct mouse-down/up.

- [ ] **Step 1: Write failing catalog/schema tests**

Expected tool names:

```ts
[
  "computer_health",
  "computer_observe",
  "computer_screenshot",
  "computer_pointer_position",
  "computer_open_app",
  "computer_focus_app",
  "computer_move_mouse",
  "computer_click",
  "computer_drag",
  "computer_scroll",
  "computer_type_text",
  "computer_press_key",
  "computer_release_inputs",
  "computer_wait_for_frontmost",
  "computer_wait_for_text",
  "computer_wait_until_changed",
  "computer_run",
]
```

Assert `computer_mouse_down`, `computer_mouse_up`, `computer_run_js` are absent. Assert unknown input fields reject. Assert `computer_health` accepts `{}` with no lease.

- [ ] **Step 2: Write failing policy/error/output tests through real MCP client**

Prove:

```ts
expect(projectObserve.isError).toBe(true);
expect(adminObserve.structuredContent).toBeDefined();
expect(nativeFailure.isError).toBe(true);
expect(nativeFailure.structuredContent).toBeUndefined();
```

For screenshot, assert one `image/png` content item and structured metadata contains width/height but no base64 field.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- tests/computer-mcp.test.ts tests/http-transport.test.ts
```

Expected: FAIL because tools are not registered.

- [ ] **Step 4: Implement strict Zod input/output schemas**

Mirror native limits exactly where known. Build discriminated Zod schema for `ComputerAction` and top-level `computer_run`. Keep direct click `count: z.union([z.literal(1), z.literal(2)]).default(1)`.

Use read annotations for health/observe/screenshot/pointer/waits and mutation annotations for app/physical/run calls, while keeping actual policy in `ScopedComputerService`.

- [ ] **Step 5: Implement MCP result encoders**

Non-image success:

```ts
{
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
}
```

Tool error:

```ts
{
  content: [{ type: "text", text: JSON.stringify(errorPayload(error), null, 2) }],
  isError: true,
}
```

Screenshot success:

```ts
{
  content: [{ type: "image", data: screenshot.pngBase64, mimeType: "image/png" }],
  structuredContent: { width: screenshot.width, height: screenshot.height },
}
```

- [ ] **Step 6: Run focused + full Node checks**

```bash
npm test -- tests/computer-mcp.test.ts tests/http-transport.test.ts
npm run check
```

Expected: GREEN.

- [ ] **Step 7: Commit**

```bash
git add src/computer-tool-registration.ts src/tool-output-schemas.ts src/server.ts tests/computer-mcp.test.ts tests/http-transport.test.ts
git commit -m "feat: expose computer runtime MCP tools"
```

---

### Task 9: Add stable macOS computer bundle installer and tunnel readiness check

**Files:**
- Create: `scripts/setup-macos-computer-runtime.mjs`
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Modify: `package.json`
- Create: `tests/setup-macos-computer-runtime.test.ts`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`

**Interfaces:**
- Package script: `setup:computer:macos` invokes the new installer.
- Installer default destination: `~/.chatgpt-system/ChatGPTSystemComputerRuntime.app`.
- Stable identity selection priority: explicit valid identity; reusable installed signer; single unambiguous Apple Development/Developer ID identity; otherwise fail with guidance.
- Explicit development-only ad-hoc mode is opt-in and reports `tccIdentityStable: false`.
- Tunnel setup with `--enable-computer-use` validates installed helper contract before declaring readiness.

- [ ] **Step 1: Write failing deterministic installer-plan tests**

Export pure helpers so Linux/Node CI can test planning without invoking macOS:

```ts
expect(buildComputerInstallPlan({ homeDir: "/Users/test", identity: "Apple Development: Test" })).toMatchObject({
  destinationBundlePath: "/Users/test/.chatgpt-system/ChatGPTSystemComputerRuntime.app",
  bundleIdentifier: "com.senoldogann.chatgpt-system.computer-runtime",
  executableName: "chatgpt-system-computer-runtime",
  tccIdentityStable: true,
});
```

Test identity selection ambiguity and explicit ad-hoc behavior. Assert no silent `-` fallback.

- [ ] **Step 2: Write failing tunnel readiness tests**

When `--enable-computer-use` is requested and validation reports missing/bad bundle, setup doctor/validation must reject rather than print ready. Without the flag, existing tunnel setup remains unaffected.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- tests/setup-macos-computer-runtime.test.ts tests/setup-chatgpt-tunnel.test.ts
```

Expected: FAIL because installer/readiness validation does not exist.

- [ ] **Step 4: Implement pure identity/install planning**

Use fixed paths and identifiers. Discover valid signing identities via `/usr/bin/security find-identity -v -p codesigning` only on macOS runtime path. Accept an explicit identity only if present in the discovered valid set.

Stable install never silently selects `-`.

- [ ] **Step 5: Implement package/sign/verify/atomic replacement flow**

Flow:

```text
swift release build
-> package fixed bundle to temporary staging path
-> codesign with selected identity
-> codesign --verify --strict --deep
-> verify CFBundleIdentifier and executable
-> inspect designated requirement
-> verify installed/current signer compatibility when replacing
-> rename existing to rollback temp only within destination parent
-> rename new bundle into destination
-> reverify installed bundle
-> remove rollback copy after success
```

On failure after moving old bundle aside, restore it before throwing.

Do not invoke any `tccutil`, `CGRequest*`, or permission automation.

- [ ] **Step 6: Integrate tunnel setup and package script**

Add:

```json
"setup:computer:macos": "node scripts/setup-macos-computer-runtime.mjs"
```

`setup-chatgpt-tunnel.mjs` validates the fixed installed helper only when computer use is enabled.

- [ ] **Step 7: Run focused tests and macOS local installer dry/planning checks**

```bash
npm test -- tests/setup-macos-computer-runtime.test.ts tests/setup-chatgpt-tunnel.test.ts
node scripts/setup-macos-computer-runtime.mjs --help
```

On macOS additionally inspect current valid identities without changing the system:

```bash
security find-identity -v -p codesigning
```

Expected: tests GREEN; help exits 0; identity command is informational only.

- [ ] **Step 8: Commit**

```bash
git add scripts/setup-macos-computer-runtime.mjs scripts/setup-chatgpt-tunnel.mjs package.json tests/setup-macos-computer-runtime.test.ts tests/setup-chatgpt-tunnel.test.ts
git commit -m "feat: install stable computer runtime bundle"
```

---

### Task 10: Integrate shutdown, docs, CI contracts and perform serious local verification

**Files:**
- Modify: `src/runtime-shutdown.ts`
- Modify: `src/cli.ts`
- Modify: `tests/runtime-shutdown.test.ts`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `.github/workflows/ci.yml` only if an explicit new macOS contract step is required after inspecting current coverage
- Modify/add tests required by any docs/setup contract

**Interfaces:**
- Shutdown phase order becomes `computer -> processes -> browser -> control -> transport`.
- `ComputerNativeSupervisor.close()` rejects new calls, best-effort releases inputs through runtime/supervisor close path, closes stdin, waits boundedly, then terminates owned child if needed.
- Documentation accurately states Slice 3 capabilities and still-absent Slice 4/5 features.

- [ ] **Step 1: Write failing shutdown-order tests**

Extend `tests/runtime-shutdown.test.ts` to record phases:

```ts
expect(events).toEqual(["computer", "processes", "browser", "control", "transport"]);
```

Add a failure-in-computer-cleanup case proving later phases still run.

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- tests/runtime-shutdown.test.ts
```

Expected: FAIL because computer phase is absent.

- [ ] **Step 3: Implement shutdown wiring**

Extend `RuntimeShutdownPhase` with `"computer"`; invoke `runtime.computer.close()` before process supervisor/browser. Preserve best-effort phase isolation.

Update CLI fallback cleanup paths so no direct duplicate process/browser close skips computer cleanup.

- [ ] **Step 4: Run focused + full Node checks**

```bash
npm test -- tests/runtime-shutdown.test.ts
npm run check
```

Expected: GREEN.

- [ ] **Step 5: Update documentation and CI contract**

README/integration docs must document:

```text
--enable-computer-use
npm run setup:computer:macos
fixed bundle ID/path
lease-free computer_health
Admin-only remaining computer tools
computer_run typed fast path
stable signing recommendation + explicit ad-hoc development override
no computer_run_js / OCR / semantic recovery yet
```

Inspect `.github/workflows/ci.yml`. If current macOS job already runs full Swift tests, release build, helper package, strict codesign and protocol health, only add checks needed for the new health schema or installer contract. Do not add physical input to CI.

- [ ] **Step 6: Run complete local verification**

Use managed processes for long commands. Required fresh evidence:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
npm run test:computer:macos
npm run package:computer:macos
npm run package:computer-fixture:macos
codesign --verify --strict --deep native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app
codesign --verify --strict --deep native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app
git diff --check origin/main...HEAD
git diff --check
```

Privacy/scope guards:

```bash
rg -n "computer_run_js|enable-full-host-js|Vision|VNRecognize|OCR|ocr|recovery|Recovery" src native/macos-computer-runtime/Sources
rg -n "CGRequestListenEventAccess|CGRequestPostEventAccess|tccutil" src native/macos-computer-runtime/Sources scripts/setup-macos-computer-runtime.mjs
```

Expected: no prohibited implementation matches except documentation/non-goal strings intentionally outside production code.

- [ ] **Step 7: Perform real-Mac TypeScript/native fixture acceptance**

Use the deterministic fixture and the TypeScript runtime/client layer, not direct Swift-only calls, to prove:

```text
computer health
observe
screenshot
open/focus
move/click/double-click
scroll
drag
type/press
wait primitives
10+ step computer_run
mouse_down/up inside run with final release
intentional failed step stops without replay
outer timeout poisons/restarts helper
human mouse takeover
fixed emergency chord
```

Inspect audit canaries afterward and prove no typed/wait text, coordinates, native stderr, request IDs or lease IDs are present.

Do not restart the daily-driver tunnel merely for this local acceptance.

- [ ] **Step 8: Direct exact-diff review**

Review `origin/main...HEAD` for:

```text
one shared AuthorityManager/runtime
fixed helper path only
strict protocol/correlation/frame limits
Admin policy before native calls
no hidden app allowlist
no native error/stderr leakage
one physical lane
run final input cleanup
no automatic retry
safe audit metadata
stable signing default and explicit-only ad-hoc
shutdown ordering
no Slice 4/5 leakage
```

Resolve any Critical/Important finding with TDD before proceeding.

- [ ] **Step 9: Commit final integration/docs**

```bash
git add src/runtime-shutdown.ts src/cli.ts tests/runtime-shutdown.test.ts README.md docs/CHATGPT_INTEGRATION.md .github/workflows/ci.yml package.json
# omit any path above that has no change
git commit -m "ci: verify computer runtime TypeScript slice"
```

- [ ] **Step 10: Push, exact-head PR CI, squash merge and post-merge CI**

Push without force. Open PR:

```text
feat: add Computer Runtime v2 TypeScript and MCP integration
```

Record exact feature HEAD. Require exact-head PR CI:

```text
test (22) SUCCESS
test (24) SUCCESS
macos-native SUCCESS
```

Before merge re-read PR head and require it still equals reviewed SHA. Squash merge with exact-head guard. Fetch `origin/main`, record exact merge SHA, and require post-merge main CI on that same SHA:

```text
test (22) SUCCESS
test (24) SUCCESS
macos-native SUCCESS
```

Only then declare Slice 3 PASS. Do not begin Slice 4 until this gate is complete.
