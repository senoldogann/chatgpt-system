# Personal Admin Daily Driver Design

**Status:** Approved for implementation
**Date:** 2026-09-08
**Branch:** `feat/personal-admin-daily-driver`
**Base:** `main@60066e4`

## 1. Goal

Turn `chatgpt-system` into a low-friction personal daily driver on the user's Mac:

- ChatGPT can acquire Admin authority itself when an explicitly configured personal mode is enabled, so the user does not copy/paste User/Admin lease IDs during normal use.
- The Secure MCP Tunnel starts automatically at macOS login and restarts after crashes.
- The OpenAI tunnel control-plane credential is stored in the macOS login Keychain, never in a LaunchAgent plist, repository file, audit log, or command-line argument.
- Existing secure defaults remain unchanged for every installation that does not explicitly enable personal-admin mode.

The intended steady-state workflow is:

```text
Mac login
  -> LaunchAgent
  -> Keychain-backed daily-driver runner
  -> tunnel-client run --profile chatgpt-system
  -> chatgpt-system stdio --enable-terminal --personal-admin
  -> ChatGPT mints short-lived Admin authority when needed
```

Normal daily use should require no Terminal window, no Touch ID prompt, and no manually pasted authority lease.

## 2. Non-goals

This phase does not:

- remove authority leases from MCP tool contracts;
- create an infinite or persisted Admin lease;
- bypass the runtime `--enable-terminal` gate;
- widen the executable allowlist;
- add shell execution, sudo/root, or a privileged execution helper;
- disable ChatGPT/OpenAI product-layer safety checks;
- persist managed-process records across daemon restarts;
- add GUI/computer-use capabilities;
- place `CONTROL_PLANE_API_KEY` in shell rc files, plist environment variables, logs, or process argv.

## 3. Security posture

### 3.1 Secure default remains unchanged

Without `--personal-admin`, `session_authority_start` continues to expose Project authority only. User/Admin creation remains local through the protected macOS approval path.

### 3.2 Personal-admin is explicit opt-in

`--personal-admin` is a runtime flag. It allows the MCP client to call `session_authority_start` with `profile="admin"` directly.

This is deliberately a stronger trust mode intended for one private workstation controlled by the same user who controls the ChatGPT account and tunnel. It must be clearly reported by `system_capabilities`.

### 3.3 Runtime terminal gate remains authoritative

An Admin lease minted in personal-admin mode receives terminal/process capability only when the runtime itself was started with `--enable-terminal`. Personal-admin never changes or bypasses that gate.

Consequently:

```text
personal-admin=true + terminal=false
  -> Admin filesystem scope, terminalEnabled=false

personal-admin=true + terminal=true
  -> Admin filesystem scope, terminalEnabled=true
```

### 3.4 Lease behavior remains memory-only and bounded

Personal Admin uses the existing `AuthorityManager` and existing Admin TTL rules. Default and maximum Admin lease duration remain one hour. No raw lease is persisted. When a lease expires, ChatGPT may call `session_authority_start(profile="admin")` again.

No separate renewal protocol is needed.

## 4. Configuration

`AppConfig` gains:

```ts
personalAdmin: {
  enabled: boolean;
}
```

`ConfigOverrides` gains:

```ts
personalAdminEnabled?: boolean;
```

Environment override:

```text
CHATGPT_SYSTEM_PERSONAL_ADMIN=true|false|1|0
```

CLI server flag:

```text
--personal-admin
```

The default is `false`.

`system_capabilities` reports:

```ts
personalAdmin: {
  enabled: boolean;
  adminLeaseMaxTtlSeconds: 3600;
}
```

## 5. MCP authority contract

When personal-admin is disabled, the existing schema is unchanged:

```ts
{
  profile: "project";
  projectRoots: string[];
  requestedTtlSeconds?: number;
}
```

When personal-admin is enabled, `session_authority_start` accepts a discriminated union:

```ts
type StartAuthorityInput =
  | {
      profile: "project";
      projectRoots: string[];
      requestedTtlSeconds?: number;
    }
  | {
      profile: "admin";
      requestedTtlSeconds?: number;
    };
```

Admin input does not accept `projectRoots` or arbitrary roots. The fixed Admin scope continues to come from trusted `AuthorityManager` code.

The returned lease remains the existing `AuthorityContext` shape, including the opaque lease ID. Other filesystem/Git/process tools continue to require `authorityLeaseId`. ChatGPT can use the returned ID internally without asking the user to paste it.

## 6. Tunnel profile integration

`scripts/setup-chatgpt-tunnel.mjs` gains:

```text
--personal-admin
```

When present, the generated MCP child command contains `--personal-admin`.

The setup output clearly states whether personal-admin is enabled. It must not imply that the mode is enabled by default.

The user's daily-driver profile is expected to include both:

```text
--enable-terminal --personal-admin
```

The two flags remain separate so the terminal gate cannot be silently inferred from personal-admin.

## 7. macOS daily-driver service

### 7.1 Files

Add:

- `scripts/setup-daily-driver.mjs`: install/status/uninstall control surface.
- `scripts/daily-driver-runner.mjs`: small long-running wrapper launched by launchd.

LaunchAgent label:

```text
com.senoldogann.chatgpt-system.daily-driver
```

LaunchAgent path:

```text
~/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist
```

Runtime state/log directory:

```text
~/.chatgpt-system/daily-driver/
```

### 7.2 Keychain credential

Keychain item:

```text
service: chatgpt-system-control-plane
account: chatgpt-system
```

Installation requires `CONTROL_PLANE_API_KEY` in the current environment once. The setup process builds a small Swift helper and sends the credential to it on stdin. The helper writes the login Keychain item directly through Apple's Security.framework; the credential must never appear in spawned argv.

