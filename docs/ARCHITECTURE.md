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
   +--> AuthorityManager ----> expiring Project/User/Admin leases
   |
   +--> PathPolicy ----------> canonical allowed roots
   |
   +--> FileSystemService ---> read/list/stat/write/patch/move/remove
   |
   +--> GitService ----------> read status/diff/log + typed local mutations + Admin-only GitHub push
   |
   +--> ProcessService ------> bounded one-shot execution
   |
   +--> ManagedProcessService (authority-scoped facade)
   |          |
   |          v
   |     ProcessSupervisor --> shared in-memory registry, logs, lifecycle
   |
   +--> ScopedBrowserService (Admin-only facade)
   |          |
   |          v
   |     BrowserService ----> URL/target/credential/redaction policy + serialization
   |          |
   |          v
   |     BrowserRuntime ----> lazy lifecycle + one owned backend
   |          |
   |          v
   |     PlaywrightBrowserBackend --> persistent Chromium automation profile
   |
   v
AuditLogger (redacted JSONL metadata)
```

One `RuntimeServices` instance owns one `AuthorityManager`, one `ProcessSupervisor`, and one optional browser service/runtime. HTTP, stdio, the local authority control socket, and every authority-scoped MCP call reuse that same runtime. There is no shadow lease store, per-request process registry, or second browser agent.

## Filesystem path decision

For each requested path:

1. Resolve a relative path against the primary configured/authority root.
2. Reject lexical traversal outside all roots.
3. Find the nearest existing ancestor for paths that do not exist yet.
4. Resolve that ancestor with `realpath`.
5. Reject the request if a symlink causes the real ancestor or final target to leave the root.
6. Only then perform the operation.

This matters for writes such as `root/link/new-file`, where `link` could be a symlink pointing outside `root` even though the final file does not yet exist.

## Conflict-safe mutation

`fs_read` and `fs_stat` return SHA-256 for readable regular files. Existing-file mutations require that exact hash. A stale or missing hash fails with `CONFLICT` before a write/delete occurs.

The client workflow is therefore:

```text
read -> reason/edit -> write(expectedSha256)
```

rather than blindly replacing whatever was in model context earlier.

## Authority model

The privilege ladder is enforced by local trusted code:

```text
Project -> explicit roots, filesystem/Git, no terminal, no browser content/action access
User    -> current-user home, filesystem/Git, no terminal, no browser content/action access
Admin   -> host scope as current OS user, terminal/process + browser capability
```

Project authority may be created directly through MCP. By default, User/Admin authority begins locally on the Mac through the private Unix control socket and protected LocalAuthentication helper. An explicit `--personal-admin` runtime mode is the one intentional exception: on a private daily-driver workstation, MCP may request the existing fixed Admin profile directly. The lease remains short-lived, in-memory, and governed by the same `AuthorityManager`; the mode does not create arbitrary roots and does not bypass the separate `--enable-terminal` or `--enable-browser` startup gates.

`browser_health` is deliberately lease-free because it returns categorical readiness only. Every page/content/action/diagnostic browser tool is resolved through an active Admin lease before reaching the browser service.

## MCP transports

The project targets the MCP TypeScript SDK v2 and the 2026-07-28 protocol line.

- **stdio** uses the SDK `serveStdio(factory)` entry point.
- **HTTP** uses `createMcpHandler(factory)` wrapped with `@modelcontextprotocol/node`'s `toNodeHandler`.
- HTTP creates MCP servers from the same shared runtime and requires bearer authentication at the outer Node HTTP layer.
- ChatGPT personal Plugin usage normally reaches stdio through OpenAI Secure MCP Tunnel, so the workstation does not need a public inbound MCP listener.
- Optional macOS daily-driver mode runs `tunnel-client` under a user LaunchAgent. A small Node runner retrieves the tunnel control-plane credential from the login Keychain, injects it only into the tunnel child environment, bounds stdout/stderr tail logs, and exits with the tunnel so launchd can restart it.

## One-shot process boundary

`terminal_run` executes one allowlisted executable with:

- `shell=false`;
- basename-only command allowlisting;
- active authority cwd policy;
- sanitized environment;
- bounded output;
- bounded execution time.

It is intentionally not described as an OS sandbox. An interpreter or build tool still has the permissions of the OS account that launched `chatgpt-system`.

## Managed process architecture

Long-lived development processes are owned by `ProcessSupervisor`, not by `terminal_run`.

The public surface is:

```text
process_start
process_list
process_status
process_logs
process_stop
```

`ProcessSupervisor` owns the private child handles, OS PID/process-group information, lifecycle state, and bounded log tails. MCP receives only opaque random managed-process IDs.

`ManagedProcessService` is recreated for each active authority scope and performs authorization before using the shared supervisor:

```text
active lease
   |
   +-- terminal capability?
   +-- command still allowlisted?
   +-- stored cwd still inside PathPolicy roots?
   |
   v
