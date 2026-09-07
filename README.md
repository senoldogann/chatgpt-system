# chatgpt-system

Secure local MCP authority gateway for controlled filesystem, Git, and process access from ChatGPT-compatible MCP clients.

The project does not hand an LLM a permanent root shell and then discover philosophy through incident response. Authority is explicit, scoped, expiring, auditable, and enforced locally.

## Status

Current foundation:

- MCP TypeScript SDK v2 / 2026-07-28 protocol support
- stdio and Streamable HTTP transports
- personal ChatGPT Plugin path through OpenAI Secure MCP Tunnel
- per-workflow **Project / User / Admin** authority leases
- cryptographically random opaque lease IDs stored only as hashes internally
- profile TTL limits and immediate revocation
- structured MCP outputs with explicit output schemas
- filesystem confinement with symlink-escape protection
- SHA-256 optimistic locking for destructive file changes
- atomic file replacement and unified-diff patching
- Git status/diff/log tools
- scoped allowlisted process execution with `shell=false`
- JSONL audit trail with redacted authority lifecycle metadata
- localhost Host/Origin validation for HTTP mode
- real MCP client integration coverage
- Node 22 / Node 24 CI

## Requirements

- Node.js 22 or newer
- npm
- Git
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

If your ChatGPT account exposes **Developer mode**, the preferred private route is a personal Plugin over **OpenAI Secure MCP Tunnel**. The Mac does not need a public inbound MCP port.

Create a Secure MCP Tunnel in OpenAI Platform, then run:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-test-project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --doctor
```

Then keep the tunnel running:

```bash
tunnel-client run --profile chatgpt-system
```

In ChatGPT:

1. **Settings → Security and login → Developer mode** ON.
2. **Plugins → +**.
3. Choose **Tunnel** under Connection.
4. Select/paste the configured tunnel and scan the MCP tools.
5. Install the personal plugin.
6. Validate it on ChatGPT Web first.
7. Validate Desktop through the same installed plugin/backend afterwards.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md) for the full runbook.

## Session authority profiles

Privileged filesystem, Git, and terminal tools require an `authorityLeaseId`. Start one profile once for the current workflow and reuse the returned lease on subsequent calls.

| Profile | Scope | Maximum lease | Terminal | Current Phase-1 meaning |
| --- | --- | ---: | --- | --- |
| `project` | Explicit project root(s) | 8 hours | Yes | Full developer operations inside selected projects |
| `user` | Canonical current-user home | 4 hours | Yes | User-owned files and processes across the home scope |
| `admin` | `/` filesystem scope | 1 hour | Yes | Host-wide path/process scope under the current OS user |

Example workflow:

```text
session_authority_start({
  profile: "project",
  projectRoots: ["/Users/you/Projects/my-app"]
})
        |
        | returns authorityLeaseId
        v
fs_read / fs_write / git_status / terminal_run
        |
        | each call includes authorityLeaseId
        v
