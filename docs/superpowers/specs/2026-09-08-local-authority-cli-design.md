# Local Authority CLI and Control Socket Design

Date: 2026-09-08
Status: Proposed, awaiting written-spec approval
Branch: `feat/local-authority-cli`
Depends on: `feat/local-authority-broker`

## 1. Problem

The ChatGPT Web plugin path proves that direct Project authority works, filesystem/Git tools work, Project terminal capability is denied, lease revocation works, and the Secure MCP Tunnel is healthy.

However, ChatGPT Web and Desktop can block `session_authority_request({ profile: "user" })` before the call reaches the local MCP server. This is a platform safety decision outside `chatgpt-system`; changing plugin permissions does not make that call reliably available.

Therefore the system must not depend on ChatGPT asking for or granting its own broader authority.

The local Mac owner must create User/Admin authority outside the MCP conversation. ChatGPT should only receive an already-approved, expiring capability handle and use it with existing filesystem/Git/process tools.

This removes the self-elevation operation from the ChatGPT tool path. It does not claim to bypass independent platform safety checks for specific files or actions. Those remain an external product boundary and are measured separately in acceptance tests.

## 2. Goal

Add a local authorization CLI that talks to the already-running `chatgpt-system` runtime through a private Unix domain control socket.

Target operator flow:

```text
Mac Terminal
    |
    | chatgpt-system authorize user
    v
local control socket
    |
    v
running chatgpt-system runtime
    |
    v
protected native authority broker
    |
    v
macOS LocalAuthentication / Touch ID
    |
    v
AuthorityManager.start(user)
    |
    v
opaque expiring lease
    |
    v
Mac clipboard
    |
    v
ChatGPT uses the already-approved lease
```

For Admin the same flow creates an Admin lease after native authentication.

Project authority remains direct through MCP because that path already works and is intentionally narrow.

## 3. Authority Model

The privilege ladder remains:

| Profile | Creation path | Filesystem scope | Git | Terminal | Native approval |
| --- | --- | --- | --- | --- | --- |
| `project` | MCP `session_authority_start` | explicit project roots | yes | no | no |
| `user` | local CLI only | canonical current-user home | yes | no | yes |
| `admin` | local CLI only | `/` under current OS account | yes | yes | yes |

Rules:

- ChatGPT cannot create User/Admin authority.
- User/Admin creation is initiated from a local process outside MCP.
- every User/Admin authorization invokes the existing protected native broker and requires fresh local authentication;
- a local authorization produces one normal `AuthorityManager` lease with the same TTL/revocation rules already used by MCP;
- server restart destroys the lease;
- no process-global "trusted" switch is added;
- Admin is still not UID 0 and does not create a root shell.

## 4. Public MCP Surface

The default ChatGPT MCP surface should no longer advertise User/Admin self-elevation tools.

### Keep

- `session_authority_start`, narrowed to direct Project authority only;
- `session_authority_status`;
- `session_authority_end`;
- existing filesystem/Git/process tools that consume `authorityLeaseId`.

### Remove from the default ChatGPT tool catalog

- `session_authority_request`;
- `session_authority_request_status`.

The domain code (`AuthorityRequestManager`, native broker, trust validator) may remain reusable internally, but ChatGPT should not need or be encouraged to invoke a broad-authority request tool that the product can block before local execution.

`session_authority_start` should expose `profile: "project"` rather than a public `project|user|admin` enum followed by a local rejection.

## 5. Local Control Server

The running tunnel-target process owns the authoritative in-memory `AuthorityManager`. A second CLI process cannot mint a useful lease in its own memory, so local authorization must be delegated to that running process.

Add a small Unix-domain control server sharing the same `RuntimeServices` instance as MCP.

Default socket:

```text
~/.chatgpt-system/control.sock
```

The control server is **opt-in** at server startup rather than automatically enabled for every stdio/HTTP runtime. The ChatGPT Secure MCP Tunnel setup enables it explicitly. This avoids collisions with unrelated local Codex/test/server instances.

Startup behavior:

1. create `~/.chatgpt-system` with mode `0700` where possible;
2. inspect an existing socket path with `lstat`;
3. if a live compatible control server answers `ping`, fail startup with `CONTROL_SOCKET_IN_USE` rather than hijacking it;
4. if the path is a stale socket owned by the current UID, unlink it and bind;
5. reject regular files, symlinks, unexpected ownership, or other path types;
6. bind the Unix socket;
7. chmod the socket `0600`;
8. unlink the owned socket on orderly shutdown.

A hostile process already running as the same macOS user remains outside the hard security boundary, consistent with the repository's existing same-user threat-model limitation. The socket nevertheless prevents access from other local OS users.

## 6. Control Protocol

Use bounded newline-delimited JSON over the Unix socket. Do not add HTTP, TCP, or a public network listener.

Maximum request/response frame size: 64 KiB.

Supported requests in this phase:

