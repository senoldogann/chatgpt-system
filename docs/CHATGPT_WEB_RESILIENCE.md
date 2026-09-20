# ChatGPT Web Project Resilience

This runbook covers two hosted-side failure symptoms that can occur while `chatgpt-system` itself remains healthy:

- `This conversation does not support developer MCPs`
- `Connection interrupted. Waiting for the complete answer`

It also distinguishes those symptoms from genuine local Secure MCP Tunnel / MCP runtime failures. The goal is recoverable project work without blind restarts, false local-change claims, or loss of Project Continuity state.

## Symptom classifier

| Symptom | What it proves | First action |
| --- | --- | --- |
| `This conversation does not support developer MCPs` | The current ChatGPT conversation/turn cannot expose developer MCP tools. It does **not** prove the local daemon or tunnel failed. | Stop local-change claims and do not repeatedly retry the unavailable namespace. |
| `@chatgpt-system-local` no longer appears in the composer or tools surface | The custom app is absent from the current product surface. It does **not** prove the local Mac is unhealthy. | Use a new supported standard text chat in the same Project instead of repeatedly trying `@` in the broken conversation. |
| `Connection interrupted. Waiting for the complete answer` | The Web response stream was interrupted. It is not evidence of local MCP failure by itself. | Preserve the current work state; do not restart a healthy tunnel solely for this message. |
| `npm run diagnose:chatgpt` reports local failure evidence | The inspected local window contains a concrete daily-driver/tunnel/runtime failure signature. | Investigate the specific local signal before retrying. |

## Recovery when the custom app still exists in the current chat

If the current **standard text chat** still exposes the custom app in the supported tools/apps surface, select it there for the message that requires local access. Do not rely on the fact that it was selected earlier; actual tool availability is the evidence that matters.

If tool schemas changed and the ChatGPT app configuration exposes a supported **Refresh** action, use that product action to reload the catalog. Do not disconnect/recreate the app merely to simulate refresh.

Once the developer MCP surface is actually available, the **first project action** is `project_resume` for the exact registered alias. Reconcile Git/worktree reality before any project mutation.

## Recovery when `@chatgpt-system-local` disappears

Selecting the app once does not guarantee it remains invokable on a later turn. If `@chatgpt-system-local` no longer appears, disappears from the composer, or the current conversation returns `This conversation does not support developer MCPs`, do not keep trying the same unavailable `@` path.

Use this recovery path:

1. Leave the broken conversation unchanged; do not repeatedly retry the unavailable developer-MCP namespace.
2. Open a **new supported standard text chat** in the **same Project**.
3. Select `chatgpt-system-local` from whatever supported apps/tools surface the new chat actually exposes. The recovery path does not assume the composer `@` picker is present.
4. Ask to continue the exact project, for example `chatgpt-system projesine devam et`.
5. The first local project action must be `project_resume` for the exact registered alias, followed by Git/worktree reconciliation before project mutation.
6. Continue from the checkpointed `Next exact step`; do not ask the user to reconstruct already checkpointed engineering state.

If the custom app is absent across new supported standard text chats as well, treat that as product/account/rollout/tool-routing availability evidence. Do not weaken local authority, reconfigure repository roots, invent a public MCP endpoint, or restart a healthy local tunnel merely to chase the UI state. Container access is not the user's Mac and must not be substituted for the unavailable developer MCP surface.

## Recovery from `Connection interrupted. Waiting for the complete answer`

`Connection interrupted. Waiting for the complete answer` is a Web-stream symptom, not proof of local tunnel failure. A long or tool-heavy turn can lose its visible stream while local MCP work continues or while the hosted turn already has a completed result.

When this appears:

1. Do not restart the daily-driver or tunnel solely because of the UI message.
2. Record the approximate incident time if possible.
3. If the page later shows the completed answer after refresh/reopen, treat that as strong evidence that the visible Web stream was the failed boundary rather than the local operation.
4. Run `npm run diagnose:chatgpt` close to the incident time to inspect bounded local evidence.
5. If the current conversation also loses developer MCP capability, use the new supported standard text chat path above and resume through Project Continuity.

