# Local Authority Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate User/Admin session authority behind native macOS local authentication while preserving direct Project leases and all existing local enforcement.

**Architecture:** Add an in-memory approval-request manager and a macOS broker adapter. ChatGPT may create a pending User/Admin approval request, but only the native Swift helper can move it to approved; the first approved status call atomically consumes that approval and mints the normal expiring authority lease. Project leases remain direct and independent of the broker.

**Tech Stack:** TypeScript/Node.js 22+, MCP SDK 2.x, Zod, Vitest, Swift 6, Foundation, LocalAuthentication, GitHub Actions macOS runner.

**Spec:** `docs/superpowers/specs/2026-09-07-local-authority-broker-design.md`

## Global Constraints

- `project` direct lease flow remains unchanged.
- direct `user`/`admin` start fails with `LOCAL_APPROVAL_REQUIRED`.
- local approval requests expire after at most 120 seconds.
- one approved request can mint at most one lease.
- no raw request ID is written to the audit log.
- native authentication accepts no model-controlled free-form reason text.
- native helper uses `LAPolicy.deviceOwnerAuthentication`.
- helper execution is `shell=false`, bounded, sanitized, and unavailable off macOS unless a test adapter is injected.
- no root-only command execution is added in this plan.
- existing path confinement, SHA guards, terminal allowlist, audit, TTL and lease revocation remain unchanged.

---

### Task 1: Approval Request Domain

**Files:**
- Create: `src/authority-request-manager.ts`
- Modify: `src/errors.ts`
- Create: `tests/authority-request-manager.test.ts`

**Interfaces:**
- Produces `AuthorityApprovalProfile = "user" | "admin"`.
- Produces `AuthorityRequestState = "pending" | "approved" | "denied" | "cancelled" | "failed" | "expired" | "consumed"`.
- Produces `AuthorityRequestManager.create`, `resolve`, `complete`, `consumeApproved`.

- [ ] **Step 1: Write lifecycle tests first**

Cover random opaque request IDs, 120-second clamp, pending state, approve/deny/cancel/fail, expiry, consume-once, concurrent-request isolation, and immutable returned views.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/authority-request-manager.test.ts`

Expected: module missing.

- [ ] **Step 3: Add stable local-approval errors**

Add subclasses/codes in `src/errors.ts`:

- `LOCAL_APPROVAL_REQUIRED`
- `LOCAL_APPROVAL_UNAVAILABLE`
- `LOCAL_APPROVAL_DENIED`
- `LOCAL_APPROVAL_EXPIRED`
- `LOCAL_APPROVAL_INVALID`

- [ ] **Step 4: Implement request manager minimally**

Use `randomBytes(32).toString("base64url")`, SHA-256-keyed internal map, injected clock, copied views, and deletion/consumption semantics. Store requested profile and effective TTL only; no credentials or prompts.

- [ ] **Step 5: Verify GREEN**

Run focused test then `npm run check`.

- [ ] **Step 6: Commit**

Commit message: `feat: add local authority request lifecycle`.

---

### Task 2: Native Broker Adapter

**Files:**
- Create: `src/local-authority-broker.ts`
- Create: `tests/local-authority-broker.test.ts`

**Interfaces:**

```ts
export interface LocalAuthorityBroker {
  request(input: { requestId: string; profile: "user" | "admin" }): Promise<{
    requestId: string;
    profile: "user" | "admin";
    approved: boolean;
    outcome: "authenticated" | "denied" | "cancelled" | "unavailable" | "failed";
  }>;
}
```

`MacOSLocalAuthorityBroker` accepts an explicit helper path and spawn dependencies for tests.

- [ ] **Step 1: Write failing adapter tests**

Cover exact executable/args, `shell:false`, no stdin, sanitized env, timeout, output limit, malformed JSON, helper non-zero exit, mismatched request ID/profile, and categorical safe result.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/local-authority-broker.test.ts`.

- [ ] **Step 3: Implement broker adapter**

Use `spawn`, fixed args `--profile` and `--request-id`, bounded buffers, no model text, safe JSON parsing/validation, and map non-darwin/missing executable to `LOCAL_APPROVAL_UNAVAILABLE`.

- [ ] **Step 4: Verify GREEN and full suite**

Run focused test and `npm run check`.

- [ ] **Step 5: Commit**

Commit message: `feat: add macOS local authority broker adapter`.

---

### Task 3: Swift LocalAuthentication Helper

**Files:**
- Create: `native/macos-authority-broker/Package.swift`
- Create: `native/macos-authority-broker/Sources/chatgpt-system-authority-broker/main.swift`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**

Executable invocation:

