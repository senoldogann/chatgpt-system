# Security policy

`chatgpt-system` intentionally exposes local capabilities to MCP clients. Treat it as a privileged local bridge, not as a generic public server.

## Security invariants

1. **Open scope, no leases required**: filesystem, Git, process, browser, and computer tools work directly against the bootstrap roots, plus the roots of any unexpired Project lease in the same runtime. A call that passes `authorityLeaseId` is confined to exactly that lease's roots. In open mode any caller can already start a lease for any allowed root, so adding active lease roots to the open scope grants nothing new; it only keeps calls working when a model forgets to pass the lease ID. Leases expire, can be revoked immediately (which also removes their roots from the open scope), and are stored internally only by hash.
2. **No privilege ladder**: every scope runs as the current OS user with the same capabilities. Host terminal, Owner shell/PTY, browser, and computer tools are available as soon as their independent startup gates are enabled. Sandboxed Project execution is a separate explicit Docker capability.
3. **No local approval ceremony**: there is no control socket, no broker, and no biometric gate. Project roots are explicit per lease and may target project directories outside the daemon bootstrap/default roots; `/` and the entire home directory are still refused.
4. **Single authoritative runtime**: the CLI never creates a shadow scope. All MCP tools resolve against the same running process and its configured roots.
5. **No private control plane**: no Unix socket, no versioned control frames, and no `authorize` commands exist. The only local trust decisions left are the startup flags themselves.
6. **No credential-shaped tool input**: MCP tools accept no helper path, shell command, password, sudo credential, API key, cookie, or biometric material. The tunnel credential lives only in the Keychain-backed daily-driver path, never in tool input.
7. **Removed**: single-flight native approval no longer exists.
8. **Removed**: orphan-lease-on-disconnect handling no longer exists; leases are plain scoped handles.
9. **Signed native helper**: the Computer Runtime helper executes only from the fixed installed app bundle under `~/.chatgpt-system`, never from mutable repository build output. Bundle identity is verified before use.
10. **Filesystem confinement**: filesystem requests are resolved against the active scope roots with symlink-target validation.
11. **No blind overwrite**: modifying or deleting an existing regular file requires its current SHA-256 from `fs_read` or `fs_stat`.
12. **Atomic replacement**: file writes use temporary sibling files plus rename to reduce partial-write risk.
13. **Bounded I/O**: file reads/writes, directory listings, native helper output, control frames, command output, managed process count/log tails, Owner PTY session count/input/output retention, browser diagnostics, snapshots, and screenshots have limits. Owner PTY lifetime is not given an arbitrary wall-clock deadline while the daemon is alive.
14. **Audit redaction**: authority/approval/process/browser/Owner-terminal lifecycle records contain categorical metadata only. Raw lease IDs, managed-process IDs, terminal session IDs, browser page IDs, request IDs, credentials, biometric material, argument or typed values, environments, file contents, command/process/PTY output, PTY input, snapshot text, screenshot bytes, console payloads, and URL query strings/fragments are not copied into audit metadata.
15. **Structured terminal execution**: `terminal_run` uses `shell=false`, an executable basename allowlist, scope cwd checks, sanitized environment variables, timeouts, and output limits.
15a. **Owner Runtime is separately explicit full-host execution**: `shell_run` and `terminal_session_*` are disabled unless the daemon starts with `--enable-owner-runtime` / `CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME=true`. They execute the trusted configured login shell as the current OS user and are not an OS sandbox. The trusted shell executable is startup configuration rather than MCP input. One-shot stdout/stderr and persistent PTY output are retained only in bounded memory; script/PTY content/environment/session identifiers are not persisted to audit. One-shot cancellation and daemon shutdown terminate owned process groups, while PTY sessions remain stoppable and always terminate at daemon shutdown.
16. **Sandboxed Project execution is independently gated**: `project_exec` is disabled by default and requires `--enable-project-exec` / `CHATGPT_SYSTEM_ENABLE_PROJECT_EXEC=true`, an allowlisted executable basename, and a cwd inside the active scope. It uses only a local Unix-socket Docker context, `network=none`, a read-only container root, bounded `/tmp`/CPU/memory/PIDs/output/runtime, the selected project root bind-mounted at `/workspace`, and no host-execution fallback.
17. **Managed processes are scope-bound**: `process_start`, `process_list`, `process_status`, `process_logs`, and `process_stop` work without a lease. Start requires the terminal gate.
18. **No raw PID surface**: MCP never accepts or returns an OS PID, process-group ID, arbitrary signal, shell flag, detached flag, or caller-supplied child environment for managed processes.
19. **No process-registry oracle**: unknown and unauthorized managed-process IDs both return `PROCESS_NOT_FOUND`; lists filter records outside the current authority scope.
20. **Bounded lifecycle management**: managed children use bounded in-memory stdout/stderr tails and an in-memory registry. Running records are never evicted to make room.
21. **Graceful process-group cleanup**: on POSIX, managed children use their own process group. Stop/shutdown sends `SIGTERM`, waits the configured grace period, then escalates to `SIGKILL` internally if required.
22. **HTTP authentication**: HTTP transport refuses to start without a bearer token and binds to loopback by default.
23. **Loopback request validation**: the localhost HTTP listener applies Host and Origin validation before routing requests.
24. **Removed**: Personal Admin no longer exists. There is no profile to mint and no flag to enable.
25. **Daily-driver credential confinement**: the optional macOS LaunchAgent stores the Secure MCP Tunnel control-plane key in the login Keychain. The key is not placed in the plist, repository, audit log, runner logs, or spawned command argv.
26. **Browser is independently gated**: browser automation is disabled by default and requires explicit `--enable-browser` / `CHATGPT_SYSTEM_ENABLE_BROWSER=true`. No lease can silently enable a disabled browser runtime.
27. **Browser semantic surface only**: MCP browser tools accept fixed role/text/label/test-id targets and a fixed key vocabulary. They expose no CSS/XPath selectors, arbitrary JavaScript, Playwright code, CDP/WebSocket endpoints, executable paths, proxy settings, browser flags, cookies, storage APIs, or file-upload primitives.
28. **Browser navigation is scheme-bounded**: caller navigation accepts only `http:` and `https:`. `file:`, `javascript:`, `data:`, browser-internal schemes, and custom application schemes are rejected before Playwright receives them.
29. **Browser credential entry is refused**: `browser_fill` and focused key actions fail closed for deterministic password, OTP, verification-code, CVV/CVC, card-number, and sensitive autocomplete signals.
30. **Browser content is redacted/bounded**: editable ARIA values are removed before snapshots leave the runtime; network diagnostic URLs have query strings/fragments stripped; console/network tails are bounded; screenshots remain in-memory for the MCP result and are never written by the runtime solely for tool delivery.
31. **Dedicated browser profile**: the documented/default persistent user-data directory is `~/.chatgpt-system/browser-profile`. The operator's normal Chrome/Chromium profile is not the default automation target.

