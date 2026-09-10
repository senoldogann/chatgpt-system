# chatgpt-system

<p align="center">
  <a href="https://github.com/senoldogann/chatgpt-system/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/senoldogann/chatgpt-system/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="macOS" src="https://img.shields.io/badge/platform-macOS-111111?logo=apple&logoColor=white">
  <img alt="Node.js 22 and 24" src="https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=nodedotjs&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-local%20authority%20gateway-5B5BD6">
  <img alt="Playwright" src="https://img.shields.io/badge/browser-Playwright%201.63.0-2EAD33">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-blue">
</p>

Secure local MCP authority gateway for controlled filesystem, Git, process, and browser automation from ChatGPT-compatible MCP clients.

`chatgpt-system` is deliberately not a permanently privileged natural-language shell. Authority is explicit, scoped, expiring, revocable, auditable, and enforced on the Mac. Browser automation follows the same rule instead of quietly becoming a side door around it.

## At a glance

| Capability | What it provides |
| --- | --- |
| **Secure MCP Tunnel** | Outbound-only personal ChatGPT connectivity without exposing a raw public MCP port |
| **Scoped authority** | Project, User, and Admin profiles with fixed local privilege boundaries |
| **Filesystem + Git** | Confined file operations plus typed Git read/write primitives |
| **Admin execution** | Allowlisted `shell=false` commands and managed development processes |
| **Browser Runtime** | Admin-only semantic Playwright automation, screenshots, and bounded browser diagnostics |
| **Computer Runtime v2 Slice 3** | Admin-gated MCP computer control backed by a signed Swift/macOS 14+ helper, strict TypeScript supervisor, typed batching, takeover safety, and deterministic verification |
| **macOS trust** | LocalAuthentication for broad authority and Keychain-backed daily-driver credentials |
| **Daily driver** | LaunchAgent startup, automatic tunnel reconnect, bounded logs, and no routine Terminal ceremony |

## Architecture

```mermaid
flowchart LR
    ChatGPT["ChatGPT Web / Desktop"] --> Tunnel["OpenAI Secure MCP Tunnel"]
    Tunnel --> Client["tunnel-client on macOS"]
    Client --> Runtime["chatgpt-system MCP runtime"]

    Runtime --> Authority["Authority Manager"]
    Authority --> Project["Project<br/>repo scoped"]
    Authority --> User["User<br/>home scoped"]
    Authority --> Admin["Admin<br/>host scope as current user"]

    Runtime --> Files["Filesystem"]
    Runtime --> Git["Typed Git"]
    Runtime --> Exec["Admin terminal + managed processes"]
    Runtime --> Browser["Admin Browser Runtime"]
    Browser --> Playwright["Playwright 1.63.0"]
    Runtime --> Computer["Admin Computer Runtime"]
    Computer --> Native["Signed macOS helper\ninherited NDJSON stdio"]
    Playwright --> Chromium["Dedicated Chromium profile"]
    Runtime --> Audit["Redacted audit log"]

    LocalAuth["macOS LocalAuthentication"] --> Authority
    Keychain["macOS Keychain"] --> Client
```

The tunnel is transport, not authority. Privilege decisions remain local to the Mac. Admin still runs as the current macOS user rather than root. Browser automation and Computer Runtime are independently gated Admin capabilities; neither is a network or OS sandbox.

## Current implementation

The shared runtime currently includes:

