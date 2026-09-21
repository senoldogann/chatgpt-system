# ChatGPT personal plugin integration

This runbook connects `chatgpt-system` to ChatGPT Web/Desktop through an OpenAI Secure MCP Tunnel while keeping the Mac private and keeping broad authority under local user control.

Browser Runtime is part of the same shared authority boundary. ChatGPT remains the reasoning agent; Playwright is deterministic browser infrastructure.

Computer Runtime v2 Slice 5 keeps the accepted Swift/macOS 14+ helper and separately gated owner-trust `computer_run_js`, then adds semantic targets, bounded AX/Vision recovery, stale-target refusal, and revalidation-aware physical actions. ChatGPT remains the reasoning agent; the native helper stays deterministic observation/input infrastructure while the JavaScript runner remains an explicit full-host capability boundary.

## Architecture

```text
ChatGPT Web / Desktop
        |
        v
personal Developer Mode Plugin
        |
        v
OpenAI Secure MCP Tunnel
        ^
        | outbound HTTPS
        |
tunnel-client on the Mac
        |
        | stdio
        v
chatgpt-system shared runtime
        |
        +-- Open scope: every tool works with no lease (bootstrap roots)
        |      |
        |      +-- optional Project lease for narrower scoping
        |      |
        |      +-- project_exec when explicit gate enabled
        |               |
        |               v
        |         local Docker sandbox (network=none, /workspace bind mount)
        |
        +-- terminal + managed processes when terminal gate enabled
        |
        +-- Browser Runtime when browser gate enabled
        |         |
        |         v
        |   BrowserService policy -> Playwright persistent Chromium
        |
        +-- Computer Runtime when computer-use gate enabled
        |         |
        |         v
        |   shared ComputerRuntime / native supervisor
        |         |
        |         v
        |   signed macOS helper over inherited NDJSON stdio
        |
        +-- shared ProcessSupervisor
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend. Normal Chat and Work can route product safety differently, so actual MCP calls are the evidence that matters.

Direct HTTP is not required for the recommended Secure MCP Tunnel flow. If an operator deliberately binds `chatgpt-system http` to a non-loopback host, startup is fail-closed unless `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true` is supplied. The acknowledgement assumes an authenticated TLS reverse proxy is already in front of the listener; it does not provide TLS itself, and the `chatgpt-system` bearer token remains mandatory.

## 1. Prerequisites

- ChatGPT Developer Mode enabled.
- Node.js 22+.
- Git.
- Docker Desktop or another trusted local Docker daemon when Project execution is enabled; the active context must use a local Unix socket.
- `tunnel-client`.
- Secure MCP Tunnel associated with the intended ChatGPT workspace.
- Runtime tunnel credential available to `tunnel-client`, normally through `CONTROL_PLANE_API_KEY`.
- Swift/Xcode command-line tools on macOS for the native Computer Runtime helper.
- Computer Runtime v2: macOS 14+ for ScreenCaptureKit screenshot support and a valid local Code Signing identity for stable daily-driver installation.
- Browser Runtime only: Chromium installed with the repository-pinned Playwright setup command.

Never put the tunnel credential in the repository, command history, MCP arguments, plugin prompts, screenshots, or audit logs.

## 2. Update and verify the repository

```bash
cd ~/chatgpt-system
git fetch origin
git checkout main
git pull --ff-only
npm install
npm run check
```

When validating an unmerged feature branch, use that exact branch only when it was explicitly requested and keep the tunnel child on the same build. For ordinary local work, stay on the authoritative `main` checkout; branch/worktree isolation is not automatic.

### Verification and publication boundaries

Normal repository development is local-first in `/Users/dogan/Desktop/chatgpt-system` on `main`. Commit, GitHub push, PR, merge, and live deployment are separate operations. The local `main` default does not authorize direct main publication or deployment.

`project_check detect` and `project_check report` are Project-scoped and need no lease. `project_check run` runs detected Project-sandbox checks. When a detected check has the `admin-host` lane, such as `package-script:test:computer:macos`, the call may also supply a separate valid `adminAuthorityLeaseId`; that lease authorizes only that native verification. It does not authorize `git_push`.

Typed `git_push` independently requires the exact Project lease returned by `project_resume`, a clean non-`main` branch, and fresh overall `project_check report` `PASS` evidence bound to the exact HEAD and working-tree digest. If MCP tools are missing from a ChatGPT conversation, treat that as product-surface/tool-routing unavailability; scope policy still applies and must not be bypassed through containers or another unsupported route.

### 2a. Build the Project execution sandbox image

Project execution is optional and disabled by default. With a trusted local Docker daemon running, build the fixed repository image once:

```bash
cd ~/chatgpt-system
npm run setup:project-exec
```

The setup command accepts no caller-controlled Docker flags. Runtime `project_exec` requires the separate `--enable-project-exec` gate, checks the cwd against the active scope roots, rejects non-local Docker contexts, disables container networking, uses a read-only container root with bounded `/tmp`, bind-mounts the selected project root at `/workspace`, and never falls back to host execution. Because the sandbox is Linux-based, macOS-native/Xcode checks remain on the host terminal path.

## 3. Legacy native broker (removed from the runtime)

The Swift LocalAuthentication broker sources remain under `native/macos-authority-broker` for reference, but the MCP server no longer starts a control socket, never invokes the broker, and has no `authorize` command. Do not install it for this runtime.

## 3a. Build, sign, and install Computer Runtime v2

The native helper remains under `native/macos-computer-runtime`, requires macOS 14+, and communicates only through inherited stdin/stdout using strict bounded NDJSON. Slice 3 established the TypeScript supervisor, strict low-level MCP registration, bounded typed `computer_run`, stable daily-driver installation, takeover safety, and ordered shutdown cleanup. Slice 4 added the separate full-host JavaScript runner. Slice 5 adds native target resolution/recovery, focused-window Vision OCR enrichment, semantic physical-action inputs, and matching semantic helpers inside `computer_run_js`.

Run:

```bash
npm run test:computer:macos
npm run build:computer:macos
npm run package:computer:macos
npm run build:computer-fixture:macos
npm run package:computer-fixture:macos

