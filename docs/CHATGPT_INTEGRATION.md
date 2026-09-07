# ChatGPT integration

This document describes the intended private connection path from ChatGPT/OpenAI products to `chatgpt-system`.

## Recommended architecture

For a developer machine, prefer Secure MCP Tunnel with the server launched over **stdio**:

```text
ChatGPT / supported OpenAI product
        |
        | OpenAI-hosted MCP tunnel endpoint
        v
Secure MCP Tunnel control plane
        ^
        | outbound HTTPS only
        |
tunnel-client on your machine
        |
        | stdio child process
        v
chatgpt-system
        |
        +-- allowed filesystem roots
        +-- read-only Git inspection
        +-- optional allowlisted terminal execution
```

This avoids publishing the local MCP listener and avoids needing a second local HTTP authentication hop.

OpenAI's Secure MCP Tunnel is designed for private/on-premises/developer-machine MCP servers. `tunnel-client` makes outbound HTTPS connections to OpenAI, receives queued MCP work, forwards it to the local MCP server, and returns the responses through the tunnel.

Official references:

- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta

## Prerequisites

You need:

1. A built copy of this repository (`npm install && npm run build`).
2. A Secure MCP Tunnel `tunnel_id` from OpenAI Platform tunnel settings.
3. A runtime OpenAI API key usable by `tunnel-client`.
4. `tunnel-client` installed from the current OpenAI release.
5. The required Platform tunnel permissions (`Read + Use`; `Manage` is required to create/edit tunnels).
6. A ChatGPT workspace/product surface that supports the MCP capabilities you intend to use.

ChatGPT plan/workspace availability is controlled by OpenAI and can change independently of this repository. Check the current OpenAI developer-mode documentation before rollout.

## 1. Build chatgpt-system

```bash
git clone https://github.com/senoldogann/chatgpt-system.git
cd chatgpt-system
npm install
npm run check
```

Choose the smallest filesystem root that contains the project ChatGPT should be allowed to access. Do not use `/`, your entire home directory, or another broad root simply for convenience.

## 2. Verify the local stdio server

Run it manually first:

```bash
node dist/cli.js stdio --root /absolute/path/to/project
```

The process speaks MCP on stdin/stdout. Protocol output owns stdout; diagnostics use stderr.

Terminal execution remains disabled unless you deliberately add `--enable-terminal`.

## 3. Configure Secure MCP Tunnel

OpenAI's current tunnel client supports a local stdio MCP command. A profile for this project follows the same pattern:

```bash
export CONTROL_PLANE_API_KEY="<runtime-api-key>"

# Replace both placeholders with your real values.
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile chatgpt-system \
  --tunnel-id "<tunnel_id>" \
  --mcp-command "node /absolute/path/to/chatgpt-system/dist/cli.js stdio --root /absolute/path/to/project"
```

Validate the profile before connecting it to a product:

```bash
tunnel-client doctor --profile chatgpt-system --explain
```

Then run it:

```bash
tunnel-client run --profile chatgpt-system
```

Keep that process healthy while ChatGPT or another OpenAI surface is discovering or calling MCP tools.

## 4. Connect from ChatGPT

Where developer-mode custom apps are available:

1. Enable developer mode for the target account/workspace.
2. Create a custom app.
3. Choose **Tunnel** as the connection type.
4. Select the tunnel associated with the target ChatGPT workspace, or provide its `tunnel_id` when the UI supports it.
5. Scan the MCP tools.
6. Review the discovered tools and their write/destructive annotations before enabling them.
7. Test read operations first (`system_capabilities`, `fs_list`, `fs_read`, `git_status`).
8. Only then test guarded mutations (`fs_write`, `fs_apply_patch`).
9. Keep `terminal_run` disabled until filesystem-only behavior is proven.

ChatGPT may require confirmation for write/modify actions based on app permissions, context, and impact. Particularly risky actions may be blocked by the host even if the MCP server exposes them.

## 5. Expected smoke test

A successful connection should support this sequence:

1. `system_capabilities` returns the configured root and limits.
2. `fs_list` lists a project directory inside that root.
3. `fs_read` reads a test file and returns its SHA-256.
4. `fs_write` or `fs_apply_patch` uses that SHA-256 as `expectedSha256`.
5. A repeated mutation using the stale hash is rejected as a conflict.
6. `git_diff` shows the resulting change.

That proves the important path end to end: OpenAI product -> tunnel -> MCP protocol -> policy boundary -> filesystem -> result.

## HTTP mode

`chatgpt-system http` remains useful for trusted local MCP clients, private reverse proxies, integration tests, or environments where a tunnel client is configured to reach an HTTP MCP server.

The default listener is loopback-only and requires a bearer token:

```bash
node dist/cli.js http \
  --root /absolute/path/to/project \
  --token '<long-random-secret>'
```

The endpoint is `http://127.0.0.1:4312/mcp`.

When bound to localhost, the server also applies the MCP SDK's Host and Origin validation guards to reduce DNS-rebinding and browser-origin attacks.

Do not expose this raw listener directly to the public internet.

## Security rollout order

Use this order when enabling capabilities:

1. Filesystem read-only tools.
2. Hash-guarded filesystem writes.
3. Read-only Git tools.
4. Terminal execution only when genuinely needed.
5. Container/VM/dedicated OS account when terminal authority must be strongly isolated.

`terminal_run` is intentionally not described as a sandbox. An allowlisted interpreter or build tool can still exercise the operating-system user's permissions.
