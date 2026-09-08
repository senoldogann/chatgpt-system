# Local Authority CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Mac owner create User/Admin authority outside ChatGPT through `chatgpt-system authorize user|admin`, while minting the lease inside the same running tunnel runtime that serves the MCP plugin.

**Architecture:** Add a private Unix-domain control plane owned by the running `chatgpt-system` process. The CLI becomes a client of that control socket, the control server reuses the existing protected macOS LocalAuthentication broker and `AuthorityManager`, and successful authorization returns one normal expiring lease to the CLI for clipboard transfer into ChatGPT. The public MCP surface keeps direct Project authority but stops advertising User/Admin self-elevation request tools.

**Tech Stack:** TypeScript/Node.js 22+, Node `net` Unix sockets, MCP SDK 2.x, Zod, Vitest, existing Swift LocalAuthentication helper, `pbcopy` on macOS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-local-authority-cli-design.md`

## Global Constraints

- Project authority remains direct through MCP and has filesystem/Git access with `terminalEnabled=false`.
- User authority is created only through the local control plane, scopes to the canonical current-user home, and has `terminalEnabled=false`.
- Admin authority is created only through the local control plane, scopes to `/` under the current OS user, and has `terminalEnabled=true`.
- User/Admin authorization requires fresh native LocalAuthentication through the existing protected root-owned, SHA-256-verified helper.
- The running tunnel-target process owns the authoritative in-memory `AuthorityManager`; the CLI must not create a shadow runtime.
- Default control socket is `~/.chatgpt-system/control.sock`.
- Control parent directory is `0700`; bound socket is `0600` where supported.
- Control transport is Unix-domain socket only, newline-delimited JSON, protocol version `1`, maximum frame size `65536` bytes.
- Only one native authorization may be in flight at a time; a second request fails with `AUTHORIZATION_BUSY`.
- The control protocol accepts only `ping` and `authorize(user|admin)`; it accepts no helper path, free-form LocalAuthentication reason, password, biometric material, sudo credential, or shell command.
- Default CLI success behavior copies the lease to the macOS clipboard and does not print the raw lease.
- `--print-lease` is explicit opt-in and never combines with clipboard copy.
- Raw leases are not written to disk or audit logs.
- ChatGPT's default MCP catalog no longer advertises `session_authority_request` or `session_authority_request_status`.
- The design does not bypass or weaken independent OpenAI product safety checks.
- Existing filesystem confinement, SHA conflict guards, Git safety, Admin terminal allowlist, `shell=false`, sanitized env, timeout/output limits, lease expiry/revocation, and audit redaction remain unchanged.

---

## File Structure

- `src/control-protocol.ts`: strict control request/response types, Zod schemas, frame encode/decode helpers, and stable control error codes.
- `src/control-server.ts`: Unix socket lifecycle, permissions, stale/live path checks, bounded framing, authorization single-flight, and shared-runtime lease minting.
- `src/control-client.ts`: one-request local Unix socket client used by CLI, with bounded response parsing and timeout.
- `src/cli.ts`: adds `authorize user|admin`, `--ttl`, `--print-lease`, starts the control server only for MCP server modes when explicitly enabled, and coordinates shutdown.
- `src/config.ts`: control-plane enable flag and deterministic socket path configuration for runtime/server modes.
- `src/server.ts`: removes User/Admin request tools from the default MCP catalog while preserving Project start/status/end and existing privileged tool behavior.
- `scripts/setup-chatgpt-tunnel.mjs`: adds `--enable-control` to the tunnel target command and prints the expected socket path.
- `tests/control-protocol.test.ts`: protocol shape/frame tests.
- `tests/control-server.test.ts`: Unix socket lifecycle, permissions, collision, authorization and shutdown tests.
- `tests/control-client.test.ts`: client request/timeout/malformed response tests.
- `tests/cli-authorize.test.ts`: CLI parsing and clipboard/printing behavior through injected client and process runner boundaries.
- Existing MCP/setup tests: regression coverage for Project authority and narrowed tool catalog.

---

### Task 1: Control Protocol and Stable Errors

**Files:**
- Create: `src/control-protocol.ts`
- Modify: `src/errors.ts`
- Test: `tests/control-protocol.test.ts`

**Interfaces:**
- Produces `CONTROL_PROTOCOL_VERSION = 1`.
- Produces `CONTROL_MAX_FRAME_BYTES = 65_536`.
- Produces `ControlRequest = PingControlRequest | AuthorizeControlRequest`.
- Produces `ControlResponse = ControlSuccessResponse | ControlErrorResponse`.
- Produces `parseControlRequest(line: string): ControlRequest`.
- Produces `parseControlResponse(line: string): ControlResponse`.
- Produces `encodeControlFrame(value: unknown): Buffer`.
- Adds stable `AppError` subclasses/codes `CONTROL_SOCKET_UNAVAILABLE`, `CONTROL_SOCKET_IN_USE`, `CONTROL_PROTOCOL_INVALID`, `AUTHORIZATION_BUSY`.

- [ ] **Step 1: Write failing protocol tests**

```ts
import { describe, expect, it } from "vitest";
import {
  CONTROL_MAX_FRAME_BYTES,
  parseControlRequest,
  parseControlResponse,
  encodeControlFrame,
} from "../src/control-protocol.js";