# Install the daily-driver helper with stable Keychain signing:
npm run setup:computer:macos
```

The disposable staged bundles and stable daily-driver location are:

```text
native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app
native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app
~/.chatgpt-system/ChatGPTSystemComputerRuntime.app
```

CI/staging bundles are ad-hoc by design. The daily-driver installer does not silently use ad-hoc signing: it reuses the installed signer when valid, accepts an exact `--identity`, or uses one unambiguous Apple Development/Developer ID identity. If no stable identity can be selected, setup stops with guidance. `--ad-hoc-development` is explicit and reports unstable TCC identity.

Fixed bundle identifier:

```text
com.senoldogann.chatgpt-system.computer-runtime
com.senoldogann.chatgpt-system.computer-runtime.fixture
```

The native protocol implements passive `health`, bounded `list_apps`, AX-first `active_window` / explicit-fresh `observe`, `resolve_target` / `resolve_targets`, bounded in-memory ScreenCaptureKit `screenshot`, app open/focus, pointer movement, click/double-click, mouse down/up, drag, bounded scroll, Unicode typing, named key/chord actions, `release_inputs`, and deterministic AX/text/screen-region verification primitives. Semantic physical actions resolve through the shared recovery engine immediately before controller mutation. Health reports passive Accessibility, Screen Recording, event-listen, and event-post readiness without requesting permission.

Physical mutations are serialized and every synthetic CoreGraphics event uses one runtime-owned tag. A listen-only takeover monitor ignores owned events, interrupts active actions on conservative unowned user input, and recognizes the fixed Control+Option+Command+Escape emergency chord. TCC is only preflighted; the protocol does not request or bypass Accessibility, Screen Recording, event-listen, or event-post permission.

The fixture remains deterministic local acceptance infrastructure only and contains no user data. `computer_run_js` remains behind `--enable-computer-use --enable-full-host-js`. Scripts run as the current macOS user with normal Node.js APIs; they are not root-confined and this is not an OS sandbox. Source is delivered only over stdin to the fixed runner entrypoint. The daemon strips its secret-bearing environment before spawn while preserving basic user environment such as HOME/PATH. Ordinary descendants remain in the owned POSIX process group and are terminated on normal completion, timeout, cancellation, takeover, or shutdown; deliberately detached or daemonized descendants can escape that group and are not claimed as contained. Slice 5 keeps target/OCR/AX content out of durable caches and audit metadata; the bounded native observation cache is in-memory only. Installing or testing the native helper does not itself require restarting the daily-driver daemon.

### 3b. Slice 5 routing, recovery, and acceptance

Use the least powerful deterministic route that can satisfy the task:

1. User intent wins: when the user explicitly asks for **Computer Use**, real Google Chrome, or physical pointer and keyboard interaction, use Computer Runtime end-to-end. For Chrome, open/focus bundle identifier `com.google.Chrome`; `browser_*` is Playwright automation, so do not substitute Chrome for Testing for this workflow.
2. Browser Runtime may be preferred for ordinary web semantics only when the user has not required Computer Use/physical desktop interaction, or when semantic Playwright automation was explicitly requested. Existing-Chrome CDP attach is still Browser Runtime, not physical Computer Use.
3. For native desktop UI, prefer AX-backed `role`, `label`, `text`, or fresh `index` targets.
4. Use `refreshObservation()` after a known UI mutation/reorder when the next target may have moved; native `observe` refreshes the recovery cache as well as returning the fresh bounded observation.
5. Use `ocrText` only when structured AX evidence is insufficient or the target is deliberately visual-only. The recovery ladder is bounded to fast then accurate Vision OCR and never retries without limit.
6. Use explicit point targets only when the caller supplied the point. Ambiguous, stale, unsafe, permission, takeover, and exhausted-recovery states fail closed instead of guessing coordinates.

For normal Chrome, an already-running `com.google.Chrome` is reused and may be focused, but it is never silently restarted to change accessibility flags. Only when Computer Runtime itself starts a stopped real Google Chrome does it pass `--force-renderer-accessibility=complete`; it does not add a temporary `--user-data-dir` or substitute Chrome for Testing, so the normal default profile/session remains the target.

The public key contract is finite and normalized before native IPC. Canonical names include `return`, `escape`, `delete`, `forward_delete`, arrows, navigation keys, letters/digits, and F1-F12. Explicit aliases include `enter -> return`, `esc -> escape`, `backspace -> delete`, `forwarddelete -> forward_delete`, page-navigation aliases, and arrow aliases. Unknown key names are rejected before native dispatch.

Direct `computer_move_mouse`, `computer_click`, `computer_drag`, and positioned `computer_scroll` accept semantic targets in the Slice 5 branch contract; typed `computer_run` has the same semantic-target parity. `computer_run_js` exposes `resolve`, `resolveMany`, `exists`, and `refreshObservation`, plus semantic action inputs. `exists` returns `false` only for target-not-found and propagates ambiguity/stale/permission/takeover failures.

When AX is weak, ordinary `computer_observe` can enrich the fresh observation with structured Vision OCR from the **focused AX window only**. The runtime captures the focused display only as the safe ScreenCaptureKit source, crops it to validated focused-window bounds, and never silently broadens automatic OCR to the full display. Fast Vision runs first; accurate Vision may run once only when the fast pass yields zero acceptable candidates. Output is bounded to 64 candidates, 512 characters per candidate, 8192 aggregate OCR characters, and confidence below 0.5 is dropped when Vision supplies confidence.

`computer_observe.perception` reports `axQuality`, required-nullable `webContentAccessible`, `ocrUsed`, `recommendedTargeting`, and bounded `ocrCandidates`. For non-Chrome applications `webContentAccessible` is explicitly JSON `null`, not omitted. Candidate `confidence` is likewise present as a number or JSON `null`. Use `recommendedTargeting=ax` for AX role/text/index, `ocr` for returned `ocrText` candidates, and `visual-point` only after a fresh screenshot with at most one explicit verified point attempt. A failed visual point is a replan boundary; do not repeat blind coordinates. Repeated OCR text remains ambiguous and fails closed instead of choosing a coordinate. Cached observations are bounded/in-memory, and known UI reorders should be followed by an explicit fresh observation before the next semantic mutation.

Real-Mac acceptance on 2026-09-12 used the exact signed helper identity (`tccIdentityStable: true`) with Accessibility, Screen Recording, event-listen, and event-post readiness all true. Recorded evidence was content-free timing/count metadata only:

> Historical baseline: these 2026-09-12 measurements predate the focused-window perception-reliability slice. Rows labeled focused-display OCR describe the then-current implementation and are retained only as baseline evidence, not as the current automatic OCR contract.

| Acceptance probe | Result |
| --- | --- |
| AX fixture target | `source=ax`; resolve 64.5 ms; verified click effect |
| stale index after intentional reorder | `COMPUTER_STALE_SNAPSHOT`; status unchanged; fresh semantic `Reorder Alpha` recovery succeeded in 179.8 ms |
| duplicate semantic target | `COMPUTER_NEEDS_REPLAN` in 51.9 ms; no pointer/status change |
| OCR-only fixture target | `source=ocr`; resolve 574 ms; semantic click + screen-region verification 511.2 ms; AX status confirmed effect |
| one JS fixture workflow | 5 semantic local pointer actions in 57.5 ms, one model/tool turn |
| physical takeover | unowned input interrupted an active held drag with `COMPUTER_USER_TAKEOVER`; OS left-button state was `up` afterward |
| emergency chord | unowned Control+Option+Command+Escape aligned into an active pointer action returned `COMPUTER_USER_TAKEOVER` |
| Calculator cold/warm native request | 59.7 ms / 2.3 ms |
| Calculator warm AX resolve | 8.3-14.4 ms |
| main-display screenshot | 235.9 ms, 1710x1112, 1,095,457 decoded PNG bytes in the measured run |
| Calculator focused-display OCR | `source=ocr`, 2991.7 ms |
| Calculator 5-step semantic workflow | 54.7 ms; 5 local actions; 6 logical native IPC requests; one model/tool turn |
| Calculator observe+resolveMany+5 moves+screenshot | 310.6 ms end-to-end; 9 logical native IPC requests; one screenshot; one model/tool turn |
| connection reuse | same native helper PID remained active across two separate ordinary `computer_run_js` calls |

The timing values are one controlled acceptance run, not latency guarantees. Native IPC counts above are logical request counts at the TypeScript/native boundary; internal Vision candidate work is deliberately not persisted in audit logs.

An independent repeat after the fresh-observation recovery-cache fix measured 44.5 ms cold / 7.3 ms warm native health, 2.9-12.3 ms warm Calculator AX resolution, a 220.9 ms main-display screenshot, a 1694.6 ms focused-display OCR resolve, and a 318.9 ms Calculator `active_window` + fresh observe + `resolveMany` + five semantic moves + screenshot workflow using 9 logical native IPC requests. Finder, TextEdit, System Settings, and Chrome also completed harmless frontmost/observation smoke checks; System Settings had one transient `openApp` unavailable result even though it became frontmost, after which `active_window` and fresh observation succeeded.

### 2026-09-15 perception-reliability acceptance and publication

The clean runtime-verification baseline before this documentation follow-up was `integration/computer-use-perception-native-verification` at exact HEAD `35ec7a7595f4f8eab4dfe1ebace260dbce6d0af1`. It contains the cached-OCR zero-retry fix plus `main@4c94c42`, and `origin` was independently re-read at the same SHA after guarded publication. Documentation-only commits may sit above that code baseline; re-read remote truth before making a publication claim.

Verification tied to that exact clean HEAD:

- focused TypeScript integration suites: **80/80 passed**;
- native macOS Computer Runtime suite: **215/215 passed**;
- full `npm run check`: **722 passed, 2 skipped, 0 failed**;
- freshness-bound `project_check`: **PASS**, with matching HEAD and working-tree digest;
- runtime and fixture release packaging: **PASS**;
- staged runtime/fixture `codesign --verify --strict --deep`: **PASS**;
- installed daily-driver runtime: signer `ComputerUse Dev`, stable designated requirement preserved.

Acceptance B is verified on an already-running normal Chrome process: weak web AX produced `axQuality=weak`, `webContentAccessible=false`, focused-window OCR candidates, and `recommendedTargeting=ocr` without restarting Chrome. A live regression that previously returned target-not-found for a unique cached `ocrText` target with `retryBudget=0` navigated successfully after the fix; zero retry still forbids fresh-context/on-demand retry work.

Acceptance C is **not** recorded as passed. The current user-level Plugins settings and public plugin-detail surfaces exposed edit/view/disconnect/delete controls but no Refresh action, and the current account UI did not expose a Workspace-admin action-control surface. Do not simulate success with blind coordinates, repeated point attempts, disconnect/recreate, or Browser Runtime substitution. Rerun this acceptance only when a supported Refresh surface is actually available, using `computer_*` end-to-end and preserving the no-restart Chrome policy.

## 4. Install the browser binary

Browser Runtime uses the exact Playwright dependency pinned by the repository. Install its Chromium binary once on the target Mac:

```bash
cd ~/chatgpt-system
npm run setup:browser
```

The setup script has a fixed purpose: install Chromium through the repository-local Playwright CLI. It accepts no caller-selected browser, channel, executable path, proxy, or arbitrary Playwright argument.

The browser runtime itself remains disabled until the tunnel/daemon startup configuration explicitly enables it.

### 4a. Optional Existing Chrome attach

The managed Playwright profile remains the default. When a trusted workflow specifically needs the Chrome session the user is already using, including existing authenticated state, Chrome 144+ can be attached only through the separate Existing-Chrome opt-in. The user first enables **Allow remote debugging for this browser instance** at `chrome://inspect/#remote-debugging`, keeps Chrome running, and then starts the runtime with:

