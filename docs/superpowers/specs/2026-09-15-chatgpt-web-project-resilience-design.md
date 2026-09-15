# ChatGPT Web Project Resilience Design

Date: 2026-09-15
Status: approved by user direction; implementation active

## Problem

`chatgpt-system` can remain locally healthy while ChatGPT Web loses either the visible response stream or the developer-MCP capability for a conversation. The user has observed two distinct hosted-side symptoms during normal text-chat project work:

1. `Connection interrupted. Waiting for the complete answer` while the local tunnel and MCP server continue processing commands.
2. A later message in a previously working conversation fails before local routing with `This conversation does not support developer MCPs`; the custom app may also stop appearing in the composer `@` picker even though it was selected earlier.

A separate historical local failure also exists: a tunnel profile temporarily pointed at a managed worktree whose dependencies were later removed, producing `ERR_MODULE_NOT_FOUND` for `zod`, stdio EOF, and tunnel restart. That local signature must remain distinguishable from the hosted failures above.

The repository already has the right durable state primitive—Project Continuity—and a daily-driver service. The gap is operational resilience: preserve semantic progress before a hosted capability disappears, reduce unnecessary sequential MCP round trips, classify local evidence without leaking identifiers, and avoid destructive recovery when the product surface is the failing boundary.

## Goals

1. Make project work recoverable after developer-MCP capability disappears mid-conversation.
2. Reduce exposure to long, tool-heavy hosted turn/orchestration failure by batching or parallelizing independent work when an existing bounded tool supports it.
3. Never widen authority merely to batch work.
4. Add a privacy-safe local diagnostic command that distinguishes strong local-failure signatures from a healthy local runtime with no local failure evidence.
5. Detect whether the active MCP child comes from a stable runtime location, a managed worktree, or an unknown path, so worktree cleanup cannot silently invalidate a live tunnel target.
6. Keep `project_resume` as the first project mutation step after MCP capability returns in a new or recovered chat.
7. Preserve all current safety, Git, TCC, authority, CAPTCHA/anti-bot, Browser-vs-Computer, and publication boundaries.

## Non-goals

- Do not attempt to modify ChatGPT Web composer behavior, the `@` picker, conversation capability routing, or OpenAI hosted turn orchestration from local code.
- Do not restart the tunnel merely because ChatGPT Web shows a stream interruption or the conversation reports developer MCP unavailability.
- Do not add a second project-memory or checkpoint database.
- Do not persist request IDs, tunnel IDs, prompt content, tool arguments, file content, stdout/stderr content, browser data, credentials, or authority lease IDs in diagnostics.
- Do not change the preserved dirty `feat/computer-use-perception-reliability` worktree or its four owned paths as part of this feature.
- Do not alter `docs/CHATGPT_INTEGRATION.md` or `scripts/setup-daily-driver.mjs` while their preserved concurrent changes remain unclassified.

## Failure taxonomy

### A. Product-surface developer-MCP loss

Signal: ChatGPT returns `This conversation does not support developer MCPs` before the local namespace can be invoked.

Contract:

- Treat this as product-surface/tool-routing unavailability, not proof of daemon or tunnel failure.
- Do not retry the same unavailable namespace repeatedly.
- Do not substitute container access for the user's Mac.
- Do not claim local mutation, tests, or Git operations that were not actually performed.
- Continue only after developer MCP tools are available again; then `project_resume` the exact alias before project mutation.
- If the custom app is absent from the current composer/tools surface, use a new supported standard text chat in the same Project rather than depending on `@mention` recovery in the broken conversation.

### B. Web response-stream interruption

Signal: ChatGPT Web displays `Connection interrupted. Waiting for the complete answer` while the local runtime may remain healthy.

Contract:

- Do not equate the UI stream state with local command failure.
- Do not restart healthy local processes solely for this symptom.
- Prefer a fresh browser/chat turn and resume from Continuity if the hosted turn does not recover.
- Use local diagnostics to determine whether there is evidence of a local restart/stdio/dependency failure around the incident.