## Open mode trust decision

There is no authority to escalate to: every tool is already available subject only to its startup gate. A model-mediated request therefore cannot expand its own capability beyond what the operator enabled at startup. Independent ChatGPT/OpenAI product safety checks can still block a specific later action. That is not treated as a local bypass opportunity.

`--owner-workstation` is the single explicit private-Mac preset for that trust decision. It composes Owner Runtime, terminal/PTY, Project Exec, Computer Use, and full-host JavaScript. Browser Runtime remains independently gated. The preset grants the current macOS user's normal filesystem/network/process capability; it does not grant root or bypass sudo, TCC, SIP, FileVault/login, or Keychain authentication.

Running with the full preset materially increases the impact of a malicious or prompt-injected MCP request and should be enabled only on a private workstation controlled by the same user.

## Owner Runtime shell and PTY boundary

Owner Runtime is the deliberate escape hatch for Codex-class local development on a private workstation. `shell_run` invokes only the trusted configured login shell (macOS default `/bin/zsh`) with `-lc`, `shell=false` at the Node spawn boundary, the active-scope cwd, and the sanitized child environment. The script may contain pipes, redirects, command substitution, compound shell syntax, arbitrary executable paths, package managers, compilers, Git, and normal host-network operations that the current OS user could run from Terminal.

That power is explicit and local: `--enable-owner-runtime` is required, and the MCP request cannot choose the shell executable or supply a child environment. The daemon does not inject sudo passwords, modify sudo policy, bypass Keychain/TCC/SIP, or automatically become root. If a shell command invokes normal `sudo`, macOS/user authentication behaves exactly as it would in the user's Terminal.

Owner shell execution is long-work friendly but not uncontained. Omitting `timeoutMs` means there is no product-imposed wall-clock deadline; a finite caller timeout remains available. stdout/stderr use bounded in-memory tails and may truncate old bytes without killing the process. MCP abort and daemon shutdown terminate the owned POSIX process group with SIGTERM followed by SIGKILL after the configured grace period. Audit records only safe lifecycle metadata plus script byte count/SHA-256; it never stores raw script, stdout/stderr, child environment, or lease values.

