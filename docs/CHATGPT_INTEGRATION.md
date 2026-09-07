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
chatgpt-system runtime
        |
        +-- MCP Project authority: direct, filesystem/Git, no terminal
        |
        +-- private Unix control socket ~/.chatgpt-system/control.sock
                     ^
                     |
          chatgpt-system authorize user|admin
                     |
                     v
          protected root-owned helper
                     |
                     v
          macOS LocalAuthentication
                     |
                     v
          same in-memory AuthorityManager
                     |
                     +-- User: home scope, no terminal
                     +-- Admin: host scope, terminal enabled
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend after Web is verified. Normal Chat and Work are tested independently because product safety routing can differ.

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

For the current development branch:

```bash
cd ~/chatgpt-system
git fetch origin
git checkout feat/local-authority-cli
git pull --ff-only
npm install
npm run check
```

## 3. Build and install the protected native broker

Build as the normal user:

```bash
npm run build:broker:macos
```

Install with explicit macOS administrator authorization:

```bash
sudo npm run install:broker:macos
```

The installer accepts no password or path arguments. macOS handles the `sudo` authentication itself.

Production locations:

```text
/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker
/Library/Application Support/chatgpt-system/etc/authority-broker.sha256
```

The production runtime never executes the repository `.build/release` helper directly. Before every User/Admin approval it verifies root ownership, regular-file/non-symlink type, non-writable permissions, and SHA-256 identity against protected metadata.

If this protected installation is absent or untrusted, User/Admin approval fails closed. Project authority remains usable.

## 4. Keep a disposable bootstrap root

```bash
rm -rf /tmp/chatgpt-system-acceptance
mkdir -p /tmp/chatgpt-system-acceptance
cd /tmp/chatgpt-system-acceptance
git init
printf 'before\n' > fixture.txt
git add fixture.txt
git commit -m 'test fixture' || true
```

The bootstrap root is not a permanent global grant.

## 5. Configure the Secure MCP Tunnel profile

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

The setup command also prints the repository build path and the protected runtime broker path so they are visibly distinct. On macOS it warns if the protected broker is unavailable, but does not disable Project authority.

If the tunnel profile existed before Local Authority CLI support, rerun this setup step so the stored MCP command gains the control-socket flags.

## 6. Run the tunnel

```bash
tunnel-client run --profile chatgpt-system
```

Keep it running while ChatGPT discovers or calls tools.

Once the MCP child is live, verify the socket on the Mac:

```bash
ls -l ~/.chatgpt-system/control.sock
```

Expected file type/mode is a Unix socket owned by the current user with `0600` permissions. The parent `~/.chatgpt-system` is forced to `0700` by the control server.

After any MCP tool/schema change, restart the local tunnel target and use **Refresh** on the ChatGPT plugin.

## 7. Expected authority tools

The default ChatGPT MCP catalog intentionally exposes only:

```text
system_capabilities
session_authority_start
session_authority_status
session_authority_end
```

There is no ChatGPT-facing `session_authority_request` or `session_authority_request_status`. User/Admin authority creation begins locally on the Mac instead of asking the remote model to expand its own authority.

Privileged tools:

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

Every filesystem/Git/terminal tool requires `authorityLeaseId`.

## 8. Privilege ladder

| Profile | Scope | TTL max | Terminal | Creation |
| --- | --- | ---: | --- | --- |
| Project | explicit project roots | 8 h | No | MCP direct |
| User | current user's canonical home | 4 h | No | local CLI + native auth |
| Admin | `/` as current OS user | 1 h | Yes | local CLI + native auth |

The MCP caller cannot set `terminalEnabled` or command capability directly.

Project/User intentionally have no terminal. An interpreter with an in-scope `cwd` could otherwise read files outside that scope using the OS user's authority.

Admin is not UID 0. Root-only operations are not part of this phase.

## 9. Project acceptance

In a fresh ChatGPT Web normal conversation with `chatgpt-system-local` selected:

```text
session_authority_start:
profile: project
projectRoots:
- /tmp/chatgpt-system-acceptance
```

Keep the returned lease ID internal to the workflow and verify:

1. `fs_read` on `fixture.txt` succeeds and returns `before`.
2. `git_status` inside the fixture succeeds.
3. reading a sibling/outside path returns `POLICY_DENIED`.
4. `terminal_run` with even an allowlisted `node --version` returns `POLICY_DENIED`.
5. `session_authority_end` succeeds.
6. reusing the ended lease returns `AUTHORITY_REQUIRED`.

Repeat the benign path in Desktop normal Chat after Web is verified. If ChatGPT offers a Work transition, that is product UI behavior; staying in Chat is acceptable only when the plugin actually continues making MCP calls. Do not count a prose-only result as acceptance evidence.

## 10. User acceptance with local Touch ID

Do **not** ask ChatGPT to create User authority.

With the tunnel running, open a separate Mac Terminal and run:

```bash
cd ~/chatgpt-system
node dist/cli.js authorize user
```

Expected behavior:

1. CLI connects to `~/.chatgpt-system/control.sock`.
2. The already-running tunnel runtime invokes the protected native broker.
3. macOS displays LocalAuthentication UI.
4. Approve locally with Touch ID when available. macOS may offer its normal device-owner fallback.
5. The same runtime mints one User lease.
6. CLI prints safe metadata only and copies the lease to the clipboard.

Expected output resembles:

```text
User authority approved.
Expires: <ISO timestamp>
Terminal: disabled
Lease copied to clipboard.
```

