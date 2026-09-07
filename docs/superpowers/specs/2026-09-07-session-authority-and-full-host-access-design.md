# Session Authority and Full Host Access Design

Date: 2026-09-07
Status: Proposed, awaiting final written-spec approval
Branch: `feat/session-authority-profiles`

## 1. Objective

Extend `chatgpt-system` from a filesystem/Git MCP bridge into a professional local authority gateway for ChatGPT Web and Desktop. A user chooses one authority profile once per ChatGPT session, and that session receives a bounded capability lease covering filesystem, terminal, developer workflows, and later computer-use actions.

The three supported profiles are:

- **Project Full Access**: full authority inside explicitly selected project roots.
- **User Full Access**: full authority inside the current macOS user's home scope.
- **Machine Admin**: host-wide authority, including operations that require native macOS elevation.

The design must preserve the existing security properties: explicit authority, fail-closed policy checks, structured MCP tools, auditability, bounded execution, SHA-guarded file mutations, and no secret disclosure to the model.

## 2. Current Foundation

`chatgpt-system` already provides:

- MCP stdio and Streamable HTTP transports.
- Secure MCP Tunnel integration for ChatGPT Developer Mode plugins.
- explicit filesystem roots with canonical realpath confinement.
- symlink escape prevention.
- SHA-256 conflict checks for file replacement, patching, and removal.
- filesystem and read-only Git tools.
- an opt-in `terminal_run` tool with `shell=false`, command allowlisting, sanitized environment, timeout, output limits, and audit logging.
- explicit MCP annotations and output schemas.
- Node 22/24 CI and real MCP handshake tests.

The separate `computer-use` repository already contains the more specialized macOS execution machinery: Rust actuation, Python orchestration, Accessibility-first grounding, screenshots, mouse/keyboard actions, human-presence detection, kill-switches, bounded recovery, approvals, capability grants, and autonomous-run budgets. This project will integrate that system rather than reimplement it.

## 3. Architectural Principle

`chatgpt-system` becomes the **authority gateway**. It decides what a ChatGPT session is allowed to do and routes permitted operations to specialized executors.

```text
ChatGPT Web / Desktop
        |
        v
chatgpt-system Plugin
        |
        v
Session Authority Gateway
        |
        +--> Filesystem / Git
        |
        +--> Developer Executor
        |
        +--> macOS Privilege Broker
        |
        +--> computer-use Bridge
        |
        +--> Audit / Lease Store / Kill Switch
```

The ChatGPT Web plugin remains the canonical integration path. Desktop may use the same installed plugin and tunnel-backed MCP surface; no separate authority implementation is created for Desktop.

## 4. Session Authority Model

### 4.1 No process-global authority

Authority must never be stored as one global mutable mode for the MCP process. Two chats can exist at the same time, and an admin choice in one must not elevate another.

The server therefore issues an opaque **authority lease**.

### 4.2 Session tools

Add three public MCP tools:

- `session_authority_start`
- `session_authority_status`
- `session_authority_end`

`session_authority_start` accepts:

```json
{
  "profile": "project" | "user" | "admin",
  "projectRoots": ["/absolute/path"],
  "requestedTtlSeconds": 3600
}
```

Rules:

- `projectRoots` is required only for the `project` profile.
- requested roots are canonicalized and validated before a lease is issued.
- the server returns a cryptographically random opaque `leaseId` plus effective scope, expiry, and capabilities.
- the raw lease value is never logged.
- a lease is immutable after creation. Changing profile means ending it and creating a new lease.
- expired and ended leases fail closed.

### 4.3 Explicit lease propagation

The design does not assume that ChatGPT will always provide a stable conversation identifier to the MCP server. Privileged tools therefore receive an `authorityLeaseId` argument and validate it server-side.

Tool descriptions and plugin guidance instruct ChatGPT to reuse the lease returned by `session_authority_start` for the rest of that conversation. This is more verbose than hidden process-global state, but it avoids cross-chat privilege leakage.

### 4.4 Default TTLs

Maximum default lease durations:

- Project Full Access: 8 hours.
- User Full Access: 4 hours.
- Machine Admin: 1 hour.

The server may clamp a requested TTL downward but never above the profile maximum.

A server restart invalidates all in-memory leases unless a future persistent lease store is explicitly designed. Phase 1 intentionally treats restart as revocation.

## 5. Authority Profiles

### 5.1 Project Full Access

Scope: one or more explicit project roots.

Capabilities:

- full file read/write/mkdir/move/remove inside selected roots.
- SHA-guarded existing-file mutations remain mandatory.
- Git read and developer Git operations when explicitly exposed.
- terminal execution inside selected roots.
- build, test, lint, formatter, package-manager, compiler, and local development commands.
- computer-use actions needed to verify the project in IDE/browser/native app.

Not allowed:

- reading or modifying unrelated home directories.
- host administration.
- credential stores or secure input extraction.

### 5.2 User Full Access

Scope: canonical current-user home directory.

Capabilities:

- Project profile capabilities plus Desktop, Documents, Downloads, user configuration, user-owned application data, and user-level launch agents.
- terminal commands executed as the current user.
- computer-use across normal user applications.

Hard boundaries remain:

- no extraction of passwords, secure text fields, keychain secrets, API secrets, or authentication tokens for model consumption.
- no automatic privilege elevation to root.

### 5.3 Machine Admin

Scope: host-wide operations that the local user explicitly delegates for the current lease.

Capabilities:

- host filesystem access where macOS permissions permit it.
- system configuration and service operations.
- privileged developer operations.
- machine-level package/service administration when explicitly requested by the task.
- computer-use across system settings and privileged dialogs.

Admin does **not** mean the model receives an administrator password, Touch ID material, keychain secrets, or reusable sudo credentials.

## 6. macOS Native Elevation and Touch ID

Machine Admin uses a dedicated **Privilege Broker**, not arbitrary password piping.

Principles:

1. `chatgpt-system` sends a structured privileged-operation request to the broker.
2. The broker validates the active admin lease and operation class.
3. Elevation uses a native macOS authorization path.
4. macOS presents its normal local authorization UI. Where the host supports and offers biometric authorization, Touch ID is used; otherwise the native password fallback remains available.
5. Credentials and biometric material never pass through ChatGPT, MCP tool arguments, logs, stdout, or environment variables.
6. Authorization is operation-scoped or short-lived according to the native API. The project will not create a permanently passwordless root shell.

Implementation research must prefer current Apple-supported ServiceManagement / Authorization Services mechanisms. The implementation must not silently edit PAM configuration merely to force Touch ID.

Privileged operations are represented as typed actions rather than `sudo sh -c <model text>`.

## 7. Terminal Architecture

The current terminal implementation is a safe foundation but is not sufficient for the three-profile model.

### 7.1 Project/User profiles

Use `spawn(..., { shell: false })` with:

- cwd confinement derived from the active lease.
- sanitized environment.
- timeout and output ceilings.
- process-tree termination on timeout.
- structured exit result.
- executable resolution pinned at server startup where practical.
- explicit audit metadata.

### 7.2 Command policy

Project profile should support professional development commands, including at minimum:

- `git`
- `node`, `npm`, `npx`, `pnpm`, `bun`, `deno`
- `python3`, `pytest`, `uv`, `pip` where installed
- `go`
- `cargo`, `rustc`
- `swift`, `swiftc`, `xcodebuild`
- `make`, `cmake`, `ninja`

The profile is not implemented as one giant shell string. Pipes, redirections, compound shell syntax, and arbitrary script interpretation require a separately classified shell capability.

### 7.3 Shell capability

Add a distinct high-risk tool or execution mode for shell syntax rather than weakening `terminal_run`.

A proposed tool is `shell_run`, which is available only for User/Admin leases and requires a stricter destructive annotation. Project mode continues to prefer structured executable + args calls.

Machine Admin privileged commands go through the Privilege Broker instead of `shell_run` whenever root authority is required.

## 8. Developer Executor

Add a higher-level developer workflow layer without hiding the primitive tools.

Responsibilities:

