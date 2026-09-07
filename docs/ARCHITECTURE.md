# Architecture

## Goal

Provide an MCP boundary between an AI client and a developer workstation without turning a natural-language request into unrestricted shell access.

## Layers

```text
MCP client
   |
   | stdio or authenticated Streamable HTTP
   v
Transport layer
   |
   v
MCP tool registry
   |
   +--> PathPolicy ----------> canonical allowed roots
   |
   +--> FileSystemService ---> read/list/stat/write/patch/move/remove
   |
   +--> GitService ----------> read-only status/diff/log
   |
   +--> ProcessService ------> opt-in, allowlisted, shell=false
   |
   v
AuditLogger (JSONL metadata, no file contents)
```

## Filesystem path decision

For each requested path:

1. Resolve a relative path against the primary configured root.
2. Reject lexical traversal outside all configured roots.
3. Find the nearest existing ancestor for paths that do not exist yet.
4. Resolve that ancestor with `realpath`.
5. Reject the request if a symlink causes the real ancestor or final target to leave the configured root.
6. Only then perform the filesystem operation.

This matters for writes such as `root/link/new-file`, where `link` could be a symlink pointing outside `root` even though the final file does not yet exist.

## Conflict-safe mutation

`fs_read` and `fs_stat` return SHA-256 for readable regular files. Existing-file mutations require that exact hash. A stale or missing hash fails with `CONFLICT` before a write/delete occurs.

The model/client workflow is therefore:

```text
read -> reason/edit -> write(expectedSha256)
```

rather than:

```text
write whatever was in context five minutes ago
```

## MCP transports

The project targets the MCP TypeScript SDK v2 and the 2026-07-28 protocol line.

- **stdio** uses the SDK `serveStdio(factory)` entry point so modern and legacy-era clients can negotiate correctly.
- **HTTP** uses `createMcpHandler(factory)` wrapped with `@modelcontextprotocol/node`'s `toNodeHandler`.
- HTTP creates a fresh MCP server from the same factory and requires bearer authentication at the outer Node HTTP layer.

## Terminal boundary

`terminal_run` is intentionally not described as sandboxed. `shell=false` prevents shell parsing/injection, but an interpreter or build tool can still access anything available to the OS user. Therefore terminal is disabled by default and must be enabled explicitly.

A later hardening track can add platform-specific sandbox adapters (for example a dedicated container/VM worker) without weakening the filesystem policy in the core service.