describe("control protocol", () => {
  it("accepts versioned ping and authorize requests only", () => {
    expect(parseControlRequest('{"version":1,"action":"ping"}')).toEqual({ version: 1, action: "ping" });
    expect(parseControlRequest('{"version":1,"action":"authorize","profile":"user","requestedTtlSeconds":3600}'))
      .toEqual({ version: 1, action: "authorize", profile: "user", requestedTtlSeconds: 3600 });
    expect(() => parseControlRequest('{"version":1,"action":"authorize","profile":"project"}')).toThrow();
    expect(() => parseControlRequest('{"version":1,"action":"authorize","profile":"admin","helperPath":"/tmp/x"}')).toThrow();
  });

  it("uses one newline-terminated bounded JSON frame", () => {
    expect(encodeControlFrame({ version: 1, action: "ping" }).toString("utf8")).toBe('{"version":1,"action":"ping"}\n');
    expect(() => encodeControlFrame({ value: "x".repeat(CONTROL_MAX_FRAME_BYTES) })).toThrow();
  });

  it("rejects malformed or unknown responses", () => {
    expect(parseControlResponse('{"version":1,"ok":true,"pong":true}')).toMatchObject({ ok: true, pong: true });
    expect(() => parseControlResponse('{"version":2,"ok":true,"pong":true}')).toThrow();
    expect(() => parseControlResponse('not-json')).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/control-protocol.test.ts
```

Expected: FAIL because `src/control-protocol.ts` does not exist.

- [ ] **Step 3: Add stable control errors**

Add to `src/errors.ts`:

```ts
export class ControlSocketUnavailableError extends AppError {
  constructor(message = "The local authority control socket is unavailable.", details?: Record<string, unknown>) {
    super(message, "CONTROL_SOCKET_UNAVAILABLE", details);
  }
}

export class ControlSocketInUseError extends AppError {
  constructor(message = "The local authority control socket is already in use.", details?: Record<string, unknown>) {
    super(message, "CONTROL_SOCKET_IN_USE", details);
  }
}

export class ControlProtocolInvalidError extends AppError {
  constructor(message = "The local authority control protocol message is invalid.", details?: Record<string, unknown>) {
    super(message, "CONTROL_PROTOCOL_INVALID", details);
  }
}

export class AuthorizationBusyError extends AppError {
  constructor(message = "Another local authority authorization is already in progress.") {
    super(message, "AUTHORIZATION_BUSY");
  }
}
```

- [ ] **Step 4: Implement strict protocol schemas and bounded framing**

Use Zod strict objects equivalent to:

```ts
export const CONTROL_PROTOCOL_VERSION = 1 as const;
export const CONTROL_MAX_FRAME_BYTES = 65_536;

const pingRequestSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  action: z.literal("ping"),
}).strict();

const authorizeRequestSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  action: z.literal("authorize"),
  profile: z.enum(["user", "admin"]),
  requestedTtlSeconds: z.number().int().positive().optional(),
}).strict();
```

Define response schemas for:

```ts
{ version: 1, ok: true, pong: true }
{ version: 1, ok: true, lease: AuthorityContext-with-leaseId }
{ version: 1, ok: false, error: string, message: string }
```

`encodeControlFrame()` must JSON-stringify, append exactly one `\n`, and reject frames whose encoded byte length exceeds `CONTROL_MAX_FRAME_BYTES`.

- [ ] **Step 5: Verify GREEN and regression suite**

```bash
npx vitest run tests/control-protocol.test.ts
npm run check
```

Expected: focused test PASS; existing suite remains green.

- [ ] **Step 6: Commit**

```bash
git add src/control-protocol.ts src/errors.ts tests/control-protocol.test.ts
git commit -m "feat: add local authority control protocol"
```

---

### Task 2: Unix Control Socket Lifecycle

**Files:**
- Create: `src/control-server.ts`
- Test: `tests/control-server.test.ts`

**Interfaces:**
- Consumes `ControlRequest`, `ControlResponse`, `CONTROL_MAX_FRAME_BYTES` from Task 1.
- Produces:

```ts
export interface ControlServerOptions {
  socketPath: string;
  runtime: RuntimeServices;
  currentUid?: number;
  fs?: ControlServerFs;
  createServer?: typeof import("node:net").createServer;
}