- MCP TypeScript SDK v2 / 2026-07-28 protocol support;
- stdio and authenticated Streamable HTTP transports;
- personal ChatGPT Plugin path through OpenAI Secure MCP Tunnel;
- Project / User / Admin authority leases;
- direct Project authority from MCP with no terminal/browser content capability;
- local User/Admin authorization through a private Unix socket and macOS LocalAuthentication;
- optional explicit personal-admin mode for a private daily-driver workstation;
- protected root-owned native approval helper with pinned SHA-256 metadata;
- filesystem confinement, symlink escape protection, optimistic SHA-256 mutation guards, and atomic replacement;
- typed Git status/diff/log/branch/stage/commit/merge/push operations;
- Admin-only allowlisted one-shot execution with `shell=false`;
- Admin-only managed process supervision with opaque IDs, bounded logs, and POSIX process-group cleanup;
- Admin-only deterministic Playwright Browser Runtime with semantic targeting and bounded diagnostics;
- browser credential-entry refusal and editable ARIA value redaction;
- Swift 6/macOS 14+ Computer Runtime v2 helper with strict bounded NDJSON over inherited stdin/stdout;
- passive Accessibility, Screen Recording, event-listen, and event-post readiness plus bounded app/window + AX observation and an 8 MiB ScreenCaptureKit screenshot path;
- deterministic app open/focus, pointer movement, click/double-click, mouse down/up, drag, scroll, Unicode typing, named keys/chords, and `release_inputs` on one serialized physical-action lane;
- one runtime-owned CoreGraphics event tag, listen-only takeover monitoring, fixed Control+Option+Command+Escape emergency stop, and deterministic AX/text/screen-region verification primitives;
- dedicated TypeScript native-host supervisor with fixed helper path, strict request/response correlation, crash/restart handling, bounded frames, and one shared `ComputerRuntime`;
- lease-free categorical `computer_health`, Admin-only strict `computer_*` MCP tools, and bounded typed `computer_run` with no automatic mutation retry or rollback claim;
- stable daily-driver installer at `~/.chatgpt-system/ChatGPTSystemComputerRuntime.app`, preserving the fixed bundle ID `com.senoldogann.chatgpt-system.computer-runtime` and designated requirement across updates;
- no `computer_run_js`, arbitrary full-host JavaScript runner, OCR, semantic target resolver, or stale-target recovery ladder yet;
- JSONL audit trail with redacted authority/process/browser/computer metadata;
- localhost Host/Origin validation for HTTP mode;
- Node 22 / Node 24 CI plus native macOS build/install verification.

Computer Runtime v2 Slice 3 connects the accepted native physical-input layer to the shared TypeScript runtime and MCP surface. The helper remains deterministic infrastructure while ChatGPT remains the reasoning agent. Full-host JavaScript, OCR, semantic target resolution, and autonomous recovery remain later capability boundaries rather than being smuggled into this slice.

## Requirements

- Node.js 22 or newer
- npm
- Git
- macOS + Swift/Xcode command-line tools for native User/Admin approval; the standalone Computer Runtime v2 helper specifically requires macOS 14+
- `tunnel-client` when using the personal ChatGPT Plugin route
- Chromium installed through the repository-pinned Playwright CLI when Browser Runtime is enabled

## Install and verify

```bash
git clone https://github.com/senoldogann/chatgpt-system.git
cd chatgpt-system
npm install
npm run check
```

For local stdio development:

```bash
npm run dev -- stdio --root /absolute/path/to/project
```

## Browser Runtime

Browser automation is disabled by default. Install the pinned Chromium binary once:

```bash
npm run setup:browser
```

The setup command accepts no browser/channel/command override. It invokes the repository-pinned Playwright CLI for Chromium with a bounded child-process lifetime.

Enable Browser Runtime explicitly:

```bash
npm run dev -- stdio \
  --root /absolute/path/to/project \
  --enable-browser
```

Optional headless mode:

```bash
npm run dev -- stdio \
  --root /absolute/path/to/project \
  --enable-browser \
  --browser-headless
```

Default browser configuration:

```text
CHATGPT_SYSTEM_ENABLE_BROWSER=false
CHATGPT_SYSTEM_BROWSER_HEADLESS=false
CHATGPT_SYSTEM_BROWSER_TIMEOUT_MS=10000
CHATGPT_SYSTEM_BROWSER_USER_DATA_DIR=~/.chatgpt-system/browser-profile
```

The default user-data directory is intentionally a dedicated automation profile. Do not point normal automation at your everyday Chrome/Chromium profile unless you deliberately accept the additional exposure.

### Browser authority boundary

`browser_health` is lease-free and returns only categorical readiness.

All other browser tools require an active Admin lease because tabs, URLs, page content, screenshots, console output, and network diagnostics can reveal authenticated user-session information unrelated to a Project/User filesystem scope.

Project and User leases therefore cannot inspect or mutate browser content.

### Browser target model

Browser actions accept semantic targets only:

```text
role
text
label
testId
```

Raw CSS/XPath selectors, arbitrary JavaScript, generated Playwright code, cookies/storage APIs, CDP endpoints, proxy settings, executable paths, browser flags, request interception, and file-upload primitives are not exposed through MCP.