```text
chatgpt-system-authority-broker --profile user|admin --request-id <opaque>
```

Stdout: exactly one JSON object with request ID, profile, approved boolean, categorical outcome.

- [ ] **Step 1: Add macOS CI job before implementation**

Add a `macos-native` job that runs `swift build -c release --package-path native/macos-authority-broker`. It must fail until the package exists.

- [ ] **Step 2: Verify RED in Actions**

Confirm macOS job fails because package is absent.

- [ ] **Step 3: Implement Swift package**

Parse only the two documented arguments. Use fixed localized reasons per profile. Call `LAContext.canEvaluatePolicy(.deviceOwnerAuthentication)` and `evaluatePolicy`. Serialize safe result with `JSONEncoder`. Never print NSError descriptions containing environmental details to stdout; stderr may contain a bounded generic diagnostic for local operator use.

- [ ] **Step 4: Add local build helper script**

Add npm script `build:broker:macos` invoking Swift build. Do not make Linux `npm run check` depend on Swift.

- [ ] **Step 5: Verify macOS CI GREEN**

Require native job plus Node 22/24 jobs to pass.

- [ ] **Step 6: Commit**

Commit message: `feat: add native macOS authority helper`.

---

### Task 4: MCP Approval Flow

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `src/authority.ts`
- Create: `tests/authority-approval-mcp.test.ts`
- Modify: `tests/authority-mcp.test.ts`

**Interfaces:**
- Add `session_authority_request({ profile, requestedTtlSeconds? })`.
- Add `session_authority_request_status({ requestId })`.
- `session_authority_start` keeps `project`, rejects direct `user/admin` with `LOCAL_APPROVAL_REQUIRED`.
- runtime owns one `AuthorityRequestManager` and one broker.

- [ ] **Step 1: Write failing real-MCP tests**

Use injected fake broker. Prove direct User/Admin start fails, request returns pending, broker approval causes status to return one normal lease, a second status is `consumed`, denial/cancellation never mints a lease, and Project flow remains green.

- [ ] **Step 2: Verify RED**

Run focused MCP tests.

- [ ] **Step 3: Add explicit output schemas**

Add request/status schemas with no credential-bearing fields.

- [ ] **Step 4: Wire request manager + broker into runtime**

Default macOS helper path comes from config/CLI or a deterministic repository/build location. Tests inject fake broker. Off-macOS production runtime reports broker unavailable but Project still works.

- [ ] **Step 5: Register MCP tools and direct-start guard**

`session_authority_request` is non-destructive and only creates a pending local approval request. `session_authority_request_status` is read-only from the plugin perspective; it may atomically consume an already-local-approved request and return the lease.

- [ ] **Step 6: Verify full suite**

Run `npm run check`, Node 22/24 CI, and macOS native CI.

- [ ] **Step 7: Commit**

Commit message: `feat: gate user and admin authority behind local approval`.

---

### Task 5: Audit, Setup and Manual Acceptance

**Files:**
- Modify: `src/audit.ts` only if required for safe categorical events.
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Add/modify tests for setup and audit redaction.

- [ ] **Step 1: Add failing audit/setup tests**

Assert raw request IDs and native diagnostics never appear in audit, while request outcome/profile are recorded. Assert ChatGPT setup detects/binds the broker helper on macOS without embedding credentials.

- [ ] **Step 2: Verify RED**

Run focused tests.

- [ ] **Step 3: Implement safe audit/setup wiring**

Document and expose only categorical authority-request lifecycle metadata.

- [ ] **Step 4: Update runbook**

Document Web-first then Desktop acceptance. Explicitly state that LocalAuthentication verifies user presence but does not itself grant root, and that typed root helper work is the next phase.

- [ ] **Step 5: Final automated verification**

Require Node 22, Node 24, macOS Swift build, setup CLI smoke, and all tests green.

- [ ] **Step 6: Manual Mac acceptance**

Build native helper locally, restart tunnel, refresh plugin, request User authority, approve Touch ID, read benign home file, revoke; repeat Admin on benign host-readable path; cancel one request and verify no lease.

- [ ] **Step 7: PR review**

Create a stacked PR against `feat/session-authority-profiles`, review all changed files, then integrate only after manual Mac acceptance.

## Self-Review Results

- Spec coverage: request lifecycle, native broker, Touch ID/password fallback, one-time consumption, MCP flow, audit redaction, macOS CI, manual acceptance all mapped to tasks.
- Root privilege boundary remains explicit and is not falsely implemented by LocalAuthentication alone.
- No placeholder task stands in for production behavior.
- Naming is consistent: `AuthorityRequestManager`, `LocalAuthorityBroker`, `session_authority_request`, `session_authority_request_status`.
