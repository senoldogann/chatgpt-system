# Security policy

`chatgpt-system` intentionally exposes local capabilities to MCP clients. Treat it as a privileged local bridge, not as a generic public server.

## Security invariants

1. **Explicit session authority**: privileged filesystem, Git, and process calls require an active opaque authority lease. Leases expire, can be revoked immediately, and are stored internally only by hash.
2. **Fixed privilege ladder**: Project has project filesystem/Git access and no terminal; User has home filesystem/Git access and no terminal; Admin has host-wide scope under the current OS user and is the only terminal-capable profile.
3. **Local approval for broad authority**: User/Admin cannot be started directly. A short-lived request must be approved through native macOS LocalAuthentication before one lease can be minted.
4. **One-time approvals**: an approved native request is consumed exactly once and cannot mint a second lease.
5. **Protected native helper**: production native approval executes only from the fixed root-owned installation under `/Library/Application Support/chatgpt-system`, never from mutable repository build output. Ownership, type, permissions, and SHA-256 metadata are verified before each approval execution.
6. **Filesystem confinement**: filesystem requests are resolved against the active lease roots with symlink-target validation.
7. **No blind overwrite**: modifying or deleting an existing regular file requires its current SHA-256 from `fs_read` or `fs_stat`.
8. **Atomic replacement**: file writes use temporary sibling files plus rename to reduce partial-write risk.
9. **Bounded I/O**: file reads/writes, directory listings, native helper output, command output, and command duration have limits.
10. **Audit redaction**: authority/approval lifecycle records contain categorical metadata only. Raw lease IDs, request IDs, credentials, biometric material, file contents, and command output are not copied into authority audit metadata.
11. **Structured terminal execution**: Admin `terminal_run` uses `shell=false`, an executable basename allowlist, cwd checks, sanitized environment variables, timeouts, and output limits.
12. **HTTP authentication**: HTTP transport refuses to start without a bearer token and binds to loopback by default.
13. **Loopback request validation**: the localhost HTTP listener applies Host and Origin validation before routing requests.

## Why Project/User do not have terminal capability

A child process is not confined merely because its working directory is inside a lease root. An allowlisted executable such as Node, Python, a package manager, compiler, or build tool can exercise the OS account's permissions and open files outside that cwd.

Therefore Project/User authority does not expose `terminal_run`. Otherwise the filesystem scope would be cosmetic rather than a security boundary.

Admin is the only Phase-1 terminal-capable profile because the user has already locally authenticated for host-wide authority.

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

## Audit limitation

The audit log is for operator visibility and debugging. It is not tamper-proof against an actor that already has write access as the same OS user. Use a separately protected sink for evidentiary/compliance-grade audit requirements.

## HTTP / remote access

Do not expose the raw HTTP listener directly to the public internet. For OpenAI products on a developer Mac, prefer Secure MCP Tunnel with `chatgpt-system` as a local stdio child process. This keeps the MCP server off the public network and uses outbound connectivity from the tunnel client.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md).

## Reporting vulnerabilities

Please open a private GitHub security advisory. Avoid public issues containing exploit details, tokens, filesystem paths, or other sensitive material.
