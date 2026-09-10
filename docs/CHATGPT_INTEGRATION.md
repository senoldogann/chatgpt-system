# ChatGPT personal plugin integration

This runbook connects `chatgpt-system` to ChatGPT Web/Desktop through an OpenAI Secure MCP Tunnel while keeping the Mac private and keeping broad authority under local user control.

Browser Runtime is part of the same shared authority boundary. ChatGPT remains the reasoning agent; Playwright is deterministic browser infrastructure.

Computer Runtime v2 Slice 3 connects the accepted Swift/macOS 14+ helper to the same shared TypeScript authority boundary. ChatGPT remains the reasoning agent; the native helper is deterministic observation/input infrastructure reached through strict Admin-scoped `computer_*` tools and bounded typed `computer_run`.

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
        +-- Project authority: direct MCP, filesystem/Git, no terminal/browser content
        |
        +-- private Unix control socket ~/.chatgpt-system/control.sock
        |            ^
        |            |
        |  chatgpt-system authorize user|admin
        |            |
        |            v
        |  protected macOS LocalAuthentication helper
        |            |
        |            v
        |  same in-memory AuthorityManager
        |
        +-- User: home scope, no terminal/browser content
        |
        +-- Admin: host scope as current OS user
        |      |
        |      +-- terminal + managed processes when terminal gate enabled
        |      |
        |      +-- Browser Runtime when browser gate enabled
        |      |         |
        |      |         v
        |      |   BrowserService policy -> Playwright persistent Chromium
        |      |
        |      +-- Computer Runtime when computer-use gate enabled
        |                |
        |                v
        |          shared ComputerRuntime / native supervisor
        |                |
        |                v
        |          signed macOS helper over inherited NDJSON stdio
        |
        +-- shared ProcessSupervisor
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend. Normal Chat and Work can route product safety differently, so actual MCP calls are the evidence that matters.

## 1. Prerequisites

- ChatGPT Developer Mode enabled.
- Node.js 22+.
- Git.
- `tunnel-client`.
- Secure MCP Tunnel associated with the intended ChatGPT workspace.
- Runtime tunnel credential available to `tunnel-client`, normally through `CONTROL_PLANE_API_KEY`.
- Swift/Xcode command-line tools on macOS for native approval.
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

When validating an unmerged feature branch, replace `main` with that exact branch and keep the tunnel child on the same build.

## 3. Build and install the protected native broker

Build as the normal user:

```bash
npm run build:broker:macos
```

Install with explicit macOS administrator authorization:

```bash
sudo npm run install:broker:macos
```

Production locations:

```text
/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker
/Library/Application Support/chatgpt-system/etc/authority-broker.sha256
```

The runtime never executes repository `.build/release` output as the production approval helper. Before every User/Admin approval it verifies protected-path ownership, file type, permissions, and SHA-256 identity.

## 3a. Build, sign, and install Computer Runtime v2 Slice 3

The native helper remains under `native/macos-computer-runtime`, requires macOS 14+, and communicates only through inherited stdin/stdout using strict bounded NDJSON. Slice 3 adds the TypeScript supervisor, Admin policy, strict MCP registration, bounded typed `computer_run`, stable daily-driver installation, and ordered shutdown cleanup.

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

The native protocol implements passive `health`, bounded `list_apps`, AX-first `active_window` / `observe`, bounded in-memory ScreenCaptureKit `screenshot`, app open/focus, pointer movement, click/double-click, mouse down/up, drag, bounded scroll, Unicode typing, named key/chord actions, `release_inputs`, and deterministic AX/text/screen-region verification primitives. Health reports passive Accessibility, Screen Recording, event-listen, and event-post readiness without requesting permission.

Physical mutations are serialized and every synthetic CoreGraphics event uses one runtime-owned tag. A listen-only takeover monitor ignores owned events, interrupts active actions on conservative unowned user input, and recognizes the fixed Control+Option+Command+Escape emergency chord. TCC is only preflighted; the protocol does not request or bypass Accessibility, Screen Recording, event-listen, or event-post permission.

The fixture remains deterministic local acceptance infrastructure only and contains no user data. Slice 3 installs the production helper at the fixed daily-driver path and exposes it through one shared TypeScript supervisor. `computer_run_js`, arbitrary full-host JavaScript, OCR, semantic target resolution, and stale-target recovery remain absent. Installing or testing the helper does not itself require restarting the daily-driver daemon.

