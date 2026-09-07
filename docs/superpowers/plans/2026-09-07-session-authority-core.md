# Session Authority Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-workflow Project/User/Admin authority leases so ChatGPT can explicitly select a bounded local authority profile and use the existing filesystem, Git, and terminal tools under that lease.

**Architecture:** `AuthorityManager` owns opaque expiring leases and returns immutable `AuthorityContext` objects. Existing services remain the enforcement primitives; each privileged MCP call resolves its lease, creates a scoped `PathPolicy` plus filesystem/Git/process services from the lease context, then executes normally. Startup roots remain the no-lease bootstrap scope and are not silently widened; Project/User/Admin widening exists only through an active lease.

**Tech Stack:** TypeScript, Node.js >=22, `@modelcontextprotocol/server` 2.x, Zod, Vitest, Node `crypto`, macOS/Linux filesystem APIs.

**Spec:** `docs/superpowers/specs/2026-09-07-session-authority-and-full-host-access-design.md`

## Global Constraints

- Three profiles: `project`, `user`, `admin`.
- Maximum TTLs: Project 8 hours, User 4 hours, Admin 1 hour.
- Lease IDs are cryptographically random, opaque, never logged, immutable, and invalid after expiry/end/server restart.
- Project roots must be explicit existing directories and must not collapse to `/` or the current home directory.
- User scope is the canonical current-user home directory.
- Admin scope is `/`; Phase 1 still runs processes as the current user. Native privilege elevation is Phase 3.
- `terminal_run` remains `shell=false`; Phase 1 does not add arbitrary shell syntax or passwordless sudo.
- Existing SHA-256 mutation guards, symlink escape protection, output limits, timeouts, sanitized environment, audit behavior, and MCP annotations remain intact.
- Secrets, passwords, Touch ID material, API keys, browser cookies, and Keychain values are never introduced as model-visible outputs.
- ChatGPT Web plugin is the canonical client; Desktop uses the same plugin/backend after web acceptance.

---

## File Structure

**Create**
- `src/authority.ts` — authority profile types, TTL policy, lease issuance/hash lookup/revocation, canonical scope construction.
- `src/scoped-runtime.ts` — construct filesystem/Git/process services for one validated `AuthorityContext` without mutating global runtime state.
- `tests/authority.test.ts` — deterministic unit tests for lease security, TTL, isolation, root validation, revocation.
- `tests/authority-mcp.test.ts` — real MCP handshake/tool-call tests for session tools and privileged lease enforcement.

**Modify**
- `src/errors.ts` — stable authority error classes/codes.
- `src/server.ts` — add authority manager to runtime, register session tools, add `authorityLeaseId` to privileged tool schemas, route calls through scoped services.
- `src/tool-output-schemas.ts` — explicit output schemas for session authority tools and authority information exposed by capabilities.
- `src/config.ts` — export the professional developer command defaults so scoped runtimes reuse one source of truth.
- `tests/process-service.test.ts` — assert lease-derived terminal enablement does not weaken command allowlisting or cwd confinement.
- `tests/http-transport.test.ts` — update descriptor/schema assertions and prove real MCP calls require/accept leases.
- `README.md` — document A/B/C session workflow and current Phase-1 limits.
- `docs/CHATGPT_INTEGRATION.md` — web plugin acceptance sequence: start lease, use lease, end lease; Desktop follows the same plugin.

---

### Task 1: Authority Domain and Lease Manager

**Files:**
- Create: `src/authority.ts`
- Modify: `src/errors.ts`
- Test: `tests/authority.test.ts`

**Interfaces:**
- Produces:
  - `type AuthorityProfile = "project" | "user" | "admin"`
  - `interface AuthorityContext { profile: AuthorityProfile; roots: string[]; terminalEnabled: true; commands: string[]; createdAt: string; expiresAt: string }`
  - `interface StartAuthorityRequest { profile: AuthorityProfile; projectRoots?: string[]; requestedTtlSeconds?: number }`
  - `interface AuthorityLeaseView extends AuthorityContext { leaseId: string }`
  - `class AuthorityManager`
    - `start(request: StartAuthorityRequest): Promise<AuthorityLeaseView>`
    - `resolve(leaseId: string): AuthorityContext`
    - `status(leaseId: string): AuthorityLeaseView`
    - `end(leaseId: string): { ended: true }`
  - `AuthorityRequiredError`, `AuthorityExpiredError`, `AuthorityDeniedError` with codes `AUTHORITY_REQUIRED`, `AUTHORITY_EXPIRED`, `AUTHORITY_DENIED`.