```json
{"version":1,"action":"ping"}
```

```json
{"version":1,"action":"authorize","profile":"user","requestedTtlSeconds":3600}
```

```json
{"version":1,"action":"authorize","profile":"admin","requestedTtlSeconds":1800}
```

Responses are strict JSON objects with a stable version and categorical error code.

Successful authorization returns:

```json
{
  "version": 1,
  "ok": true,
  "lease": {
    "leaseId": "<opaque>",
    "profile": "user",
    "roots": ["/Users/..."],
    "terminalEnabled": false,
    "createdAt": "...",
    "expiresAt": "..."
  }
}
```

The lease is intentionally transmitted over this local mode-`0600` socket to the local CLI. Native authentication secrets are not.

The server never accepts:

- arbitrary executable paths;
- free-form LocalAuthentication reason text;
- passwords;
- Touch ID/biometric data;
- reusable LocalAuthentication/authorization material;
- sudo credentials;
- arbitrary shell commands through the control protocol.

Only one native authorization may be in flight at a time. Concurrent `authorize` requests fail with `AUTHORIZATION_BUSY` rather than creating multiple overlapping Touch ID prompts.

## 7. Internal Authorization Flow

For an `authorize` request:

1. validate control protocol shape and profile;
2. create an internal short-lived authority request using `AuthorityRequestManager`;
3. invoke the existing `MacOSLocalAuthorityBroker`;
4. the broker validates the protected root-owned helper immediately before spawn;
5. macOS LocalAuthentication performs local user authentication;
6. denied/cancelled/unavailable/failed outcomes never create a lease;
7. authenticated outcome completes and consumes the internal request once;
8. start the normal User/Admin lease using `AuthorityManager.start`;
9. return the lease to the local CLI;
10. audit categorical lifecycle metadata without raw request/lease IDs.

This keeps one implementation of native approval semantics instead of creating a second independent Touch ID path.

## 8. CLI Contract

Extend the existing CLI with a client-only command:

```text
chatgpt-system authorize user
chatgpt-system authorize admin
```

Optional TTL:

```text
chatgpt-system authorize user --ttl 3600
```

When running directly from the repository during development, the equivalent is:

```text
node dist/cli.js authorize user
```

The CLI does **not** create a second runtime. It connects to the existing control socket and asks that runtime to authorize.

Default success behavior:

```text
User authority approved.
Expires: 2026-09-08T04:00:00.000Z
Terminal: disabled
Lease copied to clipboard.
```

The raw lease ID is not printed by default.

On macOS, copy the exact lease ID to the clipboard using `pbcopy` with `shell=false` and stdin. No shell command string is constructed.

For diagnostic/automation use, an explicit `--print-lease` option may print the lease to stdout instead of copying it. It must be opt-in and documented as exposing the capability to terminal logs/capture.

The CLI must never write a lease to disk.

## 9. ChatGPT Usage

After local authorization, the user pastes the lease into the ChatGPT conversation once.

Recommended first User acceptance prompt:

```text
@chatgpt-system-local kullan.

Bu lease Mac üzerinde kullanıcı tarafından önceden onaylandı.
authorityLeaseId: <PASTE>

Bu lease ile yalnızca:
1. /Users/dogan/chatgpt-system/package.json dosyasını fs_read ile oku.
2. /etc/hosts okumayı dene.
3. terminal_run ile node --version çalıştırmayı dene.

Yeni authority oluşturma veya authority request çağırma.
```

Expected local-policy behavior:

- package.json succeeds;
- `/etc/hosts` returns `POLICY_DENIED` for User;
- `terminal_run` returns `POLICY_DENIED` for User.

Admin acceptance uses an independently authorized Admin lease and verifies `/etc/hosts` plus a harmless allowlisted `node --version`.

The user-provided lease is intentionally visible to the ChatGPT conversation because it is the capability used for that workflow. Its risk is bounded by expiry, local profile capability, explicit revocation, and server-restart invalidation.

## 10. Platform Safety Boundary

This design solves one observed failure mode: ChatGPT does not need to invoke an MCP action that asks to elevate itself to User/Admin authority.

It does **not** promise that ChatGPT will execute every subsequent filesystem/process call. OpenAI may independently block an action based on product safety policy, path sensitivity, context, or tool classification before it reaches the MCP server.

Acceptance must distinguish:

```text
local MCP result: POLICY_DENIED / AUTHORITY_REQUIRED / success
```

from:

```text
platform result: BLOCKED_BY_SAFETY_CHECKS (or equivalent)
```

A platform block is not treated as a local authorization bug.

If benign User/Admin calls are still systematically blocked even with a pre-approved lease, this architecture remains locally correct but the personal ChatGPT Plugin cannot provide the desired broad capability in that product surface. The fallback would then be a non-ChatGPT planner/executor channel, not an attempt to bypass platform safety controls.

## 11. Security Properties

