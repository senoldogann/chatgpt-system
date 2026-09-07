# ChatGPT personal plugin integration

This runbook connects `chatgpt-system` to a personal ChatGPT Developer Mode plugin through **OpenAI Secure MCP Tunnel** while keeping the Mac private.

The Phase 1 architecture is:

```text
ChatGPT personal Plugin
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
        +-- explicit filesystem root
        +-- conflict-safe filesystem tools
        +-- read-only Git inspection
        +-- terminal disabled by default
```

No raw MCP port needs to be exposed to the public internet.

## Current OpenAI references

- Plugin quickstart: https://developers.openai.com/plugins/quickstart
- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- Plugin build guide: https://developers.openai.com/plugins/build/plugins
- Public submission: https://developers.openai.com/plugins/deploy/submission

OpenAI's current Plugin Quickstart explicitly demonstrates a personal plugin in **ChatGPT Work**. Normal **Chat** availability is therefore an acceptance test in this project, not a claim made in advance.

## Prerequisites

You need:

1. ChatGPT Developer Mode enabled under **Settings → Security and login**.
2. Node.js 22 or newer.
3. `tunnel-client` from OpenAI's current release.
4. A Secure MCP Tunnel ID from OpenAI Platform tunnel settings.
5. Platform tunnel permissions required by your organization/account.
6. A runtime credential available to `tunnel-client`, normally through `CONTROL_PLANE_API_KEY` or the credential mechanism supported by your installed tunnel-client version.

Do not put the runtime credential in this repository, command history, `.env.example`, or a tunnel setup argument.

For a personal account, follow OpenAI's current tunnel documentation and use the personal Platform organization associated with that account. The tunnel must also be associated with the ChatGPT context that should be able to discover it.

## 1. Install and verify the repository

```bash
git clone https://github.com/senoldogann/chatgpt-system.git
cd chatgpt-system
npm install
npm run check
```

Choose the **smallest** project directory ChatGPT should be allowed to access. The setup helper rejects `/`, a relative path, and your entire home directory.

## 2. Use a disposable fixture for the first write test

Do not make the first experiment against a valuable repository. Create a tiny disposable Git repository instead:

```bash
mkdir -p /tmp/chatgpt-system-acceptance
cd /tmp/chatgpt-system-acceptance
git init
printf 'before\n' > fixture.txt
git add fixture.txt
git commit -m 'test fixture'
```

If your Git identity is not configured, the commit is optional for read/write testing, but `git_diff` is easiest to inspect in a real Git repository.

## 3. Generate and validate the Secure MCP Tunnel profile

From the `chatgpt-system` repository:

```bash
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx
```

Without `--doctor` or `--run`, the command is a dry setup: it validates arguments and prints the non-secret profile commands it would use. Terminal access stays disabled.

When your runtime tunnel credential is available in the environment, create the profile and run OpenAI's doctor checks:

```bash
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --doctor
```

The helper performs these checks before claiming readiness:

- `dist/cli.js` exists;
- the allowed root exists and is a directory;
- `tunnel-client` is available;
- `tunnel-client init` succeeds;
- `tunnel-client doctor --profile chatgpt-system --explain` succeeds.

It launches the local MCP target with an equivalent command to:

```text
node /absolute/path/to/chatgpt-system/dist/cli.js stdio --root /tmp/chatgpt-system-acceptance
```

The helper never accepts or prints the control-plane API key.

## 4. Run the tunnel

After doctor succeeds:

```bash
tunnel-client run --profile chatgpt-system
```

Keep this process running while ChatGPT discovers or calls the MCP tools.

You can alternatively perform init + doctor + run in one invocation:

```bash
npm run setup:chatgpt -- \
  --root /tmp/chatgpt-system-acceptance \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --run
```

## 5. Create the personal Plugin in ChatGPT

In ChatGPT:

1. Open **Settings → Security and login** and confirm **Developer mode** is ON.
2. Open **Plugins**.
3. Select the **+** button to create a personal Developer Mode plugin.
4. Choose **Tunnel** under **Connection**.
5. Select the configured tunnel, or paste its valid tunnel ID if the UI offers that path.
6. Scan/discover the MCP tools.
7. Verify the discovered tool set before installing the plugin.
8. Install the personal plugin.

Expected initial tools:

```text
system_capabilities
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

`terminal_run` may be discoverable, but the server must report it as **disabled** in the default profile. Calling it should fail closed until the local server is deliberately restarted with terminal enabled.

## 6. Acceptance Test A: ChatGPT Work

Open the ChatGPT homepage, switch from **Chat** to **Work**, start a fresh Work conversation, type `@`, and explicitly select the personal plugin.

Run the following sequence against the disposable fixture:

1. Ask it to call `system_capabilities` and confirm the only configured root is `/tmp/chatgpt-system-acceptance`.
2. Call `fs_list` on `.`.
3. Call `fs_read` on `fixture.txt` and keep the returned SHA-256.
4. Call `fs_apply_patch` or `fs_write` with that `expectedSha256` to change `before` to `after`.
5. Repeat a mutation using the now-stale old SHA-256; it must fail with `CONFLICT`.
6. Call `git_diff`; it must show only the intended fixture change.
7. Attempt to read a path outside the allowed root, for example `../outside.txt`; the policy must reject it.
8. Confirm terminal execution remains disabled.

Do not proceed to a valuable project until this sequence behaves exactly as expected.

## 7. Acceptance Test B: normal Chat

Only after Work passes:

1. Open a normal **Chat** conversation.
2. Look for the personal plugin through `@` or the plugin picker available in that surface.
3. If it can be invoked, repeat the read-only portion of the smoke test first.
4. Perform one guarded write only on the disposable fixture.

Record the actual observed product behavior. Do not infer support from the Work result.

### If normal Chat works

Phase 1 has reached the actual project goal. Keep the private tunnel architecture and do not build a cloud relay merely for entertainment.

### If normal Chat does not expose or permit the personal plugin

Record the exact UI limitation/error. That result triggers a separate Phase 2 design for a **submission-ready public Plugin + stable HTTPS MCP gateway + private device relay**. Do not expose the Mac directly or improvise a public reverse proxy as a permanent solution.

## Terminal access is a separate decision

The initial acceptance test does not require terminal execution.

If terminal is deliberately enabled later:

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --enable-terminal \
  --allow-command git \
  --allow-command node \
  --allow-command npm
```

`terminal_run` uses `shell=false`, an executable allowlist, bounded output/time, and an allowed working directory. It is still **not an OS sandbox**. An interpreter, package manager, compiler, or build tool can exercise the permissions of the OS user running it.

For hard process isolation, use a container, VM, or dedicated OS account.

## HTTP mode remains local/trusted

Authenticated Streamable HTTP is still useful for local clients and integration tests:

```bash
node dist/cli.js http \
  --root /absolute/path/to/project \
  --token '<long-random-secret>'
```

The default endpoint is `http://127.0.0.1:4312/mcp`. It is loopback-only by default and applies Host/Origin validation guards.

Do **not** expose this raw listener directly to the public internet for the personal-plugin path. Secure MCP Tunnel exists specifically so that is unnecessary.

## Troubleshooting order

If ChatGPT cannot discover or call the plugin:

1. Run `tunnel-client doctor --profile chatgpt-system --explain`.
2. Confirm `tunnel-client run --profile chatgpt-system` is still healthy.
3. Confirm the tunnel is associated with the intended Platform organization and ChatGPT context.
4. Confirm Developer Mode is still enabled.
5. Re-scan the Plugin tools after descriptor changes.
6. Check the local `chatgpt-system` audit log for the attempted operation metadata.
7. Test `system_capabilities` before attempting any mutation.

Never respond to a connectivity problem by broadening the filesystem root or enabling terminal access. Those actions increase authority and do not repair a tunnel association.