```text
--enable-browser --browser-existing-chrome
```

Browser page/content operations require the browser gate but no lease. Existing-Chrome mode reuses the same bounded semantic `browser_*` surface; it does not expose cookies, profile databases, raw CDP, `chrome:`, `chrome-extension:`, or `devtools:` pages. Runtime shutdown owns only the automation connection and must not intentionally close the normal Chrome process or pre-existing tabs. For non-default Chrome profile locations, use the explicit `--browser-existing-chrome-user-data-dir <path>` discovery input. See [docs/EXISTING_CHROME_ATTACH.md](EXISTING_CHROME_ATTACH.md) for the complete consent, privacy, lifecycle, and troubleshooting contract.

## 5. Configure the Secure MCP Tunnel profile

Create a disposable bootstrap root. This root is the startup/default scope shown by `system_environment`; it does **not** prevent later Project leases from targeting other explicit repository paths:

```bash
rm -rf /tmp/chatgpt-system-acceptance
mkdir -p /tmp/chatgpt-system-acceptance
cd /tmp/chatgpt-system-acceptance
git init
printf 'before\n' > fixture.txt
git add fixture.txt
git commit -m 'test fixture' || true
```

For a private daily-driver acceptance profile with sandboxed Project execution, host terminal, Browser Runtime, and Computer Runtime enabled:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --enable-project-exec \
  --enable-owner-runtime \
  --enable-browser \
  --enable-computer-use \
  --enable-full-host-js \
  --doctor
