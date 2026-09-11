# Security policy

`chatgpt-system` intentionally exposes local capabilities to MCP clients. Treat it as a privileged local bridge, not as a generic public server.

## Security invariants

1. **Explicit session authority**: privileged filesystem, Git, process, and browser content/action calls require an active opaque authority lease. Leases expire, can be revoked immediately, and are stored internally only by hash.
2. **Fixed privilege ladder**: Project has project filesystem/Git access and no host-terminal/browser content access; User has home filesystem/Git access and no host-terminal/browser content access; Admin has host-wide scope under the current OS user and is the only host-terminal/process/browser-capable profile. Project-only sandboxed execution is a separate explicit startup capability and never upgrades the lease to Admin.
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
13. **Bounded I/O**: file reads/writes, directory listings, native helper output, control frames, command output, command duration, managed process count/log tails, browser diagnostics, snapshots, and screenshots have limits.
14. **Audit redaction**: authority/approval/process/browser lifecycle records contain categorical metadata only. Raw lease IDs, managed-process IDs, browser page IDs, request IDs, credentials, biometric material, argument or typed values, environments, file contents, command/process output, snapshot text, screenshot bytes, console payloads, and URL query strings/fragments are not copied into audit metadata.
15. **Structured terminal execution**: Admin `terminal_run` uses `shell=false`, an executable basename allowlist, cwd checks, sanitized environment variables, timeouts, and output limits.
16. **Sandboxed Project execution is independently gated**: `project_exec` is disabled by default and requires `--enable-project-exec` / `CHATGPT_SYSTEM_ENABLE_PROJECT_EXEC=true`, an active Project lease, an allowlisted executable basename, and a cwd inside that lease. It uses only a local Unix-socket Docker context, `network=none`, a read-only container root, bounded `/tmp`/CPU/memory/PIDs/output/runtime, the selected Project root bind-mounted at `/workspace`, and no host-execution fallback.
17. **Managed processes are authority-scoped**: `process_start`, `process_list`, `process_status`, `process_logs`, and `process_stop` require an active lease. Start requires terminal capability, which currently means Admin.
18. **No raw PID surface**: MCP never accepts or returns an OS PID, process-group ID, arbitrary signal, shell flag, detached flag, or caller-supplied child environment for managed processes.
19. **No process-registry oracle**: unknown and unauthorized managed-process IDs both return `PROCESS_NOT_FOUND`; lists filter records outside the current authority scope.
20. **Bounded lifecycle management**: managed children use bounded in-memory stdout/stderr tails and an in-memory registry. Running records are never evicted to make room.
21. **Graceful process-group cleanup**: on POSIX, managed children use their own process group. Stop/shutdown sends `SIGTERM`, waits the configured grace period, then escalates to `SIGKILL` internally if required.
22. **HTTP authentication**: HTTP transport refuses to start without a bearer token and binds to loopback by default.
23. **Loopback request validation**: the localhost HTTP listener applies Host and Origin validation before routing requests.
24. **Personal Admin is explicit**: `--personal-admin` is disabled by default. When enabled, MCP may mint the existing fixed Admin profile directly, but leases remain bounded/in-memory and terminal/process/browser capability still depends on separate startup gates.
25. **Daily-driver credential confinement**: the optional macOS LaunchAgent stores the Secure MCP Tunnel control-plane key in the login Keychain. The key is not placed in the plist, repository, audit log, runner logs, or spawned command argv.
26. **Browser is independently gated**: browser automation is disabled by default and requires explicit `--enable-browser` / `CHATGPT_SYSTEM_ENABLE_BROWSER=true`. Admin authority cannot silently enable a disabled browser runtime.
27. **Browser semantic surface only**: MCP browser tools accept fixed role/text/label/test-id targets and a fixed key vocabulary. They expose no CSS/XPath selectors, arbitrary JavaScript, Playwright code, CDP/WebSocket endpoints, executable paths, proxy settings, browser flags, cookies, storage APIs, or file-upload primitives.
28. **Browser navigation is scheme-bounded**: caller navigation accepts only `http:` and `https:`. `file:`, `javascript:`, `data:`, browser-internal schemes, and custom application schemes are rejected before Playwright receives them.
29. **Browser credential entry is refused**: `browser_fill` and focused key actions fail closed for deterministic password, OTP, verification-code, CVV/CVC, card-number, and sensitive autocomplete signals.
30. **Browser content is redacted/bounded**: editable ARIA values are removed before snapshots leave the runtime; network diagnostic URLs have query strings/fragments stripped; console/network tails are bounded; screenshots remain in-memory for the MCP result and are never written by the runtime solely for tool delivery.
31. **Dedicated browser profile**: the documented/default persistent user-data directory is `~/.chatgpt-system/browser-profile`. The operator's normal Chrome/Chromium profile is not the default automation target.

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

