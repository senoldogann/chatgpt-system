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
chatgpt-system
        |
        v
Session Authority Gateway
        |
        +-- Project: direct, filesystem/Git, no terminal
        |
        +-- User: native local approval, home scope, no terminal
        |
        +-- Admin: native local approval, host scope, terminal enabled
                         |
                         v
              protected root-owned helper
                         |
                         v
              macOS LocalAuthentication
```

ChatGPT Web is the canonical first acceptance surface. Desktop uses the same installed plugin/backend after Web is verified.

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
git checkout feat/local-authority-broker
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

The setup command prints both the repository build path and the protected runtime broker path so they are visibly distinct. On macOS it warns if the protected broker is unavailable, but does not disable Project authority.

## 6. Run the tunnel

```bash
tunnel-client run --profile chatgpt-system
```

Keep it running while ChatGPT discovers or calls tools.

After any MCP tool/schema change, restart the local tunnel target and use **Refresh** on the ChatGPT plugin.

## 7. Expected authority tools

```text
system_capabilities
session_authority_start
session_authority_request
session_authority_request_status
session_authority_status
session_authority_end
```

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

| Profile | Scope | TTL max | Terminal | Approval |
| --- | --- | ---: | --- | --- |
| Project | explicit project roots | 8 h | No | direct |
| User | current user's canonical home | 4 h | No | native LocalAuthentication |
| Admin | `/` as current OS user | 1 h | Yes | native LocalAuthentication |

The MCP caller cannot set `terminalEnabled` or command capability directly.

Project/User intentionally have no terminal. An interpreter with an in-scope `cwd` could otherwise read files outside that scope using the OS user's authority.

Admin is not UID 0. Root-only operations are not part of this phase.

## 9. Project acceptance

In a fresh ChatGPT Web/Work conversation, select `chatgpt-system-local` and run:

```text
session_authority_start:
profile: project
projectRoots:
- /tmp/chatgpt-system-acceptance
```

Keep the returned lease ID internal to the workflow and verify:

1. `fs_read` on `fixture.txt` succeeds.
2. `git_status` inside the fixture succeeds.
3. reading a sibling/outside path returns `POLICY_DENIED`.
4. `terminal_run` with even an allowlisted `node --version` returns `POLICY_DENIED`.
5. `session_authority_end` succeeds.
6. reusing the ended lease returns `AUTHORITY_REQUIRED`.

## 10. User acceptance with Touch ID

In a fresh conversation:

```text
session_authority_request:
profile: user
```

Expected flow:

1. Tool returns a short-lived `requestId` with `state=pending`.
2. macOS displays native LocalAuthentication UI.
3. Approve locally with Touch ID when available. macOS may offer its normal device-owner fallback.
4. Call `session_authority_request_status` with the request ID.
5. The first approved status returns `state=consumed` plus exactly one User lease.
6. Read `/Users/dogan/chatgpt-system/package.json` with that lease.
7. Read `/etc/hosts`; it must return `POLICY_DENIED` because it is outside home.
8. Call `terminal_run`; it must return `POLICY_DENIED` even for `node`.
9. End the lease and verify reuse returns `AUTHORITY_REQUIRED`.
10. Calling request status again must not mint another lease.

Direct `session_authority_start(profile=user)` is intentionally unsupported and must fail with `LOCAL_APPROVAL_REQUIRED` if it reaches the local MCP server.

## 11. Admin acceptance with Touch ID

In another fresh conversation:

```text
session_authority_request:
profile: admin
```

Approve through native macOS authentication, then call `session_authority_request_status`.

Verify:

1. returned lease profile is `admin`;
2. root scope is `/`;
3. `terminalEnabled=true`;
4. `/etc/hosts` can be read because it is system-readable;
5. a harmless allowlisted command such as `node --version` succeeds;
6. shell syntax or a non-allowlisted executable remains rejected;
7. end the lease and verify reuse fails.

Do not use this acceptance test for destructive system changes.

## 12. Cancellation acceptance

Create a User or Admin request and cancel the macOS authentication UI.

Expected result:

```text
state: cancelled
lease: absent
```

Cancellation, denial, failure, timeout, malformed helper output, trust failure, or server restart must never produce a lease.

## 13. Protected-helper tamper check

Repository build output is not trusted at runtime. After protected installation, modifying or rebuilding:

```text
native/macos-authority-broker/.build/release/chatgpt-system-authority-broker
```

must not change which executable the production broker uses.

Do not deliberately tamper with the protected `/Library/Application Support/...` installation during normal acceptance. Trust-failure cases are covered automatically in tests.

## 14. Web and Desktop

Validate ChatGPT Web first. Once the Web plugin path works, open Desktop and use the same installed `chatgpt-system-local` plugin. Do not create a second permanent authority mechanism for Desktop.

A locally listed Desktop STDIO MCP entry by itself is not proof that a normal Chat session routes to it. The plugin + Secure MCP Tunnel path remains canonical.

## 15. Terminal security

Only an Admin lease has terminal capability in this phase.

`terminal_run` still uses:

- `shell=false`;
- executable basename allowlist;
- cwd policy;
- sanitized environment;
- bounded output/time.

It is not an OS sandbox. Admin child processes run with the actual permissions of the OS account running `chatgpt-system`.

## 16. Audit behavior

Default audit location:

```text
~/.chatgpt-system/audit.jsonl
```

Authority/approval audit records contain only non-secret categorical metadata such as profile, state, root count, scope digest, and expiry where applicable.

Raw lease IDs, approval request IDs, passwords, API keys, Touch ID/biometric material, LocalAuthentication diagnostics, file contents, and command stdout/stderr are not copied into authority lifecycle audit metadata.

## 17. Troubleshooting order

1. `npm run check`
2. `npm run build:broker:macos`
3. `sudo npm run install:broker:macos`
4. `tunnel-client doctor --profile chatgpt-system --explain`
5. restart `tunnel-client run --profile chatgpt-system`
6. Refresh the ChatGPT plugin tool catalog
7. `system_capabilities`
8. Project acceptance
9. User native approval
10. Admin native approval
11. inspect `~/.chatgpt-system/audit.jsonl` for non-secret evidence

A connectivity problem is not fixed by widening authority.

## Current phase boundary

Implemented now:

- Project/User/Admin filesystem and Git authority
- native User/Admin approval
- protected approval helper trust chain
- Admin-only structured terminal execution
- lease expiry/revoke/isolation
- audit redaction

Not implemented yet:

- arbitrary shell language
- UID 0 / root-only typed operations
- ServiceManagement/XPC privileged helper
- computer-use screenshot/mouse/keyboard bridge
- autonomous developer executor
- launchd-managed persistent runtime
