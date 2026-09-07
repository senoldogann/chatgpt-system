# chatgpt-system

Secure local MCP authority gateway for controlled filesystem, Git, and process access from ChatGPT-compatible MCP clients.

The project deliberately does not turn an LLM into a permanently privileged shell. Authority is explicit, scoped, expiring, revocable, auditable, and enforced on the local machine.

## Status

Current foundation:

- MCP TypeScript SDK v2 / 2026-07-28 protocol support
- stdio and Streamable HTTP transports
- personal ChatGPT Plugin path through OpenAI Secure MCP Tunnel
- per-workflow Project / User / Admin authority
- native macOS approval for User/Admin via LocalAuthentication
- Touch ID / Apple Watch / password fallback handled entirely by macOS
- one-time approval requests and expiring opaque authority leases
- protected root-owned native approval helper with pinned SHA-256 metadata
- filesystem confinement with symlink-escape protection
- SHA-256 optimistic locking for destructive file changes
- atomic file replacement and unified-diff patching
- Git status/diff/log tools
- Admin-only allowlisted process execution with `shell=false`
- JSONL audit trail with redacted authority lifecycle metadata
- localhost Host/Origin validation for HTTP mode
- real MCP client integration coverage
- Node 22 / Node 24 CI plus native macOS build/install verification

## Requirements

- Node.js 22 or newer
- npm
- Git
- macOS + Swift/Xcode command-line tools for native User/Admin approval
- `tunnel-client` when using the personal ChatGPT Plugin route

## Install

```bash
git clone https://github.com/senoldogann/chatgpt-system.git
cd chatgpt-system
npm install
npm run check
```

For development:

```bash
npm run dev -- stdio --root /absolute/path/to/project
```

## Personal ChatGPT Plugin

For a personal ChatGPT Developer Mode plugin, use OpenAI Secure MCP Tunnel so the Mac does not expose a public inbound MCP port.

Create the tunnel in OpenAI Platform, then configure the local profile:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-test-project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --doctor
```

Keep the tunnel running while ChatGPT uses the plugin:

```bash
tunnel-client run --profile chatgpt-system
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend afterwards.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md) for the full runbook.

## Authority privilege ladder

Every privileged filesystem/Git/process call carries an opaque `authorityLeaseId`. The capability mapping is fixed by local trusted code and cannot be overridden by MCP input.

| Profile | Scope | Maximum lease | Terminal | Local Mac approval |
| --- | --- | ---: | --- | --- |
| `project` | Explicit project root(s) | 8 hours | **No** | No |
| `user` | Canonical current-user home | 4 hours | **No** | **Yes** |
| `admin` | `/` host-wide scope under current OS user | 1 hour | **Yes** | **Yes** |

Why Project/User have no terminal: restricting only a child process's working directory does not restrict what Node, Python, package managers, compilers, or similar programs can access with the OS user's permissions. Giving them terminal capability would silently bypass the filesystem scope.

### Project authority

Project mode is direct and should be the default for normal repository work:

```text
session_authority_start({
  profile: "project",
  projectRoots: ["/Users/you/Projects/my-app"]
})
```

It supports filesystem and built-in Git tools inside the selected roots. `/` and the entire user home directory are rejected as Project roots.

### User/Admin native approval

User/Admin cannot be started directly. ChatGPT first creates a short-lived approval request:

```text
session_authority_request({ profile: "user" | "admin" })
        |
        v
macOS LocalAuthentication
        |
        | Touch ID / Apple Watch / password fallback
        v
session_authority_request_status({ requestId })
        |
        | first approved status consumes approval once
        v
User/Admin authorityLeaseId
```

Direct `session_authority_start({ profile: "user" | "admin" })` fails with `LOCAL_APPROVAL_REQUIRED`.

Approval requests expire after two minutes. Approval and lease lifetimes are separate. One approved request can mint at most one lease.

## Protected native approval helper

The Swift LocalAuthentication helper is built in the repository, but **production never executes the repository build output directly**.

Build it as the normal user:

```bash
npm run build:broker:macos
```

Install it into the protected system location with explicit administrator authorization:

```bash
sudo npm run install:broker:macos
```

Installed paths:

```text
/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker
/Library/Application Support/chatgpt-system/etc/authority-broker.sha256
```

Before every User/Admin native approval, the Node broker verifies:

- installation directories are real directories, not symlinks;
- helper and metadata are regular files, not symlinks;
- protected paths are owned by UID 0;
- group/other write permissions are absent;
- helper SHA-256 matches the protected metadata.

If validation fails, User/Admin approval fails closed. Project authority remains usable.

The installer never accepts a password, destination override, helper override, or credential argument. `sudo` authentication is handled by macOS outside the application protocol.

## Admin is not root

An Admin lease provides host-wide filesystem scope where the current OS account has permission and enables the structured `terminal_run` tool. It does **not** grant UID 0 and it does not cache or expose a sudo credential.

True root-only operations are intentionally deferred to a future typed macOS ServiceManagement/XPC privileged helper. This project does not use password piping, `sudo -S`, PAM edits, passwordless sudo rules, or a reusable root shell.

## Tools

| Tool | Purpose | Authority requirement |
| --- | --- | --- |
| `system_capabilities` | Bootstrap roots, limits, audit location and startup state | None |
| `session_authority_start` | Create a direct Project lease | None |
| `session_authority_request` | Request native User/Admin approval | None |
| `session_authority_request_status` | Inspect/consume one local approval and mint a lease once | Request ID |
| `session_authority_status` | Inspect an active lease | Lease ID |
| `session_authority_end` | Revoke an active lease | Lease ID |
| `fs_list` | List a directory | Lease ID |
| `fs_stat` | Inspect metadata and small-file SHA-256 | Lease ID |
| `fs_read` | Read UTF-8/base64 content and SHA-256 | Lease ID |
| `fs_write` | Create or conflict-safe atomic replace | Lease ID |
| `fs_apply_patch` | Apply unified diff against expected SHA-256 | Lease ID |
| `fs_mkdir` | Create directory tree | Lease ID |
| `fs_move` | Move a path with file hash guards | Lease ID |
| `fs_remove` | Delete file/directory with safeguards | Lease ID |
| `git_status` | Read status | Lease ID |
| `git_diff` | Read working/staged diff | Lease ID |
| `git_log` | Read recent commits | Lease ID |
| `terminal_run` | Run one allowlisted executable with `shell=false` | **Admin lease only** |

Every tool declares explicit MCP safety annotations and an output schema. Successful calls return readable text plus validated `structuredContent`.

## Conflict-safe file editing

Existing regular files cannot be blindly overwritten.

1. Read/stat the file with the active lease.
2. Keep the returned `sha256`.
3. Pass it as `expectedSha256` to the mutation.
4. If the file changed meanwhile, the operation returns `CONFLICT` without applying the mutation.

Creating a brand-new file does not require `expectedSha256`.

## Terminal execution

`terminal_run` is available only through an active Admin lease. It:

- uses `shell=false`;
- requires an allowlisted executable basename;
- rejects executable-path substitution;
- confines `cwd` to the Admin lease roots;
- sanitizes the environment;
- bounds runtime and output;
- is **not** an OS sandbox.

The default developer command set is:

```text
git node npm npx pnpm bun deno python3 go cargo swift swiftc xcodebuild make cmake
```

An Admin process still executes with the permissions of the OS account running `chatgpt-system`.

## Audit log

Default location:

```text
~/.chatgpt-system/audit.jsonl
```

Authority logs contain categorical lifecycle metadata only. Raw lease IDs, approval request IDs, passwords, API keys, biometric material, secure-field contents, file contents, and command output are not copied into authority audit metadata.

## Separate local route: Codex

Codex can launch the local stdio MCP server directly:

```bash
npm run setup:codex -- --root /absolute/path/to/project
```

See [docs/CODEX_PLUS.md](docs/CODEX_PLUS.md).

## Local HTTP

HTTP mode is for a trusted local/private environment and requires a bearer token:

```bash
node dist/cli.js http \
  --root /Users/you/Projects/my-app \
  --token 'replace-this-with-a-long-random-secret'
```

Default endpoint:

```text
http://127.0.0.1:4312/mcp
```

Do not expose the raw listener directly to the public internet.

## Development

```bash
npm run build
npm test
npm run check
npm run build:broker:macos
node scripts/setup-chatgpt-tunnel.mjs --help
```

CI runs Node 22/24 build/tests and a macOS job that builds, installs into the protected location, and self-verifies the native broker on an ephemeral runner.

## Security model

Read [SECURITY.md](SECURITY.md) before granting broad authority. The deeper design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