## 4. Install the browser binary

Browser Runtime uses the exact Playwright dependency pinned by the repository. Install its Chromium binary once on the target Mac:

```bash
cd ~/chatgpt-system
npm run setup:browser
```

The setup script has a fixed purpose: install Chromium through the repository-local Playwright CLI. It accepts no caller-selected browser, channel, executable path, proxy, or arbitrary Playwright argument.

The browser runtime itself remains disabled until the tunnel/daemon startup configuration explicitly enables it.

## 5. Configure the Secure MCP Tunnel profile

Create a disposable bootstrap root:

```bash
rm -rf /tmp/chatgpt-system-acceptance
mkdir -p /tmp/chatgpt-system-acceptance
cd /tmp/chatgpt-system-acceptance
git init
printf 'before\n' > fixture.txt
git add fixture.txt
git commit -m 'test fixture' || true
```

For a private daily-driver acceptance profile with terminal, personal-admin, Browser Runtime, and Computer Runtime enabled:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --personal-admin \
  --enable-browser \
  --enable-computer-use \
  --doctor
```

Optional headless mode:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --personal-admin \
  --enable-browser \
  --browser-headless \
  --doctor
```

`--browser-headless` without `--enable-browser` is rejected.

The capability gates are independent:

- omitting `--enable-terminal` keeps one-shot/managed process execution disabled;
- omitting `--personal-admin` preserves local User/Admin approval;
- omitting `--enable-browser` keeps Browser Runtime disabled even for Admin;
- omitting `--enable-computer-use` keeps Computer Runtime disabled even for Admin;
- enabling Browser or Computer Runtime does not make Project/User capable of using those surfaces.

The default browser profile is:

```text
~/.chatgpt-system/browser-profile
```

Use a dedicated automation profile. Do not make the operator's everyday Chrome profile the normal acceptance target.

If the `chatgpt-system` tunnel profile already exists and its child command is stale, replacement is intentionally explicit:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --personal-admin \
  --enable-browser \
  --enable-computer-use \
  --force \
  --doctor
```

`--force` replaces only the existing `tunnel-client` profile configuration. It does not delete repository data or bypass Project/User/Admin policy.

The generated stdio target includes the private control socket and only the explicit feature gates selected during setup.

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

Verify the local control socket:

```bash
ls -ld ~/.chatgpt-system
ls -l ~/.chatgpt-system/control.sock
```

Expected permissions:

```text
~/.chatgpt-system                drwx------
~/.chatgpt-system/control.sock   srw-------
```

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
terminal_run
process_start
process_list
process_status
process_logs
process_stop
```

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

`browser_health` is lease-free and categorical. Every other browser tool requires Admin authority. Browser MCP schemas do not accept raw selectors, JavaScript, CDP endpoints, proxy/executable settings, cookie/storage operations, or file-upload paths.

