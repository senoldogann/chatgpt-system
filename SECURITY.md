# Security policy

`chatgpt-system` intentionally exposes local capabilities to MCP clients. Treat it as a privileged local bridge, not as a generic public server.

## Security invariants

1. **Filesystem confinement**: filesystem requests are lexically checked and resolved against explicitly configured roots, including symlink-target validation before the operation.
2. **No blind overwrite**: modifying or deleting an existing regular file requires its current SHA-256, obtained from `fs_read` or `fs_stat`.
3. **Atomic replacement**: file writes use a temporary sibling file, `fsync`, and rename, reducing partial-write risk.
4. **Bounded I/O**: file reads/writes, directory listings, command output, and command duration have configurable limits.
5. **Auditability**: operations are appended to a local JSONL audit log. File contents and command output are not copied into the audit log.
6. **Terminal is opt-in**: `terminal_run` is disabled by default. It uses `shell=false`, a command allowlist, a constrained cwd, sanitized environment variables, timeouts, and output limits.
7. **HTTP authentication**: HTTP transport refuses to start without a bearer token and binds to loopback by default.

## Threat model and filesystem race limitation

The filesystem policy is designed to prevent accidental or agent-driven escape from configured roots. It assumes the configured roots and their directory components are not being concurrently rewritten by a hostile local process running with the same OS-level authority.

Path validation and SHA-256 checks are user-space precondition checks. They are **not a kernel-level, linearizable compare-and-swap primitive**. Another local process with permission to mutate the same directory tree can race validation/hash verification and the final filesystem operation. Atomic rename prevents partially written destination files; it does not make the preceding hash comparison an atomic CAS against external writers.

For adversarial multi-process isolation, run the bridge in a container, VM, or dedicated account and expose only the intended workspace. Do not rely on JavaScript path checks as a substitute for an OS security boundary.

## Important terminal limitation

The process runner is **not an operating-system sandbox**. An allowlisted executable such as Node, Python, a compiler, package manager, or build tool can exercise the permissions of the bridge process, including access outside configured filesystem roots.

The command allowlist limits which top-level executable name can be requested. It does not make interpreters, package managers, compilers, or build tools intrinsically safe.

If you need hard process isolation, run this bridge inside an OS/container sandbox that exposes only the intended workspace and credentials.

## Git safety

Built-in Git tools are read-only. They disable repository hooks, filesystem monitors, external diff/textconv, pagers, and interactive credential prompts for the exposed operations. Mutating Git operations should be performed only through an explicitly enabled terminal, where their broader authority is visible.

The bridge assumes its startup environment, including executable search paths, is trusted. An actor that can replace executables found through `PATH` already operates at or near the bridge process's OS authority.

## Audit log limitation

The audit log is intended for operator visibility and debugging. It is not tamper-proof against an actor that already has write access as the same OS user. Put the log on a separately protected sink if you need evidentiary or compliance-grade audit guarantees.

## HTTP / remote access

Do not bind directly to a public interface unless you also provide a properly authenticated, TLS-terminating reverse proxy and understand the threat model. The default design is loopback-only and suitable for a trusted local MCP host or a secure tunnel.

## Reporting vulnerabilities

Please open a private GitHub security advisory for vulnerabilities. Avoid filing public issues containing exploit details, tokens, filesystem paths, or other sensitive material.
