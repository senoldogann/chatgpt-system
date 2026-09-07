# Chatgpt-system

Secure local MCP bridge for controlled filesystem, Git, and process access from ChatGPT-compatible MCP clients.

The point of this project is not to give an LLM a root shell and hope everyone has a character-building afternoon. It exposes narrow, auditable tools with explicit filesystem roots, conflict-safe writes, bounded I/O, and opt-in terminal access.

## Status

`0.1.x` foundation:

- MCP TypeScript SDK v2 / 2026-07-28 protocol support
- stdio and Streamable HTTP transports
- structured MCP outputs with explicit output schemas
- filesystem root confinement with symlink-escape protection
- SHA-256 optimistic locking for destructive file changes
- atomic file replacement and unified-diff patching
- read-only Git status/diff/log tools
- terminal execution behind an explicit opt-in switch
- JSONL audit trail
- localhost Host/Origin request validation for HTTP mode
- real MCP client integration coverage for authenticated Streamable HTTP
- personal ChatGPT Plugin path through OpenAI Secure MCP Tunnel
- one-command Codex local MCP registration as a separate local route
- regression/security tests and GitHub Actions CI

## Requirements

- Node.js 22 or newer
- npm
- Git for the built-in Git inspection tools
- `tunnel-client` only when using the personal ChatGPT Plugin route

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

## Personal ChatGPT Plugin: recommended route

If your ChatGPT account exposes **Developer mode**, the preferred private route is a personal Plugin over **OpenAI Secure MCP Tunnel**. The Mac does not need a public inbound MCP port.

First create a Secure MCP Tunnel in your OpenAI Platform context, then from this repository run:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-test-project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx
```

That first command is a dry setup and prints only non-secret configuration. With the runtime credential available to `tunnel-client`, create and validate the profile:

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
6. Test it in **Work** first, because that is the current documented personal-plugin flow.
7. Test normal **Chat** separately. This repository intentionally does not claim that surface works until it has been observed on the real account.

The first write test should use a disposable Git repository and follow:

```text
system_capabilities
  -> fs_list
  -> fs_read
  -> fs_apply_patch/fs_write with expectedSha256
  -> stale-hash CONFLICT
  -> git_diff
  -> path-escape rejection
```

Terminal remains disabled throughout this initial acceptance test.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md) for the full runbook and troubleshooting sequence.

## Separate local route: Codex

Codex local is a different OpenAI surface and can launch local stdio MCP servers directly. It does not require Secure MCP Tunnel:

```bash
npm run setup:codex -- --root /absolute/path/to/project
```

Then open a new Codex local session and inspect `/mcp`.

See [docs/CODEX_PLUS.md](docs/CODEX_PLUS.md) for setup, verification, multiple roots, and terminal options.

## Quick start: stdio

Use stdio when your MCP host can launch a local child process:

```bash
node dist/cli.js stdio --root /Users/you/Projects/my-app
```

Multiple roots can be supplied by repeating `--root`:

```bash
node dist/cli.js stdio \
  --root /Users/you/Projects/app \
  --root /Users/you/Projects/shared
```

Relative tool paths resolve against the first root. Absolute tool paths may target any configured root.

## Quick start: local HTTP

HTTP mode is intended for a trusted local host or secure private environment. It refuses to start without a bearer token:

```bash
node dist/cli.js http \
  --root /Users/you/Projects/my-app \
  --token 'replace-this-with-a-long-random-secret'
```

Endpoint:

```text
http://127.0.0.1:4312/mcp
```

Health check:

```text
GET http://127.0.0.1:4312/health
```

The MCP endpoint requires:

```text
Authorization: Bearer <token>
```

When the listener is bound to localhost, the server also applies the MCP SDK's Host and Origin validation guards. Do not expose the raw HTTP listener to the public internet.

## Tools

| Tool | Purpose | Mutation |
| --- | --- | --- |
| `system_capabilities` | Show roots, limits, audit location, terminal state | No |
| `fs_list` | List a directory | No |
| `fs_stat` | Inspect metadata and small-file SHA-256 | No |
| `fs_read` | Read UTF-8/base64 content and SHA-256 | No |
| `fs_write` | Create or conflict-safe atomic replace | Yes |
| `fs_apply_patch` | Apply unified diff against expected SHA-256 | Yes |
| `fs_mkdir` | Create directory tree | Yes |
| `fs_move` | Move path, hash-guarded for files | Yes |
| `fs_remove` | Delete file/directory with safeguards | Destructive |
| `git_status` | Read status | No |
| `git_diff` | Read working/staged diff | No |
| `git_log` | Read recent commits | No |
| `terminal_run` | Run an allowlisted executable | High authority |

Every tool declares explicit MCP safety annotations and an output schema. Successful tool calls return both readable text content and `structuredContent` validated by the MCP SDK.

## Conflict-safe file editing

Existing regular files cannot be blindly overwritten.

1. Call `fs_read` or `fs_stat`.
2. Keep the returned `sha256`.
3. Submit that value as `expectedSha256` to `fs_write`, `fs_apply_patch`, `fs_move`, or `fs_remove` when applicable.
4. If another process changed the file meanwhile, the operation returns `CONFLICT` and no mutation occurs.

This prevents an agent from overwriting a newer editor/IDE change using stale context.

Creating a brand-new file does not require `expectedSha256`. Supplying a hash for a missing file is treated as a conflict.

## Terminal access

Terminal execution is **disabled by default**:

```bash
node dist/cli.js stdio \
  --root /Users/you/Projects/my-app \
  --enable-terminal
```

You can replace the default command allowlist:

```bash
node dist/cli.js stdio \
  --root /Users/you/Projects/my-app \
  --enable-terminal \
  --allow-command git \
  --allow-command node \
  --allow-command npm
```

Important: the command runner uses `shell=false`, constrains the working directory, sanitizes the environment, limits output/time, and requires an executable allowlist. **It is still not an operating-system sandbox.** Node, Python, package managers, compilers, and build tools can access resources beyond the configured filesystem roots if the OS user can access them.

For hard isolation, run the bridge in a container/VM or a dedicated OS account with only the workspace mounted/accessible.

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

`CHATGPT_SYSTEM_ROOTS` uses the operating system's path delimiter (`:` on macOS/Linux, `;` on Windows).

## Audit log

Default location:

```text
~/.chatgpt-system/audit.jsonl
```

Each line includes operation name, target, outcome, duration, and limited metadata. File contents and command stdout/stderr are intentionally not duplicated into the audit log.

## Development

```bash
npm run build
npm test
npm run check
node scripts/setup-chatgpt-tunnel.mjs --help
```

CI runs the build and test suite on Node 22 and Node 24. Coverage includes a real MCP client handshake over authenticated Streamable HTTP, strict tool metadata/output-schema checks, structured tool results, filesystem/process security regressions, and the tunnel setup helper.

## Security model

Read [SECURITY.md](SECURITY.md) before enabling terminal or remote access. The deeper design is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
