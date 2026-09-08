# Security policy

`chatgpt-system` intentionally exposes local capabilities to MCP clients. Treat it as a privileged local bridge, not as a generic public server.

## Security invariants

1. **Explicit session authority**: privileged filesystem, Git, and process calls require an active opaque authority lease. Leases expire, can be revoked immediately, and are stored internally only by hash.
2. **Fixed privilege ladder**: Project has project filesystem/Git access and no terminal; User has home filesystem/Git access and no terminal; Admin has host-wide scope under the current OS user and is the only terminal-capable profile.
3. **Local creation of broad authority by default**: ChatGPT's default MCP catalog can create Project authority only. User/Admin authority is created from the Mac through `chatgpt-system authorize user|admin`, a private Unix control socket, and native LocalAuthentication unless the operator explicitly starts the runtime with `--personal-admin`.
4. **Shared authoritative runtime**: the CLI never creates a shadow `AuthorityManager`. The control socket talks to the same running process that serves MCP, so a locally created lease exists in exactly one authoritative in-memory lease store.
5. **Private local control plane**: the default control socket is `~/.chatgpt-system/control.sock`; its parent is `0700`, the socket is `0600`, frames are bounded/versioned JSON, only one request is accepted per connection, stale/live socket ownership is checked, and only `ping` plus `authorize(user|admin)` exist.
6. **No credential-shaped control input**: the local control protocol accepts no helper path, free-form authentication reason, shell command, password, sudo credential, API key, cookie, or biometric material. The lease capability itself is intentionally returned to the local CLI after successful authorization.
7. **Single-flight native approval**: only one User/Admin LocalAuthentication flow may be in flight. A concurrent request fails with `AUTHORIZATION_BUSY`.
8. **No orphan lease on disconnect**: if the local CLI disconnects after native approval but before successful lease delivery, the newly created lease is immediately revoked.
9. **Protected native helper**: production native approval executes only from the fixed root-owned installation under `/Library/Application Support/chatgpt-system`, never from mutable repository build output. Ownership, type, permissions, and SHA-256 metadata are verified before each approval execution.
10. **Filesystem confinement**: filesystem requests are resolved against the active lease roots with symlink-target validation.
11. **No blind overwrite**: modifying or deleting an existing regular file requires its current SHA-256 from `fs_read` or `fs_stat`.
12. **Atomic replacement**: file writes use temporary sibling files plus rename to reduce partial-write risk.
13. **Bounded I/O**: file reads/writes, directory listings, native helper output, control frames, command output, command duration, managed process count, and managed process log tails have limits.
14. **Audit redaction**: authority/approval/process lifecycle records contain categorical metadata only. Raw lease IDs, managed-process IDs, request IDs, credentials, biometric material, argument values, environments, file contents, and command/process output are not copied into audit metadata.
15. **Structured terminal execution**: Admin `terminal_run` uses `shell=false`, an executable basename allowlist, cwd checks, sanitized environment variables, timeouts, and output limits.
16. **Managed processes are authority-scoped**: `process_start`, `process_list`, `process_status`, `process_logs`, and `process_stop` require an active lease. Start requires terminal capability, which currently means Admin.
17. **No raw PID surface**: MCP never accepts or returns an OS PID, process-group ID, arbitrary signal, shell flag, detached flag, or caller-supplied child environment for managed processes.
18. **No process-registry oracle**: unknown and unauthorized managed-process IDs both return `PROCESS_NOT_FOUND`; lists filter records outside the current authority scope.
19. **Bounded lifecycle management**: managed children use bounded in-memory stdout/stderr tails and an in-memory registry. Running records are never evicted to make room.
20. **Graceful process-group cleanup**: on POSIX, managed children use their own process group. Stop/shutdown sends `SIGTERM`, waits the configured grace period, then escalates to `SIGKILL` internally if required.
21. **HTTP authentication**: HTTP transport refuses to start without a bearer token and binds to loopback by default.
22. **Loopback request validation**: the localhost HTTP listener applies Host and Origin validation before routing requests.
23. **Personal Admin is explicit**: `--personal-admin` is disabled by default. When enabled, MCP may mint the existing fixed Admin profile directly, but leases remain bounded/in-memory and terminal/process capability still depends on the separate runtime terminal gate.
24. **Daily-driver credential confinement**: the optional macOS LaunchAgent stores the Secure MCP Tunnel control-plane key in the login Keychain. The key is not placed in the plist, repository, audit log, runner logs, or spawned command argv.