- inspect repository state.
- identify relevant files.
- perform guarded edits.
- run build/test/lint/typecheck commands.
- classify failures.
- retry with bounded repair loops.
- show final diff and verification evidence.

The executor is orchestration, not a second file system. Existing filesystem/Git/process services remain the source of authority and enforcement.

A coding task should be able to execute this loop:

```text
inspect -> plan -> edit -> build/test -> diagnose -> repair -> re-test -> diff -> report
```

Every loop has ceilings for attempts, wall-clock time, output bytes, and process runtime.

## 9. computer-use Integration

The `computer-use` repository remains a separate specialized subsystem.

`chatgpt-system` adds an adapter that supervises and communicates with it over its existing typed local IPC boundary instead of importing its internals.

Initial MCP-facing capabilities should cover:

- computer health/capabilities.
- screenshot / observe.
- accessibility tree / element discovery.
- click / move / drag / scroll.
- keyboard typing and hotkeys.
- application activation/opening.
- focused application/window inspection.
- bounded goal execution through the existing OODA runner.
- kill-switch state.

Authority mapping:

- Project lease: GUI actions when related to the selected project and verification workflow.
- User lease: normal desktop application control.
- Admin lease: system UI control, while privileged changes still route through the Privilege Broker when OS elevation is required.

Existing `computer-use` safeguards remain active: credential-field blocking, human-presence handling, kill-switch, grants, bounded autonomy, and evidence-based verification. `chatgpt-system` authority is an additional outer boundary, not a replacement.

## 10. Session Safety and Approval Semantics

The ChatGPT plugin permission setting and local authority lease are independent layers.

A user may configure ChatGPT to `Allow all actions`, but the local gateway still enforces the selected lease.

For each session:

1. No privileged lease exists initially.
2. ChatGPT calls `session_authority_start` only after the user selects A/B/C.
3. The returned lease authorizes only that profile.
4. Destructive/high-impact local actions are audited.
5. Native admin elevation still requires the local macOS authorization UI when needed.
6. `session_authority_end` revokes immediately.
7. expiry or server restart revokes automatically.

The project will not expose a hidden `--trust-everything-forever` mode.

## 11. Secrets and Credential Boundary

The following are never returned as model-visible tool output:

- password field contents.
- Touch ID / biometric material.
- macOS Keychain secret values.
- raw API keys discovered on disk.
- private SSH key contents.
- browser session cookies or authentication tokens unless a future explicit secret-handling design is separately approved.

Tools may report that a credential exists or that native authentication succeeded without exposing the credential itself.

## 12. Auditing

Expand the existing audit log to include:

- lease creation/end/expiry metadata.
- profile and scope digest.
- tool name and authority decision.
- target path/cwd in display-safe form.
- process command and arg count, not secret-bearing raw environment.
- privileged operation class.
- native authorization success/failure.
- computer-use action category and verification outcome.

Never log:

- raw lease IDs.
- runtime API keys.
- passwords.
- secure-field contents.
- biometric data.

A same-user malicious process can still tamper with ordinary user-owned logs; the audit is operational evidence, not a tamper-proof security ledger.

## 13. Persistent Runtime

After the authority system is verified, add a macOS service layer so the user does not have to keep a Terminal window open.

Components:

- launchd-managed `tunnel-client` profile.
- launchd-managed local `chatgpt-system`/bridge dependencies where appropriate.
- health checks and bounded restart policy.
- log rotation.
- no secrets committed to repository files.
- runtime key stored through a macOS-appropriate protected mechanism, not plaintext in the repo.

Persistence is implemented after core authority tests, not before.

## 14. Error Handling

All privileged paths fail closed.

Examples:

- missing/invalid/expired lease -> `AUTHORITY_REQUIRED` or `AUTHORITY_EXPIRED`.
- wrong profile for operation -> `AUTHORITY_DENIED`.
- path outside lease scope -> existing policy denial.
- native authorization cancelled -> operation cancelled, no fallback bypass.
- computer-use driver unavailable -> typed bridge unavailable error; do not silently substitute raw shell UI automation.
- timeout/output limit -> terminate the process tree and return bounded evidence.
- ambiguous privilege classification -> require the stricter path.