### C. Local MCP/tunnel failure

Strong local signals include:

- daily-driver not loaded/running;
- recent tunnel WARN/ERROR records;
- recent `stdio MCP command failed`, EOF, or child-exit records;
- recently modified stderr containing `ERR_MODULE_NOT_FOUND` for `zod`;
- active MCP command rooted in a managed worktree whose required runtime dependencies are absent.

These signals justify local investigation. They still do not justify blind restart loops.

## Architecture

### 1. Agent resilience protocol

Extend `AGENTS.md` with a dedicated ChatGPT Web/MCP resilience section.

The protocol adds **risk checkpoints** in addition to existing meaningful milestones. Before a sequence expected to be long or tool-heavy, the agent should checkpoint the semantic state when Project Continuity is available. A practical trigger is any sequence expected to require roughly eight or more sequential MCP calls, a long hosted wait/poll cycle, or a transition after which losing the current conversation would force the user to reconstruct intent.

The checkpoint must contain the exact current goal, branch/worktree/HEAD when relevant, latest completed milestone, blocker, and next exact step. It must not contain sensitive content.

The protocol also requires:

- prefer existing bounded batch tools (`fs_apply_patch_set`, `computer_run`, compound `shell_run` only when Admin authority is already required) and parallel independent read-only calls over unnecessary serial model yields;
- never acquire broader authority solely to reduce call count;
- use short one-shot status polling, not long remote watchers;
- after product-surface MCP loss, stop local claims and hand off to a new supported chat rather than probing the unavailable namespace repeatedly;
- before removing a worktree used for ChatGPT tunnel acceptance, run the diagnostic command and refuse cleanup if the active MCP child is still sourced from that worktree.

### 2. Continuity model guidance

Strengthen only the public descriptions for `project_resume` and `project_checkpoint`; the storage model and schemas remain unchanged.

`project_checkpoint` guidance should explicitly mention proactive checkpointing before long/tool-heavy/remote-sensitive sequences because developer MCP capability can disappear between messages.

`project_resume` guidance should explicitly state that after developer MCP capability returns in a new/recovered chat it is the first project tool to call before mutation.

This is model guidance, not automatic logging. The existing optimistic record-version conflict protection remains authoritative.

### 3. Privacy-safe local ChatGPT connection diagnostics

Add `scripts/diagnose-chatgpt-connection.mjs` and an npm script `diagnose:chatgpt`.

The command is macOS/daily-driver focused and reads only local operational evidence:

- `launchctl print` for the known daily-driver label;
- the bounded daily-driver `stdout.log` and `stderr.log`;
- the process table only to identify the descendant MCP command path;
- filesystem existence checks for the active runtime's `dist/cli.js`, `node_modules`, and `node_modules/zod/package.json`.

The command must output sanitized JSON only. It must never emit raw log lines, process command lines, request IDs, tunnel IDs, client instance IDs, local file contents, credential values, or PIDs.

Public output shape:

```ts
type Diagnosis =
  | "LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE"
  | "LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE"
  | "LOCAL_RUNTIME_DEPENDENCY_FAILURE"
  | "DAILY_DRIVER_UNAVAILABLE"
  | "INSUFFICIENT_EVIDENCE";

type RuntimeSource = "stable-runtime" | "managed-worktree" | "other" | "unknown";

interface ChatGptConnectionDiagnostic {
  diagnosis: Diagnosis;
  windowMinutes: number;
  dailyDriver: {
    loaded: boolean;
    running: boolean;
    neverExited: boolean | null;
  };
  tunnel: {
    forwardedCommandCount: number;
    warningCount: number;
    errorCount: number;
    stdioFailureCount: number;
    recentActivity: boolean;
  };
  runtime: {
    source: RuntimeSource;
    distCliPresent: boolean | null;
    nodeModulesPresent: boolean | null;
    zodPresent: boolean | null;
  };
  stderr: {
    recent: boolean;
    dependencyFailureSignature: boolean;
  };
  guidance: string[];
}
```

Default evidence window: 15 minutes. CLI accepts `--minutes <1..120>` only.

