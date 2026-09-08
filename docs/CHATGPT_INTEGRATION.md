# ChatGPT personal plugin integration

This runbook connects `chatgpt-system` to ChatGPT Web/Desktop through an OpenAI Secure MCP Tunnel while keeping the Mac private and keeping broad authority under local user control.

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
        +-- Project authority: direct MCP, filesystem/Git, no terminal/process start
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
        +-- User: home scope, no terminal/process start
        |
        +-- Admin: host scope as current OS user, terminal + managed processes
        |
        +-- shared ProcessSupervisor
              process_start/list/status/logs/stop
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend. Normal Chat and Work can route safety differently, so actual tool calls are the evidence that matters.

## 1. Prerequisites

- ChatGPT Developer Mode enabled.
- Node.js 22+.
- Git.
- `tunnel-client`.
- Secure MCP Tunnel associated with the intended ChatGPT workspace.
- Runtime tunnel credential available to `tunnel-client`, normally through `CONTROL_PLANE_API_KEY`.
- Swift/Xcode command-line tools on macOS for native approval.

Never put the runtime credential in the repository, command history, MCP arguments, plugin prompts, or screenshots.

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

## 4. Configure the Secure MCP Tunnel profile

Use a disposable bootstrap root:

```bash
rm -rf /tmp/chatgpt-system-acceptance
mkdir -p /tmp/chatgpt-system-acceptance
cd /tmp/chatgpt-system-acceptance
git init
printf 'before\n' > fixture.txt
git add fixture.txt
git commit -m 'test fixture' || true
```

Then configure the tunnel:

```bash
cd ~/chatgpt-system
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --doctor
```

The generated stdio target includes:

```text
--enable-control --control-socket ~/.chatgpt-system/control.sock
```

If the profile predates local authorization support, rerun setup rather than hand-editing a stale child command.

## 5. Run the tunnel

```bash
tunnel-client run --profile chatgpt-system
```

Keep it running while ChatGPT discovers or calls tools. Verify the local socket:

```bash
ls -ld ~/.chatgpt-system
ls -l ~/.chatgpt-system/control.sock
```

Expected permissions:

```text
~/.chatgpt-system                drwx------
~/.chatgpt-system/control.sock   srw-------
```

After MCP tool/schema changes, restart the tunnel target and refresh the ChatGPT plugin catalog.

## 6. Tool catalog

Authority tools exposed to ChatGPT:

```text
system_capabilities
session_authority_start
session_authority_status
session_authority_end
```

User/Admin creation tools are intentionally absent. Broad authority starts locally on the Mac.

Filesystem/Git/one-shot process tools:

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
terminal_run
```

Managed-process tools:

```text
process_start
process_list
process_status
process_logs
process_stop
```

Every privileged tool takes `authorityLeaseId`. Managed-process MCP schemas do not accept OS PID, signal, shell, detached, or environment fields.

## 7. Privilege ladder

| Profile | Scope | TTL max | Terminal / process start | Creation |
| --- | --- | ---: | --- | --- |
| Project | explicit project roots | 8 h | No | MCP direct |
| User | current user's canonical home | 4 h | No | local CLI + native auth |
| Admin | `/` as current OS user | 1 h | Yes | local CLI + native auth |

Admin is not UID 0. Root-only operations are not part of this boundary.

## 8. Project acceptance

In a fresh ChatGPT normal conversation using `chatgpt-system-local`, create Project authority for:

```text
/tmp/chatgpt-system-acceptance
```

Verify:

1. `fs_read fixture.txt` succeeds.
2. `git_status` succeeds.
3. sibling/outside read returns `POLICY_DENIED`.
4. `terminal_run node --version` returns `POLICY_DENIED`.
5. `process_start node ...` also returns `POLICY_DENIED`.
6. `session_authority_end` succeeds.
7. ended-lease reuse returns `AUTHORITY_REQUIRED`.

## 9. User authorization and acceptance

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
6. a known Admin-created process ID, if supplied during a controlled acceptance, returns `PROCESS_NOT_FOUND` rather than revealing metadata;
7. ending the lease revokes it.

Independent product safety can still block an operation before MCP receives it. Record that separately rather than widening local authority to bypass it.

## 10. Admin authorization and one-shot acceptance

On the Mac:

```bash
cd ~/chatgpt-system
node dist/cli.js authorize admin
```

Approve locally, paste the copied lease into ChatGPT, then verify:

1. status reports `profile=admin`, root `/`, `terminalEnabled=true`;
2. `/etc/hosts` can be read when the product forwards the call;
3. `terminal_run node --version` succeeds;
4. `sh -c ...` remains `POLICY_DENIED` because `sh` is not allowlisted;
5. executable paths such as `/usr/bin/node` remain rejected.

No destructive system operation is needed for acceptance.

## 11. Managed Process Supervisor acceptance

With an active Admin lease, start a harmless inline Node fixture under the repository without modifying files:

```text
process_start:
  command: node
  args:
    - -e
    - console.log('process-ready'); setInterval(() => {}, 1000)
  cwd: /Users/dogan/chatgpt-system