Do not use container fallback as the user's Mac. If developer MCP tools are unavailable, no agent should claim that local files, tests, Git state, or runtime state were changed or verified through the plugin.

## Safe local diagnostic

Run:

```bash
npm run diagnose:chatgpt
```

Optional bounded evidence window:

```bash
npm run diagnose:chatgpt -- --minutes 30
```

The accepted range is 1–120 minutes. The diagnostic emits sanitized JSON only. It does not emit raw log lines, request IDs, tunnel IDs, client instance IDs, PIDs, raw process commands, credentials, prompt content, tool arguments, file contents, browser data, screenshots, OCR/AX content, or authority lease IDs.

Interpret the top-level `diagnosis` conservatively:

- `LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE`: the inspected window contains recent forwarded MCP activity and no strong local failure signature. This does **not** prove an OpenAI fault; it means the local evidence inspected does not support a local crash. Do not restart a healthy tunnel solely for the hosted UI symptom.
- `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE`: recent tunnel WARN/ERROR/stdio-failure evidence exists. Investigate that local cause first.
- `LOCAL_RUNTIME_DEPENDENCY_FAILURE`: the active runtime is missing required runtime material or recent stderr contains the bounded missing-`zod` dependency signature. Rebuild/repoint the runtime; do not hide it with a restart loop.
- `DAILY_DRIVER_UNAVAILABLE`: the configured daily-driver is not loaded and running. Diagnose the local service first.
- `INSUFFICIENT_EVIDENCE`: the requested window does not contain enough local activity/failure evidence to classify the boundary. Capture a closer incident time and rerun.

## Managed-worktree cleanup guard

The diagnostic reports only a categorical runtime source:

- `stable-runtime`
- `managed-worktree`
- `other`
- `unknown`

If it reports `managed-worktree`, **do not remove** that worktree. First repoint/update the tunnel profile to a stable runtime, restart only as part of that intentional deployment transition, and rerun `npm run diagnose:chatgpt`. Cleanup may proceed only after a fresh diagnostic no longer reports the worktree as the active runtime source.

For `other` or `unknown`, inspect the deployment source before cleanup; never guess. This guard prevents the historical failure pattern where a live MCP child referenced an ephemeral worktree and later lost runtime dependencies after cleanup.

## Reduce hosted turn exposure without widening authority

For long project work, agents should create a bounded Project Continuity **risk checkpoint** before roughly eight or more sequential MCP calls, long hosted polling, or another transition where losing the conversation would make intent expensive to reconstruct.

Prefer existing bounded batching or parallel independent reads over unnecessary model/tool round trips. This is a reliability optimization only; never widen authority merely to batch work, and never collapse operations that require distinct safety verification into one opaque command.

## Evidence for OpenAI Support

When the local diagnostic is healthy but ChatGPT Web repeatedly loses the response stream or developer-MCP capability, preserve privacy-safe correlation evidence for OpenAI Support. Useful evidence can include:

- exact incident timestamp and time zone;
- the visible UI error string;
- whether a refresh/reopen revealed a completed answer;
- whether a new supported standard text chat in the same Project could expose the app;
- the diagnostic classification and counts;
- when available, relevant tunnel command **request ID** or hosted workflow/correlation identifiers supplied privately through Support.

Do not post API keys, bearer tokens, tunnel credentials, cookies, prompt contents, repository contents, or other secrets in public issue trackers.

## Explicit non-actions

- Do not repeatedly retry an unavailable developer-MCP namespace.
- Do not restart a healthy tunnel just because ChatGPT Web shows either hosted symptom.
- Do not substitute container access for the user's Mac.
- Do not widen Project/User/Admin authority to recover product UI availability.
- Do not delete an active `managed-worktree` runtime source.
- Do not claim local changes when developer MCP access was unavailable.

The local system can make project work resilient and diagnosable; it cannot locally repair ChatGPT's composer `@` picker, hosted conversation capability routing, or Web response stream.