Persistent `terminal_session_*` sessions use an exact native PTY backend behind the same Owner Runtime gate. The MCP surface exposes only opaque daemon-local session IDs; raw PIDs, process-group IDs, signals, shell paths, environments, and detached flags remain internal. Output is a bounded UTF-8-safe in-memory ring addressed by monotonic event sequence; writes and dimensions are bounded. Sessions are not persisted across daemon restart. Daemon shutdown owns SIGTERM -> grace -> SIGKILL cleanup for every running PTY. Audit stores only lifecycle and byte-count metadata, never PTY input/output or session identifiers.

## Owner Computer Runtime ceiling boundary

While Owner Runtime is enabled, the old `computer_run` 100-action ceiling and implicit 30-second program deadline are productivity limits, not security boundaries, and are removed. The same Owner mode lets `computer_run_js` omit its legacy 30-second wall-clock deadline. This does **not** make execution unbounded in memory or unstoppable: explicit finite timeout, MCP cancellation, native request timeout, user takeover, the fixed emergency chord, runtime/daemon shutdown, and held-input release remain authoritative. Cancellation aborts local waits and prevents future actions; a native request already handed to the persistent helper is treated as one atomic bounded operation and is followed by fail-closed cleanup rather than killing the permission-bearing helper mid-action.

Containment remains bounded for MCP/native frames, JavaScript source, stdout/stderr/result bytes, screenshots, observations, returned `computer_run` step summaries, and semantic recovery (`maxAutomaticRetriesPerAction = 2`). Audit records only categorical/count/lifecycle metadata and never stores action bodies, typed text, screenshots, OCR/AX text, JS source/output, AbortSignal objects, credentials, environment values, or native identifiers. TCC is never bypassed: release acceptance requires a stable signed helper plus categorical `computer_health` readiness for Accessibility, Screen Recording, event listen, and event post.

## Daily-driver tunnel credential boundary

The optional macOS daily-driver service is a user LaunchAgent, not a root daemon. The installer builds the repository's small Swift Keychain helper, atomically installs it at a private executable path under `~/.chatgpt-system/bin`, and uses that same dedicated helper for app-specific `store`, `read`, and idempotent `delete`. A new credential is sent only on stdin and is never placed in spawned argv.

Runtime `read` uses Security.framework with authentication UI disabled/fail-closed. It therefore supports unattended access only when the app-owned login-Keychain item is already readable for the logged-in user; it never tries to bypass Keychain authentication or display a hidden prompt. The wrapper places the returned value only in the `tunnel-client` child environment. The LaunchAgent plist contains only absolute executable/script paths, profile name, log path, and helper path. Runner stdout/stderr logs are bounded tails and intentionally do not include the key or environment dump.

This key authenticates `tunnel-client` to the Secure MCP Tunnel control plane. It is not a model invocation credential used by `chatgpt-system`, and the bridge does not turn daily-driver startup into direct model API usage.

## Why host tools stay behind startup gates

A child process is not confined merely because its working directory is inside a scope root. An allowlisted executable such as Node, Python, a package manager, compiler, or build tool can exercise the OS account's permissions and open files outside that cwd.

Likewise, an authenticated browser page, accessibility snapshot, screenshot, console message, or network diagnostic may expose information unrelated to a filesystem root. Browser content cannot honestly inherit a filesystem-only scope.

Therefore host terminal/process start and browser page/content/action tools stay behind their explicit startup gates even though no lease is required. Otherwise the gates would be cosmetic rather than meaningful boundaries.

`project_exec` is available only when the operator explicitly enables that separate runtime gate. `project_exec` does not reuse the host `ProcessService`: it executes through the fixed Docker sandbox backend, requires the cwd to remain inside the active scope roots, and fails closed when Docker is unavailable.

## Verification authority is separate from publication authority

`project_check detect` and `project_check report` are Project-scoped inspection operations. `project_check run` executes repository-derived checks without accepting arbitrary command, argument, or cwd overrides: Project-sandbox checks use the active scope, while a detected `admin-host` check requires a separate valid `adminAuthorityLeaseId`. That native lease authorizes only the requested verification execution; it does not authorize GitHub publication or deployment.