export interface ControlServerHandle {
  socketPath: string;
  close(): Promise<void>;
}

export async function startControlServer(options: ControlServerOptions): Promise<ControlServerHandle>;
```

- [ ] **Step 1: Write failing lifecycle tests**

Create tests that use a temporary directory and real Unix sockets on supported CI hosts:

```ts
it("creates a private socket and removes it on shutdown", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-"));
  const socketPath = path.join(base, "control.sock");
  const handle = await startControlServer({ socketPath, runtime });
  expect((await lstat(socketPath)).isSocket()).toBe(true);
  expect((await lstat(socketPath)).mode & 0o777).toBe(0o600);
  await handle.close();
  await expect(lstat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
});
```

Also cover:

```text
existing regular file -> CONTROL_SOCKET_IN_USE
existing symlink -> CONTROL_SOCKET_IN_USE
existing socket owned by unexpected uid -> CONTROL_SOCKET_IN_USE
live compatible socket responding to ping -> CONTROL_SOCKET_IN_USE
stale owned socket -> unlink then bind
request frame > 65536 bytes -> CONTROL_PROTOCOL_INVALID response then close
malformed JSON -> CONTROL_PROTOCOL_INVALID response
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/control-server.test.ts
```

Expected: FAIL because `startControlServer` is missing.

- [ ] **Step 3: Implement safe socket-path preparation**

In `src/control-server.ts`, before `listen()`:

```ts
const parent = path.dirname(socketPath);
await mkdir(parent, { recursive: true, mode: 0o700 });
await chmod(parent, 0o700);
```

Use `lstat(socketPath)` rather than `stat()` when a path exists. Reject symbolic links and non-sockets. For an existing socket owned by the current UID, attempt a bounded local `ping`; only unlink when the connection proves stale. Never unlink an existing regular file or symlink.

- [ ] **Step 4: Implement bounded newline framing**

For each accepted connection, accumulate bytes only until the first newline. If accumulated bytes exceed `CONTROL_MAX_FRAME_BYTES`, write one encoded error response and destroy the connection. Reject a second request frame on the same connection; this phase is one request per connection.

- [ ] **Step 5: Implement ping only and socket permissions**

For Task 2, `authorize` may return `CONTROL_PROTOCOL_INVALID` until Task 3. `ping` returns:

```json
{"version":1,"ok":true,"pong":true}
```

After `listen`, call `chmod(socketPath, 0o600)` and verify with `lstat` in tests.

- [ ] **Step 6: Implement orderly shutdown ownership check**

`close()` must close the `net.Server`, then `lstat` the socket path and unlink only if it is still a socket owned by the current UID. Do not unlink a replacement file created after shutdown began.

- [ ] **Step 7: Verify GREEN**

```bash
npx vitest run tests/control-server.test.ts
npm run check
```

- [ ] **Step 8: Commit**

```bash
git add src/control-server.ts tests/control-server.test.ts
git commit -m "feat: add private unix authority control socket"
```

---

### Task 3: Shared-Runtime User/Admin Authorization

**Files:**
- Modify: `src/control-server.ts`
- Test: `tests/control-server.test.ts`

**Interfaces:**
- Consumes existing `RuntimeServices.authority`, `RuntimeServices.authorityRequests`, `RuntimeServices.approvalBroker`.
- Produces one normal `AuthorityContext & { leaseId: string }` from an authenticated `authorize` control request.
- No new native approval implementation; reuse `MacOSLocalAuthorityBroker` and `AuthorityRequestManager`.

- [ ] **Step 1: Add failing authorization tests with a controlled fake broker**

Add cases equivalent to:

```ts
it("mints a non-terminal user lease only after local approval", async () => {
  const broker = new ControlledBroker("authenticated");
  const { runtime, socketPath, close } = await fixture({ approvalBroker: broker });
  const response = await sendControl(socketPath, {
    version: 1,
    action: "authorize",
    profile: "user",
    requestedTtlSeconds: 75,
  });
  expect(response).toMatchObject({
    ok: true,
    lease: { profile: "user", terminalEnabled: false, commands: [] },
  });
  expect(runtime.authority.resolve(response.lease.leaseId).profile).toBe("user");
  await close();
});
```

Also prove:

```text
Admin authenticated -> root `/`, terminalEnabled true, configured commands present
cancelled -> no lease
failed/unavailable -> no lease
second concurrent authorize while first broker call pending -> AUTHORIZATION_BUSY
requested User/Admin TTL still clamped by AuthorityManager profile limits
raw requestId and raw leaseId absent from audit file
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/control-server.test.ts -t "authorize"
```

Expected: FAIL because authorize is not implemented.

- [ ] **Step 3: Add a single-flight authorization guard**

Inside the control server keep only process-local state:

```ts
let authorizationInFlight = false;
```

On `authorize`, if true, return:

```json
{"version":1,"ok":false,"error":"AUTHORIZATION_BUSY","message":"Another local authority authorization is already in progress."}
```

Set/reset the flag with `try/finally` around the complete native approval flow.

- [ ] **Step 4: Implement the internal request/broker/lease flow**

Use this exact sequence:

```ts
const pending = runtime.authorityRequests.create({
  profile: request.profile,
  ...(request.requestedTtlSeconds !== undefined
    ? { requestedTtlSeconds: request.requestedTtlSeconds }
    : {}),
});
await runtime.authorityRequests.flushAudit();