The Keychain item is created or updated by the Swift Security.framework helper. The runner reads the fixed item through `/usr/bin/security find-generic-password -w ...` from the unlocked login Keychain after login.

The LaunchAgent plist never contains the key.

### 7.3 Runner

`daily-driver-runner.mjs` receives only non-secret arguments:

```text
--tunnel-client <absolute executable path>
--profile chatgpt-system
--log-dir <absolute path>
```

At startup it:

1. reads the control-plane key from Keychain;
2. starts `tunnel-client run --profile <profile>` with `shell:false`;
3. adds `CONTROL_PLANE_API_KEY` only to the child environment in memory;
4. pipes stdout/stderr to bounded rolling files;
5. forwards SIGTERM/SIGINT to the tunnel child;
6. exits when the tunnel child exits so launchd can restart it.

### 7.4 Bounded logs

Keep separate files:

```text
stdout.log
stderr.log
```

Each file retains at most 1 MiB of tail content. The runner serializes writes per stream so concurrent chunks cannot race and expand files without bound.

No authority lease, API key, or environment dump is intentionally logged.

### 7.5 LaunchAgent behavior

The generated plist uses:

```text
RunAtLoad = true
KeepAlive = true
ProcessType = Background
ThrottleInterval = 5
```

launchd's own stdout/stderr for the wrapper go to `/dev/null`; operational tunnel logs are managed by the bounded runner.

Install performs user-level `launchctl bootstrap gui/<uid> <plist>` after replacing an older instance with `bootout` when present.

Uninstall boots the service out and removes the plist. Keychain deletion is explicit and part of uninstall so no stale tunnel credential remains after the feature is removed.

## 8. Daily-driver setup command

Add npm scripts:

```json
{
  "setup:daily-driver": "npm run build && node scripts/setup-daily-driver.mjs install",
  "daily-driver:status": "node scripts/setup-daily-driver.mjs status",
  "daily-driver:uninstall": "node scripts/setup-daily-driver.mjs uninstall"
}
```

The normal one-time installation flow is:

```text
1. Configure tunnel profile with --enable-terminal --personal-admin.
2. Ensure CONTROL_PLANE_API_KEY exists in the one-time installer environment.
3. npm run setup:daily-driver
4. LaunchAgent starts the tunnel.
5. Future macOS logins require no Terminal interaction.
```

The setup script does not accept API keys as CLI arguments.

## 9. Failure behavior

- Missing `CONTROL_PLANE_API_KEY` during install: fail before changing Keychain/plist/launchd.
- Missing tunnel-client executable: fail before install.
- Keychain write/read failure: fail without printing the secret.
- Invalid or non-absolute tunnel-client path: reject.
- launchctl bootstrap failure: report a non-secret error and leave files inspectable for repair.
- runner cannot read Keychain: exit nonzero; launchd throttles/retries.
- tunnel-client exits/crashes: runner exits; launchd restarts it.
- personal-admin disabled: direct Admin MCP authority start returns schema/policy denial and local approval path remains required.

## 10. Testing

Automated tests must cover at minimum:

1. personal-admin defaults false;
2. CLI parses `--personal-admin` only for server mode;
3. environment override parsing;
4. `system_capabilities` reports personal-admin state;
5. default MCP catalog still exposes Project-only authority start;
6. personal-admin catalog accepts direct Admin start;
7. personal Admin receives `/` scope but terminal stays false when runtime terminal gate is false;
8. personal Admin receives terminal allowlist only when runtime terminal gate is true;
9. Project behavior remains unchanged in personal-admin mode;
10. tunnel setup includes `--personal-admin` only when requested;
11. daily-driver plist contains no API key and only absolute executable/script paths;
12. Keychain store flow has no credential in argv; the native helper receives the exact credential bytes through stdin and writes them through Security.framework;
13. runner Keychain lookup uses fixed service/account identifiers;
14. runner spawns tunnel-client with `shell:false` and key only in child env;
15. bounded logs never exceed 1 MiB;
16. install/status/uninstall launchctl command construction is deterministic and user-scoped;
17. full `npm run check` remains green on Node 22/24;
18. macOS CI remains green.

## 11. Manual acceptance

After merge on the user's Mac:

1. rebuild and replace the `chatgpt-system` tunnel profile with `--enable-terminal --personal-admin`;
2. install daily-driver service once while `CONTROL_PLANE_API_KEY` is available;
3. stop any manually running tunnel before enabling the LaunchAgent;
4. verify `daily-driver:status` reports loaded/running;
5. refresh ChatGPT plugin catalog;
6. verify `system_capabilities` reports terminal and personal-admin enabled;
7. from ChatGPT, call `session_authority_start(profile="admin")` without any locally pasted lease;
8. verify returned Admin lease has `/` scope and terminal capability;
9. run benign filesystem, `node --version`, and managed-process smoke tests;
10. reboot or log out/in once and verify ChatGPT reconnects without opening Terminal;
11. confirm plist/log/audit do not contain `CONTROL_PLANE_API_KEY` or raw authority leases.

## 12. Security invariants

Implementation is incomplete unless all remain true:

- personal-admin is disabled by default;
- personal-admin is visible in runtime capability reporting;
- no persisted/infinite authority lease;
- Admin scope is still fixed by trusted code;
- runtime terminal gate still controls terminal/process capability;
- command allowlist and `shell:false` remain unchanged;
- no API key in CLI arguments, plist, repository, audit, or bounded logs;
- LaunchAgent runs only as the logged-in user, never root;
- no sudo or password piping;
- existing local User/Admin approval flow still works when personal-admin is off;
- ChatGPT product safety remains outside this project's control and is not bypassed.