- ChatGPT cannot invoke the local `authorize` CLI through Project/User authority because those profiles have no terminal capability.
- An Admin lease can execute commands, but obtaining that Admin lease already required local authentication.
- The control server is local Unix-socket-only and mode `0600`.
- Native approval still executes only the protected root-owned, hash-verified helper.
- Passwords, Touch ID/biometric data, native LocalAuthentication internals, sudo credentials, and reusable native authorization material never cross MCP, the control protocol, audit logs, or environment variables.
- The opaque authority lease intentionally crosses the local control socket and later the ChatGPT conversation because it is the workflow capability handle.
- Raw leases are never stored on disk by the CLI/runtime.
- Clipboard contains the lease after authorization until replaced by the user/system; documentation must state this explicitly.
- Leases remain opaque, expiring, revocable, and invalid after runtime restart.
- Existing filesystem symlink checks, SHA guards, Git safety, terminal allowlist, `shell=false`, sanitized env, timeout and output limits remain unchanged.

## 12. Failure Behavior

Stable local control errors should include:

- `CONTROL_SOCKET_UNAVAILABLE`;
- `CONTROL_SOCKET_IN_USE`;
- `CONTROL_PROTOCOL_INVALID`;
- `AUTHORIZATION_BUSY`;
- existing `LOCAL_APPROVAL_UNAVAILABLE`;
- existing `LOCAL_APPROVAL_DENIED` / categorical cancellation handling;
- existing authority errors after lease creation.

Rules:

- missing tunnel runtime: CLI fails without starting a shadow runtime;
- stale/untrusted socket path: fail closed unless it is provably an owned stale socket;
- Touch ID cancellation: no lease;
- helper trust failure: no lease;
- control disconnect during approval: if no lease has been created, do not create one for an absent client; if creation races the disconnect, revoke/discard it immediately;
- runtime shutdown: close control server and invalidate all leases with process state.

## 13. Testing

Automated tests must cover:

### Control server

- `0700` parent / `0600` socket permissions where supported;
- stale owned socket cleanup;
- live socket collision rejection;
- symlink/regular-file/unexpected-owner rejection;
- bounded frames and malformed JSON;
- `ping`;
- one authorization in flight;
- disconnect handling;
- shutdown cleanup.

### Authorization

- User Touch-ID-approved fake broker -> User lease, terminal disabled;
- Admin approved fake broker -> Admin lease, terminal enabled;
- cancellation/denial/failure -> no lease;
- TTL clamping remains profile-specific;
- raw request/lease IDs absent from audit;
- no control request can choose helper path or reason text.

### CLI

- connects to existing socket rather than creating runtime;
- user/admin parsing and TTL validation;
- `pbcopy` invoked with `shell=false` and lease on stdin;
- raw lease not printed by default;
- `--print-lease` is explicit;
- server unavailable produces a stable local error.

### MCP regression

- Project start still works through Web;
- Project terminal remains `POLICY_DENIED`;
- public MCP catalog no longer advertises User/Admin approval-request tools;
- externally/local-created User/Admin lease works with existing status/end/fs/git/process policy code.

## 14. Manual macOS Acceptance

1. update/build/install the branch;
2. restart the tunnel target with the control server enabled;
3. Refresh the ChatGPT plugin;
4. verify Project acceptance remains green;
5. run `chatgpt-system authorize user` locally;
6. verify native Touch ID UI appears;
7. verify CLI reports User metadata and copies the lease without printing it;
8. paste lease into ChatGPT Web and perform benign User read/policy checks without calling authority-request tools;
9. revoke the User lease through MCP and verify reuse fails;
10. run `chatgpt-system authorize admin` locally;
11. approve Touch ID;
12. paste Admin lease and test `/etc/hosts`, `node --version`, and non-allowlisted shell rejection;
13. cancel one native authorization and verify no lease is produced;
14. repeat the benign User test in ChatGPT Desktop using the same installed plugin;
15. record whether any call is blocked by product safety separately from local MCP results.

## 15. Delivery Structure

Implement on `feat/local-authority-cli`, stacked on `feat/local-authority-broker`.

Suggested implementation phases:

1. control protocol and Unix socket lifecycle;
2. shared-runtime authorization endpoint;
3. CLI authorize client + clipboard handling;
4. narrow MCP public authority surface;
5. tunnel setup wiring;
6. tests/docs/manual Web/Desktop acceptance.

PR #7 remains the protected native broker foundation. This branch should be reviewed and integrated only after PR #7 and after manual acceptance proves the local CLI can create a lease in the same running tunnel runtime.

## 16. Non-Goals

Not implemented here:

- bypassing ChatGPT/OpenAI product safety controls;
- process-global active authority with no lease handle;
- automatic conversation identification;
- a menu-bar GUI;
- persistent leases across runtime restart;
- storing leases in Keychain or files;
- root/UID-0 operations;
- arbitrary `sudo` or shell language;
- computer-use integration;
- autonomous developer executor.