```

Optional headless mode:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --enable-browser \
  --browser-headless \
  --doctor
```

`--browser-headless` without `--enable-browser` is rejected.

The capability gates are independent:

- omitting `--enable-terminal` keeps one-shot/managed **host** process execution disabled;
- omitting `--enable-project-exec` keeps `project_exec` disabled; enabling it does not grant host-terminal authority;
- omitting `--enable-owner-runtime` keeps unrestricted `shell_run` and persistent `terminal_session_*` PTY tools disabled;
- omitting `--enable-browser` keeps Browser Runtime disabled;
- omitting `--enable-computer-use` keeps Computer Runtime disabled;
- omitting `--enable-full-host-js` keeps `computer_run_js` disabled even when Computer Runtime is enabled;
- `--enable-full-host-js` without `--enable-computer-use` is rejected.

The default browser profile is:

```text
~/.chatgpt-system/browser-profile
```

Use a dedicated automation profile. Do not make the operator's everyday Chrome profile the normal acceptance target.

If Existing-Chrome mode is intentionally selected, configure the same tunnel with `--enable-browser --browser-existing-chrome` instead of treating the everyday profile as the managed automation profile. This is a distinct consented mode and cannot be combined with `--browser-headless`.

If the `chatgpt-system` tunnel profile already exists and its child command is stale, replacement is intentionally explicit:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --enable-owner-runtime \
  --enable-browser \
  --enable-computer-use \
  --enable-full-host-js \
  --force \
  --doctor