const native = await runtime.approvalBroker.request({
  requestId: pending.requestId,
  profile: pending.profile,
});
```

Map `authenticated` to `approved`; denial/cancellation/failure must complete categorically and return an error response without calling `AuthorityManager.start()`.

On authentication:

```ts
runtime.authorityRequests.complete(pending.requestId, "approved");
const consumed = runtime.authorityRequests.consumeApproved(pending.requestId);
const lease = await runtime.authority.start({
  profile: consumed.profile,
  ...(consumed.requestedTtlSeconds !== undefined
    ? { requestedTtlSeconds: consumed.requestedTtlSeconds }
    : {}),
});
```

Return only safe lease metadata plus the lease ID to the local client. Flush request and authority audit chains before responding.

- [ ] **Step 5: Handle client disconnect before lease delivery**

Track whether the socket remains writable before returning the successful lease frame. If the client disconnects after native approval but before the success frame is written, immediately call:

```ts
runtime.authority.end(lease.leaseId)
```

and flush authority audit so no orphaned lease survives with no recipient.

- [ ] **Step 6: Verify GREEN and full suite**

```bash
npx vitest run tests/control-server.test.ts
npm run check
```

- [ ] **Step 7: Commit**

```bash
git add src/control-server.ts tests/control-server.test.ts
git commit -m "feat: mint user and admin leases through local control"
```

---

### Task 4: Local Control Client and `authorize` CLI

**Files:**
- Create: `src/control-client.ts`
- Modify: `src/cli.ts`
- Test: `tests/control-client.test.ts`
- Test: `tests/cli-authorize.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ControlClientOptions {
  socketPath: string;
  timeoutMs?: number;
}

