# Architecture

## Goal

Provide an MCP boundary between an AI client and a developer workstation. Serbest mod: there is no privilege ladder and no lease-gated capability. Every tool runs directly against the bootstrap roots; startup flags (`--enable-terminal`, `--enable-owner-runtime`, `--enable-browser`, `--enable-computer-use`, `--enable-project-exec`) are the only gates, and `project_register`/`project_resume` provide optional project identity for continuity.

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
   +--> AuthorityManager ----> optional expiring Project leases (open scope otherwise)
    |
   +--> PathPolicy ----------> canonical allowed roots
    |
   +--> FileSystemService ---> read/list/stat/write/patch/move/remove
    |
   +--> GitService ----------> read status/diff/log + typed local mutations + project-gated push
    |
   +--> ProcessService ------> bounded structured one-shot execution
    |
   +--> OwnerShellService (Owner Runtime facade, startup-gated only)
   |          |
   |          v
   |     OwnerShellSupervisor --> arbitrary trusted login-shell execution + owned process groups
   |
   +--> ManagedProcessService (authority-scoped facade)
   |          |
   |          v
   |     ProcessSupervisor --> shared in-memory registry, logs, lifecycle
   |
   +--> ScopedBrowserService (startup-gated facade)
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

One `RuntimeServices` instance owns one `AuthorityManager`, one `ProcessSupervisor`, one `OwnerShellSupervisor`, and one optional browser service/runtime. HTTP, stdio, and every open-scope MCP call reuse that same runtime. There is no control socket, no approval broker, no shadow lease store, per-request process registry, or second browser agent.

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

Serbest mod: there is no privilege ladder. One `project` profile exists and every lease is fully authorized; capability gates are startup flags only.

```text
open scope  -> bootstrap roots, every tool, no lease required
project     -> optional explicit roots for project identity, same full capability
```

`session_authority_start(profile="project", projectRoots=[...])` opens an optional project scope; `project_register`/`project_resume` carry the continuity alias across chats. `/` and the entire home directory remain forbidden Project roots. There is no User/Admin profile, no control socket, no approval broker, and no `authorize` command.

`browser_health` and `computer_health` return categorical readiness only. Page/content/action browser tools, Computer Runtime actuation, Owner Runtime shell, terminal, and Project execution are gated exclusively by their `--enable-*` startup flags.

## MCP transports

The project targets the MCP TypeScript SDK v2 and the 2026-07-28 protocol line.

- **stdio** uses the SDK `serveStdio(factory)` entry point.
- **HTTP** uses `createMcpHandler(factory)` wrapped with `@modelcontextprotocol/node`'s `toNodeHandler`.
- HTTP creates MCP servers from the same shared runtime and requires bearer authentication at the outer Node HTTP layer.
- HTTP binds to loopback by default. A non-loopback bind is rejected unless the operator explicitly supplies `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true`; that acknowledgement assumes an authenticated TLS reverse proxy is already present and does not add TLS or weaken bearer authentication.
- ChatGPT personal Plugin usage normally reaches stdio through OpenAI Secure MCP Tunnel, so the workstation does not need a public inbound MCP listener.
- Optional macOS daily-driver mode runs `tunnel-client` under a user LaunchAgent. A small Node runner retrieves the tunnel control-plane credential from the login Keychain, injects it only into the tunnel child environment, bounds stdout/stderr tail logs, and exits with the tunnel so launchd can restart it.

## Verification and publication architecture

Local development defaults to the authoritative checkout on `main`; branches and worktrees are exceptional isolation choices, not an automatic per-task workflow. Commit, push, PR, merge, and deployment remain separate operator decisions.

`project_check` has three distinct operations. `detect` derives fixed checks from repository metadata. `run` executes selected detected checks: Project-sandbox checks run containerized, while `admin-host` checks run native commands from a fixed allowlist and cannot accept arbitrary commands or paths. `report` reads freshness-bound evidence and does not execute a check.

The typed `git_push` boundary independently requires the exact resumed Project context, a clean non-`main` branch, and fresh overall `project_check` PASS evidence for the exact HEAD and working-tree digest. A local `main` development default therefore does not weaken the non-main publication boundary.

## One-shot process boundary

`terminal_run` executes one allowlisted executable with:

- `shell=false`;
- basename-only command allowlisting;
- active authority cwd policy;
- sanitized environment;
- bounded output;
- bounded execution time.