- Consumes: exported `DEFAULT_COMMANDS` from Task 2 may be wired later; initially constructor accepts `commands: string[]` so this task is independently testable.

- [ ] **Step 1: Write failing lease lifecycle tests**

Create `tests/authority.test.ts` with a temporary home/project fixture, an injected clock (`let now = Date.parse("2026-09-07T20:00:00Z")`) and deterministic assertions:

```ts
it("issues an opaque project lease and resolves immutable scope", async () => {
  const manager = new AuthorityManager({ homeDir: home, commands: ["git", "node"], now: () => now });
  const lease = await manager.start({ profile: "project", projectRoots: [project], requestedTtlSeconds: 60 });
  expect(lease.leaseId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(lease.profile).toBe("project");
  expect(lease.roots).toEqual([await realpath(project)]);
  expect(manager.resolve(lease.leaseId)).toMatchObject({ profile: "project", roots: [await realpath(project)] });
});

it("clamps ttl by profile and expires fail-closed", async () => {
  const manager = new AuthorityManager({ homeDir: home, commands: ["git"], now: () => now });
  const lease = await manager.start({ profile: "admin", requestedTtlSeconds: 99_999 });
  expect(Date.parse(lease.expiresAt) - Date.parse(lease.createdAt)).toBe(3_600_000);
  now += 3_600_001;
  expect(() => manager.resolve(lease.leaseId)).toThrowError(AuthorityExpiredError);
});
```

Also cover: missing/blank lease -> required; end revokes; project roots required; project `/` rejected; project canonical home rejected including symlink aliases; user roots exactly canonical home; admin roots exactly `/`; two concurrent leases retain independent scopes; returned arrays cannot mutate stored scope.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/authority.test.ts`

Expected: FAIL because `src/authority.ts` and authority error classes do not exist.

- [ ] **Step 3: Implement authority errors**

In `src/errors.ts`, add subclasses using the existing project error payload pattern:

```ts
export class AuthorityRequiredError extends AppError {
  constructor(message = "An active authority lease is required.", details?: Record<string, unknown>) {
    super("AUTHORITY_REQUIRED", message, details);
  }
}
export class AuthorityExpiredError extends AppError {
  constructor(message = "The authority lease has expired.", details?: Record<string, unknown>) {
    super("AUTHORITY_EXPIRED", message, details);
  }
}
export class AuthorityDeniedError extends AppError {
  constructor(message = "The authority lease does not permit this operation.", details?: Record<string, unknown>) {
    super("AUTHORITY_DENIED", message, details);
  }
}
```

Use the exact constructor shape already used by `PolicyError`/`LimitError`; adapt only the base-class name/signature if `errors.ts` differs.

- [ ] **Step 4: Implement `AuthorityManager` minimally and securely**

In `src/authority.ts`:

```ts
const PROFILE_MAX_TTL_SECONDS = { project: 8 * 60 * 60, user: 4 * 60 * 60, admin: 60 * 60 } as const;