Navigation accepts only `http:` and `https:` URLs. Credential-shaped fields such as passwords, OTPs, verification codes, and payment-card secrets are refused before input reaches Playwright. Editable ARIA values are redacted before snapshots leave the runtime.

Browser actions are serialized through one runtime-owned operation chain so concurrent sessions cannot race tab/focus mutations inside the owned context.

## Computer Runtime v2 Slice 3

Slice 3 keeps the Swift helper under `native/macos-computer-runtime` and adds the TypeScript native-host supervisor, Admin policy, strict MCP tools, bounded typed `computer_run`, stable installation, and shutdown integration. The helper requires macOS 14+ and communicates only over inherited stdin/stdout using strict bounded NDJSON; there is no computer socket or caller-selected executable path. The native protocol includes passive `health`, bounded `list_apps`, AX-first `active_window` / `observe`, bounded ScreenCaptureKit `screenshot`, app open/focus, pointer/mouse/scroll actions, keyboard text/key/chords, `release_inputs`, `wait_for_frontmost`, `wait_for_text`, `wait_until_changed`, and optional post-action verification.

Build, test, and stage the fixed background app bundle with:

```bash
npm run test:computer:macos
npm run build:computer:macos
npm run package:computer:macos
npm run build:computer-fixture:macos
npm run package:computer-fixture:macos

# Daily-driver install with a stable Keychain code-signing identity:
npm run setup:computer:macos
```

The disposable staged bundles and stable daily-driver location are:

```text
native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app
native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app
~/.chatgpt-system/ChatGPTSystemComputerRuntime.app
```

CI/staging packaging remains explicitly ad-hoc. `setup:computer:macos` instead reuses the currently installed signer when possible, accepts an exact valid `--identity`, or selects one unambiguous Apple Development/Developer ID identity. It never silently falls back to ad-hoc signing. `--ad-hoc-development` exists only for disposable development and reports that TCC identity is unstable.

The helper bundle identifier is fixed to `com.senoldogann.chatgpt-system.computer-runtime`; the synthetic local acceptance fixture is fixed to `com.senoldogann.chatgpt-system.computer-runtime.fixture`. `health` uses passive TCC preflight checks only. Physical posting/listening also uses passive preflight checks; the protocol does not request or bypass TCC. Screenshot capture and screen-region verification stay in memory.

Physical mutations are serialized and tagged with one runtime-owned CoreGraphics tag. A listen-only monitor ignores owned events, interrupts active automation on conservative unowned user input, and recognizes the fixed Control+Option+Command+Escape emergency chord. Verification uses bounded safe AX title/description state or in-memory screen-region digests; it does not read editable AX values or use OCR.

Slice 3 exposes strict Computer Runtime MCP tools through the shared authority boundary. `computer_health` is lease-free and categorical; every observation, screenshot, app-focus, physical-input, wait, release, and `computer_run` operation requires Admin authority. Raw `mouse_down` / `mouse_up` are intentionally absent as direct MCP tools but are available inside one bounded `computer_run`, whose finalizer releases held input. There is still no `computer_run_js`, OCR, semantic resolver, or recovery engine.

## Personal ChatGPT Plugin

For a personal ChatGPT Developer Mode plugin, use OpenAI Secure MCP Tunnel so the Mac does not expose a public inbound MCP port.

Create the tunnel in OpenAI Platform, then configure the local profile. For the full daily-driver capability set including browser:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-test-project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --personal-admin \
  --enable-browser \
  --enable-computer-use \
  --doctor
```

The generated tunnel child command always enables the private local authority control socket. `--enable-terminal`, `--personal-admin`, and `--enable-browser` are separate explicit trust decisions. Omitting any of them preserves that capability's secure default.

Headless browser mode is optional:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-test-project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --personal-admin \
  --enable-browser \
  --browser-headless \
  --doctor
```

`--browser-headless` without `--enable-browser` is rejected.

If the `chatgpt-system` tunnel profile already exists and its child command is stale, replacement is intentionally explicit. Re-run setup with `--force`:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-test-project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --personal-admin \
  --enable-browser \
  --force \
  --doctor
