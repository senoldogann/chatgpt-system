# Local Authority Broker Design

Date: 2026-09-07
Status: Approved refinement A
Branch: `feat/local-authority-broker`
Depends on: `feat/session-authority-profiles`

## 1. Problem

`Project Full Access` works end-to-end through the ChatGPT plugin, but ChatGPT Web and Desktop both block direct `session_authority_start({ profile: "user" })` before the local MCP server can create the lease. Plugin permission is already `Allow all actions`, so this is not a local plugin-permission misconfiguration.

The authority decision for broad User/Admin access must therefore move to the physical Mac. ChatGPT may request broad access, but it must not be able to grant that access to itself.

A second security issue appears once terminal execution is considered. Confining only the terminal working directory does not confine the child process. A Project-scoped `node`, `python3`, package manager, compiler, or similar executable can still access arbitrary files allowed to the OS user. Therefore Project/User filesystem scopes cannot safely coexist with unrestricted interpreter/process execution.

The native approval helper also cannot remain executable from a mutable repository build directory. If a Project lease includes the `chatgpt-system` repository, an agent could modify/rebuild that helper and fabricate an approval result. The runtime approval helper must therefore be installed outside project/user writable space and verified before use.

## 2. Goal

Add a local macOS authority broker that:

- keeps Project authority as the direct, narrow filesystem/Git path;
- requires native local user authentication before User or Admin authority becomes active;
- uses LocalAuthentication with `LAPolicy.deviceOwnerAuthentication`, which on macOS prefers Touch ID/Apple Watch where available and falls back to the user's password;
- never exposes credentials, biometric material, reusable authorization material, or helper stdout directly to ChatGPT;
- binds one local approval to one random request and consumes it once;
- makes terminal authority part of a strict privilege ladder instead of automatically enabling it for every lease;
- runs the native approval helper only from a protected root-owned installation path;
- keeps all existing lease expiry, path policy, SHA conflict, Git, audit, and revocation enforcement.

This phase authenticates the local user and gates creation of User/Admin leases. Actual root-only typed operations remain a separate privileged-helper step using Apple Service Management / XPC. This phase must not pretend that biometric authentication alone creates root authority.

## 3. Authority Privilege Ladder

The approved model is:

| Profile | Filesystem scope | Git | Terminal | Local approval | Root-only operations |
| --- | --- | --- | --- | --- | --- |
| `project` | explicit project root(s) | yes | **no** | no | no |
| `user` | canonical current-user home | yes | **no** | yes | no |
| `admin` | `/` host-wide scope under the current OS user | yes | **yes** | yes | no |

Rules:

- `project` is the default coding scope for normal file and Git work.
- `user` adds broad home-directory access, but does not add interpreter/process execution.
- `admin` is the only Phase-1 lease that enables `terminal_run`.
- `admin` still runs as the OS account that launched `chatgpt-system`; it is not UID 0.
- root-only operations are deferred to typed privileged helper APIs and must never be exposed as a raw passwordless root shell.

This ladder is intentionally monotonic: a broader capability requires a stronger local authorization boundary.

## 4. Architecture

```text
ChatGPT Web / Desktop
        |
        | Project: session_authority_start(project)
        | User/Admin: session_authority_request(...)
        v
chatgpt-system MCP
        |
        +---------------------------+
        |                           |
        | Project                   | User/Admin
        | direct narrow lease       | pending approval request
        | no terminal               v
        |                  LocalAuthorityBroker (Node)
        |                           |
        |                           | fixed executable, shell=false
        |                           v
        |              protected macOS helper installation
        |                           |
        |                           v
        |              LocalAuthentication (Swift)
        |                           |
        |              Touch ID / Apple Watch / password
        |                           |
        |                     approved / denied
        |                           |
        +---------------------------+
                                    v
                         AuthorityRequestManager
                                    |
                         one-time approved request
                                    v
                         AuthorityManager.start(...)
                                    |
                         User lease: no terminal
                         Admin lease: terminal enabled
```

No process-global authority is introduced.

## 5. Public MCP Contract

### `session_authority_start`

- `project` remains supported directly with explicit `projectRoots`.
- direct `user` and `admin` starts fail closed with `LOCAL_APPROVAL_REQUIRED` and instruct the client to use the local approval flow.

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
- stores it only in process memory, keyed internally by SHA-256;
- starts native local authentication asynchronously;
- returns immediately with `state: "pending"` and the request ID;
- accepts no free-form model-controlled prompt/reason text.

Approval request lifetime is always at most two minutes and is independent of the requested lease lifetime.

### `session_authority_request_status`

Input:

```json
{ "requestId": "..." }
```

Behavior:

- `pending`: returns no lease;
- `denied` / `cancelled` / `failed` / `expired`: returns a terminal state and no lease;
- the first successful `approved` status atomically consumes the approval, starts the requested User/Admin lease, and returns that lease once;
- subsequent status calls never mint another lease.

The returned lease is then used by existing filesystem/Git tools. `terminal_run` additionally requires the lease to have terminal capability, which in this phase means an Admin lease only.

## 6. Lease Capability Model

`AuthorityContext` must encode capabilities explicitly rather than assuming every lease has terminal access.

Required shape conceptually:

```ts
interface AuthorityContext {
  profile: "project" | "user" | "admin";
  roots: string[];
  terminalEnabled: boolean;
  commands: string[];
  createdAt: string;
  expiresAt: string;
}
```

Profile capability mapping is fixed by trusted local code:

```text
project -> terminalEnabled=false
user    -> terminalEnabled=false
admin   -> terminalEnabled=true
```

The MCP caller cannot override this mapping.

`terminal_run` must fail closed when the active lease has `terminalEnabled=false`, even when the command basename is otherwise allowlisted.

