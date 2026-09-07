# Local Authority Broker Design

Date: 2026-09-07
Status: Approved refinement
Branch: `feat/local-authority-broker`
Depends on: `feat/session-authority-profiles`

## 1. Problem

`Project Full Access` works end-to-end through the ChatGPT plugin, but ChatGPT Web and Desktop both block direct `session_authority_start({ profile: "user" })` before the local MCP server can create the lease. Plugin permission is already `Allow all actions`, so this is not a local plugin-permission misconfiguration.

The authority decision for broad User/Admin access must therefore move to the physical Mac. ChatGPT may request broad access, but it must not be able to grant that access to itself.

## 2. Goal

Add a local macOS authority broker that:

- keeps Project authority as the current direct lease path;
- requires native local user authentication before User or Admin authority becomes active;
- uses LocalAuthentication with `LAPolicy.deviceOwnerAuthentication`, which on macOS prefers Touch ID/Apple Watch where available and falls back to the user's password;
- never exposes credentials, biometric material, reusable authorization material, or helper stdout directly to ChatGPT;
- binds one local approval to one random request and consumes it once;
- keeps all existing lease expiry, scope, path-policy, SHA conflict, terminal, and audit enforcement.

This phase authenticates the local user and gates creation of User/Admin leases. Actual root-only typed operations remain a separate privileged-helper step using Apple Service Management / XPC; this phase must not pretend that biometric authentication alone creates root authority.

## 3. Architecture

```text
ChatGPT Web / Desktop
        |
        | session_authority_request(user|admin)
        v
chatgpt-system MCP
        |
        | create opaque pending request
        v
LocalAuthorityBroker (Node)
        |
        | spawn fixed native helper, shell=false
        v
macOS LocalAuthentication helper (Swift)
        |
        | Touch ID / Apple Watch / password fallback
        v
approved / denied only
        |
        v
AuthorityRequestManager
        |
        | one-time approved request
        v
AuthorityManager.start(...)
        |
        v
normal expiring authority lease
```

No process-global authority is introduced.

## 4. Public MCP Contract

### `session_authority_start`

- `project` remains supported directly with explicit `projectRoots`.
- `user` and `admin` direct start fails closed with `LOCAL_APPROVAL_REQUIRED` and instructs the client to use the local approval flow.

### `session_authority_request`

Input:

```json
{
  "profile": "user" | "admin",
  "requestedTtlSeconds": 3600
}
```

Behavior:

- creates a cryptographically random request ID;
- stores it only in process memory;
- starts native local authentication asynchronously;
- returns immediately with `state: "pending"` and the request ID;
- accepts no free-form model-controlled prompt/reason text.

### `session_authority_request_status`

Input:

```json
{ "requestId": "..." }
```

Behavior:

- `pending`: returns no lease;
- `denied`/`cancelled`/`expired`: returns a terminal state and no lease;
- first successful `approved` status atomically consumes the approval, starts the requested User/Admin lease, and returns the lease once;
- subsequent status calls return `consumed` and never mint another lease.

The returned lease is then used by existing filesystem/Git/terminal tools exactly as in Phase 1A.

## 5. Native Helper

Location: `native/macos-authority-broker`.

A small Swift executable imports `Foundation` and `LocalAuthentication`.

Accepted arguments are strictly:

- `--profile user|admin`
- `--request-id <opaque-id>`

The localized reason is selected from fixed source-code strings, not passed from ChatGPT.

The helper writes one JSON object to stdout with only:

```json
{
  "requestId": "...",
  "profile": "user",
  "approved": true,
  "outcome": "authenticated"
}
```

On cancellation/failure it emits a safe categorical outcome. It never returns password, biometric data, LocalAuthentication internals, or reusable credentials.

## 6. Node Broker

`src/local-authority-broker.ts` owns native-helper execution.

Requirements:

- only available on `darwin` unless a test adapter is injected;
- executable path is explicit/configured and cannot be supplied by the MCP caller;
- `spawn(..., { shell: false, stdio: ["ignore", "pipe", "pipe"] })`;
- bounded timeout and bounded stdout/stderr;
- sanitized environment;
- JSON schema validation of helper response;
- mismatched request ID/profile is a hard failure;
- helper stderr is not copied into model-visible output;
- no native result contains a lease ID.

## 7. Request State

`src/authority-request-manager.ts` stores pending requests in memory.

States:

- `pending`
- `approved`
- `denied`
- `cancelled`
- `failed`
- `expired`
- `consumed`

Rules:

- request IDs use at least 32 random bytes encoded base64url;
- request TTL: 2 minutes maximum;
- approval can be consumed exactly once;
- server restart destroys all requests;
- request ID is never written to the normal audit log;
- audit records only profile, event, categorical outcome, and request scope metadata.

## 8. Errors

Add stable codes:

- `LOCAL_APPROVAL_REQUIRED`
- `LOCAL_APPROVAL_UNAVAILABLE`
- `LOCAL_APPROVAL_DENIED`
- `LOCAL_APPROVAL_EXPIRED`
- `LOCAL_APPROVAL_INVALID`

All failures are fail-closed.

## 9. macOS Root Privilege Boundary

LocalAuthentication proves local user presence. It does not itself grant UID 0.

Machine Admin in this phase may issue the existing host-wide admin lease after local authentication, but true root-only operations are not added here. The next privileged-helper phase must use typed operations behind an Apple-supported Service Management/XPC helper. It must not add password piping, `sudo -S`, `sudo sh -c`, PAM edits, or a permanently passwordless root shell.

## 10. Testing

CI:

- Node 22 and 24 unit/integration tests use an injected fake native broker.
- request lifecycle tests cover approve/deny/cancel/expire/consume-once/concurrency.
- MCP tests prove direct User/Admin start fails and request/status flow creates a lease only after approval.
- audit tests prove request IDs and native details are absent.
- macOS CI builds the Swift package.

Manual macOS acceptance:

1. request User authority from ChatGPT;
2. verify native macOS authentication UI appears;
3. approve with Touch ID where available;
4. status produces one User lease;
5. use the lease to read a benign file under the user's home;
6. end the lease and verify reuse fails;
7. repeat Admin approval and verify host-wide readable-path access that does not require root;
8. cancel one request and verify no lease is created.

## 11. Security Invariants

- ChatGPT cannot directly grant itself User/Admin authority.
- local user presence is required for every new User/Admin request.
- one local approval creates at most one lease.
- no raw authentication secret crosses MCP, logs, stdout exposed to ChatGPT, or environment variables.
- existing authority leases remain explicit, expiring, revocable, and session-scoped by opaque handle.
- Project authority remains usable even when the native broker is absent.