## 15. Testing Strategy

### 15.1 Authority core

- no privileged call succeeds without a lease.
- leases are random, non-guessable, immutable, and expiry-bound.
- one lease cannot change profile in place.
- project lease cannot access sibling or home paths.
- user lease cannot automatically elevate to admin.
- admin lease expires after its maximum TTL.
- ending a lease revokes all following calls.
- concurrent leases cannot alter each other's scope.

### 15.2 Terminal

- shell remains false for `terminal_run`.
- cwd cannot escape lease roots.
- timeout kills the full child process tree.
- output limits remain enforced.
- disallowed commands fail before spawn.
- secrets are absent from the child environment unless explicitly safe.
- command resolution does not silently switch to a malicious repository-local binary.

### 15.3 Privilege Broker

- privileged actions require admin lease.
- native authorization cancellation fails closed.
- no credential appears in logs, tool outputs, arguments, or environment.
- typed privileged actions cannot smuggle arbitrary shell fragments.
- simulated broker tests run in CI; real Touch ID/native-auth tests are documented and run manually on macOS.

### 15.4 Computer-use bridge

- typed contract test against the existing driver.
- driver death/restart behavior.
- kill-switch propagation.
- credential-field protection remains active.
- project/user/admin authority mapping is enforced.
- simulated actuation in CI; no real cursor movement in CI.

### 15.5 End-to-end acceptance

1. Project profile edits a disposable repo, runs tests, repairs a seeded failure, and shows a clean verification result.
2. User profile reads/writes a disposable file under the user's home and operates a benign GUI test application.
3. Admin profile requests a harmless privileged operation and triggers native macOS authorization/Touch ID flow without revealing credentials.
4. A second ChatGPT session without the lease cannot reuse the first session's authority.
5. Work mode and normal Chat are tested separately through the installed web plugin.
6. Desktop is tested through the same installed plugin after the web path passes.

## 16. Delivery Phases

### Phase 1: Session Authority Core

- lease manager.
- A/B/C profiles.
- session tools.
- privileged-tool lease propagation.
- existing filesystem/Git/process integration.
- CI and MCP schema coverage.

### Phase 2: Developer Executor

- professional command profile.
- build/test/repair orchestration.
- process-tree handling.
- final-diff verification.

### Phase 3: Privilege Broker

- typed macOS privileged operations.
- native authorization UI.
- Touch ID when provided by macOS, password fallback otherwise.
- no secret exposure.

### Phase 4: computer-use Bridge

- supervise existing driver/orchestrator.
- expose typed observation/action/goal tools.
- retain kill-switch and existing safety rules.

### Phase 5: Persistent Service

- launchd-managed runtime.
- secure runtime credential storage.
- health/restart/logging.

## 17. Acceptance Criteria

The project is ready for the requested professional full-access workflow when:

- ChatGPT Web can start exactly one selected authority lease per conversational workflow and use it for subsequent local operations.
- the three profiles are behaviorally distinct and enforced locally.
- Project profile can complete a real edit/build/test/repair loop.
- User profile can operate across the user's normal home scope.
- Admin profile can perform an approved privileged operation through native macOS authorization without revealing credentials.
- computer-use can be invoked through the same plugin while its own kill-switch and credential protections remain intact.
- Node 22/24 CI and the computer-use simulated suites remain green.
- manual macOS acceptance proves Touch ID/native authorization, real filesystem, terminal, Git, and GUI operation.
- the same plugin is validated on ChatGPT Web first and Desktop second.

## 18. Non-Goals

This design intentionally does not provide:

- permanent passwordless root access.
- password/Touch ID/keychain secret extraction into model context.
- one process-global authority flag shared by every ChatGPT conversation.
- unrestricted arbitrary shell as the only execution primitive.
- duplicated computer-use implementation inside TypeScript.
- automatic public multi-user distribution or SaaS tenancy.

The goal is maximum practical local authority with explicit session-scoped delegation, not maximum irreversible blast radius.