export async function requestControl(
  request: ControlRequest,
  options: ControlClientOptions,
): Promise<ControlResponse>;
```

- CLI syntax:

```text
chatgpt-system authorize user [--ttl <seconds>] [--print-lease]
chatgpt-system authorize admin [--ttl <seconds>] [--print-lease]
```

- Default socket path: `~/.chatgpt-system/control.sock`.

- [ ] **Step 1: Write failing control-client tests**

Cover:

```text
connect -> send exactly one encoded frame -> parse exactly one bounded response
missing socket -> CONTROL_SOCKET_UNAVAILABLE
connect timeout -> CONTROL_SOCKET_UNAVAILABLE
malformed/oversized response -> CONTROL_PROTOCOL_INVALID
server error response is returned intact, not converted to success
```

Run:

```bash
npx vitest run tests/control-client.test.ts
```

Expected: module missing.

- [ ] **Step 2: Implement one-shot Unix socket client**

Use `net.createConnection(socketPath)`, `socket.setTimeout(timeoutMs ?? 5_000)`, `socket.end(encodeControlFrame(request))`, collect only one newline-terminated response, enforce `CONTROL_MAX_FRAME_BYTES`, and always destroy the socket on timeout/protocol failure.

- [ ] **Step 3: Write failing CLI parsing/clipboard tests**

Extract a testable command parser from `src/cli.ts` that distinguishes server mode from authorize mode. Cover:

```ts
parseArgs(["authorize", "user"])
parseArgs(["authorize", "admin", "--ttl", "1800"])
parseArgs(["authorize", "user", "--print-lease"])
```

Reject:

```text
authorize project
--ttl 0
--ttl non-integer
server-only flags mixed with authorize
unknown authorize flags
```

Inject `requestControl` and `copyLease` dependencies into a small exported `runAuthorizeCommand()` function for tests.

- [ ] **Step 4: Implement safe clipboard boundary**

Define:

```ts
export type ClipboardWriter = (value: string) => Promise<void>;
```

Default macOS implementation uses:

```ts
const child = spawn("pbcopy", [], {
  shell: false,
  stdio: ["pipe", "ignore", "ignore"],
  env: sanitizedMinimalEnv,
});
child.stdin.end(leaseId, "utf8");
```

Do not place the lease in argv, environment, temporary files, or a shell command string.

- [ ] **Step 5: Implement CLI success/error output**

Default success output must exclude the raw lease:

```text
User authority approved.
Expires: <ISO timestamp>
Terminal: disabled
Lease copied to clipboard.
```

Admin prints `Terminal: enabled`.

With `--print-lease`, print:

```text
<raw lease id>
```

and do not invoke `pbcopy`.

If control response is `{ ok:false }`, print only stable code + safe message and exit non-zero.

- [ ] **Step 6: Verify GREEN**

```bash
npx vitest run tests/control-client.test.ts tests/cli-authorize.test.ts
npm run check
```

- [ ] **Step 7: Commit**

```bash
git add src/control-client.ts src/cli.ts tests/control-client.test.ts tests/cli-authorize.test.ts
git commit -m "feat: add local authorize CLI"
```

---

### Task 5: Runtime Control-Server Wiring and Config

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli.ts`
- Test: `tests/config.test.ts` if present, otherwise create `tests/control-config.test.ts`
- Modify: `tests/cli-authorize.test.ts`