```

`--force` replaces only the existing `tunnel-client` profile configuration. It does not delete repository data or bypass scope policy.

The generated stdio target includes only the explicit feature gates selected during setup. The configured bootstrap root is not a permanent repository allowlist: `session_authority_start(profile="project", projectRoots=["/absolute/other-repo"])` may open another exact project directory without tunnel reconfiguration, except that `/` and the entire home directory remain denied. For durable handoff, call `project_register` once and `project_resume` in later chats.


### ChatGPT Web custom-app availability recovery

If ChatGPT returns `This conversation does not support developer MCPs`, treat it as a **product surface / tool routing availability** problem, do not treat it as daemon failure or tunnel failure. Do not invent a local-host fallback and do not claim local changes, tests, or Git operations that were not actually performed.

Recovery flow:

1. Return to a supported **standard text chat** surface. Agent mode does not use custom apps; Deep Research can use custom apps only for read/fetch actions, not write/modify actions.
2. Select the custom app again from the tools/apps menu or `@mention` it on the message that needs new local data or an action.
3. If the MCP server tool/action definitions changed, use **Refresh** in the app configuration so ChatGPT reloads the current actions.
4. Once developer MCP tools are available again, call `project_resume` for the exact registered alias and reconcile Git/worktree reality before continuing.

Stopping and continuing the same chat is not itself proof that the custom app remains available on the next message. The agent must use actual MCP tool availability as evidence. Safety or product-surface routing must never be worked around by keyword substitution or by pretending container access is equivalent to the user's Mac.

## 6. Run the tunnel

For manual acceptance:

```bash
tunnel-client run --profile chatgpt-system
```

Keep it running while ChatGPT discovers or calls tools. After MCP tool/schema changes, restart the tunnel target and refresh the ChatGPT plugin catalog.

For the permanent personal daily-driver setup, stop the manual tunnel after acceptance and run the one-time installer from a shell where `CONTROL_PLANE_API_KEY` is already exported:

```bash
cd ~/chatgpt-system
npm run setup:daily-driver
```

The installer stores the tunnel control-plane credential in the macOS login Keychain, writes a user LaunchAgent, and starts the service. The key authenticates `tunnel-client` to the Secure MCP Tunnel control plane; it is not used by `chatgpt-system` to make model API calls.

Service inspection/removal:

```bash
npm run daily-driver:status
npm run daily-driver:uninstall
```

Verify the local state directory:

```bash
ls -ld ~/.chatgpt-system
```

Expected permissions:

```text
~/.chatgpt-system                drwx------
```

## Deployment and release verification

Deployment is separate from local development, commit, push, PR, and merge. Do not put a live PID or release SHA in README because either can change independently of source history. Before any authorized deployment, identify the actual child command and release target without stopping the healthy tunnel:

```bash
npm run diagnose:chatgpt
npm run daily-driver:status
readlink ~/.chatgpt-system/runtime/current
readlink ~/.chatgpt-system/runtime/previous
ps -axo pid=,command= | grep 'dist/cli.js stdio' | grep -v grep
```

Record the release directory, its Git HEAD, the actual `dist` artifact identity, dependencies, and the previous release target. Prepare and build the new release from the exact verified commit in a separate release directory; never copy files over a running release or create a mixed source/dist tree. Keep the previous release intact until post-deployment acceptance succeeds.

A supported transition stops/restarts only the deployment-owned daily-driver/tunnel/MCP chain after preparation is complete. It does not restart Chrome, the computer runtime, or unrelated services. Afterward, verify the child command resolves to the new release, rerun the configured health/diagnostic checks, confirm the MCP catalog and harmless read-only calls, and retain the previous release for rollback. If any required authority or exact-head verification is unavailable, stop rather than bypassing it.

### Continuous runtime updates (extension-style)

The manual deployment above is automated by `scripts/auto-update-runtime.mjs`, which runs hourly as a separate LaunchAgent (`com.senoldogann.chatgpt-system.auto-update`). Each pass fetches `origin/main`, refuses unexpected remotes, and stops when the live release already matches. A newer commit is deployed only when its CI check-runs report success (best-effort via `gh`, mandatory `--require-ci` available) **and** a fresh `releases/<sha>` worktree passes the full local `npm run check`. The `current` symlink is flipped atomically, the daily-driver runner is pinned to the stable `runtime/chatgpt-system-main/...` path so the tunnel profile never needs rewriting, the daily-driver restarts, and `healthz`/`readyz` plus `diagnose-chatgpt-connection --minutes 10` must pass. Any verification failure flips `current` back to `previous` and restarts again. Old releases are pruned to the retention count (default 3, always keeping current and previous).

```bash
cd ~/chatgpt-system
npm run setup:auto-update          # hourly agent, --interval-sec 3600 default
npm run auto-update:check          # dry run, no changes
npm run auto-update:status         # current/previous + last result
npm run auto-update:uninstall      # remove the agent
```

State and bounded logs live in `~/.chatgpt-system/auto-update/` (`state.json`, `auto-update.log`); no credentials are logged. The updater never touches the Desktop checkout branch: it only fetches and creates detached worktrees.

Limitation: the updater refreshes the Mac side only. When the MCP tool catalog changes, ChatGPT Web/Desktop still needs a manual catalog Refresh in the plugin configuration; new tools are invisible until that Refresh happens. After every `deployed` result, Refresh the ChatGPT plugin catalog.

## 7. Tool catalog

Authority tools:

```text
system_capabilities
system_environment
session_authority_start
session_authority_status
session_authority_end
```

Filesystem/Git/process tools:

```text
fs_list
fs_stat
fs_read
fs_write
fs_apply_patch
fs_mkdir
fs_move
fs_remove
git_status
git_diff
git_log
git_create_branch
git_switch_branch
git_stage_paths
git_commit
git_merge_branch
git_push
```

Sandboxed Project execution:

```text
project_exec
```

Host execution/process tools:

```text
shell_run
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
terminal_run
process_start
process_list
process_status
process_logs
process_stop
```

`terminal_run` is the structured path: `shell=false`, configured executable basename allowlist, bounded command timeout/output, and the terminal gate. Prefer it when a command fits that contract.

`shell_run` is the Owner Runtime escape hatch for unrestricted one-shot local development. It requires `--enable-owner-runtime`, executes arbitrary login-shell syntax through the trusted startup shell as the current macOS user, and is not an OS sandbox. It supports pipes/redirection/compound commands, installed compilers and package managers, Git, arbitrary executable paths, and normal host network access. The MCP caller cannot choose the shell executable or child environment. Omitted `timeoutMs` has no product wall-clock deadline; finite timeout, MCP cancellation, and daemon shutdown terminate the owned process group. Retained stdout/stderr remain bounded, and audit keeps only script byte count/SHA-256 and lifecycle metadata.

`terminal_session_*` is the persistent interactive Owner path behind the same gate. `open` starts the trusted configured login shell in a real PTY and returns an opaque daemon-local session ID; `read` uses a monotonic event-sequence cursor over bounded UTF-8-safe retained output; `write` and `resize` are bounded. Sessions never persist across daemon restart. Raw PID/process group, signal, shell path, child environment, PTY input/output, and session ID are excluded from persistent audit metadata. Daemon shutdown terminates every running PTY with group SIGTERM, the configured grace interval, then SIGKILL if necessary.

Use `terminal_run` for narrow deterministic commands, `shell_run` for unrestricted one-shot shell execution, and `terminal_session_*` for REPLs, debugger/CLI prompts, persistent dev servers, or any tool that genuinely requires a TTY.

Browser tools:

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

`browser_health` is lease-free and categorical. No other browser tool needs a lease once the browser gate is enabled. Browser MCP schemas do not accept raw selectors, JavaScript, CDP endpoints, proxy/executable settings, cookie/storage operations, or file-upload paths.

Computer Runtime v2 Slice 5 exposes this strict MCP catalog:

```text
computer_health
computer_observe
computer_screenshot
computer_pointer_position
computer_open_app
computer_focus_app
computer_move_mouse
computer_click
computer_drag
computer_scroll
computer_type_text
computer_press_key
computer_release_inputs
computer_wait_for_frontmost
computer_wait_for_text
computer_wait_until_changed
computer_scroll_until_visible
computer_run
computer_run_js
computer_resolve_semantic_target
```

`computer_health` is lease-free and categorical. No other computer tool needs a lease once the computer gate is enabled. `computer_run_js` additionally requires the full-host startup gate. `computer_resolve_semantic_target` is read-only but also requires the Jev startup gate and `TYPESAFE_API_KEY`; `computer_scroll_until_visible` uses bounded scoped recovery and never guesses coordinates. Its successful public result is the existing bounded structured contract: `stdout`, `stderr`, and optional JSON-compatible `result`. No synthetic `cleanupStatus` field is invented; if cleanup prevents a successful terminal result, the call fails with the stable runtime error path rather than reporting unknown cleanup as success. Direct `computer_mouse_down` / `computer_mouse_up` are not registered, but raw hold primitives may be used inside one bounded `computer_run`, whose finalizer releases held input.

With `--enable-owner-runtime`, Computer Runtime uses Owner productivity semantics without changing the native helper architecture. `computer_run` is not rejected merely because it exceeds the legacy 100-action limit, and omitted `timeoutMs` installs no 30-second local program deadline. `computer_run_js` likewise has no implicit 30-second runner deadline when Owner Runtime is enabled. Explicit finite timeout, MCP cancellation, user takeover, the fixed emergency chord, and shutdown remain stop paths. Cancellation interrupts local waits and prevents subsequent actions; an already-issued native RPC remains bounded by `requestTimeoutMs` and is allowed to complete before cleanup. Returned step summaries, JS source/output/result, screenshot/observation payloads, protocol frames, and recovery retries remain bounded.

Phase 3 real-Mac release acceptance is fail-closed. Before declaring the Owner computer path ready, the existing setup/doctor state must report `tccIdentityStable: true`, and lease-free `computer_health` must report `accessibilityTrusted`, `screenCaptureAuthorized`, `eventListenAuthorized`, and `eventPostAuthorized` all `true`. If any value is false, use the normal macOS System Settings permission flow and restart the installed helper/daemon as required; never use `tccutil` or another bypass to manufacture readiness.

## 8. No privilege ladder

Serbest mod: Admin/User ayrımı, local onay ve lease-gated kabiliyet yoktur. Her kapsam mevcut OS kullanıcısı olarak aynı yeteneklerle çalışır. Host terminal, Owner shell/PTY, browser ve computer araçları bağımsız startup flagleri açılır açılmaz kullanılabilir. Sandboxed Project execution ayrı bir explicit Docker kabiliyetidir. Project leaseleri opsiyonel kapsamlamadır: her araç bootstrap rootlara karşı leasesiz de çalışır.

Root-only operasyonlar bu sınırın parçası değildir.

## 9. Project acceptance

Create Project authority for:

```text
/tmp/chatgpt-system-acceptance
```

Verify:

1. `fs_read fixture.txt` succeeds.
2. `git_status` succeeds.
3. sibling/outside read returns `POLICY_DENIED`.
4. with `--enable-project-exec` and the fixed image installed, `project_exec node --version` runs in the Docker sandbox; without the gate it returns `PROJECT_EXEC_DISABLED`.
5. `terminal_run node --version` still returns `POLICY_DENIED` for the same Project lease.
6. `process_start node ...` returns `POLICY_DENIED`.
7. `browser_tabs` returns `POLICY_DENIED` even if Browser Runtime is enabled globally.
8. `session_authority_end` succeeds.
9. ended-lease reuse returns `AUTHORITY_REQUIRED`.

## 10. Open-scope acceptance (no User profile)

Serbest modda User profili yoktur. Bootstrap rootlara karşı leasesiz çalışıldığı doğrulanır:

```bash
cd ~/chatgpt-system
npm run dev -- stdio --root /tmp/chatgpt-system-acceptance --enable-terminal
```

Verify:

1. `fs_list`/`fs_read` bootstrap root içinde leasesiz succeeds;
2. sibling/outside read returns `POLICY_DENIED`;
3. `terminal_run node --version` succeeds yalnızca terminal startup gate açıkken, kapalıyken `POLICY_DENIED`;
4. ended-lease reuse returns `AUTHORITY_REQUIRED`.

Independent product safety can still block an operation before MCP receives it. Record that separately rather than widening filesystem scope to bypass it.

## 11. Open host acceptance (no Admin ceremony)

Serbest modda Admin onayı yoktur. Project leasesi doğrudan MCP ile alınır:

```text
session_authority_start(profile="project", projectRoots=["/tmp/chatgpt-system-acceptance"])
```

then verify:

1. status reports `profile=project`, exact roots;
2. bootstrap dışı explicit proje dizini okunabilir;
3. `terminal_run node --version` succeeds yalnızca terminal startup gate açıkken;
4. `sh -c ...` remains `POLICY_DENIED` when `sh` is not allowlisted;
5. executable paths such as `/usr/bin/node` remain rejected.

No destructive system operation is needed for acceptance.

## 12. Managed Process Supervisor acceptance

With terminal enabled, start a harmless inline Node fixture:

```text
process_start:
  command: node
  args:
    - -e
    - console.log('process-ready'); setInterval(() => {}, 1000)
  cwd: /absolute/path/to/chatgpt-system