It is intentionally not described as an OS sandbox. An interpreter or build tool still has the permissions of the OS account that launched `chatgpt-system`.

## Owner Runtime shell and PTY architecture

`terminal_run` stays the narrow structured executor. Owner Runtime adds a separate `shell_run` path when `--enable-owner-runtime` (or `--owner-workstation`) is active:

```text
ownerRuntime.enabled
        |
        v
OwnerShellService
  - startup-gate check
  - authority PathPolicy cwd check
  - script size/NUL validation
  - content-free audit metadata
        |
        v
shared OwnerShellSupervisor
        |
        +--> trusted shellPath -lc <script>
        +--> shell=false at Node spawn boundary
        +--> sanitized child environment
        +--> dedicated POSIX process group
        +--> bounded stdout/stderr tails
        +--> timeout / MCP abort / daemon-shutdown cleanup
```

The MCP caller supplies shell **script content**, not the shell executable, child environment, OS PID, signal, or detached mode. Shell syntax, arbitrary installed executables, compilers/package managers, Git, and normal network access therefore work with the permissions of the current OS user. This is intentionally full-host execution, not an OS sandbox. Omitted `timeoutMs` installs no Owner Runtime wall-clock deadline; retained output and protocol payloads remain bounded.

## Owner Computer Runtime productivity policy

The existing persistent Computer Runtime helper remains the only desktop-control session. Owner Runtime does not introduce a second session or video stream; ChatGPT continues to use direct `computer_*` calls or the local fast paths `computer_run` / `computer_run_js`. The scoped computer service passes an internal Owner flag only when the Owner Runtime startup gate is enabled.

In Owner mode, execution count/duration and retained result memory are deliberately separate concerns. `computer_run` can execute beyond the legacy 100-action count and can omit a program deadline, but it retains only a fixed bounded tail of step summaries while preserving exact `completedCount` / `actionCount`. `computer_run_js` can omit its runner timer, but JS source and combined output/result remain bounded. Explicit deadlines, MCP cancellation, physical-input serialization, native per-request timeout, recovery budget `2`, user takeover, emergency stop, and ordered shutdown remain authoritative. Cancellation can abort local waits immediately; an already-issued native helper request remains atomic and bounded, after which no later action starts and cleanup runs.

Persistent interactive work uses a separate PTY path rather than changing `terminal_run` or overloading `shell_run`:

```text
ownerRuntime.enabled
        |
        v
TerminalSessionService
  - startup-gate + PathPolicy visibility
  - input/dimension/cursor validation
  - content-free lifecycle audit
        |
        v
shared TerminalSessionSupervisor
  - opaque session registry
  - bounded UTF-8 output ring + monotonic sequence cursors
  - later open-scope rediscovery; incompatible scope hidden
  - SIGTERM / grace / SIGKILL daemon cleanup
        |
        v
lazy NodePtyBackend -> trusted shellPath -l in a real PTY
```

`terminal_session_open/read/write/resize/close/list` expose only opaque daemon-local session IDs. Raw PID/process-group IDs, arbitrary signals, shell path, child environment, and detached mode never enter the MCP schema. Sessions may outlive the lease that created them but not the daemon process; there is no disk-backed terminal history. PTY input/output stays in bounded memory and is excluded from persistent audit/continuity metadata.

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

`ManagedProcessService` is recreated for each active scope and performs authorization before using the shared supervisor:

```text
open scope / active lease
   |
   +-- terminal enabled?
   +-- command still allowlisted?
   +-- stored cwd still inside PathPolicy roots?
   |
   v
shared ProcessSupervisor
```

A compatible later scope can therefore recover a process created by an earlier one. An incompatible scope cannot enumerate it. Unknown and unauthorized IDs return the same `PROCESS_NOT_FOUND` result.

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
open scope (browser startup-gate)
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
   |  - shared-state serialization
   |  - independent per-page operation queues
   |  - independent lease-free health probe
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
   |  - capture-time bounds before retention: 2,048-char diagnostic text and 16,384-char URL-like strings
   |  - in-memory screenshots
   v