**Interfaces:**
- Extend `AppConfig` with:

```ts
control: {
  enabled: boolean;
  socketPath: string;
};
```

- Extend `ConfigOverrides` with `controlEnabled?: boolean` and `controlSocketPath?: string`.
- Add server flags:

```text
--enable-control
--control-socket <absolute-or-home-resolved-path>
```

- `authorize` client mode uses the same configured/default socket path but never starts MCP/runtime services.

- [ ] **Step 1: Write failing config and lifecycle tests**

Assert:

```text
control disabled by default
control socket defaults to ~/.chatgpt-system/control.sock
--enable-control enables it for stdio/http server mode
--control-socket without --enable-control is rejected in server mode
stdio server with control enabled starts MCP and control server over the same RuntimeServices object
SIGINT/SIGTERM closes control server before process exit
`authorize` does not call createRuntimeServices/startStdio/startHttp
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/control-config.test.ts tests/cli-authorize.test.ts
```

- [ ] **Step 3: Add config fields and environment support**

Add environment parsing for:

```text
CHATGPT_SYSTEM_ENABLE_CONTROL=true|false|1|0
CHATGPT_SYSTEM_CONTROL_SOCKET=/absolute/path
```

Default socket path:

```ts
path.join(homedir(), ".chatgpt-system", "control.sock")
```

- [ ] **Step 4: Start control server only once per MCP process**

After `createRuntimeServices(config)` and before serving stdio/http:

```ts
const control = config.control.enabled
  ? await startControlServer({ socketPath: config.control.socketPath, runtime })
  : undefined;
```

Shutdown order:

```text
stop accepting MCP work
close control server
close stdio/http transport
exit
```

Do not create a second runtime for the control server.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/control-config.test.ts tests/cli-authorize.test.ts
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/cli.ts tests/control-config.test.ts tests/cli-authorize.test.ts
git commit -m "feat: wire authority control into tunnel runtime"
```

---

### Task 6: Narrow the Default MCP Authority Surface

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/authority-approval-mcp.test.ts`
- Modify: `tests/http-transport.test.ts`
- Modify: `tests/authority-mcp.test.ts`

**Interfaces:**
- Public `session_authority_start` input schema becomes:

```ts
z.object({
  profile: z.literal("project"),
  projectRoots: z.array(z.string()).min(1),
  requestedTtlSeconds: z.number().int().positive().optional(),
})
```

- Remove registration of `session_authority_request` and `session_authority_request_status` from `createMcpServer()`.
- Keep internal `AuthorityRequestManager` and `LocalAuthorityBroker` in runtime services for the local control server.

- [ ] **Step 1: Write failing catalog regression tests**

In a real MCP handshake assert:

```ts
expect(toolNames).toContain("session_authority_start");
expect(toolNames).not.toContain("session_authority_request");
expect(toolNames).not.toContain("session_authority_request_status");
```