Computer Runtime v2 Slice 3 exposes this strict MCP catalog:

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
computer_run
```

`computer_health` is lease-free and categorical. Every other computer tool requires Admin authority. Direct `computer_mouse_down` / `computer_mouse_up` are not registered, but raw hold primitives may be used inside one bounded `computer_run`, whose finalizer releases held input. `computer_run_js` is absent.

## 8. Privilege ladder

| Profile | Scope | TTL max | Terminal/process | Browser content/actions | Computer content/actions | Creation |
| --- | --- | ---: | --- | --- | --- | --- |
| Project | explicit project roots | 8 h | No | No | No | MCP direct |
| User | current user's canonical home | 4 h | No | No | No | local CLI + native auth |
| Admin | `/` as current OS user | 1 h | Yes when terminal gate enabled | Yes when browser gate enabled | Yes when computer-use gate enabled | local CLI + native auth by default; MCP direct in personal-admin mode |

Admin is not UID 0. Root-only operations are not part of this boundary.

## 9. Project acceptance

Create Project authority for:

```text
/tmp/chatgpt-system-acceptance
```

Verify:

1. `fs_read fixture.txt` succeeds.
2. `git_status` succeeds.
3. sibling/outside read returns `POLICY_DENIED`.
4. `terminal_run node --version` returns `POLICY_DENIED`.
5. `process_start node ...` returns `POLICY_DENIED`.
6. `browser_tabs` returns `POLICY_DENIED` even if Browser Runtime is enabled globally.
7. `session_authority_end` succeeds.
8. ended-lease reuse returns `AUTHORITY_REQUIRED`.

## 10. User authorization and acceptance

Do not ask ChatGPT to create User authority. On the Mac:

```bash
cd ~/chatgpt-system
node dist/cli.js authorize user
```

Approve with macOS LocalAuthentication. The normal CLI prints safe metadata and copies the raw lease to the clipboard without printing it.

Paste the lease once into ChatGPT and verify:

1. status reports `profile=user`, home scope, terminal disabled;
2. reading a file under the home scope succeeds;
3. `/etc/hosts` is outside User scope and returns `POLICY_DENIED`;
4. `terminal_run` returns `POLICY_DENIED`;
5. `process_start` returns `POLICY_DENIED`;
6. `browser_tabs` returns `POLICY_DENIED`;
7. a known Admin-created process ID returns `PROCESS_NOT_FOUND` rather than leaking metadata;
8. ending the lease revokes it.

Independent product safety can still block an operation before MCP receives it. Record that separately rather than widening local authority to bypass it.

## 11. Admin authorization and one-shot acceptance

If personal-admin is disabled, authorize locally:

```bash
cd ~/chatgpt-system
node dist/cli.js authorize admin
```

Approve locally, paste the copied lease into ChatGPT, then verify:

1. status reports `profile=admin`, root `/`;
2. `/etc/hosts` can be read when the product forwards the call;
3. `terminal_run node --version` succeeds only when terminal startup gate is enabled;
4. `sh -c ...` remains `POLICY_DENIED` when `sh` is not allowlisted;
5. executable paths such as `/usr/bin/node` remain rejected.

In personal-admin mode, use `session_authority_start(profile="admin")` instead and verify the same fixed Admin capability profile.

No destructive system operation is needed for acceptance.

## 12. Managed Process Supervisor acceptance

With an active Admin lease, start a harmless inline Node fixture:

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
6. A later compatible Admin lease can still inspect/stop the process.
7. `process_stop` is idempotent.
8. User authority sees no record and known-ID lookup returns `PROCESS_NOT_FOUND`.
9. non-allowlisted `sh` remains `POLICY_DENIED`.

Managed records/logs are in memory only. A clean daemon shutdown attempts to stop running children. An abrupt crash can leave a detached child alive; the next daemon does not sweep arbitrary PIDs.

## 13. Browser Runtime functional acceptance

Run this only after `npm run setup:browser`, with Browser Runtime enabled and an active Admin lease.

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

## 14. Browser safety acceptance

With Browser Runtime enabled, verify fail-closed behavior:

1. Project `browser_tabs` -> `POLICY_DENIED`.
2. User `browser_tabs` -> `POLICY_DENIED`.
3. Revoked/expired Admin browser call -> authority error before browser action.
4. `browser_navigate` with `file:///tmp/test` -> `BROWSER_NAVIGATION_REFUSED`.
5. `browser_navigate` with `javascript:...` -> `BROWSER_NAVIGATION_REFUSED`.
6. Password-shaped fill target -> `BROWSER_CREDENTIAL_ENTRY_REFUSED` with no field mutation.
7. OTP/verification/payment-card-shaped target -> `BROWSER_CREDENTIAL_ENTRY_REFUSED`.
8. credential-shaped focused field + key action -> refusal before key dispatch.
9. zero semantic target matches -> `BROWSER_TARGET_NOT_FOUND`.
10. multiple semantic target matches -> `BROWSER_TARGET_AMBIGUOUS`.
11. MCP tool schemas reject extra raw-selector/JavaScript/CDP/executable-path fields.
12. disabled Browser Runtime remains unavailable even with a valid Admin lease.

The Browser Runtime does not type credentials. Existing authenticated state stored in the dedicated profile can still make private pages visible to Admin-authorized inspection, so protect that profile as privileged local state.

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

## 16. Cancellation acceptance

Run:

```bash
node dist/cli.js authorize user
```

Cancel the macOS authentication UI. The CLI must exit non-zero with a safe categorical error and no lease produced/copied.

Cancellation, denial, failure, timeout, malformed helper output, trust failure, control-client disconnect, or server restart must never leave an undisclosed live lease behind.

## 17. Control socket and protected-helper checks

Inspect socket ownership/mode:

```bash
stat -f '%N | owner=%Su | uid=%u | mode=%Sp' \
  ~/.chatgpt-system \
  ~/.chatgpt-system/control.sock
```