```

`--force` replaces only the existing `tunnel-client` profile configuration. It does not delete repository data or bypass authority policy.

Run manually with:

```bash
tunnel-client run --profile chatgpt-system
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend. Normal Chat and Work may route product safety differently, so actual MCP calls are the acceptance evidence that matters.

See [docs/CHATGPT_INTEGRATION.md](docs/CHATGPT_INTEGRATION.md) for the full runbook.

## macOS daily driver

After the tunnel profile is configured, the optional daily-driver service can keep `tunnel-client` running automatically at login. The one-time installer stores `CONTROL_PLANE_API_KEY` in the macOS login Keychain and installs a user LaunchAgent.

Before installing, stop any manually running tunnel process. Then run once from a shell where the credential is already available:

```bash
npm run setup:daily-driver
```

Maintenance commands:

```bash
npm run daily-driver:status
npm run daily-driver:uninstall
```

The LaunchAgent runs as the logged-in user. The tunnel credential is not written to the plist, repository, audit log, runner logs, or spawned command argv.

## Authority privilege ladder

Every privileged filesystem/Git/process/browser-content call carries an opaque `authorityLeaseId`. The capability mapping is fixed by trusted local code and cannot be overridden by MCP input.

| Profile | Scope | Maximum lease | Terminal/process | Browser content/actions | Authority creation |
| --- | --- | ---: | --- | --- | --- |
| `project` | Explicit project root(s) | 8 hours | No | No | MCP `session_authority_start` |
| `user` | Canonical current-user home | 4 hours | No | No | Local CLI + macOS authentication |
| `admin` | `/` host-wide scope under current OS user | 1 hour | Yes when runtime gate enabled | Yes when browser gate enabled | Local CLI by default; MCP direct in personal-admin mode |

### Project authority

Project mode is the default for normal repository work:

```text
session_authority_start({
  profile: "project",
  projectRoots: ["/Users/you/Projects/my-app"]
})
```

It supports filesystem and built-in Git tools inside selected roots. `/` and the entire user home directory are rejected as Project roots.

### User/Admin local authorization

By default broad authority starts physically on the Mac:

```bash
chatgpt-system authorize user
chatgpt-system authorize admin
```

The flow is:

```text
local CLI
   |
   v
~/.chatgpt-system/control.sock
   |
   v
protected root-owned LocalAuthentication helper
   |
   v
same in-memory AuthorityManager
   |
   v
expiring lease
```

The normal CLI copies the raw lease to the clipboard rather than printing it. `--print-lease` is an explicit diagnostic escape hatch.

## Protected native approval helper

Build as the normal user:

```bash
npm run build:broker:macos
```

Install with explicit administrator authorization:

```bash
sudo npm run install:broker:macos
```

Protected production paths:

```text
/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker
/Library/Application Support/chatgpt-system/etc/authority-broker.sha256
```

The runtime verifies path type, ownership, permissions, and SHA-256 identity before each User/Admin native approval. Repository-local `.build/release` output is never trusted as the production approval executable.

## Admin is not root

An Admin lease provides host-wide scope where the current OS account has permission and can enable structured terminal/process/browser capabilities when their independent runtime gates are enabled. It does not grant UID 0 and does not cache or expose sudo credentials.

True root-only operations remain a future typed ServiceManagement/XPC boundary, not password piping, `sudo -S`, passwordless sudo, or a reusable root shell.

## MCP tool surface

### System and authority

```text
system_capabilities
system_environment
session_authority_start
session_authority_status
session_authority_end
```

### Filesystem

```text
fs_list
fs_stat
fs_read
fs_write
fs_apply_patch
fs_mkdir
fs_move
fs_remove
```

### Git