`git_push` remains an independent typed publication boundary. It requires the exact resumed Project lease, a clean non-`main` branch, and fresh overall `project_check report` PASS evidence bound to the exact HEAD and working-tree digest. Local development may default to `main`, but that preference does not permit direct main publication.

If a ChatGPT conversation does not expose MCP tools, that is a product-surface/tool-routing availability failure. Do not substitute container access, an unsupported endpoint, or another tool to bypass the missing MCP surface.

`browser_health` remains lease-free because it exposes only categorical readiness and does not start or inspect browsing content.

## Not root

Everything runs as the OS account that launched `chatgpt-system`. This phase does not provide:

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

A later call may manage a process created by an earlier call when command allowlist and cwd scope are still compatible. Revoking the original lease does not automatically terminate the child. This is deliberate so an operator can recover and stop a development server with a newly opened compatible scope.

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

Except for categorical `browser_health`, every operation requires the browser gate; no lease is needed. Browser operations are serialized so concurrent ChatGPT sessions do not race tab/focus/page mutations inside the owned context.

The browser runtime is **not a network sandbox**. HTTP(S) navigation may load arbitrary remote application code and follow redirects. The browser process has the OS/network permissions of the account running it. Use a separate OS account, VM, containerized browser environment, or network policy if stronger isolation is required.

The runtime also does not automate credential entry. Existing authenticated state in the dedicated profile may still make sensitive pages visible to a browser tool; operators should treat that profile as privileged local state.

Clean shutdown attempts managed processes first, then the browser context, then MCP transport. A failure in one cleanup phase does not skip later phases.

## Legacy native helper and control socket (removed)

The Swift LocalAuthentication broker (`native/macos-authority-broker`) and the local Unix control socket no longer exist in the runtime: there is no `authorize` command, no `ping`/`authorize` protocol, and no approval executable verification. The native sources and the `install:broker:macos` script remain in the repository for reference, but the MCP server never invokes them.

## Filesystem race limitation

The filesystem policy protects against accidental or agent-driven root escape but is not a kernel-level linearizable compare-and-swap boundary.

Path validation and SHA-256 precondition checks can be raced by another hostile local process with permission to mutate the same tree. Atomic rename prevents partially written destination files; it does not make preceding validation/hash checks atomic against external writers.

For adversarial multi-process isolation, use a container, VM, or dedicated OS account and expose only the intended workspace.

## Host terminal limitation

Host process execution is **not an operating-system sandbox**. The command allowlist limits the requested top-level executable name, not what an interpreter/compiler/package manager may subsequently do with the OS account's permissions.

If stronger host-process isolation is required, run the bridge inside a container, VM, sandbox, or dedicated account with only the required resources exposed.

## Project Docker sandbox boundary

`project_exec` is a distinct least-privilege path, not a claim that the host account is sandboxed. The runtime checks the cwd through the same `PathPolicy`, rejects non-local Docker contexts, and launches the fixed image with no network, no added capabilities, `no-new-privileges`, a read-only container root, bounded resources, and only the selected project root bind-mounted at `/workspace`. The Docker client process receives a narrow environment and does not inherit daemon secret variables or caller-controlled Docker host/context overrides.

The Docker daemon is trusted infrastructure and the sandbox executes Linux tooling, so behavior can differ from the macOS host. Native Xcode/macOS tasks are intentionally not tunneled through this boundary. If the Docker executable/daemon, local Unix context, or fixed image is unavailable, the operation returns `SANDBOX_UNAVAILABLE`; it never retries through host execution. A process with authority to control the local Docker daemon is itself highly privileged, so this boundary assumes the operator's local Docker installation/context is trusted.

## Jev semantic targeting egress boundary

`computer_resolve_semantic_target` is the only capability in this system that sends data to a third party. Every other boundary keeps data on the Mac or, for ChatGPT itself, inside the already-declared MCP transport. Enabling this capability is therefore a deliberate privacy decision, not an implementation detail.

When the tool runs it takes a fresh `computer_observe` snapshot of the frontmost application and POSTs a derived payload to `https://api.typesafe.ai/v1/systemone`.

What leaves the Mac:

- the focused window title;
- for each observed element, its accessibility role plus its AX title or description, bounded by the existing observation limits (`maxObservationElements`, default 500, and `maxObservationChars`, default 262144);
- the caller's natural-language `instruction` text;
- the TypeSafe API key, only as an `Authorization: Bearer` header.

Because AX titles and descriptions are whatever the focused application renders, this payload can contain message subjects, document names, contact names, file paths, and similar user content. Do not enable Jev targeting while a window with sensitive content is frontmost unless that exposure is intended.