function digestLease(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function newLeaseId(): string {
  return randomBytes(32).toString("base64url");
}
```

Store leases keyed by `digestLease(leaseId)`, not by raw IDs. Canonicalize project roots with `realpath(path.resolve(root))`, require `stat(...).isDirectory()`, deduplicate, reject canonical `/` and canonical `homeDir`, freeze/copy arrays on storage and return. `resolve()` deletes and throws `AuthorityExpiredError` after expiry. `status()` returns the caller-provided raw ID plus a cloned view; raw IDs never enter internal audit metadata.

- [ ] **Step 5: Run authority tests GREEN**

Run: `npx vitest run tests/authority.test.ts`

Expected: all authority lifecycle/security tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/authority.ts src/errors.ts tests/authority.test.ts
git commit -m "feat: add session authority leases"
```

---

### Task 2: Scoped Runtime Construction

**Files:**
- Create: `src/scoped-runtime.ts`
- Modify: `src/config.ts`
- Modify: `tests/process-service.test.ts`
- Test: `tests/authority.test.ts`

**Interfaces:**
- Consumes: `AuthorityContext` from Task 1, existing `AuditLogger`, service classes, limits/http config.
- Produces:
  - exported `DEFAULT_COMMANDS: readonly string[]` from `src/config.ts`.
  - `interface ScopedRuntime { policy: PathPolicy; fs: FileSystemService; git: GitService; process: ProcessService }`
  - `createScopedRuntime(runtime: RuntimeServicesBase, authority: AuthorityContext): ScopedRuntime` where `RuntimeServicesBase` contains `config` and `audit` only; avoid importing `RuntimeServices` from `server.ts` to prevent a cycle.

- [ ] **Step 1: Add failing isolation tests**

Extend `tests/authority.test.ts` or add focused cases proving a project lease scoped to `projectA` cannot resolve `projectB`, while a user lease can resolve a path under `home`, and admin can resolve a temp path outside home. Use `createScopedRuntime` and call `scoped.fs.read(...)`/`scoped.policy.resolve(...)` rather than testing internal arrays only.

- [ ] **Step 2: Run focused tests RED**

Run: `npx vitest run tests/authority.test.ts tests/process-service.test.ts`

Expected: FAIL because `createScopedRuntime` is missing and command defaults are not exported.

- [ ] **Step 3: Export one command-default source**

Change `const DEFAULT_COMMANDS` in `src/config.ts` to:

```ts
export const DEFAULT_COMMANDS = [
  "git", "node", "npm", "npx", "pnpm", "bun", "deno", "python3", "go", "cargo", "swift", "swiftc", "xcodebuild", "make", "cmake",
] as const;
```

Do not expand the list in Phase 1; Phase 2 owns the professional command-profile expansion (`pytest`, `uv`, `pip`, `rustc`, `ninja`) after executable-resolution hardening.

- [ ] **Step 4: Implement scoped services without global mutation**

Create `src/scoped-runtime.ts`:

```ts
export function createScopedRuntime(base: { config: AppConfig; audit: AuditLogger }, authority: AuthorityContext): ScopedRuntime {
  const policy = new PathPolicy([...authority.roots]);
  const config: AppConfig = {
    ...base.config,
    roots: [...authority.roots],
    terminal: { enabled: true, commands: [...authority.commands] },
  };
  return {
    policy,
    fs: new FileSystemService(policy, base.audit, config.limits),
    git: new GitService(policy, base.audit, config),
    process: new ProcessService(policy, base.audit, config),
  };
}
```

No scoped object mutates `base.config`, `base.policy`, or another lease's arrays.

- [ ] **Step 5: Prove terminal policy is still enforced**

Add to `tests/process-service.test.ts` a lease/scoped-runtime case that enables terminal but still rejects a command absent from `authority.commands`, and rejects a cwd outside authority roots. Keep existing `shell=false`/timeout/output tests unchanged.

- [ ] **Step 6: Run focused tests GREEN**

Run: `npx vitest run tests/authority.test.ts tests/process-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/scoped-runtime.ts tests/authority.test.ts tests/process-service.test.ts
git commit -m "feat: scope runtime services to authority leases"
```

---

### Task 3: Session Authority MCP Tools and Schemas

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Create: `tests/authority-mcp.test.ts`

**Interfaces:**
- Consumes: `AuthorityManager` Task 1.
- Produces MCP tools:
  - `session_authority_start({ profile, projectRoots?, requestedTtlSeconds? })`
  - `session_authority_status({ authorityLeaseId })`
  - `session_authority_end({ authorityLeaseId })`
- Runtime gains `authority: AuthorityManager`.

- [ ] **Step 1: Write failing MCP discovery/start/status/end tests**

Use the existing MCP client/transport pattern from `tests/http-transport.test.ts` in `tests/authority-mcp.test.ts`. Assert `tools/list` contains the three session tools with all four safety annotations and explicit `outputSchema`.

Call `session_authority_start` with a disposable project and assert structured output contains:

```ts
{
  leaseId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
  profile: "project",
  roots: [await realpath(project)],
  terminalEnabled: true,
  expiresAt: expect.any(String),
}
```

Then call status with the lease; call end; status again must return `isError: true` with code `AUTHORITY_REQUIRED` or the project-standard revoked code chosen in Task 1.

- [ ] **Step 2: Run MCP test RED**

Run: `npx vitest run tests/authority-mcp.test.ts`

Expected: FAIL because session tools are absent.

- [ ] **Step 3: Add explicit output schemas**

In `src/tool-output-schemas.ts`, define schemas with exact fields:

```ts
export const authorityLeaseOutputSchema = z.object({
  leaseId: z.string(),
  profile: z.enum(["project", "user", "admin"]),
  roots: z.array(z.string()),
  terminalEnabled: z.literal(true),
  commands: z.array(z.string()),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const authorityEndOutputSchema = z.object({ ended: z.literal(true) });
```

- [ ] **Step 4: Wire `AuthorityManager` into runtime**

In `createRuntimeServices(config)`, construct one manager using canonical `homedir()` and the configured/default developer command list. Add `authority` to `RuntimeServices`. The manager is process-local, so restart revokes all leases by construction.

- [ ] **Step 5: Register session tools**

Add `session_authority_start` as a non-destructive write (`readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:false`, `openWorldHint:false`), `status` as read-only, and `end` as destructive/idempotent. Tool descriptions must state that the returned `leaseId` is the authority handle for subsequent privileged calls and must not be exposed outside the current workflow.

- [ ] **Step 6: Run MCP tests GREEN**

Run: `npx vitest run tests/authority-mcp.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/tool-output-schemas.ts tests/authority-mcp.test.ts
git commit -m "feat: expose session authority tools"
```

---

### Task 4: Enforce Leases on Filesystem, Git, and Terminal Tools

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/authority-mcp.test.ts`
- Modify: `tests/http-transport.test.ts`

**Interfaces:**
- Every filesystem/Git/terminal input schema gains required `authorityLeaseId: string`.
- `system_capabilities` remains lease-free bootstrap information.
- Each privileged handler executes:
  1. `const authority = runtime.authority.resolve(authorityLeaseId)`
  2. `const scoped = createScopedRuntime(runtime, authority)`
  3. invoke the existing service on `scoped`.

- [ ] **Step 1: Write failing no-lease/cross-scope tests**

In `tests/authority-mcp.test.ts` assert:

- `fs_read` without `authorityLeaseId` fails schema validation before service execution.
- project lease reads `fixture.txt` inside its project.
- same lease cannot read a sibling project or the user's home.
- user lease can read a disposable file under the test home fixture.
- admin lease can read a disposable path outside that home (within OS permissions).
- ended/expired lease returns authority error and performs no mutation.
- `terminal_run` with a project lease can run an allowlisted harmless executable in-project and cannot run a non-allowlisted command.

For mutation coverage, read a file to obtain SHA, call `fs_write` with lease + `expectedSha256`, verify content, end lease, and prove a second write with the old lease is rejected.

- [ ] **Step 2: Run focused tests RED**

Run: `npx vitest run tests/authority-mcp.test.ts tests/http-transport.test.ts`

Expected: FAIL because existing tool schemas do not require leases and handlers use global services.

- [ ] **Step 3: Add a shared lease field schema**

In `src/server.ts` define once:

```ts
const authorityLeaseField = { authorityLeaseId: z.string().min(40) };
```

Spread it into `fs_list`, `fs_stat`, `fs_read`, `fs_write`, `fs_apply_patch`, `fs_mkdir`, `fs_move`, `fs_remove`, `git_status`, `git_diff`, `git_log`, and `terminal_run` input objects. Do not add it to `system_capabilities` or the session-authority start tool.

- [ ] **Step 4: Route privileged calls through scoped runtime**

Add a helper:

```ts
function withAuthority(runtime: RuntimeServices, leaseId: string) {
  const authority = runtime.authority.resolve(leaseId);
  return createScopedRuntime(runtime, authority);
}
```

Use only the returned `scoped.fs`, `scoped.git`, `scoped.process` in privileged handlers. Never mutate `runtime.config.roots` or `runtime.policy.roots`.

- [ ] **Step 5: Update existing transport expectations**

In `tests/http-transport.test.ts`, start a project lease before calling filesystem tools, pass the returned ID, and continue asserting structured outputs and schema/annotation completeness. Descriptor tests should assert the `authorityLeaseId` field exists on all privileged schemas.

- [ ] **Step 6: Run the complete local suite GREEN**

Run: `npm run check`

Expected: build succeeds and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts tests/authority-mcp.test.ts tests/http-transport.test.ts
git commit -m "feat: enforce authority leases on local tools"
```

---

### Task 5: Audit, Documentation, and Phase-1 Acceptance

**Files:**
- Modify: `src/audit.ts` only if needed to add an explicit safe authority-event helper; do not log raw lease IDs.
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `tests/authority.test.ts`
- Modify: `tests/authority-mcp.test.ts`

**Interfaces:**
- Authority audit metadata contains profile, scope digest/count, event type, expiry/end result; never raw lease/token/secret material.
- User-facing workflow is `session_authority_start -> privileged calls with authorityLeaseId -> session_authority_end`.

- [ ] **Step 1: Add failing audit redaction test**

Use a temporary audit file, start/end a lease, perform one privileged action, read the JSONL, and assert the raw `leaseId` string is absent while `authority.start`/`authority.end` (or the exact chosen event names) plus profile are present.

- [ ] **Step 2: Run audit test RED if authority events are not yet recorded**

Run: `npx vitest run tests/authority.test.ts -t "audit"`

Expected: FAIL because lease lifecycle metadata is not yet emitted.

- [ ] **Step 3: Add safe authority lifecycle auditing**

Pass an optional audit callback/logger into `AuthorityManager`; emit only:

```ts
{ event: "authority.start", profile, rootCount, scopeDigest, expiresAt }
{ event: "authority.end", profile, rootCount, scopeDigest }
{ event: "authority.expired", profile, rootCount, scopeDigest }
```

Compute `scopeDigest` from canonical roots with SHA-256. Never include raw lease IDs.

- [ ] **Step 4: Document the exact ChatGPT Web workflow**

Update README and `docs/CHATGPT_INTEGRATION.md` with:

```text
1. Keep tunnel-client running.
2. In a new ChatGPT Work/Chat workflow call session_authority_start once.
3. Choose project/user/admin; project includes explicit roots.
4. Reuse returned authorityLeaseId on every filesystem/Git/terminal call.
5. End explicitly when finished; expiry/restart also revoke.
```

Document current limits honestly: admin is host-wide path/process scope but not root elevation until Phase 3; no `shell_run` until Phase 2; no computer-use bridge until Phase 4; Desktop uses the same installed plugin after web validation.

- [ ] **Step 5: Run full verification on supported Node versions**

Run locally: `npm run check`.

Push branch and require CI jobs for Node 22 and Node 24 to pass. The CI already executes build/test plus Codex and ChatGPT setup CLI smoke checks; do not weaken those jobs.

- [ ] **Step 6: Manual disposable acceptance on the Mac**

With the tunnel running and plugin refreshed:

1. Start Project lease for `/tmp/chatgpt-system-acceptance`.
2. `fs_read` fixture, capture SHA.
3. `fs_write` guarded change.
4. `terminal_run` `git status --short` in the fixture.
5. End lease.
6. Retry read/write with old lease and verify rejection.
7. Start User lease and verify a benign disposable file under the user's home.
8. Start Admin lease and verify access to a benign readable path outside home; do not attempt native elevation in Phase 1.
9. Confirm a second ChatGPT workflow without a lease cannot invoke privileged tools successfully.

- [ ] **Step 7: Commit**

```bash
git add src/audit.ts README.md docs/CHATGPT_INTEGRATION.md tests/authority.test.ts tests/authority-mcp.test.ts
git commit -m "docs: complete session authority phase one"
```

---

## Self-Review Results

- **Spec coverage:** Phase 1 covers the spec's lease manager, A/B/C profiles, explicit lease propagation, local scope enforcement, existing filesystem/Git/process integration, audit requirements, TTLs, restart revocation, and web-first acceptance. Developer Executor, arbitrary shell mode, native Touch ID privilege broker, computer-use bridge, and launchd persistence are intentionally separate later plans matching spec Phases 2-5.
- **Placeholder scan:** No TBD/TODO/"implement later" instruction is used as an implementation substitute; later phases are named boundaries, not missing Phase-1 steps.
- **Type consistency:** `authorityLeaseId`, `AuthorityContext`, `AuthorityLeaseView`, `AuthorityManager`, and `createScopedRuntime` use one spelling/signature throughout.