shared ProcessSupervisor
```

A compatible later Admin lease can therefore recover a process created by an earlier Admin lease. A User or incompatible scope cannot enumerate it. Unknown and unauthorized IDs return the same `PROCESS_NOT_FOUND` result.

### Spawn and logs

Managed children use:

- `shell=false`;
- the same sanitized environment policy as `terminal_run`;
- ignored stdin;
- piped stdout/stderr;
- canonical authorized cwd;
- a separate process group on POSIX.

The registry defaults to 32 records. Running records are never evicted to make space. Completed records may be evicted oldest-first. Each stdout/stderr stream keeps a bounded tail, default 128 KiB, dropping oldest bytes after overflow.

### Stop and shutdown

For a running POSIX process group:

```text
SIGTERM
   |
   | wait processStopGraceMs (default 3000 ms)
   v
still running? -> SIGKILL
   |
   v
close event -> stopped
```

The signal target is private implementation state. MCP cannot provide a PID, process-group ID, or signal name.

## Browser runtime architecture

Browser automation is an optional structured capability, not a second autonomous agent. ChatGPT remains the reasoning layer; Playwright is deterministic infrastructure.

Browser support is disabled unless startup configuration enables it. Production uses the repository-pinned Playwright version and a dedicated persistent Chromium user-data directory, defaulting to:

```text
~/.chatgpt-system/browser-profile
```

The default/personal Chrome profile is not the documented automation target.

The browser path is intentionally layered:

```text
Admin lease
   |
   v
ScopedBrowserService
   |
   v
BrowserService
   |  - http/https navigation allowlist
   |  - semantic target uniqueness
   |  - credential-shaped input refusal
   |  - editable ARIA value redaction
   |  - diagnostic URL sanitization
   |  - serialized operations
   v
BrowserRuntime
   |  - lazy start
   |  - one owned backend/context
   |  - stable categorical launch failures
   v
PlaywrightBrowserBackend
   |  - role/text/label/testId locators only
   |  - opaque page IDs
   |  - bounded console/network tails
   |  - in-memory screenshots
   v
persistent Chromium context
```

MCP never receives Playwright handles, browser PIDs, CDP/WebSocket endpoints, executable paths, proxy settings, arbitrary launch arguments, cookies/storage APIs, JavaScript evaluation, CSS/XPath selectors, or file-upload primitives.

Caller navigation accepts only `http:` and `https:`. Browser actions require a semantic target to resolve to exactly one element. Fill/key operations refuse deterministic password/OTP/payment credential signals. ARIA snapshots are captured in AI-oriented mode and current editable values are removed before leaving the local runtime.

Browser diagnostics are operational aids, not a network sandbox. Redirects, page JavaScript, and remote sites still execute with the permissions and network access of the owned browser process.

## Runtime shutdown

Clean runtime shutdown attempts resources in this order:

1. stop all managed processes;
2. close the owned browser runtime/context;
3. close the private authority control socket;
4. close MCP transport/server.

A failure in one cleanup phase is reported categorically and does not prevent later phases from running.

An abrupt daemon crash can leave a detached managed child alive. No PID registry is persisted and the next daemon deliberately does not scan/kill arbitrary processes because it cannot prove ownership safely. Browser profile state is persistent by design, while opaque page IDs and diagnostic buffers are in-memory only.

## Audit boundary

Authority, managed-process, and browser lifecycle/action events are written as JSONL metadata. Process audit records may include command basename, argument count, and coarse state. Browser audit records may include operation category, outcome, duration, bounded counts, sanitized host/origin, and stable error code where useful.

They do not include:

- authority lease IDs;
- managed-process IDs;
- browser page IDs;
- OS PIDs/process-group IDs;
- argument or typed/fill values;
- environment values;
- stdout/stderr;
- file contents;
- ARIA snapshot text;
- screenshot bytes;
- console payloads;
- URL query strings or fragments;
- cookies/storage/credentials.

Audit storage is operational visibility, not a tamper-proof security log against the same OS user.

## Future capability boundaries

The remaining layers stay separate:

1. Computer-Use Bridge over the existing typed `computer-use` safety/kill-switch boundary for native macOS applications and browser cases that cannot be handled semantically.
2. A deterministic execution queue may serialize local workflows, but it is not represented as a scheduler for future ChatGPT reasoning turns.
3. True root-only actions remain narrow ServiceManagement/XPC operations, never a reusable root shell.