persistent Chromium context
```

MCP never receives Playwright handles, browser PIDs, CDP/WebSocket endpoints, executable paths, proxy settings, arbitrary launch arguments, cookies/storage APIs, JavaScript evaluation, CSS/XPath selectors, or file-upload primitives.

Caller navigation accepts only `http:` and `https:`. Browser actions require a semantic target to resolve to exactly one element. Fill/key operations refuse deterministic password/OTP/payment credential signals. ARIA snapshots are captured in AI-oriented mode and current editable values are removed before leaving the local runtime.

Browser diagnostics are operational aids, not a network sandbox. Redirects, page JavaScript, and remote sites still execute with the permissions and network access of the owned browser process. Shared tab lifecycle operations remain ordered globally; page operations are ordered per page so an unrelated page is not blocked by another page's long wait; `browser_health` does not queue behind either chain.

Diagnostic content is bounded twice: the Playwright backend truncates remote-controlled diagnostic strings before storing them in `diagnosticsByPageId`, and `BrowserService` still sanitizes/redacts the public MCP output. This prevents a page from relying on an oversized console message or URL to consume unbounded daemon memory before the output layer applies its own limits.

## Computer native-helper lifecycle

The macOS Computer Runtime helper remains a permission-bearing child owned by `ComputerNativeSupervisor`. Normal shutdown first closes the protocol client and attempts graceful EOF. If the helper does not exit, cleanup is bounded and escalates deterministically:

```text
graceful stdin EOF
   |
   | close grace
   v
SIGTERM
   |
   | close grace
   v
still alive? -> SIGKILL
   |
   | final bounded grace
   v
cleanup complete
```

Fatal protocol/timeout invalidation uses the same termination routine asynchronously, with the cleanup promise explicitly handled so an uncooperative child cannot create an unhandled rejection. MCP callers still never choose PIDs or signals.

## SessionEventStore metadata boundary

`SessionEventStore` is an optional runtime-owned SQLite metadata database under the private state root at `session-events/metadata.db`, separate from the Project Continuity database and task state. It is **disabled by default**: unless `CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS=true` is explicitly set at startup, runtime construction does not open or create the metadata database. Opting in through code alone effects **no deployment or restart** of the live daemon.

The store has an **internal API** only, with no MCP tool or autonomous collector. Its v1 writers create a local UUID session for a trusted caller-provided project ID and append only the atomic `session.started` and `session.closed` metadata events. Revisions use transactional compare-and-swap; history uses a bounded, project-scoped, ascending `afterSeq` cursor. Directories and database permissions are private, and unknown/corrupt schemas fail closed. This store is not an authority source or a replacement for Project Continuity.

There is **no verified external ChatGPT conversation binding**, **no transcript or tool bodies**, and **no automatic capture** of chat, tool arguments/results, browser content, screenshots, clipboard, terminal output, or leases. Binding, message and tool-call tables are reserved with no ingestion API. A separate future provider-evidence integration and encryption/key-lifecycle design are required before introducing identity binding or content recording; do not infer conversation identity from a tab, URL or model-generated text. See the approved specification `docs/superpowers/specs/2026-09-21-session-event-store-metadata-design.md`.

The optional store closes after browser resources and before Continuity during graceful runtime shutdown. No new MCP tool, deployment or daemon restart is part of this implementation.

## Runtime shutdown

Clean runtime shutdown attempts resources in this order:

1. close the computer JavaScript runner;
2. close Computer Runtime and release held input;
3. close terminal sessions;
4. close the Owner Shell supervisor;
5. close the managed process supervisor (persistent managed jobs may survive);
6. close the owned browser runtime/context;
7. close `SessionEventStore` when enabled;
8. close the Project Continuity store when present;
9. close MCP transport/server.

A failure in one cleanup phase is reported categorically and does not prevent later phases from running.

An abrupt daemon crash can leave a detached managed child alive. No PID registry is persisted and the next daemon deliberately does not scan/kill arbitrary processes because it cannot prove ownership safely. Browser profile state is persistent by design, while opaque page IDs and diagnostic buffers are in-memory only.

## Audit boundary

Authority, managed-process, and browser lifecycle/action events are written as JSONL metadata. Process audit records may include command basename, argument count, and coarse state. Browser audit records may include operation category, outcome, duration, bounded counts, sanitized host/origin, and stable error code where useful.

`AuditLogger` serializes writes and keeps the active audit file bounded to 16 MiB plus one `.1` rotated generation. Direct `record()` reports persistence failures to callers that explicitly asked to write an audit record. `run()` deliberately treats persistence as best-effort after the wrapped operation has produced an outcome: a completed side effect is not retroactively reported as failed because the audit sink became unavailable, and an operation error is rethrown unchanged even if recording that error also fails. This avoids turning an audit-storage incident into a duplicate-retry trigger for non-idempotent actions.

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