```text
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

`git_push` is Admin-only and pushes only the validated current branch to the existing credential-free GitHub `origin`. Remote/refspec/force input is not exposed.

### One-shot and managed processes

```text
terminal_run
process_start
process_list
process_status
process_logs
process_stop
```

Process execution requires terminal-capable authority, currently Admin. MCP never accepts or returns OS PIDs, process-group IDs, arbitrary signals, shell mode, detached mode, or caller-provided child environments.

### Browser

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

`browser_health` needs no lease; every other browser tool is Admin-only.

Computer Runtime v2 Slice 3 exposes the following MCP surface:

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

`computer_health` is lease-free; every other computer tool is Admin-only. Direct raw `computer_mouse_down` / `computer_mouse_up` and `computer_run_js` are not registered. Hold primitives exist only inside bounded typed `computer_run`.

Every MCP tool declares explicit safety annotations and output schemas. Successful calls return readable text plus validated structured content.

## Conflict-safe file editing

Existing regular files cannot be blindly overwritten:

1. read/stat the file;
2. keep the returned SHA-256;
3. pass it as `expectedSha256` to the mutation;
4. a concurrent change returns `CONFLICT` without applying the mutation.

Creating a new file does not require `expectedSha256`.

## Process safety

`terminal_run` and `process_start` share:

- `shell=false`;
- executable basename allowlist;
- active authority cwd checks;
- sanitized environment;
- bounded execution/logging.

Managed processes additionally use opaque IDs and daemon-controlled stop semantics. On POSIX the daemon sends `SIGTERM`, waits the configured grace period, and escalates to `SIGKILL` only if required.

Neither one-shot nor managed execution is an OS sandbox.

## Browser safety

Browser Runtime intentionally does not expose the full Playwright API. It is a narrow semantic capability with:

- independent startup opt-in;
- Admin-only page/content/action access;
- dedicated persistent automation profile;
- opaque in-memory page IDs;
- semantic locator allowlist;
- unique-target enforcement;
- HTTP(S)-only caller navigation;
- credential-shaped input refusal;
- editable-value snapshot redaction;
- bounded console/network diagnostics;
- query/fragment stripping from diagnostic URLs;
- in-memory screenshot delivery;
- serialized actions;
- categorical/stable browser errors.

It is not a browser/network sandbox. Remote pages still execute in Chromium with the OS/network permissions available to that process.

## Shutdown behavior

Clean shutdown attempts resources in order:

```text
computer runtime / held-input cleanup
      -> managed processes
      -> browser runtime/context
      -> local authority control socket
      -> MCP transport/server
```

A cleanup error in one phase does not skip later phases.

## Audit

Default audit location:

```text
~/.chatgpt-system/audit.jsonl
```

Audit records are operational metadata, not a tamper-proof compliance log. Browser audit intentionally excludes page IDs, typed text, snapshots, screenshots, console payloads, cookies/storage, credentials, and URL query/fragment data. Computer audit records only constructed operation metadata such as action, outcome, duration, safe error code, and bounded batch counts; typed text, coordinates, AX/UI text, screenshot bytes, native stderr, request IDs, and authority lease IDs are excluded.

See [SECURITY.md](SECURITY.md) for the complete trust model and limitations.

## Testing

Main verification command:

```bash
npm run check
```

CI verifies:

- Node.js 22 build/tests;
- Node.js 24 build/tests;
- native macOS authority helper build/install contract;
- macOS Computer Runtime v2 Swift tests, deterministic fake-sink physical-input/verification tests, fixed helper + fixture `.app` packaging, four-field passive native readiness smoke, and installer CLI contract;
- TypeScript Computer Runtime protocol/supervisor/policy/MCP/batch/shutdown tests;
- setup CLI smoke contracts without downloading a browser binary.

Browser unit tests use injected/fake backends and do not require graphical Chromium in CI. Real browser acceptance is performed separately on the target Mac after merge.

## Documentation

- [Security model](SECURITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [ChatGPT integration and acceptance runbook](docs/CHATGPT_INTEGRATION.md)
- [Browser Runtime design](docs/superpowers/specs/2026-09-09-browser-runtime-design.md)
- [Browser Runtime implementation plan](docs/superpowers/plans/2026-09-09-browser-runtime.md)

## Roadmap boundary

Browser Runtime remains the structured web layer. Computer Runtime v2 Slice 3 now provides the separate native desktop-control layer through explicit Admin-gated MCP tools and a bounded typed `computer_run`.

Next separate work:

1. Slice 4 full-host execution only behind its dedicated containment and policy gates;
2. Slice 5 semantic target resolution, OCR fallback, stale-target recovery, and recovery ladder;
3. typed root-only ServiceManagement/XPC operations only when a concrete need justifies them.

Those remain separate capability boundaries. Slice 3 deliberately provides strong low-level computer capability without pretending that semantic recovery or arbitrary host JavaScript already exists.
