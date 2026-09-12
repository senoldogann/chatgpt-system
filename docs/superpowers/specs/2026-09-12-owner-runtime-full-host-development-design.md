# Owner Runtime / Full-Host Development Design

**Status:** Proposed for user review
**Date:** 2026-09-12
**Branch:** `design/owner-runtime-full-host`
**Base:** `main@a5923a5bbae8743abc1cd5ca39cdb73926787270`

## 1. Goal

Extend `chatgpt-system` so an explicitly approved personal Admin session can give ChatGPT Web a Codex-class local development environment on the user's Mac.

The intended owner-trust workflow is:

```text
ChatGPT Web
  -> chatgpt-system
  -> locally approved Admin session
      -> full filesystem as the current macOS user
      -> unrestricted shell + interactive PTY
      -> normal network access
      -> compilers/build tools/package managers
      -> long-running development processes
      -> semantic code queries
      -> Git/GitHub
      -> Browser Runtime
      -> Computer Runtime
  -> local worktree / application
  -> verification
  -> Git checkpoint / PR / CI
```

The objective is not to recreate an IDE, compiler, shell, or remote desktop inside the plugin. The plugin exposes the real local development environment to ChatGPT with strong lifecycle, cancellation, audit-redaction, and authority boundaries.

## 2. Product decision

The product concept is named **Owner Runtime**, but the implementation keeps the existing `admin` authority profile.

Do not add a fourth authority profile. Instead, add one explicit trusted startup capability:

```text
ownerRuntimeEnabled
```

Only a locally approved Admin lease can use Owner Runtime tools, and only when the daemon was started with the Owner Runtime gate enabled.

The authority model remains:

```text
Project
  -> project roots
  -> safe filesystem/Git/code tools
  -> optional sandboxed project_exec
  -> no host shell / no PTY / no computer control

User
  -> home-directory filesystem scope
  -> no host shell / no PTY / no computer control

Admin
  -> filesystem root scope as the current OS user
  -> existing Admin browser/computer capabilities when enabled
  -> Owner Runtime shell/PTY only when ownerRuntimeEnabled=true
```

This preserves the existing safer modes while giving the personal owner the unrestricted mode they explicitly requested.

## 3. Non-goals

This work does not:

- create another LLM or local autonomous planner;
- create a custom compiler abstraction;
- create a replacement text editor or IDE UI;
- add a generic remote-desktop/video-stream server;
- bypass macOS TCC, SIP, sudo, Keychain, or OS authentication;
- make Project/User authority equivalent to Admin;
- persist terminal sessions across daemon restarts;
- automatically commit every file edit;
- expose daemon/tunnel/authority secrets to child processes merely because Owner Runtime is enabled.

## 4. Why a separate shell capability

Existing `terminal_run` intentionally uses `shell=false`, an executable allowlist, command timeout, bounded output, and sanitized environment. Existing plans explicitly treated arbitrary shell syntax as a separate higher-risk capability.

Keep `terminal_run` unchanged for compatibility and for agents that want a structured, narrow execution tool.

Add an Owner-only shell surface instead of weakening `terminal_run`.

This prevents a large behavioral migration across current tests and keeps the difference obvious in the MCP catalog:

```text
terminal_run       structured / allowlisted / shell=false
shell_run          Owner Runtime / arbitrary shell syntax
terminal_session_* Owner Runtime / persistent interactive PTY
```

## 5. Owner shell execution

### 5.1 `shell_run`

Add a one-shot arbitrary shell tool for locally approved Admin Owner Runtime sessions.

Conceptual input:

```ts
{
  authorityLeaseId: string;
  script: string;
  cwd?: string;
  timeoutMs?: number | null;
}
```

Semantics:

- execute as the current macOS user;
- use a trusted operator-configured shell, default `/bin/zsh` on macOS;
- execute through login-shell semantics (`zsh -lc ...`) so normal developer PATH/toolchains are available;
- accept pipes, redirects, command substitution, compound commands, scripts, package-manager commands, arbitrary executable paths, and commands not known to `chatgpt-system`;
- normal host network access is available;
- `cwd` may be anywhere allowed by the Admin root scope (`/`), subject to the current OS user's permissions;
- omitted/null `timeoutMs` means no Owner Runtime wall-clock deadline;
- a finite `timeoutMs` remains available when ChatGPT deliberately wants a deadline;
- request cancellation, daemon shutdown, explicit stop, or authority/runtime shutdown must terminate the owned process group.