Also assert `session_authority_start` schema only allows literal `project`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/http-transport.test.ts tests/authority-approval-mcp.test.ts
```

Expected: current catalog still exposes request/status tools.

- [ ] **Step 3: Remove only the public registrations**

Delete the two `server.registerTool(...)` blocks for request/status and simplify `session_authority_start` to Project-only input. Do not delete the domain manager/broker used by the control server.

- [ ] **Step 4: Add regression proving locally minted leases still work with existing tools**

Use the control server fixture to mint a fake-approved User/Admin lease, then call existing MCP `session_authority_status`, `fs_read`, `terminal_run`, and `session_authority_end` using that lease ID. This proves the lease store is shared between local control and MCP.

Expected:

```text
User: status/read work inside home policy; terminal -> POLICY_DENIED
Admin: status + benign terminal -> success
ended locally minted lease -> AUTHORITY_REQUIRED
```

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/authority-mcp.test.ts tests/authority-approval-mcp.test.ts tests/http-transport.test.ts
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/authority-approval-mcp.test.ts tests/http-transport.test.ts tests/authority-mcp.test.ts
git commit -m "fix: remove broad authority requests from chatgpt tools"
```

---

### Task 7: Secure MCP Tunnel Setup Wiring

**Files:**
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- Tunnel target command must include `--enable-control` by default for the ChatGPT personal-plugin profile.
- Setup output prints the resolved control socket path but never a lease or credential.

- [ ] **Step 1: Write failing setup tests**

Assert `buildTunnelSetup()` produces an MCP command containing:

```text
stdio
--root <bootstrap-root>
--enable-control
```

and reports:

```text
Control socket: /Users/<user>/.chatgpt-system/control.sock
```

Assert setup serialization/output contains neither `CONTROL_PLANE_API_KEY` nor any `authorityLeaseId`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/setup-chatgpt-tunnel.test.ts
```

- [ ] **Step 3: Add tunnel control flag**

In `buildTunnelSetup`, append `--enable-control` to the local MCP command. Do not enable bootstrap terminal. The authority privilege ladder remains independent of bootstrap process configuration.

- [ ] **Step 4: Update runbook with the exact operator flow**

Document:

```bash
cd ~/chatgpt-system
git checkout feat/local-authority-cli
git pull --ff-only
npm install
npm run check
npm run build:broker:macos
sudo npm run install:broker:macos
```

Then:

```bash
tunnel-client run --profile chatgpt-system
```

And in a second terminal:

```bash
node dist/cli.js authorize user
node dist/cli.js authorize admin
```

Document that the default command copies the lease to the clipboard, the clipboard itself is a temporary exposure boundary, and `--print-lease` should be used only for diagnostics.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/setup-chatgpt-tunnel.test.ts
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add scripts/setup-chatgpt-tunnel.mjs tests/setup-chatgpt-tunnel.test.ts README.md docs/CHATGPT_INTEGRATION.md
git commit -m "docs: wire local authorize flow into chatgpt tunnel"
```

---

### Task 8: CI, Security Review, and Manual Web/Desktop Acceptance

**Files:**
- Modify only if required: `.github/workflows/ci.yml`
- Modify: `SECURITY.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- No new production interface beyond Tasks 1-7.
- Acceptance distinguishes local MCP errors from ChatGPT product safety blocks.

- [ ] **Step 1: Add/confirm CI coverage for Unix control tests**

Node 22 and Node 24 jobs must execute all new Vitest suites through `npm run check`. macOS native job remains responsible for Swift build + protected helper install verification. No Linux job attempts to run real LocalAuthentication.

- [ ] **Step 2: Run fresh exact-head automated verification**

Require:

```bash
npm run check
npm run build:broker:macos
```

and GitHub Actions:

```text
Node 22: success
Node 24: success
macos-native: success
ChatGPT tunnel setup smoke: success
```

- [ ] **Step 3: Review the full branch diff against the spec**

Explicitly search for and reject:

```text
TCP/HTTP control listener
world/group-writable socket
blind unlink of arbitrary existing socket path
multiple simultaneous native approvals
shadow AuthorityManager created by authorize CLI
MCP-advertised User/Admin request tools
lease written to disk/audit/env/argv
pbcopy through shell=true or shell command string
model-controlled helper path or LocalAuthentication reason
password/sudo credential handling
Project/User terminal re-enabled
```

- [ ] **Step 4: Update SECURITY.md**

Document the local control socket boundary, same-user threat-model limitation, clipboard lease exposure, shared-runtime requirement, single-flight native authentication, and that independent OpenAI safety checks may still block a requested action before MCP execution.

- [ ] **Step 5: Manual Mac acceptance, local side**

After pulling/building the final branch, restart the tunnel target and verify the socket:

```bash
ls -l ~/.chatgpt-system/control.sock
```

Expected socket mode equivalent to `srw-------`.

Run:

```bash
node dist/cli.js authorize user
```

Expected: Touch ID/native authentication appears, raw lease is not printed, metadata is printed, lease is copied to clipboard.

Repeat cancellation once and verify no lease is reported/copied.

- [ ] **Step 6: Manual ChatGPT Web User acceptance**

Paste the locally approved User lease into a fresh Web conversation and request only existing tool calls:

```text
@chatgpt-system-local kullan.
Bu authority lease Mac üzerinde yerel olarak onaylandı:
authorityLeaseId: <PASTE>