```

Expected behavior:

1. `process_start` returns an opaque `processId`, command `node`, and normally `state=running`.
2. No OS PID or process-group ID appears in output.
3. `process_status` reports the record.
4. `process_logs` contains `process-ready` in the bounded stdout tail.
5. `process_list` includes the record for the compatible Admin scope.
6. End the first Admin lease, create a second Admin lease, and verify the second compatible lease can still inspect/stop the process.
7. `process_stop` transitions it to `stopped`; a second stop is harmless/idempotent.
8. User authority sees no record in `process_list`, and direct lookup of the known ID returns `PROCESS_NOT_FOUND`.
9. `process_start` with `sh` remains `POLICY_DENIED`.

Stop behavior is daemon-controlled: POSIX process group receives `SIGTERM`, the daemon waits `CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS` (default 3000 ms), then uses `SIGKILL` only if still necessary. Callers cannot choose signals.

Managed records/logs are in memory only. A clean daemon shutdown attempts to stop running children. An abrupt crash can leave a detached child alive; the next daemon does not sweep arbitrary PIDs.

## 12. Cancellation acceptance

Run:

```bash
node dist/cli.js authorize user
```

Cancel the macOS authentication UI. The CLI must exit non-zero with a safe categorical error and no lease produced/copied.

Cancellation, denial, failure, timeout, malformed helper output, trust failure, control-client disconnect, or server restart must never leave an undisclosed live lease behind.

## 13. Control socket and protected-helper checks

Inspect socket ownership/mode:

```bash
stat -f '%N | owner=%Su | uid=%u | mode=%Sp' \
  ~/.chatgpt-system \
  ~/.chatgpt-system/control.sock
```

Stopping the tunnel cleanly removes the socket. A stale owned socket may be replaced; regular files, symlinks, unexpected-owner sockets, and compatible live sockets fail closed.

Repository helper rebuilds must not change the production executable selected from `/Library/Application Support/chatgpt-system/...`.

## 14. Web and Desktop

Validate Web first, then Desktop with the same installed `chatgpt-system-local` plugin. Do not create a second permanent authority implementation for Desktop. Count actual MCP calls, not UI labels, as acceptance evidence.

## 15. Process security summary

`terminal_run` and `process_start` share:

- `shell=false`;
- executable basename allowlist;
- NUL-argument rejection;
- active authority cwd policy;
- sanitized environment.

Managed processes additionally have:

- opaque random IDs instead of PID exposure;
- bounded registry size;
- separate bounded stdout/stderr tails;
- authority-filtered lookup/listing;
- process-group cleanup on POSIX;
- graceful stop with bounded escalation;
- no persistent registry or unsafe startup PID sweep.

Neither one-shot nor managed process execution is an OS sandbox. Admin children run as the OS account that launched `chatgpt-system`, not root.

## 16. Audit behavior

Default audit location:

```text
~/.chatgpt-system/audit.jsonl
```

Authority/approval/process lifecycle records contain non-secret categorical metadata. Raw lease IDs, internal approval request IDs, managed-process IDs, OS PIDs, passwords, API keys, biometric material, argument values, environment values, file contents, stdout, and stderr are excluded from lifecycle audit metadata.

## 17. Troubleshooting order

1. `npm run check`
2. `npm run build:broker:macos`
3. `sudo npm run install:broker:macos`
4. rerun `npm run setup:chatgpt -- ... --doctor`
5. `tunnel-client doctor --profile chatgpt-system --explain`
6. restart `tunnel-client run --profile chatgpt-system`
7. verify `~/.chatgpt-system/control.sock`
8. refresh the ChatGPT plugin tool catalog
9. Project acceptance
10. User acceptance
11. Admin one-shot acceptance
12. managed-process acceptance
13. inspect `~/.chatgpt-system/audit.jsonl` for non-secret evidence

A connectivity problem is not fixed by widening authority. Humanity has benchmarked that approach extensively enough.

## Current phase boundary

Implemented:

- Project/User/Admin filesystem and Git authority
- direct Project authority in MCP
- local User/Admin authorization CLI
- private same-runtime Unix control plane
- protected native User/Admin approval helper
- Admin-only structured one-shot terminal execution
- Admin-only managed process start with authority-scoped list/status/logs/stop
- opaque process IDs, bounded logs/registry, POSIX process-group cleanup
- clean runtime managed-process shutdown
- lease expiry/revoke/isolation
- audit redaction

Next separate capability layers:

- adapter to the existing `computer-use` repository for `open_app`, `open_url`, screenshot, active window, mouse and keyboard
- browser diagnostics for console errors, network failures, render/DOM state and screenshots
- typed root-only ServiceManagement/XPC operations
- autonomous developer executor after the typed primitives exist