Stopping the tunnel cleanly removes the socket. A stale owned socket may be replaced; regular files, symlinks, unexpected-owner sockets, and compatible live sockets fail closed.

Repository helper rebuilds must not change the production executable selected from `/Library/Application Support/chatgpt-system/...`.

## 18. Shutdown acceptance

On a controlled local run with Computer Runtime, a managed process, and Browser Runtime active, terminate the daemon normally and verify cleanup is attempted in this order:

```text
computer runtime / held-input cleanup
managed processes
browser context
local authority control socket
MCP transport/server
```

A simulated/tested failure in an earlier phase must not skip later cleanup phases.

Browser page IDs and diagnostic buffers are in-memory only. The dedicated browser profile is persistent by design.

## 19. Web and Desktop

Validate Web first, then Desktop with the same installed plugin/backend. Do not create a second permanent authority implementation for Desktop. Count actual MCP calls, not UI labels, as acceptance evidence.

Browser Runtime exists so normal web tasks can prefer deterministic semantic automation. Computer Runtime v2 Slice 3 is now the separate Admin-gated native desktop-control surface. ChatGPT can use strict low-level computer tools and typed `computer_run`; semantic recovery and arbitrary full-host JavaScript remain separate later capabilities.

## 20. Troubleshooting order

1. `npm run check`
2. `npm run test:computer:macos` when validating the native Computer Runtime v2 helper
3. `npm run package:computer:macos` when validating its disposable staged helper `.app`
4. `npm run package:computer-fixture:macos` when validating the synthetic local acceptance fixture
5. `npm run setup:computer:macos` when installing/updating the stable daily-driver Computer Runtime
6. `npm run build:broker:macos`
7. `sudo npm run install:broker:macos`
8. `npm run setup:browser` when Browser Runtime is required
9. for a stale profile, rerun `npm run setup:chatgpt -- ... --enable-terminal --personal-admin --enable-browser --enable-computer-use --force --doctor`
10. `tunnel-client doctor --profile chatgpt-system --explain`
11. restart `tunnel-client run --profile chatgpt-system` only when applying a new child command/build
12. verify `~/.chatgpt-system/control.sock`
13. refresh the ChatGPT plugin catalog
14. Project acceptance
15. User acceptance
16. Admin/process acceptance
17. Browser functional acceptance
18. Computer Runtime functional/takeover acceptance
19. Browser/computer safety and audit acceptance
20. inspect `~/.chatgpt-system/audit.jsonl` for non-secret evidence

A connectivity problem is not fixed by widening authority. Humanity has benchmarked that approach extensively enough.

## Current phase boundary

Implemented:

- Project/User/Admin filesystem and Git authority;
- direct Project authority in MCP;
- local User/Admin authorization CLI;
- private same-runtime Unix control plane;
- protected native User/Admin approval helper;
- Admin-only structured one-shot terminal execution;
- Admin-only managed process start with authority-scoped list/status/logs/stop;
- opaque process IDs, bounded logs/registry, POSIX process-group cleanup;
- deterministic Admin-only Playwright Browser Runtime;
- semantic browser targets, credential refusal, snapshot/network redaction, and bounded diagnostics;
- dedicated persistent Chromium automation profile;
- ordered computer/process/browser/control/transport runtime cleanup;
- Swift 6/macOS 14+ Computer Runtime v2 native layer plus dedicated TypeScript native-host supervisor;
- passive TCC health, bounded app/window + AX observation, ScreenCaptureKit screenshot capture, deterministic open/focus, physical mouse/keyboard input, held-input cleanup, takeover/emergency safety, and deterministic AX/text/screen-region verification;
- stable fixed-path daily-driver helper signing/install plus disposable helper/fixture packaging;
- lease-free `computer_health`, Admin-only strict `computer_*` MCP tools, and bounded typed `computer_run`;
- no `computer_run_js`, arbitrary full-host JavaScript runner, OCR, semantic target resolver, or recovery engine in Slice 3;
- lease expiry/revoke/isolation;
- audit redaction.

Next separate capability layers:

- Slice 4 full-host execution only behind its dedicated containment and policy gates;
- Slice 5 semantic target resolution, OCR fallback, stale-target recovery, and recovery ladder;
- typed root-only ServiceManagement/XPC operations only for concrete root-only needs.
