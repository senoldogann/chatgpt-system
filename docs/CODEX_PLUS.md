# Plus-compatible local path: Codex

ChatGPT web and Codex are different product surfaces. Full custom MCP write/modify support in ChatGPT web is plan-gated, but Codex local can use local MCP servers over stdio and Codex is included with ChatGPT plans.

For `chatgpt-system`, that gives a practical local path without publishing the MCP server or paying for a workspace plan just to test filesystem/Git tooling.

## Architecture

```text
ChatGPT account sign-in (Plus works with Codex)
        |
        v
Codex local (CLI / supported local Codex surface)
        |
        | stdio MCP
        v
chatgpt-system
        |
        +-- allowed filesystem roots
        +-- read-only Git tools
        +-- optional allowlisted terminal
```

No Secure MCP Tunnel is required for this path because Codex launches the MCP process locally.

## Setup

Build the project first:

```bash
npm install
npm run build
```

Register one project root with Codex:

```bash
npm run setup:codex -- --root /absolute/path/to/project
```

The setup script uses Codex's own MCP configuration command and registers `chatgpt-system` as a local stdio server. It requires an explicit `--root` rather than guessing what the agent should be allowed to access.

Multiple roots:

```bash
npm run setup:codex -- \
  --root /Users/you/Projects/app \
  --root /Users/you/Projects/shared
```

Use a different MCP registration name:

```bash
npm run setup:codex -- \
  --name chatgpt-system-work \
  --root /Users/you/Projects/work
```

## Verify

```bash
codex mcp get chatgpt-system --json
codex mcp list --json
```

Then open a new Codex local session and inspect `/mcp`. Ask Codex to call `system_capabilities` first so you can confirm the exact roots and terminal policy it received.

A sensible first smoke test is:

```text
Use chatgpt-system. Call system_capabilities, list the project root, read README.md, then show git status. Do not modify anything.
```

## Terminal access

Terminal remains disabled by default.

To enable it explicitly:

```bash
npm run setup:codex -- \
  --root /Users/you/Projects/my-app \
  --enable-terminal
```

To replace the default executable allowlist:

```bash
npm run setup:codex -- \
  --root /Users/you/Projects/my-app \
  --enable-terminal \
  --allow-command git \
  --allow-command node \
  --allow-command npm
```

This is still not an OS sandbox. An allowed interpreter or package manager can exercise the permissions of your local OS user. Use a container, VM, or dedicated account when hard isolation matters.

## What this does and does not solve

This route solves the practical local-agent problem for Plus users who want an OpenAI coding agent to use `chatgpt-system` on their machine.

It does **not** unlock plan-gated full custom MCP inside ordinary ChatGPT web conversations. It avoids that limitation by using Codex, a supported local OpenAI surface that can launch local MCP servers directly.

For a future ChatGPT-web connection, keep using the Secure MCP Tunnel design documented in [CHATGPT_INTEGRATION.md](CHATGPT_INTEGRATION.md) when the account/workspace has the required MCP capability.

## References

- OpenAI Help: Codex is included across ChatGPT plans: https://help.openai.com/en/articles/11369540
- OpenAI Codex MCP configuration supports local stdio MCP servers via `mcp_servers` / `codex mcp add`.