Classification priority:

1. daily-driver unavailable → `DAILY_DRIVER_UNAVAILABLE`;
2. recent stderr dependency signature or active runtime dependency missing → `LOCAL_RUNTIME_DEPENDENCY_FAILURE`;
3. recent tunnel warning/error/stdio failure → `LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE`;
4. running daily-driver plus recent forwarded commands and no local failure evidence → `LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE`;
5. otherwise → `INSUFFICIENT_EVIDENCE`.

`LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE` deliberately does not claim that OpenAI is at fault; it only proves that the inspected local window contains no strong local failure signal.

### 4. Stable-runtime cleanup guard

No automatic worktree deletion behavior is added. Instead, agent protocol uses the diagnostic runtime-source result as a pre-cleanup guard:

- `stable-runtime`: normal task-owned cleanup rules apply;
- `managed-worktree`: do not remove that worktree until the tunnel/profile is repointed and a fresh diagnostic no longer reports it as active;
- `other`/`unknown`: inspect before cleanup; do not guess.

This directly prevents the historical pattern where dependency cleanup invalidated the active MCP child.

### 5. User-facing recovery runbook

Create `docs/CHATGPT_WEB_RESILIENCE.md` and link it from `README.md`.

The runbook must explicitly handle the user's real composer behavior:

- selecting the custom app once does not prove it remains invokable on later turns;
- if `@chatgpt-system-local` no longer appears, do not keep trying to force it in the same broken conversation;
- open a new supported standard text chat in the same Project, select the custom app from whatever supported apps/tools surface is available, then say `chatgpt-system projesine devam et` or the exact project continuation request;
- the first local project action is `project_resume`, followed by Git/worktree reconciliation;
- if the custom app is absent across new supported chats as well, treat it as product/account rollout/routing availability and do not modify local configuration merely to chase the UI state.

The runbook also distinguishes `Connection interrupted` from local MCP failure and documents `npm run diagnose:chatgpt` as the safe evidence collector.

## Testing strategy

TDD is required for behavior changes.

1. Add RED unit tests for the diagnostic classifier and sanitization contract.
2. Implement pure parsing/classification helpers, then the macOS evidence collector.
3. Add RED tests for Continuity tool descriptions requiring proactive risk-checkpoint/new-chat resume guidance.
4. Update descriptions minimally.
5. Add/extend docs contract tests requiring the new recovery wording, new-chat path, no blind restart, batching, and diagnostic command.
6. Run focused tests after each task, then full `npm run check`.
7. Run the real diagnostic command against the installed daily-driver and inspect only its sanitized JSON output.
8. Run `git diff --check` and freshness-bound `project_check` on the exact final HEAD before publication readiness is claimed.

## Safety and privacy invariants

- No credential, request ID, tunnel ID, client instance ID, PID, raw process command, raw log line, file content, typed text, browser content, screenshot/OCR/AX content, or authority lease ID in diagnostic output.
- No automatic tunnel restart for product-surface or Web-stream symptoms.
- No new persistent state store.
- No authority widening for batching.
- No mutation on `main`.
- No modification of preserved dirty worktree contents.
- No remote push/PR/merge without explicit user authorization for that action.

## Acceptance criteria

1. `npm run diagnose:chatgpt` returns only the bounded sanitized schema above and correctly classifies fixture scenarios for healthy-local, stdio/tunnel failure, missing dependency, unavailable daily-driver, and insufficient evidence.
2. The real installed daily-driver can be diagnosed without exposing request/tunnel/client IDs or raw logs.
3. `AGENTS.md` requires proactive risk checkpoints, bounded batching/parallelism, product-surface fail-closed handoff, and runtime-source cleanup guard.
4. Continuity tool descriptions instruct proactive checkpointing and first-action `project_resume` after capability recovery.
5. README and the new resilience runbook document the actual no-`@` recovery path through a new standard chat in the same Project.
6. Existing safety/authority behavior is unchanged.
7. Focused tests and full repository verification pass on the exact implementation branch state.