```

Expected behavior:

1. `process_start` returns an opaque `processId` and normally `state=running`.
2. No OS PID/process-group ID appears.
3. `process_status` reports the record.
4. `process_logs` contains `process-ready` in the bounded stdout tail.
5. `process_list` includes the compatible record.
6. A later open-scope call can still inspect/stop the process.
7. `process_stop` is idempotent.
8. Out-of-scope known-ID lookup returns `PROCESS_NOT_FOUND` rather than leaking metadata.
9. non-allowlisted `sh` remains `POLICY_DENIED`.

Managed records/logs are in memory only. A clean daemon shutdown attempts to stop running children. An abrupt crash can leave a detached child alive; the next daemon does not sweep arbitrary PIDs.

## 13. Browser Runtime functional acceptance

Run this only after `npm run setup:browser`, with Browser Runtime enabled (no lease needed, open scope).

Use harmless public/local test content that does not require credentials.

Verify in order:

1. `browser_health` returns `enabled=true`, an expected categorical state, and `browserInstalled=true`.
2. `browser_tabs` returns the owned context's pages using opaque page IDs.
3. `browser_new_tab` creates a page; optionally navigate directly to a harmless HTTP(S) URL.
4. `browser_navigate` accepts a normal `https://` URL and waits for DOM content loaded.
5. `browser_snapshot` returns an ARIA-oriented snapshot without current editable textbox values.
6. `browser_click` succeeds for one uniquely resolved semantic role/text/label/test-id target.
7. `browser_fill` succeeds for a benign non-credential field.
8. `browser_select_option` succeeds for a benign select/combobox fixture.
9. `browser_press_key` accepts only the fixed key vocabulary.
10. `browser_wait_for_text` observes a bounded visible text target.
11. `browser_screenshot` returns PNG image content/metadata without creating a caller-selected output path.
12. `browser_console_errors` returns only the bounded recent warning/error tail.
13. `browser_network_errors` returns bounded failed/error responses with URL query strings/fragments stripped.
14. `browser_select_tab` brings the chosen opaque page ID to front.
15. `browser_close_tab` invalidates the page ID.
16. `browser_close` closes the owned context; a later authorized browser operation may lazily create a fresh context against the same dedicated profile.