Personal Admin does **not** imply terminal or browser capability. If the daemon was not also started with `--enable-terminal`, the resulting Admin lease has host-wide filesystem scope but `terminalEnabled=false` and an empty command allowlist. If browser startup is not enabled, browser content/action tools remain unavailable. These independent runtime gates remain authoritative.

This mode materially increases the impact of a malicious or prompt-injected MCP request and should be enabled only on a private workstation controlled by the same user. The default local-approval path remains available and unchanged when the flag is absent.

## Daily-driver tunnel credential boundary

The optional macOS daily-driver service is a user LaunchAgent, not a root daemon. The one-time installer reads `CONTROL_PLANE_API_KEY` from the operator's current environment, builds the repository's small Swift Keychain helper, and sends the credential to that helper on stdin. The helper uses Apple's Security.framework (`SecItemUpdate`/`SecItemAdd`) so the credential is stored byte-for-byte without interactive TTY handling and is never placed in spawned argv.

At runtime the wrapper retrieves that fixed Keychain item and places the value only in the `tunnel-client` child environment. The LaunchAgent plist contains only absolute executable/script paths, profile name, and log path. Runner stdout/stderr logs are bounded tails and intentionally do not include the key or environment dump.

This key authenticates `tunnel-client` to the Secure MCP Tunnel control plane. It is not a model invocation credential used by `chatgpt-system`, and the bridge does not turn daily-driver startup into direct model API usage.

## Why Project/User do not have host terminal or browser content capability

A child process is not confined merely because its working directory is inside a lease root. An allowlisted executable such as Node, Python, a package manager, compiler, or build tool can exercise the OS account's permissions and open files outside that cwd.

Likewise, an authenticated browser page, accessibility snapshot, screenshot, console message, or network diagnostic may expose information unrelated to a Project/User filesystem root. Browser content cannot honestly inherit a filesystem-only scope.

Therefore Project/User authority exposes neither host terminal/process start nor browser page/content/action tools. Otherwise the narrower authority profiles would be cosmetic rather than meaningful boundaries.

Project leases may optionally use `project_exec`, but only when the operator explicitly enables that separate runtime gate. `project_exec` does not reuse the host `ProcessService`: it executes through the fixed Docker sandbox backend, accepts no User/Admin lease, requires the cwd to remain inside the Project roots, and fails closed when Docker is unavailable.

Admin is the only profile allowed to reach the unsandboxed host/user-session capabilities. `browser_health` remains lease-free because it exposes only categorical readiness and does not start or inspect browsing content.

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

## Browser automation boundary

Browser automation uses the repository-pinned Playwright runtime as deterministic infrastructure. There is no second LLM/browser agent loop.

The owned browser context uses a dedicated persistent profile. Page handles are represented to MCP only by cryptographically random, in-memory opaque IDs. Closed or unknown IDs fail with `BROWSER_PAGE_NOT_FOUND`; IDs are not persisted or audited.

The public browser surface is intentionally narrow:

```text
browser_health
browser_tabs
browser_new_tab
browser_select_tab
browser_close_tab
browser_navigate
browser_snapshot
browser_click
browser_fill
browser_select_option
browser_press_key
browser_wait_for_text
browser_screenshot
browser_console_errors
browser_network_errors
browser_close
```