The shell is full-host execution, not a sandbox.

### 5.2 Output handling

Unrestricted development commands can produce large output. Do not kill them merely because output exceeded an MCP response limit.

Use bounded tail/ring buffers:

- continue executing after old output is discarded;
- return bounded stdout/stderr tails plus `bytesSeen`/`truncated` metadata;
- never let process output grow daemon memory without bound;
- preserve exit code/signal/cancellation state.

This changes containment from **execution-killing output limits** to **bounded retained output**, which is better suited to compiler/build workflows.

### 5.3 Environment

Owner Runtime must expose a normal developer environment without leaking control-plane secrets.

Start from the existing sanitized child environment, then let the trusted login shell establish the user's ordinary shell environment.

Never automatically forward daemon-only values such as tunnel credentials, HTTP control tokens, authority lease material, or internal API secrets.

Owner shell scripts can still access any credentials that the current macOS user can ordinarily access through their normal filesystem, credential helpers, environment/profile configuration, or interactive OS workflows. That is part of owner-trust full-host execution.

## 6. Interactive PTY

A Codex-class local environment requires a real pseudo-terminal, not only one-shot `spawn(..., shell:false)` calls.

Add an Owner Runtime terminal-session service backed by a proper PTY implementation on macOS. Prefer a focused dependency such as `node-pty` rather than emulating terminal behavior with pipes.

Initial MCP surface:

```text
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
```

### 6.1 Open

`terminal_session_open` starts the trusted login shell in a PTY and returns an opaque session ID.

Conceptual input:

```ts
{
  authorityLeaseId: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}
```

The MCP caller cannot choose an arbitrary shell executable through this API. Shell selection is trusted startup configuration; arbitrary programs are launched by typing/running commands inside the shell.

### 6.2 Read/write

`terminal_session_write` writes bounded UTF-8 input to the PTY. `terminal_session_read` returns output accumulated after an opaque cursor/sequence value, with a bounded retained tail.

This permits:

- interactive compilers/build tools;
- REPLs;
- package-manager prompts;
- long-running development servers;
- debuggers and CLIs that require a TTY;
- terminal control sequences without pretending they are ordinary stdout lines.

PTY input/output content must not be copied into persistent audit metadata.

### 6.3 Lifetime

A PTY session:

- may run indefinitely while the daemon is alive;
- survives the expiration of the specific Admin lease that created it, matching the useful managed-process model;
- can only be rediscovered/read/written/closed by a later locally approved Admin Owner Runtime lease;
- is terminated on daemon shutdown;
- uses an owned process group and graceful-then-force cleanup;
- never exposes raw OS PIDs as the public management handle.

This lets a new ChatGPT tool call or resumed chat reconnect to a development terminal without turning the daemon into a persistent remote-shell service across restarts.

## 7. IDE/compiler capability without rebuilding an IDE

Do not build a new compiler platform abstraction.

The existing pieces already cover the IDE loop:

```text
fs_* / fs_apply_patch_set
  -> file editing

code_query
  -> repository search + TypeScript symbols/definitions/references/diagnostics

shell_run / terminal_session_*
  -> real compiler, formatter, package manager, debugger, test runner, REPL

process_* / terminal sessions
  -> local dev servers and long-running jobs

git_*
  -> structured safe Git operations

raw shell `git ...`
  -> full Git escape hatch for Owner Runtime

browser_*
  -> semantic web/runtime verification

computer_*
  -> real macOS/native application verification
```

Language-specific semantic intelligence beyond the existing TypeScript language service can be added later only when real use shows it is worth the maintenance. The first Owner Runtime release relies on the actual compiler/toolchain output rather than inventing a universal compiler protocol.

## 8. Local workspace and Git as durable engineering history

Local files/worktrees are the active source of implementation truth while a task is in progress.

Git is the durable code/history layer; Project Continuity is the semantic handoff layer.

Preferred workflow:

```text
current main
  -> isolated feature worktree
  -> local edits
  -> build/test/debug
  -> meaningful Git checkpoint commit
  -> continue locally
  -> exact-head verification
  -> push
  -> PR / hosted CI
  -> merge
  -> sync stable main
  -> continuity checkpoint
```

Do not automatically commit every edit. That creates noisy history and interferes with RED/GREEN work.

Create Git checkpoints at meaningful, independently reviewable milestones and before risky transitions/handoffs. Keep commit messages factual. Use Project Continuity to remember goal, decisions, blockers, verification evidence, and next step; do not misuse Git commits as prose memory.

Existing optimistic filesystem writes, worktree isolation, and safe Git tools remain valuable even though unrestricted shell can also run raw `git` commands.

## 9. Full-host computer use

The existing Computer Runtime already has the correct core architecture: one persistent native helper, AX-first perception, physical actuation, recovery, verification, user takeover, and emergency stop.

Do **not** add a second computer-session abstraction just to make it look more real-time.

ChatGPT can use two complementary paths:

```text
repeated direct tools
  computer_observe -> act -> verify -> observe

local fast path
  computer_run / computer_run_js
  -> many observe/resolve/act/wait/verify steps locally
  -> one model round trip
```

The native helper remains warm across calls, so repeated direct calls already form a persistent local control session from the agent's perspective.

### 9.1 Real-time expectation

MCP/ChatGPT Web is a tool-call protocol, not a 60-FPS remote-desktop stream. The target is low-latency closed-loop control, not continuous video streaming.

For workflows that need rapid local reaction, `computer_run_js` performs loops/conditions/retries locally without yielding to the model between every physical action. For tasks that require reasoning after new visual state, ChatGPT observes again and continues.

Do not build video streaming unless later evidence proves the tool-call + local-fast-path model is insufficient.

## 10. Remove arbitrary Owner Runtime action/time ceilings

The current Computer Runtime has development-era hard maxima such as:

```text
maxActionProgramActions = 100
maxActionProgramRuntimeMs = 30000
maxJsRuntimeMs = 30000
```

These are unsuitable as hard Owner Runtime productivity ceilings.

For locally approved Admin Owner Runtime:

- remove the hard action-count ceiling from `computer_run`;
- remove the internal wall-clock maximum from `computer_run`;
- remove the 30-second hard maximum from `computer_run_js`;
- omitted timeout means no local deadline;
- an explicitly supplied finite timeout remains supported;
- transport/request cancellation must cancel the execution;
- user takeover and the fixed emergency chord always remain authoritative;
- daemon shutdown always terminates owned JS/process work and releases held input.

Do **not** remove containment bounds that protect process memory or protocol integrity. Keep bounded:

- MCP/request/frame sizes;
- JS source size;
- returned stdout/stderr/result size;
- screenshot size;
- observation element/character count;
- retained PTY/process log buffers;
- schema string/array sizes needed to prevent unbounded allocation.

Also keep bounded automatic recovery retries. `maxAutomaticRetriesPerAction = 2` is a fail-closed correctness rule, not a productivity/runtime ceiling. Long or complex workflows should express explicit loops in the Owner Runtime program instead of creating an uncontrolled hidden retry loop.

## 11. Cancellation and cleanup are mandatory

Removing arbitrary time limits increases the importance of cancellation.

Every long-running Owner Runtime execution must have a deterministic stop path:

- MCP request cancellation/disconnect when observable;
- explicit session/process close;
- daemon shutdown;
- Admin runtime shutdown/reconfiguration;
- Computer Runtime user takeover;
- `Control+Option+Command+Escape` for active computer automation.

Owned process groups must be terminated as groups so child compilers/dev servers do not become orphans.

Computer automation must continue to call `release_inputs` on cancellation/error/takeover/shutdown paths.

No indefinite execution is allowed to become **unstoppable** execution.

## 12. macOS permissions and Screen Recording

Do not bypass TCC.

The existing stable signed Computer Runtime helper remains the permission identity. `computer_health` already reports passive readiness for:

- Accessibility;
- Screen Recording;
- event listen;
- event post.

The Slice 5 real-Mac acceptance recorded all four as ready with `tccIdentityStable: true`, so no permission change should be necessary while that installed helper identity remains unchanged.