## Why User/Admin creation is local

A model-mediated request to expand its own authority may be rejected by independent product safety controls before the MCP server receives it. More importantly, authority creation is a local trust decision and should not depend on whether a remote product chooses to forward an escalation-shaped tool call.

Therefore User/Admin creation begins on the physical Mac:

```text
chatgpt-system authorize user|admin
        |
        v
private Unix socket
        |
        v
same running MCP/tunnel runtime
        |
        v
protected macOS LocalAuthentication helper
        |
        v
expiring lease
```

The CLI copies the resulting lease to the clipboard by default using `/usr/bin/pbcopy` with `shell=false` and the lease on stdin. The lease is not placed in argv, environment variables, a temp file, or authority audit metadata. `--print-lease` is explicit diagnostic opt-in.

Independent ChatGPT/OpenAI product safety checks can still block a specific later action. That is not treated as a local authority bypass opportunity.

## Personal Admin exception

`--personal-admin` is an explicit private-workstation trust mode for the operator who does not want to approve and paste an Admin lease during every normal session. In this mode `session_authority_start(profile="admin")` is exposed directly to MCP. The request still maps to the fixed Admin profile in trusted code, receives the existing one-hour maximum TTL, stays only in memory, and is audited without the raw lease value.

Personal Admin does **not** imply terminal capability. If the daemon was not also started with `--enable-terminal`, the resulting Admin lease has host-wide filesystem scope but `terminalEnabled=false` and an empty command allowlist. This keeps the runtime terminal gate authoritative.

This mode materially increases the impact of a malicious or prompt-injected MCP request and should be enabled only on a private workstation controlled by the same user. The default local-approval path remains available and unchanged when the flag is absent.

## Daily-driver tunnel credential boundary

The optional macOS daily-driver service is a user LaunchAgent, not a root daemon. The one-time installer reads `CONTROL_PLANE_API_KEY` from the operator's current environment, builds the repository's small Swift Keychain helper, and sends the credential to that helper on stdin. The helper uses Apple's Security.framework (`SecItemUpdate`/`SecItemAdd`) so the credential is stored byte-for-byte without interactive TTY handling and is never placed in spawned argv.

At runtime the wrapper retrieves that fixed Keychain item and places the value only in the `tunnel-client` child environment. The LaunchAgent plist contains only absolute executable/script paths, profile name, and log path. Runner stdout/stderr logs are bounded tails and intentionally do not include the key or environment dump.

This key authenticates `tunnel-client` to the Secure MCP Tunnel control plane. It is not a model invocation credential used by `chatgpt-system`, and the bridge does not turn daily-driver startup into direct model API usage.

## Why Project/User do not have terminal capability

A child process is not confined merely because its working directory is inside a lease root. An allowlisted executable such as Node, Python, a package manager, compiler, or build tool can exercise the OS account's permissions and open files outside that cwd.

Therefore Project/User authority does not expose `terminal_run` or `process_start`. Otherwise the filesystem scope would be cosmetic rather than a security boundary.

Admin is the only terminal-capable profile because the user has already locally authenticated for host-wide authority.

## Admin is not root

LocalAuthentication proves local user presence. It does not grant UID 0.

An Admin lease still runs as the OS account that launched `chatgpt-system`. This phase does not provide:

- password piping;
- `sudo -S`;
- PAM modifications;
- passwordless sudo rules;
- reusable sudo credentials;
- a raw or persistent root shell.

Future root-only capabilities must be exposed as narrow typed operations behind an Apple-supported ServiceManagement/XPC privileged helper.

## Managed process boundary

The managed process subsystem is for long-lived development processes such as local servers. It is separate from one-shot `terminal_run`.

Public MCP tools:

```text
process_start
process_list
process_status
process_logs
process_stop
```

The daemon owns the real child handles and process-group identifiers. Callers receive only opaque random managed-process IDs.

A later Admin lease may manage a process created by an earlier Admin lease when command allowlist and cwd scope are still compatible. Revoking the original lease does not automatically terminate the child. This is deliberate so an operator can recover and stop a development server with a newly approved compatible lease.

Managed records and logs exist only in memory. Clean daemon shutdown attempts to stop every running managed process group. An abrupt daemon crash or `SIGKILL` can leave a detached child alive; the next daemon does **not** scan or kill arbitrary OS PIDs because it has no trustworthy ownership proof. There is no persistence guarantee across daemon restart.

Managed process execution is **not an operating-system sandbox**. The executable runs with the permissions of the OS user that launched `chatgpt-system`.

## Protected native helper boundary

The Swift LocalAuthentication helper is built in the repository but installed separately to:

```text
/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker
```

Its pinned hash metadata is stored at:

```text
/Library/Application Support/chatgpt-system/etc/authority-broker.sha256
```

The production broker rejects missing, symlinked, non-root-owned, group/other-writable, malformed, or hash-mismatched protected artifacts. Repository-local `.build/release` output is never trusted as the production approval executable.

The installer is intentionally separate from ChatGPT/MCP authority. It is human-run with explicit macOS administrator authorization and accepts no password or path override arguments.

## Control socket boundary

The local Unix socket is a capability-creation control plane, not a second MCP transport. It intentionally supports only a tiny protocol:

```text
ping
authorize user [bounded TTL]
authorize admin [bounded TTL]
```

The server owns the socket path. Existing regular files/symlinks are never unlinked as "stale" sockets. A compatible live socket is treated as in use. Only an owned stale socket may be removed before bind.

A client connection stays open while native approval runs. If the connection disappears before a success response can deliver the lease, the server revokes that lease rather than leaving an authority capability with no recipient.

## Filesystem race limitation

The filesystem policy protects against accidental or agent-driven root escape but is not a kernel-level linearizable compare-and-swap boundary.

Path validation and SHA-256 precondition checks can be raced by another hostile local process with permission to mutate the same tree. Atomic rename prevents partially written destination files; it does not make preceding validation/hash checks atomic against external writers.

For adversarial multi-process isolation, use a container, VM, or dedicated OS account and expose only the intended workspace.

## Terminal limitation

Admin process execution is **not an operating-system sandbox**. The command allowlist limits the requested top-level executable name, not what an interpreter/compiler/package manager may subsequently do with the Admin OS account's permissions.

If stronger process isolation is required, run the bridge inside a container, VM, sandbox, or dedicated account with only the required resources exposed.

## Git safety

Built-in Git tools are read-only. They disable repository hooks, filesystem monitors, external diff/textconv, pagers, and interactive credential prompts for exposed operations.

The bridge assumes its startup environment, including executable search paths, is trusted. An actor that can replace executables found through `PATH` already operates at or near the bridge process's OS authority.

## Future GUI and browser capabilities

Computer-use and browser diagnostics must preserve the same authority model rather than tunneling around it.

- GUI actions will be adapters over the existing separate `computer-use` system so its kill switch, credential blocking, human-presence detection, grants, and verification remain active;
- browser console/network diagnostics should use a browser automation/CDP boundary and must not become a cookie/token extraction channel;
- true root operations remain typed ServiceManagement/XPC operations, not a reusable root shell.

## Audit limitation

The audit log is for operator visibility and debugging. It is not tamper-proof against an actor that already has write access as the same OS user. Use a separately protected sink for evidentiary/compliance-grade audit requirements.

## HTTP / remote access

Do not expose the raw HTTP listener directly to the public internet. For OpenAI products on a developer Mac, prefer Secure MCP Tunnel with `chatgpt-system` as a local stdio child process. This keeps the MCP server off the public network and uses outbound connectivity from the tunnel client.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md).

## Reporting vulnerabilities

Please open a private GitHub security advisory. Avoid public issues containing exploit details, tokens, filesystem paths, or other sensitive material.