Except for categorical `browser_health`, every operation requires an active Admin lease. Browser operations are serialized so concurrent ChatGPT sessions do not race tab/focus/page mutations inside the owned context.

The browser runtime is **not a network sandbox**. HTTP(S) navigation may load arbitrary remote application code and follow redirects. The browser process has the OS/network permissions of the account running it. Use a separate OS account, VM, containerized browser environment, or network policy if stronger isolation is required.

The runtime also does not automate credential entry. Existing authenticated state in the dedicated profile may still make sensitive pages visible to an Admin-authorized browser tool; operators should treat that profile as privileged local state.

Clean shutdown attempts managed processes first, then the browser context, then the authority control socket, then MCP transport. A failure in one cleanup phase does not skip later phases.

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

## Host terminal limitation

Admin process execution is **not an operating-system sandbox**. The command allowlist limits the requested top-level executable name, not what an interpreter/compiler/package manager may subsequently do with the Admin OS account's permissions.

If stronger host-process isolation is required, run the bridge inside a container, VM, sandbox, or dedicated account with only the required resources exposed.

## Project Docker sandbox boundary

`project_exec` is a distinct least-privilege path, not a claim that the host account is sandboxed. The runtime accepts only Project leases, checks the cwd through the same `PathPolicy`, rejects non-local Docker contexts, and launches the fixed image with no network, no added capabilities, `no-new-privileges`, a read-only container root, bounded resources, and only the selected Project root bind-mounted at `/workspace`. The Docker client process receives a narrow environment and does not inherit daemon secret variables or caller-controlled Docker host/context overrides.

The Docker daemon is trusted infrastructure and the sandbox executes Linux tooling, so behavior can differ from the macOS host. Native Xcode/macOS tasks are intentionally not tunneled through this boundary. If the Docker executable/daemon, local Unix context, or fixed image is unavailable, the operation returns `SANDBOX_UNAVAILABLE`; it never retries through Admin host execution. A process with authority to control the local Docker daemon is itself highly privileged, so this boundary assumes the operator's local Docker installation/context is trusted.

## Git safety

Built-in Git tooling separates read operations from narrow typed mutations. `git_status`, `git_diff`, and `git_log` are read-only. Local mutation tools expose only validated branch creation/switching, explicit file staging, bounded commit messages, and fixed-option merges; they do not accept arbitrary Git arguments. Repository hooks, external diff/textconv, pagers, and commit signing are disabled for these operations.

`git_push` is a separate remote-write boundary. It requires Admin authority, accepts no remote/refspec/force input, resolves only the existing `origin`, rejects credential-bearing or non-GitHub origin URLs, and pushes only the validated current branch to the same remote branch name. Interactive Git prompting remains disabled.

Git audit metadata records operation categories and bounded counts/flags, not commit messages, staged path values, remote URLs, or credentials.

The bridge assumes its startup environment, including executable search paths, is trusted. An actor that can replace executables found through `PATH` already operates at or near the bridge process's OS authority.

## Future GUI capability

The remaining GUI layer must preserve the same authority model rather than tunneling around it.

- native GUI actions will be adapters over the separate `computer-use` system so its kill switch, credential blocking, human-presence detection, grants, and verification remain active;
- browser work should prefer the existing semantic Browser Runtime before falling back to pixel-driven computer use;
- true root operations remain typed ServiceManagement/XPC operations, not a reusable root shell.

## Audit limitation

The audit log is for operator visibility and debugging. It is not tamper-proof against an actor that already has write access as the same OS user. Use a separately protected sink for evidentiary/compliance-grade audit requirements.

## HTTP / remote access

Do not expose the raw HTTP listener directly to the public internet. For OpenAI products on a developer Mac, prefer Secure MCP Tunnel with `chatgpt-system` as a local stdio child process. This keeps the MCP server off the public network and uses outbound connectivity from the tunnel client.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md).

## Reporting vulnerabilities

Please open a private GitHub security advisory. Avoid public issues containing exploit details, tokens, filesystem paths, or other sensitive material.