Owner Runtime setup/doctor documentation should still provide the exact recovery path when readiness is false:

```text
System Settings
  -> Privacy & Security
  -> Accessibility

System Settings
  -> Privacy & Security
  -> Screen & System Audio Recording
```

The setup script may offer to open the relevant System Settings pane, but it must never edit the TCC database or silently request/bypass permission.

After granting/changing permission, restart the installed helper/daemon as required and require `computer_health` to report readiness before acceptance testing.

## 13. Startup/configuration

Add an explicit Owner Runtime startup gate:

```text
--enable-owner-runtime
CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME=true
```

Conceptual configuration:

```ts
ownerRuntime: {
  enabled: boolean;
  shellPath: string; // trusted startup config, default /bin/zsh on macOS
}
```

Rules:

- Owner Runtime requires personal Admin capability to be enabled;
- it does not automatically enable Browser Runtime or Computer Runtime;
- the daily-driver setup may enable Owner Runtime, Browser Runtime, Computer Runtime, and full-host JS together because that is the intended personal configuration;
- Project/User leases never inherit Owner Runtime merely because the daemon gate is on;
- `system_capabilities` reports categorical Owner Runtime availability without exposing shell history/environment content.

## 14. MCP surface changes

New tools:

```text
shell_run
terminal_session_open
terminal_session_read
terminal_session_write
terminal_session_resize
terminal_session_close
terminal_session_list
```

Existing tools remain:

```text
terminal_run          structured allowlisted execution
process_*             structured allowlisted managed processes
fs_*
git_*
code_query
browser_*
computer_*
computer_run_js
project_exec
task_state
project_continuity tools
```

This is intentionally additive. Existing Project/User behavior and existing `terminal_run` callers do not silently gain new power.

## 15. Audit and privacy

Owner Runtime is powerful, but audit should remain metadata-oriented.

For `shell_run`, persist only safe metadata such as:

```text
action=shell.run
scriptByteCount
scriptSha256
cwd category/display path when safe
duration
exit/cancel outcome
```

Never persist raw shell script text, stdout, stderr, PTY input, PTY output, typed computer text, screenshot pixels, OCR/AX text, credential values, or environment values in the audit log.

For PTY sessions, audit lifecycle metadata only:

```text
session open / close
start duration/state
input byte count (not content)
output byte count (not content)
```

Owner Runtime output is returned to the active ChatGPT request/session as needed but retained only in bounded in-memory tails unless the user or command itself writes it to disk.

## 16. Sudo and OS privilege

Owner Runtime executes as the current macOS user. It does not become root automatically.

Because arbitrary shell is available, the user can run `sudo` exactly as they could in Terminal. `chatgpt-system` must not:

- inject a sudo password;
- scrape/store a password prompt;
- bypass sudo policy;
- install a privileged helper merely to make shell commands root.

If the Mac is configured for Touch ID, passwordless sudo, or another normal OS authentication method, that existing system behavior may be used. The plugin does not invent its own privilege escalation path.

## 17. Failure semantics

Owner Runtime errors should remain stable and categorical.

Add focused errors such as:

```text
OWNER_RUNTIME_DISABLED
SHELL_FAILED
SHELL_CANCELLED
TERMINAL_SESSION_NOT_FOUND
TERMINAL_SESSION_CLOSED
TERMINAL_SESSION_LIMIT
```

Do not copy arbitrary raw shell/PTY output into stable error messages. Output belongs in explicit bounded output fields.

A failed compiler/build command is normally a successful `shell_run` transport result with a non-zero exit code, not an MCP protocol failure. Reserve tool errors for failure to create/manage the execution itself.

## 18. Testing strategy

### 18.1 Authority/config

Prove:

- Owner Runtime disabled by default;
- Project and User cannot call shell/PTY tools;
- Admin without the Owner Runtime startup gate is denied;
- locally approved Admin with the gate can use them;
- existing `terminal_run` allowlist behavior is unchanged.

### 18.2 Unrestricted shell

Use harmless fixtures to prove:

- pipes and redirects work;
- compound shell syntax works;
- a temporary executable not present in the configured command allowlist can run;
- absolute executable paths work;
- cwd can be outside bootstrap project roots under Admin scope;
- login-shell PATH can discover ordinary user-local toolchains;
- daemon-only secret canaries are absent;
- large output truncates retained output without killing the command;
- explicit timeout/cancellation terminates the owned process group;
- no timeout means a controlled long-running fixture can outlive the old 60-second/30-second ceilings.

### 18.3 PTY

Prove:

- open/read/write/resize/close lifecycle;
- a real TTY is observed by the child;
- interactive stdin works;
- output cursoring does not duplicate/drop retained chunks inside the documented buffer window;
- later Admin Owner lease can rediscover/manage an existing session;
- Project/User cannot discover it;
- daemon shutdown terminates PTY process groups;
- PTY content is absent from audit.

### 18.4 Computer Runtime Owner mode

Prove with simulated/native fixtures:

- more than 100 explicit local actions can be accepted/executed without a hard action-count failure;
- a run can exceed 30 seconds when no timeout is supplied without being killed by the old cap;
- a supplied finite timeout still cancels cleanly;
- request cancellation/takeover/emergency stop releases input and kills owned JS descendants;
- output/source/observation/screenshot memory bounds remain enforced;
- bounded automatic recovery still fails closed.

### 18.5 Development workflow acceptance

On a disposable repository/worktree, prove ChatGPT can:

```text
inspect code
-> edit locally
-> run compiler/tests
-> start a dev process/PTY
-> inspect diagnostics
-> use browser and/or Computer Runtime
-> verify behavior
-> create meaningful Git commits
-> push feature branch
-> inspect PR/CI
-> continue from Project Continuity in a new chat
```

This is the meaningful "Codex-class" acceptance test. Tool count alone is not acceptance.

## 19. Delivery sequence

Keep the implementation reviewable and avoid mixing every subsystem into one giant PR.

### Phase 1 — Owner authority + `shell_run`

- config/startup capability;
- Admin capability propagation;
- unrestricted one-shot shell service;
- bounded retained output;
- cancellation/process-group cleanup;
- audit redaction;
- tests and docs.

This produces useful Codex-like host execution by itself.

### Phase 2 — Interactive PTY

- PTY supervisor/session registry;
- open/read/write/resize/list/close tools;
- lease visibility rules;
- bounded in-memory terminal output;
- daemon cleanup;
- real interactive acceptance.

### Phase 3 — Owner Computer Runtime ceilings/cancellation

- remove arbitrary owner action/runtime hard maxima;
- preserve payload/memory/recovery bounds;
- strengthen request cancellation cleanup where needed;
- verify stable helper/TCC readiness;
- long local computer/JS acceptance.

### Phase 4 — Codex-class integration acceptance

- local feature-worktree engineering scenario;
- compiler/test/server flow;
- Browser + Computer Runtime verification;
- Git/PR/CI/continuity handoff;
- update docs and Project Continuity;
- only then perform the previously planned Computer Runtime Slice 6 serious acceptance/freeze against the expanded final product.

## 20. Definition of done

Owner Runtime is complete when a locally approved Admin ChatGPT session can, without a command allowlist:

- execute arbitrary shell syntax and executables as the current macOS user;
- use an interactive persistent PTY;
- access the full filesystem allowed to that user;
- use normal host network access;
- invoke installed compilers, package managers, build tools, debuggers, and Git;
- run long development jobs without arbitrary 30/60-second product ceilings;
- edit and reason over a local feature worktree;
- keep meaningful code history in Git and semantic task memory in Project Continuity;
- use Browser Runtime and Computer Runtime in the same engineering workflow;
- control the Mac in a low-latency observe/act/verify loop and run long local multi-action computer programs;
- recover/stop cleanly on cancellation, user takeover, emergency stop, or daemon shutdown;
- avoid automatically leaking daemon secrets into full-host child processes;
- keep Project/User authority behavior narrow and unchanged;
- pass Node 22/24 CI, native macOS CI where relevant, real-Mac acceptance, and a fresh ChatGPT Web -> plugin -> local development E2E scenario.

At that point `chatgpt-system` provides the local execution side of a Codex-class development workflow for ChatGPT Web without duplicating the operating system's shell, compilers, IDE, browser, or native UI stack.