What does not leave the Mac through this path: screenshots, OCR text, editable AX values, typed text, file contents, Git state, environment variables, and authority lease identifiers. The API key is never placed in the URL, request body, audit log, MCP arguments, or error output.

The capability is disabled by default and fails closed. It requires `--enable-computer-use`, the separate `--enable-jev-targeting` gate, and a `TYPESAFE_API_KEY`; a missing gate or key returns `JEV_TARGETING_UNAVAILABLE`. Startup rejects the gate without Computer Runtime or without a key.

The tool is read-only: it never clicks, types, or moves input, and it carries no authority beyond the observation it already performed. It returns a suggested target that the calling agent must still act on through the existing `computer_*` tools.

Responses are schema-validated before use. An answer missing `confidence`, carrying a confidence outside `0..1`, or naming a choice outside the supplied candidate set is rejected rather than resolved, because an unvalidated response previously bypassed the low-confidence gate. Confidence alone is not treated as sufficient: a chosen element whose description duplicates another candidate's resolves to `ambiguous_duplicate`. Requests are bounded by an abort timeout, retried only on network failures and retryable HTTP statuses, and never retried on a 4xx that cannot succeed. Retry warnings carry structured status metadata only, never the response body or instruction text.

Availability of this third-party service is not a dependency of Computer Runtime. AX, OCR, and index targeting remain the primary path; Jev targeting is an optional accelerator.

## Git safety

Built-in Git tooling separates read operations from narrow typed mutations. `git_status`, `git_diff`, and `git_log` are read-only. Local mutation tools expose only validated branch creation/switching, explicit file staging, bounded commit messages, and fixed-option merges; they do not accept arbitrary Git arguments. Repository hooks, external diff/textconv, pagers, and commit signing are disabled for these operations.

`git_push` is a separate remote-write boundary: `projectAuthorityLeaseId` must resolve to the exact Project lease created by `project_resume`. The resumed context is kept only in bounded in-memory digest-keyed state; generic Project leases do not satisfy it. Immediately before publication, Project Continuity revalidates the registered worktree identity, the tree must be clean and non-`main`, and existing `ProjectCheckService` evidence must be a fresh `PASS` bound to the exact current `HEAD` and `workingTreeDigest`. A stale/missing/failed/unavailable verification fails closed. The final remote write rechecks branch/HEAD and pushes the verified commit SHA only to the same validated branch at the existing credential-free GitHub `origin`. MCP accepts no remote/refspec/force/branch/head or verification-override input, and interactive Git prompting remains disabled.

Git audit metadata records operation categories and bounded counts/flags, not commit messages, staged path values, remote URLs, or credentials.

The bridge assumes its startup environment, including executable search paths, is trusted. An actor that can replace executables found through `PATH` already operates at or near the bridge process's OS authority.

## Future GUI capability

The remaining GUI layer must preserve the same authority model rather than tunneling around it.

- native GUI actions will be adapters over the separate `computer-use` system so its kill switch, credential blocking, human-presence detection, grants, and verification remain active;
- browser work should prefer the existing semantic Browser Runtime before falling back to pixel-driven computer use;
- true root operations remain typed ServiceManagement/XPC operations, not a reusable root shell.

## Tool metrics

`~/.chatgpt-system/tool-metrics.jsonl` records one line per MCP tool call: tool name, outcome, duration and response size. It never stores arguments, paths, file contents or error messages. The file is bounded to 4 MiB with one rotated copy. `npm run stats` summarizes it locally.

## Audit limitation

The audit log is for operator visibility and debugging. It is not tamper-proof against an actor that already has write access as the same OS user. Use a separately protected sink for evidentiary/compliance-grade audit requirements.

## HTTP / remote access

Do not expose the raw HTTP listener directly to the public internet. For OpenAI products on a developer Mac, prefer Secure MCP Tunnel with `chatgpt-system` as a local stdio child process. This keeps the MCP server off the public network and uses outbound connectivity from the tunnel client.

The listener binds to loopback by default. A non-loopback host is rejected unless the operator explicitly supplies `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true`. That acknowledgement does **not** add TLS, proxy authentication, or network isolation; it is only for deployments already protected by an authenticated TLS reverse proxy. Bearer authentication remains mandatory in all HTTP modes.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md).

## Reporting vulnerabilities

Please open a private GitHub security advisory. Avoid public issues containing exploit details, tokens, filesystem paths, or other sensitive material.