Do not use personal email, banking, password-manager, payment, or other sensitive authenticated pages as acceptance fixtures.

For Existing-Chrome acceptance, use the dedicated [docs/EXISTING_CHROME_ATTACH.md](EXISTING_CHROME_ATTACH.md) flow and a page the user explicitly permits. Verify eligible HTTP(S) tabs and a bounded snapshot, confirm internal Chrome/extension/DevTools pages are absent, avoid user-visible destructive actions, then close only the runtime connection and prove the normal Chrome process/pre-existing tabs survive and a later browser operation can establish a fresh connection.

## 14. Browser safety acceptance

With Browser Runtime enabled, verify fail-closed behavior:

1. Disabled-gate `browser_tabs` -> categorical gate error.
2. Revoked/expired lease browser call -> authority error before browser action.
3. `browser_navigate` with `file:///tmp/test` -> `BROWSER_NAVIGATION_REFUSED`.
4. `browser_navigate` with `javascript:...` -> `BROWSER_NAVIGATION_REFUSED`.
5. Password-shaped fill target -> `BROWSER_CREDENTIAL_ENTRY_REFUSED` with no field mutation.
6. OTP/verification/payment-card-shaped target -> `BROWSER_CREDENTIAL_ENTRY_REFUSED`.
7. credential-shaped focused field + key action -> refusal before key dispatch.
8. zero semantic target matches -> `BROWSER_TARGET_NOT_FOUND`.
9. multiple semantic target matches -> `BROWSER_TARGET_AMBIGUOUS`.
10. MCP tool schemas reject extra raw-selector/JavaScript/CDP/executable-path fields.
11. disabled Browser Runtime remains unavailable even with open scope.

The Browser Runtime does not type credentials. Existing authenticated state stored in the dedicated profile can still make private pages visible to inspection, so protect that profile as privileged local state.

## 15. Browser audit acceptance

Default audit location:

```text
~/.chatgpt-system/audit.jsonl
```

After controlled browser operations, inspect the audit records and verify they do **not** contain:

- authority lease IDs;
- browser page IDs;
- fill/typed text;
- ARIA snapshot text;
- screenshot bytes/base64;
- console payload text;
- URL query strings or fragments;
- cookies/storage values;
- credentials.

Categorical operation/outcome/duration, bounded counts, sanitized host/origin, and stable error codes are acceptable.

## 16. Cancellation acceptance (removed ceremony)

Serbest modda local onay töreni yoktur. İptal/ret/timeout durumlarında yarım kalmış lease sızıntısı olmaz: `session_authority_end` idempotent değildir, biten lease tekrar kullanılamaz; daemon restart parked worker'ları otomatik canlandırmaz.

## 17. Legacy control socket (removed from the runtime)

Serbest modda local-approval control socket yoktur. Eski kurulumlardan kalan `~/.chatgpt-system/control.sock` ve `persistent-owner-mode.json` daemon ilk açılışta yok sayılır/silinir. Setup çıktısı artık broker/control yolu içermez; runtime broker'ı çağırmaz.

## 18. Shutdown acceptance

On a controlled local run with Computer Runtime, a managed process, and Browser Runtime active, terminate the daemon normally and verify cleanup is attempted in this order:

```text
full-host JavaScript runner/process-group cleanup
computer runtime / held-input cleanup
managed processes
browser context
MCP transport/server
```

A simulated/tested failure in an earlier phase must not skip later cleanup phases.

Browser page IDs and diagnostic buffers are in-memory only. The dedicated browser profile is persistent by design.

## 19. Web and Desktop

Validate Web first, then Desktop with the same installed plugin/backend. Do not create a second permanent authority implementation for Desktop. Count actual MCP calls, not UI labels, as acceptance evidence.

Browser Runtime exists so normal web tasks can prefer deterministic semantic automation. Computer Runtime v2 Slice 5 is the separate startup-gated native desktop-control surface. ChatGPT can use direct semantic/coordinate computer tools, typed `computer_run`, and separately gated owner-trust `computer_run_js`; the native helper owns AX-first resolution, bounded recovery, focused-window Vision enrichment, and fail-closed stale/ambiguous target handling.

## 20. Troubleshooting order

1. `npm run check`
2. `npm run test:computer:macos` when validating the native Computer Runtime v2 helper
3. `npm run package:computer:macos` when validating its disposable staged helper `.app`
4. `npm run package:computer-fixture:macos` when validating the synthetic local acceptance fixture
5. `npm run setup:computer:macos` when installing/updating the stable daily-driver Computer Runtime
6. `npm run setup:browser` when Browser Runtime is required
7. for a stale full-capability profile, rerun `npm run setup:chatgpt -- ... --enable-terminal --enable-owner-runtime --enable-browser --enable-computer-use --enable-full-host-js --force --doctor`
8. `tunnel-client doctor --profile chatgpt-system --explain`
9. restart `tunnel-client run --profile chatgpt-system` only when applying a new child command/build
10. refresh the ChatGPT plugin catalog
11. Project acceptance
12. Open-scope acceptance
13. Open host/process acceptance
14. Browser functional acceptance
15. Computer Runtime functional/takeover acceptance
16. Browser/computer safety and audit acceptance
17. inspect `~/.chatgpt-system/audit.jsonl` for non-secret evidence

A connectivity problem is not fixed by widening filesystem scope. Humanity has benchmarked that approach extensively enough.

## Current phase boundary

Implemented:

- Open scope: bootstrap roots + optional Project leases, no User/Admin profiles;
- direct Project authority in MCP;
- no local authorization CLI, no control plane, no approval broker;
- structured one-shot terminal execution behind the terminal startup gate;
- managed process start with open-scope list/status/logs/stop;
- opaque process IDs, bounded logs/registry, POSIX process-group cleanup;
- deterministic startup-gated Playwright Browser Runtime;
- semantic browser targets, credential refusal, snapshot/network redaction, and bounded diagnostics;
- dedicated persistent Chromium automation profile;
- ordered full-host JavaScript/computer/Owner-PTY/Owner-shell/process/browser/transport runtime cleanup;
- Swift 6/macOS 14+ Computer Runtime v2 native layer plus dedicated TypeScript native-host supervisor;
- passive TCC health, bounded app/window + AX observation, ScreenCaptureKit screenshot capture, deterministic open/focus, physical mouse/keyboard input, held-input cleanup, takeover/emergency safety, and deterministic AX/text/screen-region verification;
- stable fixed-path daily-driver helper signing/install plus disposable helper/fixture packaging;
- lease-free `computer_health`, startup-gated strict `computer_*` MCP tools, bounded typed `computer_run`, and separately gated `computer_run_js`;
- fixed per-call full-host runner with stdin-only source, sanitized secret-bearing environment, bounded source/runtime/output, private low-level computer RPC, process-group cleanup for ordinary descendants, request cancellation, and takeover-fatal termination;
- Slice 5 semantic AX/label/text/index/point/OCR targets, bounded recovery, stale-snapshot refusal, focused-window Vision enrichment, and fresh-observation cache refresh;
- lease expiry/revoke/isolation;
- audit redaction.

Next separate capability layers:

- no additional Computer Runtime feature layer is implied by Slice 5 completion; any expansion requires a separate plan;
- typed root-only ServiceManagement/XPC operations only for concrete root-only needs.

## Computer Use reliability v2 contract

The structured `computer_observe` element contract exposes `parentIndex`, `depth`, bounded `actions`, and `scroll` capability metadata so the model can reason about hierarchy and deterministic containers instead of inferring layout from pixels. Semantic targets use the same scoped `within` form in standalone tools and `computer_run`; point targets remain explicit and are never silently promoted into semantic recovery.

The decision ladder is: prefer semantic AX targeting first; for an off-screen semantic target in a known deterministic container, use scoped `computer_scroll_until_visible`; use bounded OCR fallback only when AX evidence is insufficient; after semantic options are exhausted, obtain a fresh screenshot. A visual fallback permits at most one verified point attempt against that fresh state. Do not repeat an unchanged point or scroll attempt: fresh observation and replanning are required.

Mutation completion is evidence-aware. `verified` means the requested verifier succeeded; `completed_unverified` means physical dispatch completed without proof of the intended UI effect. Callers must not reinterpret event posting alone as verification. Screenshot metadata carries explicit display bounds and pixel-to-screen scales; bounded scrolling stops at six physical scrolls or earlier on an unchanged digest and never switches to raw coordinates automatically.

Recovery error details remain non-sensitive and bounded. The public recovery evidence contains only `candidateCount`, `scopeResolved`, `activeScrollContainerCount`, and `recommendedRecovery` (`observe`, `scope-target`, `scroll`, `screenshot`, or `none`). Target text, OCR text, page content, native diagnostics, and guessed coordinates are not copied into these details; callers use the categorical recommendation together with a fresh observation when replanning.