session_authority_end({ authorityLeaseId })
```

Important properties:

- A lease is immutable after creation.
- Expiry, explicit end, or server restart revokes it.
- Concurrent leases keep independent scopes.
- Project mode rejects `/` and the entire home directory.
- Raw lease IDs are not written to audit logs.
- `system_capabilities.terminal.enabled` describes the bootstrap startup configuration; an active authority lease has its own explicit `terminalEnabled` state.

### Current phase boundary

`admin` currently means host-wide filesystem/process scope **as the user running `chatgpt-system`**. It does not yet provide root elevation, passwordless sudo, or Touch ID authorization. Native macOS privilege brokering/Touch ID is a later implementation phase.

Likewise, arbitrary shell syntax and the `computer-use` GUI bridge are not part of this Phase-1 authority core yet.

## Tools

| Tool | Purpose | Lease required |
| --- | --- | --- |
| `system_capabilities` | Bootstrap roots, limits, audit location and startup terminal state | No |
| `session_authority_start` | Create Project/User/Admin lease | No |
| `session_authority_status` | Inspect active lease | Yes, its own lease ID |
| `session_authority_end` | Revoke active lease | Yes, its own lease ID |
| `fs_list` | List a directory | Yes |
| `fs_stat` | Inspect metadata and small-file SHA-256 | Yes |
| `fs_read` | Read UTF-8/base64 content and SHA-256 | Yes |
| `fs_write` | Create or conflict-safe atomic replace | Yes |
| `fs_apply_patch` | Apply unified diff against expected SHA-256 | Yes |
| `fs_mkdir` | Create directory tree | Yes |
| `fs_move` | Move path, hash-guarded for files | Yes |
| `fs_remove` | Delete file/directory with safeguards | Yes |
| `git_status` | Read status | Yes |
| `git_diff` | Read working/staged diff | Yes |
| `git_log` | Read recent commits | Yes |
| `terminal_run` | Run an allowlisted executable with `shell=false` | Yes |

Every tool declares explicit MCP safety annotations and an output schema. Successful calls return readable text plus `structuredContent` validated by the MCP SDK.

## Conflict-safe file editing

Existing regular files cannot be blindly overwritten.

1. Call `fs_read` or `fs_stat` with the active `authorityLeaseId`.
2. Keep the returned `sha256`.
3. Submit that value as `expectedSha256` to `fs_write`, `fs_apply_patch`, `fs_move`, or `fs_remove` when applicable.
4. If another process changed the file meanwhile, the operation returns `CONFLICT` and no mutation occurs.

Creating a brand-new file does not require `expectedSha256`. Supplying a hash for a missing file is treated as a conflict.

## Terminal execution

`terminal_run` requires an active authority lease and uses the lease's scope and executable allowlist.

The default developer command set currently contains:

```text
git node npm npx pnpm bun deno python3 go cargo swift swiftc xcodebuild make cmake
```

You can replace the configured command list at server startup with repeated `--allow-command` flags or `CHATGPT_SYSTEM_ALLOW_COMMANDS`.

The runner:

- uses `shell=false`;
- rejects executable paths instead of accepting arbitrary path substitution;
- confines `cwd` to the active lease roots;
- sanitizes the environment;
- bounds output and runtime;
- does not provide an OS sandbox.

Interpreters, package managers, compilers, and build tools still execute with the permissions of the OS account running the bridge. Hard isolation requires a container, VM, or dedicated OS account.

## Separate local route: Codex

Codex local can launch local stdio MCP servers directly and does not require Secure MCP Tunnel:

```bash
npm run setup:codex -- --root /absolute/path/to/project
```

See [docs/CODEX_PLUS.md](docs/CODEX_PLUS.md).

## Local stdio

```bash
node dist/cli.js stdio --root /Users/you/Projects/my-app
```

Multiple bootstrap roots can be supplied by repeating `--root`. Session authority may later select a different profile scope explicitly.

## Local HTTP

HTTP mode is intended for a trusted local host or secure private environment and refuses to start without a bearer token:

```bash
node dist/cli.js http \
  --root /Users/you/Projects/my-app \
  --token 'replace-this-with-a-long-random-secret'
```

Default endpoint:

```text
http://127.0.0.1:4312/mcp
```

Do not expose the raw HTTP listener directly to the public internet.

## Configuration

Environment equivalents are available for automated launches. See `.env.example`.

Key variables:

```text
CHATGPT_SYSTEM_ROOTS
CHATGPT_SYSTEM_AUDIT_FILE
CHATGPT_SYSTEM_ENABLE_TERMINAL
CHATGPT_SYSTEM_ALLOW_COMMANDS
CHATGPT_SYSTEM_HTTP_HOST
CHATGPT_SYSTEM_HTTP_PORT
CHATGPT_SYSTEM_HTTP_TOKEN
CHATGPT_SYSTEM_MAX_READ_BYTES
CHATGPT_SYSTEM_MAX_WRITE_BYTES
CHATGPT_SYSTEM_MAX_DIRECTORY_ENTRIES
CHATGPT_SYSTEM_MAX_COMMAND_OUTPUT_BYTES
CHATGPT_SYSTEM_COMMAND_TIMEOUT_MS
```

`CHATGPT_SYSTEM_ROOTS` uses the operating system path delimiter (`:` on macOS/Linux, `;` on Windows).

## Audit log

Default location:

```text
~/.chatgpt-system/audit.jsonl
```

Normal operation records include action, target, outcome, duration, and limited metadata. File contents and command stdout/stderr are not duplicated into the audit log.

Authority lifecycle records contain only profile, root count, a SHA-256 digest of the canonical scope, and expiry where relevant. Raw lease IDs, passwords, API keys, secure-field values, and biometric material are not logged.

## Development

```bash
npm run build
npm test
npm run check
node scripts/setup-chatgpt-tunnel.mjs --help
```

CI runs build/test on Node 22 and Node 24 and includes real MCP handshake coverage, strict tool metadata/output-schema checks, authority isolation, filesystem/process regressions, and tunnel setup smoke checks.

## Security model

Read [SECURITY.md](SECURITY.md) before granting broad authority. The deeper design is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