Yeni authority oluşturma veya authority request çağırma.
1. session_authority_status ile doğrula.
2. /Users/dogan/chatgpt-system/package.json dosyasını oku.
3. /etc/hosts okumayı dene.
4. terminal_run ile node --version çalıştırmayı dene.
5. lease'i kapat ve tekrar kullanımın reddedildiğini doğrula.
```

Expected local results when calls reach MCP:

```text
profile=user
terminalEnabled=false
package.json read=success
/etc/hosts=POLICY_DENIED
terminal_run=POLICY_DENIED
ended lease reuse=AUTHORITY_REQUIRED
```

Record `BLOCKED_BY_SAFETY_CHECKS` separately if ChatGPT blocks a call before MCP.

- [ ] **Step 7: Manual ChatGPT Web Admin acceptance**

Run locally:

```bash
node dist/cli.js authorize admin
```

Approve Touch ID, paste the lease into a fresh Web conversation, then verify:

```text
session_authority_status -> profile=admin, root=/, terminalEnabled=true
fs_read /etc/hosts -> success when platform allows the call to reach MCP
terminal_run node --version -> exitCode 0 when platform allows the call to reach MCP
terminal_run sh -c ... -> POLICY_DENIED
session_authority_end -> true
reuse -> AUTHORITY_REQUIRED
```

No destructive system operation is part of acceptance.

- [ ] **Step 8: Manual Desktop acceptance**

Use the same installed `chatgpt-system-local` plugin and a fresh locally approved User lease. Repeat only the benign User status/read/policy test. Do not create a second Desktop-specific authority implementation.

- [ ] **Step 9: Create stacked PR and integrate only after acceptance**

Open `feat/local-authority-cli` against `feat/local-authority-broker`. Keep it draft until local socket, Touch ID, Web User/Admin, and Desktop benign acceptance results are recorded. Merge dependency order remains:

```text
feat/session-authority-profiles
-> feat/local-authority-broker
-> feat/local-authority-cli
```

## Self-Review Results

- Spec coverage: control socket lifecycle, protocol, shared runtime, native approval reuse, single-flight behavior, CLI/clipboard, narrowed MCP catalog, tunnel setup, audit/security boundaries, Web/Desktop acceptance, and platform-safety distinction all map to explicit tasks.
- Placeholder scan: no TODO/TBD, generic “handle errors”, “write tests”, or undefined follow-up step remains.
- Type consistency: `ControlRequest`, `ControlResponse`, `requestControl`, `startControlServer`, `ControlServerHandle`, config fields, CLI command syntax, and stable error codes are defined before later tasks consume them.
- Scope check: root-only ServiceManagement/XPC operations, menu-bar UI, persistent leases, computer-use, and autonomous developer execution remain outside this plan exactly as required by the spec.