## 7. Native Helper

Source location:

```text
native/macos-authority-broker
```

Runtime installation location:

```text
/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker
```

The repository build output is never used directly by the production broker.

The Swift executable imports `Foundation` and `LocalAuthentication`.

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

## 8. Protected Helper Installation and Trust Checks

The helper is built from the repository, then installed by an explicit local setup step that requires native administrator authorization. The installed file must not be writable by the regular user account running ChatGPT or the MCP server.

Required installation properties:

- installation directory is root-owned;
- helper file is root-owned;
- helper is a regular file, not a symlink;
- group/other write bits are absent;
- user write permission is absent for the non-root runtime user;
- the broker executable path is fixed in trusted local configuration and cannot be supplied by MCP arguments;
- production runtime refuses User/Admin approval if the helper fails trust validation.

The implementation should additionally record or verify a trusted executable identity suitable for the current phase, such as a pinned SHA-256 generated at installation time and stored in a root-owned metadata file. The metadata itself must be protected by the same ownership/write rules. This avoids trusting only a path name.

Repository-local `.build/release/...` output is development/build input only.

## 9. Node Broker

`src/local-authority-broker.ts` owns native-helper execution.

Requirements:

- only available on `darwin` unless a test adapter is injected;
- executable path is fixed/configured by trusted local setup and cannot be supplied by the MCP caller;
- trust validation runs before helper execution;
- `spawn(..., { shell: false, stdio: ["ignore", "pipe", "pipe"] })`;
- bounded timeout and bounded stdout/stderr;
- sanitized environment;
- JSON schema validation of helper response;
- mismatched request ID/profile is a hard failure;
- helper stderr is not copied into model-visible output;
- no native result contains a lease ID.

## 10. Request State

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
- request TTL is fixed at two minutes maximum;
- requested lease TTL is stored separately and later clamped by the selected authority profile;
- approval can be consumed exactly once;
- server restart destroys all requests;
- request ID is never written to the normal audit log;
- audit records only profile, event, categorical state, and non-secret lifecycle metadata.

## 11. Errors

Stable codes:

- `LOCAL_APPROVAL_REQUIRED`
- `LOCAL_APPROVAL_UNAVAILABLE`
- `LOCAL_APPROVAL_DENIED`
- `LOCAL_APPROVAL_EXPIRED`
- `LOCAL_APPROVAL_INVALID`
- existing policy/authority errors for disabled terminal capability and expired/revoked leases.

All failures are fail-closed.

## 12. macOS Root Privilege Boundary

LocalAuthentication proves local user presence. It does not itself grant UID 0.

Machine Admin in this phase may issue the host-wide Admin lease after local authentication, and that Admin lease may use the existing allowlisted `terminal_run` as the current OS user. True root-only operations are not added here.

The next privileged-helper phase must use typed operations behind an Apple-supported Service Management/XPC helper. It must not add password piping, `sudo -S`, `sudo sh -c`, PAM edits, a permanently passwordless sudo rule, or a reusable raw root shell.

## 13. Testing

Automated tests must cover:

- profile capability mapping: Project/User terminal disabled, Admin terminal enabled;
- `terminal_run` rejected for Project/User even with an allowlisted command and in-scope cwd;
- Admin terminal remains allowlisted, cwd-confined, bounded, and `shell=false`;
- request lifecycle approve/deny/cancel/expire/consume-once/concurrency;
- MCP tests proving direct User/Admin start fails and request/status flow creates a lease only after local approval;
- approval request TTL separated from requested lease TTL;
- audit tests proving raw request IDs and native details are absent;
- native broker adapter response validation;
- trust validation rejects missing helper, symlink helper, wrong owner, writable helper/metadata, or hash mismatch;
- setup tests prove deterministic protected installation locations without embedding credentials;
- macOS CI builds the Swift package;
- Node 22 and 24 run the full TypeScript/MCP test suite.

Manual macOS acceptance:

1. install the native helper into the protected location and verify owner/mode/hash metadata;
2. restart the tunnel and refresh plugin descriptors;
3. start Project authority and prove `terminal_run` is rejected;
4. request User authority from ChatGPT;
5. verify native macOS authentication UI appears;
6. approve with Touch ID where available;
7. status produces one User lease;
8. read a benign file under the user's home;
9. prove `terminal_run` is rejected for User;
10. revoke User lease and verify reuse fails;
11. request Admin authority and approve locally;
12. verify Admin can read a benign host-wide system-readable path;
13. run one harmless allowlisted command with Admin;
14. revoke Admin lease;
15. cancel one approval request and verify no lease is created;
16. tamper with or replace a development build helper and prove production approval still uses only the protected installed helper.

## 14. Security Invariants

- ChatGPT cannot directly grant itself User/Admin authority.
- local user presence is required for every new User/Admin request.
- one local approval creates at most one lease.
- Project/User leases cannot execute terminal commands in this phase.
- Admin is the only Phase-1 terminal-capable profile.
- filesystem scope does not falsely claim to sandbox arbitrary child processes.
- the production native helper is outside project/user writable scope and its identity is validated before use.
- no raw authentication secret crosses MCP, logs, model-visible stdout, or environment variables.
- existing authority leases remain explicit, expiring, revocable, and referenced by opaque handles.
- Project authority remains usable even when the native broker is absent.
- root-only operations remain unavailable until the separate typed privileged-helper phase.

## 15. Non-Goals for This Phase

Not implemented here:

- arbitrary `shell_run` syntax;
- containers/VM-based process sandboxing;
- root shell access;
- sudo password automation;
- ServiceManagement/XPC root operations;
- computer-use screenshot/mouse/keyboard tools;
- autonomous developer-executor orchestration;
- launchd persistence.
