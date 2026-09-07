# Security policy

`chatgpt-system` intentionally exposes local capabilities to MCP clients. Treat it as a privileged local bridge, not as a generic public server.

## Security invariants

1. **Filesystem confinement**: every filesystem path must remain under an explicitly configured root after lexical normalization and realpath/symlink resolution.
2. **No blind overwrite**: modifying or deleting an existing regular file requires its current SHA-256, obtained from `fs_read` or `fs_stat`.
3. **Atomic replacement**: file writes use a temporary sibling file and rename, reducing partial-write risk.
4. **Bounded I/O**: file reads/writes, directory listings, command output, and command duration have configurable limits.
5. **Auditability**: operations are appended to a local JSONL audit log. File contents and command output are not copied into the audit log.
6. **Terminal is opt-in**: `terminal_run` is disabled by default. It uses `shell=false`, a command allowlist, a constrained cwd, sanitized environment variables, timeouts, and output limits.
7. **HTTP authentication**: HTTP transport refuses to start without a bearer token and binds to loopback by default.

## Important terminal limitation

The process runner is **not an operating-system sandbox**. An allowlisted executable such as Node, Python, a compiler, package manager, or build tool may itself read/write files outside configured roots or execute child processes. Enabling terminal access therefore grants substantially more authority than the filesystem tools.

If you need hard process isolation, run this bridge inside an OS/container sandbox that exposes only the intended workspace and credentials.

## Git safety

Built-in Git tools are read-only. They disable repository hooks and external diff/textconv for the exposed operations. Mutating Git operations should be performed only through an explicitly enabled terminal, where their broader authority is visible.

## HTTP / remote access

Do not bind directly to a public interface unless you also provide a properly authenticated, TLS-terminating reverse proxy and understand the threat model. The default design is loopback-only and suitable for a trusted local MCP host or a secure tunnel.

## Reporting vulnerabilities

Please open a private GitHub security advisory for vulnerabilities. Avoid filing public issues containing exploit details, tokens, filesystem paths, or other sensitive material.
