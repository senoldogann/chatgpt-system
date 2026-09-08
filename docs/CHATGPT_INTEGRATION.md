# ChatGPT personal plugin integration

This runbook connects `chatgpt-system` to a personal ChatGPT Developer Mode plugin through **OpenAI Secure MCP Tunnel** while keeping the Mac private.

The current architecture is:

```text
ChatGPT Web / Desktop
        |
        v
personal Developer Mode Plugin
        |
        | OpenAI-hosted tunnel endpoint
        v
Secure MCP Tunnel
        ^
        | outbound HTTPS only
        |
tunnel-client on the Mac
        |
        | stdio child process
        v
chatgpt-system
        |
        v
Session Authority Gateway
        |
        +-- Project lease
        +-- User lease
        +-- Admin lease
        |
        +-- filesystem / Git / terminal
```

No raw MCP port needs to be exposed to the public internet. ChatGPT Web is the canonical acceptance path. Desktop uses the same installed plugin/backend after the web path is verified.

## Current OpenAI references

- Plugin quickstart: https://developers.openai.com/plugins/quickstart
- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- Plugin build guide: https://developers.openai.com/plugins/build/plugins
- Public submission: https://developers.openai.com/plugins/deploy/submission

OpenAI's current personal-plugin quickstart explicitly demonstrates Work. Normal Chat availability is therefore tested separately instead of being inferred from Work.

## Prerequisites

You need:

1. ChatGPT Developer Mode enabled under **Settings → Security and login**.
2. Node.js 22 or newer.
3. `tunnel-client`.
4. A Secure MCP Tunnel ID from OpenAI Platform.
5. The tunnel associated with the ChatGPT workspace/context that should discover it.
6. A runtime credential available to `tunnel-client`, normally through `CONTROL_PLANE_API_KEY` or the mechanism supported by the installed tunnel-client version.

Never put the runtime credential in this repository, command history, `.env.example`, MCP arguments, or ChatGPT messages.

## 1. Install or update the repository

```bash
cd ~/chatgpt-system
git checkout main
git pull
npm install
npm run check
```

During development of an unmerged feature branch, check out that branch explicitly before building.

## 2. Keep a disposable bootstrap root

The Secure MCP Tunnel profile still launches the MCP server with a small bootstrap root. Use a disposable project while validating new authority behavior:

```bash
rm -rf /tmp/chatgpt-system-acceptance
mkdir -p /tmp/chatgpt-system-acceptance
cd /tmp/chatgpt-system-acceptance
git init
printf 'before\n' > fixture.txt
git add fixture.txt
git commit -m 'test fixture' || true
```

The bootstrap root is not a permanent global authority grant. Broader Project/User/Admin access is issued only through an active session lease.

## 3. Generate and validate the tunnel profile

From the repository:

```bash
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --doctor
```

Expected final doctor result:

```text
RESULT ok
NEXT tunnel-client run --profile chatgpt-system
```

The helper never accepts or prints the control-plane API key.

## 4. Run the tunnel

```bash
tunnel-client run --profile chatgpt-system
```

Keep this process alive while ChatGPT discovers or calls tools. The local UI should report health/live and readiness/ready.

After changing MCP descriptors, schemas, or tools, rebuild/restart the local target if required and use **Refresh** on the ChatGPT plugin so the tool catalog is rescanned.

## 5. Create or refresh the personal Plugin

In ChatGPT:

1. Confirm **Developer mode** is ON.
2. Open **Plugins**.
3. Create a personal Developer Mode plugin with **Connection: Tunnel**, or open the existing plugin.
4. Select the configured tunnel or enter its tunnel ID.
5. Authentication is **None** for this local stdio target; tunnel-client handles the OpenAI control-plane connection separately.
6. Discover/refresh tools.
7. Inspect the schemas before granting action permissions.

Expected authority tools:

```text
system_capabilities
session_authority_start
session_authority_status
session_authority_end
```

Expected privileged tools:

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

Every privileged filesystem/Git/terminal schema must contain a required `authorityLeaseId`.

## 6. Session authority model

Each new workflow starts with **no privileged lease**.

Call `session_authority_start` once and choose exactly one profile:

### A. Project Full Access

```json
{
  "profile": "project",
  "projectRoots": ["/absolute/path/to/project"]
}
```

Maximum TTL: **8 hours**.

The project roots must be explicit existing directories. `/` and the entire current-user home directory are rejected for Project mode.

### B. User Full Access

```json
{
  "profile": "user"
}
```

Maximum TTL: **4 hours**.

Scope is the canonical current-user home directory.

### C. Machine Admin scope, Phase 1

```json
{
  "profile": "admin"
}
```

Maximum TTL: **1 hour**.

Scope is `/`, but Phase 1 still executes as the OS user running `chatgpt-system`. This is host-wide filesystem/process scope where normal macOS permissions allow it; it is **not yet root elevation**.

Native macOS authorization/Touch ID is implemented in a later Privilege Broker phase. Phase 1 never gives ChatGPT a password, Touch ID material, reusable sudo credential, or Keychain secret.

## 7. Reuse the lease on every privileged call

`session_authority_start` returns an opaque `leaseId`. Use that exact value as `authorityLeaseId` on every filesystem/Git/terminal call in that workflow.

Example:

```text
session_authority_start(project)
        |
        | leaseId = <opaque value>
        v
fs_read({ authorityLeaseId, path: "fixture.txt" })
        |
        | sha256
        v
fs_write({ authorityLeaseId, path: "fixture.txt", expectedSha256, ... })
        |
        v
terminal_run({ authorityLeaseId, command: "git", args: ["status", "--short"], cwd: "." })
        |
        v
session_authority_end({ authorityLeaseId })
```

Do not copy a lease into another conversation. Expiry, explicit end, or server restart revokes it.

## 8. Web acceptance: Project profile

Run this first in ChatGPT Web against `/tmp/chatgpt-system-acceptance`:

1. `system_capabilities`.
2. `session_authority_start` with `profile=project` and project root `/tmp/chatgpt-system-acceptance`.
3. `fs_read` `fixture.txt` with the returned `authorityLeaseId` and keep the SHA-256.
4. `fs_write` or `fs_apply_patch` using the same lease and `expectedSha256`.
5. Repeat a mutation with the stale old hash and confirm `CONFLICT`.
6. `terminal_run` with `command=git`, `args=["status", "--short"]`, cwd inside the fixture.
7. Try `sh -c ...`; it must be rejected because `terminal_run` is an executable allowlist with `shell=false`.
8. Attempt a sibling/outside path; it must fail with `POLICY_DENIED`.
9. Call `session_authority_end`.
10. Retry `fs_read` or `fs_write` with the ended lease; it must fail with `AUTHORITY_REQUIRED`.

The bootstrap `system_capabilities.terminal.enabled` value can still be false. Session authority has a separate explicit `terminalEnabled: true` state and scoped runtime.

## 9. Web acceptance: User profile

After the Project fixture succeeds:

1. Create a harmless disposable file under your home directory.
2. Start `profile=user`.
3. Read/write only that disposable file.
4. Confirm a path outside home is denied by the lease scope.
5. End the lease.

Do not use User mode as the default for ordinary coding when Project mode is sufficient.

## 10. Web acceptance: Admin profile, Phase 1

After Project and User pass:

1. Start `profile=admin`.
2. Read a benign system-readable file/path outside the home directory.
3. Run a harmless allowlisted command in an allowed cwd.
4. Verify operations still run as the current OS user.
5. End the lease.

Do **not** test destructive system changes, sudo, PAM edits, or privilege escalation in Phase 1. Touch ID/native elevation belongs to the dedicated Privilege Broker phase.

## 11. Work and normal Chat are separate product tests

### Work

Open a fresh Work conversation, select the plugin, and run the Project-profile acceptance sequence.

### Normal Chat

Open a fresh normal Chat conversation and verify the same installed personal plugin is actually available in that surface. If available, repeat a read-only Project test first, then one guarded write.

Do not infer normal Chat support merely because Work succeeds.

## 12. Desktop acceptance

Only after the Web plugin path is stable:

1. Open ChatGPT Desktop.
2. Confirm the same installed plugin is visible.
3. Use the plugin-backed path, not a separate permanent authority implementation.
4. Start a fresh Project lease and repeat the disposable read/write/terminal/end sequence.

A locally listed STDIO MCP configuration is not treated as proof that normal Chat tool routing uses it. The personal plugin + tunnel path remains canonical.

## Terminal security

Session authority enables `terminal_run`, but it remains deliberately structured:

- `spawn(..., { shell: false })` semantics;
- executable allowlist;
- cwd confinement from the active lease;
- bounded output/time;
- sanitized environment;
- no arbitrary shell pipelines/redirection/compound syntax in Phase 1;
- no OS sandbox.

The current default command set is:

```text
git node npm npx pnpm bun deno python3 go cargo swift swiftc xcodebuild make cmake
```

Interpreters, compilers, package managers, and build tools execute with the OS account's real permissions. Use Project mode whenever possible.

## Audit behavior

Default audit location:

```text
~/.chatgpt-system/audit.jsonl
```

Authority lifecycle events record:

- `authority.start`
- `authority.end`
- `authority.expired`
- profile
- root count
- SHA-256 scope digest
- expiry on start

Raw lease IDs are never written to authority audit metadata. File contents, passwords, runtime API keys, secure-field contents, Touch ID data, and Keychain secret values are not added to audit output.

## Troubleshooting order

If ChatGPT cannot discover or call the plugin:

1. `tunnel-client doctor --profile chatgpt-system --explain`
2. Confirm `tunnel-client run --profile chatgpt-system` is healthy.
3. Confirm tunnel organization + ChatGPT workspace association.
4. Confirm Developer Mode.
5. Pull/build the expected repository revision.
6. Refresh the personal Plugin tools after schema changes.
7. Call `system_capabilities`.
8. Start a new authority lease.
9. Confirm every privileged call carries `authorityLeaseId`.
10. Inspect the local audit log for non-secret operation evidence.

A connectivity failure is not fixed by widening authority. Do not respond to a stale plugin catalog by granting User/Admin mode; refresh the tool descriptors instead.

## Current phase boundaries

Phase 1 provides session-scoped A/B/C filesystem/Git/terminal authority.

Not yet implemented in this phase:

- unrestricted `shell_run`;
- build/test/repair Developer Executor orchestration;
- native macOS Privilege Broker / Touch ID elevation;
- `computer-use` screenshot/mouse/keyboard bridge;
- launchd-managed persistent runtime.

Those are separate planned phases built on top of this authority core.