The raw lease should not appear in normal stdout.

Now paste the lease once into a fresh ChatGPT workflow and instruct ChatGPT to use it as `authorityLeaseId`. Verify:

1. `session_authority_status` reports `profile=user`, root `/Users/dogan`, terminal disabled.
2. `fs_read` on `/Users/dogan/chatgpt-system/package.json` succeeds.
3. `fs_read` on `/etc/hosts` returns `POLICY_DENIED`.
4. `terminal_run` returns `POLICY_DENIED` even for `node`.
5. `session_authority_end` succeeds.
6. reusing the ended lease returns `AUTHORITY_REQUIRED`.

If ChatGPT independently blocks one of these later operations with a product-level safety result, record that separately from MCP error codes. Do not widen the local authority model to work around product safety.

## 11. Admin acceptance with local Touch ID

With the same tunnel runtime alive:

```bash
cd ~/chatgpt-system
node dist/cli.js authorize admin
```

Approve through native macOS authentication. The lease is copied to the clipboard.

Paste it once into a fresh ChatGPT workflow and verify:

1. `session_authority_status` reports `profile=admin`;
2. root scope is `/`;
3. `terminalEnabled=true`;
4. `/etc/hosts` can be read because it is system-readable;
5. a harmless allowlisted command such as `node --version` succeeds;
6. shell syntax or a non-allowlisted executable remains rejected;
7. `session_authority_end` revokes the lease and reuse fails.

Do not use this acceptance test for destructive system changes.

## 12. Cancellation acceptance

Run:

```bash
node dist/cli.js authorize user
```

Cancel the macOS authentication UI.

Expected result: the CLI exits non-zero with a safe categorical error and no lease is produced or copied.

Cancellation, denial, failure, timeout, malformed helper output, trust failure, control-client disconnect, or server restart must never leave an undisclosed live lease behind.

## 13. Control-socket acceptance

While the tunnel runtime is alive:

```bash
stat -f '%N | owner=%Su | uid=%u | mode=%Sp' \
  ~/.chatgpt-system \
  ~/.chatgpt-system/control.sock
```

Expected:

```text
~/.chatgpt-system                current user, drwx------
~/.chatgpt-system/control.sock   current user, srw-------
```

Stop the tunnel cleanly and verify the socket disappears. Restarting must recreate it. A stale owned socket from a crashed process may be replaced; a regular file, symlink, unexpected-owner socket, or live socket at the configured path must fail closed.

## 14. Protected-helper tamper check

Repository build output is not trusted at runtime. After protected installation, modifying or rebuilding:

```text
native/macos-authority-broker/.build/release/chatgpt-system-authority-broker
```

must not change which executable the production broker uses.

Do not deliberately tamper with the protected `/Library/Application Support/...` installation during normal acceptance. Trust-failure cases are covered automatically in tests.

## 15. Web and Desktop

Validate ChatGPT Web first. Once the Web plugin path works, open Desktop and use the same installed `chatgpt-system-local` plugin. Do not create a second permanent authority mechanism for Desktop.

Empirical acceptance has shown the plugin can execute in normal Chat on both Web and Desktop, although Desktop may still offer a transition to Work for some requests. Treat actual tool calls as evidence, not the UI label alone.

## 16. Terminal security

Only an Admin lease has terminal capability in this phase.

`terminal_run` still uses:

- `shell=false`;
- executable basename allowlist;
- cwd policy;
- sanitized environment;
- bounded output/time.

It is not an OS sandbox. Admin child processes run with the actual permissions of the OS account running `chatgpt-system`.

## 17. Audit behavior

Default audit location:

```text
~/.chatgpt-system/audit.jsonl
```

Authority/approval audit records contain only non-secret categorical metadata such as profile, state, root count, scope digest, and expiry where applicable.

Raw lease IDs, internal approval request IDs, passwords, API keys, Touch ID/biometric material, LocalAuthentication diagnostics, file contents, and command stdout/stderr are not copied into authority lifecycle audit metadata.

## 18. Troubleshooting order

1. `npm run check`
2. `npm run build:broker:macos`
3. `sudo npm run install:broker:macos`
4. rerun `npm run setup:chatgpt -- ... --doctor` so the profile contains `--enable-control`
5. `tunnel-client doctor --profile chatgpt-system --explain`
6. restart `tunnel-client run --profile chatgpt-system`
7. verify `~/.chatgpt-system/control.sock`
8. Refresh the ChatGPT plugin tool catalog
9. Project acceptance
10. `node dist/cli.js authorize user` and User acceptance
11. `node dist/cli.js authorize admin` and Admin acceptance
12. inspect `~/.chatgpt-system/audit.jsonl` for non-secret evidence

A connectivity problem is not fixed by widening authority. The universe has already tried enough variants of that strategy.

## Current phase boundary

Implemented now:

- Project/User/Admin filesystem and Git authority
- direct Project authority in MCP
- local User/Admin authorization CLI
- private same-runtime Unix control plane
- protected native User/Admin approval helper
- Admin-only structured terminal execution
- lease expiry/revoke/isolation
- audit redaction

Next capability layers:

- managed process supervisor: start/list/status/stop/logs
- adapter to the existing `computer-use` repository for `open_app`, `open_url`, screenshot, active window, mouse and keyboard
- browser diagnostics for console errors, network failures, render/DOM state and screenshots
- typed root-only ServiceManagement/XPC operations
- autonomous developer executor and persistent launchd runtime
