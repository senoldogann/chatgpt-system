# Owner Workstation + Verified Project Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the private-Mac daily-driver mode explicit and unattended-ready, and make typed Git publication fail closed unless the exact resumed project has fresh local verification for the exact state being pushed.

**Architecture:** Compose existing Personal Admin, Owner Runtime, Project Exec, Computer Runtime, Project Continuity, Project Check, and Git services instead of replacing them. Add an opt-in `owner-workstation` preset, a bounded in-memory `ContinuityResumeRegistry`, and a `ProjectPublishGate` that combines an Admin remote-write lease with the exact Project lease minted by `project_resume`. Reuse `ProjectCheckService` evidence and the existing Git remote policy; do not create duplicate memory or verification stores.

**Tech Stack:** Node.js >=22, TypeScript 6, MCP SDK v2, Zod 4, Vitest 5, Swift 6/macOS Security framework, Docker-backed Project Exec, existing macOS Computer Runtime.

**Spec:** `docs/superpowers/specs/2026-09-13-owner-workstation-verified-project-session-design.md`

## Global Constraints

- `/Users/dogan/Desktop/chatgpt-system` is the authoritative checkout.
- Use exact Project Continuity alias `chatgpt-system-desktop`; reconcile Git/worktree reality before edits.
- Implementation, focused tests, builds, native acceptance, and full verification are local-first on a non-`main` branch/worktree.
- `owner-workstation` is explicit opt-in; secure defaults remain off/narrow.
- `owner-workstation` enables Personal Admin, Owner Runtime, terminal, local Docker Project Exec, Computer Use, and full-host JavaScript. Browser Runtime remains independently configured and is not enabled by the preset.
- Owner Runtime remains current-user host authority, not root and not an OS sandbox. Never add sudo-password handling, TCC DB modification, SIP/FileVault/login bypass, or Keychain authentication bypass.
- `ProjectCheckService` remains the sole freshness-bound verification store; evidence stays bound to exact `HEAD` + `workingTreeDigest`.
- Project Continuity remains the sole semantic project-handoff store.
- Existing Git remote safety remains: credential-free GitHub origin only, current validated branch, no force, no caller-controlled remote/refspec.
- Typed `git_push` requires two leases: `authorityLeaseId` = active Admin lease; `projectAuthorityLeaseId` = active Project lease produced by `project_resume` for the exact project.
- Push from `main`, dirty state, missing/failed/unavailable/stale verification, wrong project, generic Project lease, or expired/revoked authority must fail closed.
- Credentials, authority lease IDs, file contents, screenshots, OCR/AX content, and typed sensitive text must never enter audit records or persisted continuity/check state.
- Preserve `origin/feat/computer-use-bridge` until its three unmerged documentation commits are explicitly classified, merged, or otherwise preserved.
- Do not push or open a PR until all final local gates in Task 7 pass.

## Execution preflight

At execution time, first invoke `superpowers:using-git-worktrees`. Create an isolated implementation worktree/branch named `feat/owner-workstation-verified-project-session` from the commit containing this plan. Then run:

```bash
npm ci
npm run check
npm run test:computer:macos
```

Expected: all baseline checks PASS before implementation. If the baseline is RED, stop implementation and diagnose the baseline rather than attributing it to this plan.

---

### Task 1: Add the explicit Owner Workstation preset

**Files:**
- Modify: `src/cli-command.ts:33-158`
- Modify: `src/config.ts:72-123,240-393`
- Modify: `scripts/setup-chatgpt-tunnel.mjs:20-330,417-445`
- Modify: `tests/cli-command.test.ts`
- Modify: `tests/owner-runtime-config.test.ts`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`

**Interfaces:**
- Produces `ConfigOverrides.ownerWorkstationEnabled?: boolean`.
- `--owner-workstation` expands to `personalAdminEnabled`, `ownerRuntimeEnabled`, `terminalEnabled`, `projectExecEnabled`, `computerUseEnabled`, and `fullHostJsEnabled` = `true`.
- Browser flags remain untouched.
- `buildTunnelSetup()` exposes `ownerWorkstationEnabled: boolean` and emits the single `--owner-workstation` server flag rather than six independent preset-generated flags.

- [ ] **Step 1: Write RED CLI/config tests for the preset**

Add tests equivalent to:

```ts
it("expands owner-workstation without enabling browser", () => {
  const parsed = parseCliCommand(["stdio", "--owner-workstation"]);
  expect(parsed).toMatchObject({
    kind: "server",
    overrides: {
      ownerWorkstationEnabled: true,
      personalAdminEnabled: true,
      ownerRuntimeEnabled: true,
      terminalEnabled: true,
      projectExecEnabled: true,
      computerUseEnabled: true,
      fullHostJsEnabled: true,
    },
  });
  expect(parsed.kind === "server" && parsed.overrides.browserEnabled).toBeUndefined();
});
```

and:

```ts
const config = await loadConfig({ roots: [root], ownerWorkstationEnabled: true });
expect(config.personalAdmin.enabled).toBe(true);
expect(config.ownerRuntime.enabled).toBe(true);
expect(config.terminal.enabled).toBe(true);
expect(config.projectExec.enabled).toBe(true);
expect(config.computerUse.enabled).toBe(true);
expect(config.computerUse.fullHostJsEnabled).toBe(true);
expect(config.browser.enabled).toBe(false);
```

Also load the default config and assert `personalAdmin.enabled`, `ownerRuntime.enabled`, `terminal.enabled`, `projectExec.enabled`, `computerUse.enabled`, and `computerUse.fullHostJsEnabled` all remain `false`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npx vitest run tests/cli-command.test.ts tests/owner-runtime-config.test.ts tests/setup-chatgpt-tunnel.test.ts
```

Expected: FAIL because `--owner-workstation`, the override, and setup output do not yet exist.

- [ ] **Step 3: Implement preset expansion in `src/cli-command.ts` and `src/config.ts`**

Add the override/property and use one helper so CLI and config cannot drift:

```ts
export function applyOwnerWorkstationPreset(overrides: ConfigOverrides): void {
  overrides.ownerWorkstationEnabled = true;
  overrides.personalAdminEnabled = true;
  overrides.ownerRuntimeEnabled = true;
  overrides.terminalEnabled = true;
  overrides.projectExecEnabled = true;
  overrides.computerUseEnabled = true;
  overrides.fullHostJsEnabled = true;
}
```

`parseCliCommand()` calls it for `--owner-workstation`. `loadConfig()` applies the same semantics when `ownerWorkstationEnabled === true`, then runs the existing dependency validations. Do not set browser fields.

- [ ] **Step 4: Implement tunnel setup preset support**

In `scripts/setup-chatgpt-tunnel.mjs`, parse `--owner-workstation`, set the same six booleans, emit `--owner-workstation` in `mcpCommand`, and return `ownerWorkstationEnabled`. Update help/output to print:

```text
Owner Workstation: ENABLED
Trust model: full current-user workstation access
Root escalation: not granted
Browser: disabled
```

when no browser flag is supplied.

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
npx vitest run tests/cli-command.test.ts tests/owner-runtime-config.test.ts tests/setup-chatgpt-tunnel.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/cli-command.ts src/config.ts scripts/setup-chatgpt-tunnel.mjs tests/cli-command.test.ts tests/owner-runtime-config.test.ts tests/setup-chatgpt-tunnel.test.ts
git commit -m "feat: add owner workstation preset"
```

---

### Task 2: Make the app-owned Keychain credential non-interactive at runtime

**Files:**
- Modify: `native/macos-authority-broker/Sources/chatgpt-system-keychain-helper/main.swift`
- Modify: `scripts/setup-daily-driver.mjs:1-338`
- Modify: `scripts/daily-driver-runner.mjs:1-160`
- Modify: `tests/setup-daily-driver.test.ts`
- Modify: `tests/daily-driver-runner.test.ts`
- Create: `tests/keychain-helper-native.test.ts`

**Interfaces:**
- Native helper supports `store <account> <service>`, `read <account> <service>`, and `delete <account> <service>`.
- `read` uses `kSecUseAuthenticationUI: kSecUseAuthenticationUIFail`; runtime never triggers an interactive Keychain prompt.
- `read` writes only credential bytes to stdout; errors go to stderr without secret material.
- Daily-driver runner requires `--keychain-helper <absolute-path>` and reads through that helper.
- Installation places the built helper at `~/.chatgpt-system/bin/chatgpt-system-keychain-helper` with executable owner-only permissions and passes that stable path to the LaunchAgent.

- [ ] **Step 1: Write RED runner/setup tests**

Add runner coverage equivalent to:

```ts
const parsed = parseRunnerArgs([
  "--tunnel-client", "/opt/homebrew/bin/tunnel-client",
  "--profile", "chatgpt-system",
  "--log-dir", "/Users/test/.chatgpt-system/daily-driver",
  "--keychain-helper", "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
]);
expect(parsed.keychainHelperPath).toBe("/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper");
```

and:

```ts
const value = readControlPlaneKey({
  helperPath: "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
  spawnSync: fakeSpawnReturning("secret-value\n"),
});
expect(value).toBe("secret-value");
expect(seen.command).not.toBe("/usr/bin/security");
expect(seen.args).toEqual(["read", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE]);
```

Add setup tests proving the LaunchAgent includes `--keychain-helper` and no credential value.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx vitest run tests/daily-driver-runner.test.ts tests/setup-daily-driver.test.ts
```

Expected: FAIL because the helper path/read command are not implemented.

- [ ] **Step 3: Extend the Swift helper with bounded command handling**

Implement command dispatch with non-empty bounded account/service strings (1-256 UTF-8 bytes). For read, use:

```swift
let readQuery: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrAccount: account,
    kSecAttrService: service,
    kSecReturnData: true,
    kSecMatchLimit: kSecMatchLimitOne,
    kSecUseAuthenticationUI: kSecUseAuthenticationUIFail,
]
```

Call `SecItemCopyMatching`, require `Data`, write that data directly to stdout, and never print it in an error. `delete` calls `SecItemDelete(query)` and treats `errSecItemNotFound` as success for idempotent uninstall.

- [ ] **Step 4: Install and wire a stable helper path**

In `setup-daily-driver.mjs`:

- always build the helper before deciding store/reuse;
- atomically copy it to `~/.chatgpt-system/bin/chatgpt-system-keychain-helper`;
- set directory mode 0700 and helper mode 0700;
- probe existing credential via helper `read`, not `/usr/bin/security`;
- use helper `store` when `CONTROL_PLANE_API_KEY` is present;
- use helper `delete` during uninstall;
- include the installed helper path in LaunchAgent arguments.

In `daily-driver-runner.mjs`, make `readControlPlaneKey({ helperPath })` execute only the supplied normalized absolute helper path with `read` and fixed account/service constants.

- [ ] **Step 5: Add a macOS-native integration test**

`tests/keychain-helper-native.test.ts` should build the helper on macOS, generate a unique test account/service, store a known non-production fixture secret via stdin, read it back, assert exact bytes, then delete it in `finally`. Skip only on non-macOS hosts.

The test must never use `KEYCHAIN_SERVICE`/`KEYCHAIN_ACCOUNT` production identifiers.

- [ ] **Step 6: Run focused JS + native tests**

```bash
npx vitest run tests/daily-driver-runner.test.ts tests/setup-daily-driver.test.ts tests/keychain-helper-native.test.ts
npm run build:broker:macos
```

Expected: PASS; runtime credential reads no longer use `/usr/bin/security`.

- [ ] **Step 7: Commit Task 2**

```bash
git add native/macos-authority-broker/Sources/chatgpt-system-keychain-helper/main.swift scripts/setup-daily-driver.mjs scripts/daily-driver-runner.mjs tests/setup-daily-driver.test.ts tests/daily-driver-runner.test.ts tests/keychain-helper-native.test.ts
git commit -m "feat: harden unattended keychain access"
```

---

### Task 3: Add deterministic Owner Workstation unattended-readiness status

**Files:**
- Create: `scripts/owner-workstation-status.mjs`
- Modify: `package.json`
- Modify: `scripts/setup-macos-computer-runtime.mjs:231-240`
- Create: `tests/owner-workstation-status.test.ts`

**Interfaces:**
- Export `buildOwnerWorkstationStatus(input)` as a pure formatter/decision function.
- CLI command: `npm run owner-workstation:status` runs build first, then status script.
- Output JSON shape:

```ts
interface OwnerWorkstationStatus {
  ready: boolean;
  computerRuntime: {
    available: boolean;
    tccIdentityStable: boolean;
    bundleIdentifierVerified: boolean;
    signatureVerified: boolean;
  };
  permissions: {
    accessibilityTrusted: boolean;
    screenCaptureAuthorized: boolean;
    eventListenAuthorized: boolean;
    eventPostAuthorized: boolean;
  };
  credential: { readableNonInteractively: boolean };
}
```

- `ready` is true only when every field above is true.
- No credential value, signing requirement text, raw Keychain error, or sensitive content is printed.

- [ ] **Step 1: Write RED deterministic status tests**

Test at least one fully ready case and one failure per category:

```ts
expect(buildOwnerWorkstationStatus({
  runtime: { available: true, tccIdentityStable: true, bundleIdentifierVerified: true, signatureVerified: true },
  health: { accessibilityTrusted: true, screenCaptureAuthorized: true, eventListenAuthorized: true, eventPostAuthorized: true },
  credentialReadable: true,
}).ready).toBe(true);
```

and assert `ready === false` when any individual readiness boolean is false.

- [ ] **Step 2: Run focused test and confirm RED**

```bash
npx vitest run tests/owner-workstation-status.test.ts
```

Expected: FAIL because the script/module does not exist.

- [ ] **Step 3: Implement readiness collection without permission prompts**

The script must:

1. call `inspectInstalledComputerRuntime()` for fixed bundle/signature/stable identity;
2. dynamically import the built `ComputerNativeSupervisor` and call only native `health` to obtain passive TCC booleans;
3. call the installed Keychain helper with `read` and discard stdout immediately after establishing success;
4. close the native supervisor in `finally`;
5. print only the structured JSON status.

Do not invoke `tccutil`, permission request APIs, or any UI automation from this status command.

- [ ] **Step 4: Add package command and run focused verification**

Add:

```json
"owner-workstation:status": "npm run build && node scripts/owner-workstation-status.mjs"
```

Run:

```bash
npx vitest run tests/owner-workstation-status.test.ts tests/setup-macos-computer-runtime.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/owner-workstation-status.mjs package.json tests/owner-workstation-status.test.ts scripts/setup-macos-computer-runtime.mjs
git commit -m "feat: report owner workstation readiness"
```

---

### Task 4: Add bounded in-memory resume-context evidence

**Files:**
- Create: `src/continuity-resume-registry.ts`
- Modify: `src/project-continuity-service.ts:76-230`
- Modify: `src/project-continuity-runtime.ts:18-57`
- Modify: `tests/project-continuity-service.test.ts`
- Modify: `tests/project-continuity-runtime.test.ts`
- Create: `tests/continuity-resume-registry.test.ts`

**Interfaces:**

```ts
export interface ContinuityResumeContext {
  projectId: string;
  alias: string;
  recordVersion: number;
  canonicalWorktree: string;
  repositoryRoot: string;
  repositoryIdentity: string;
  expiresAt: string;
}

export class ContinuityResumeRegistry {
  register(leaseId: string, context: ContinuityResumeContext): void;
  require(leaseId: string): ContinuityResumeContext;
}
```

- Registry keys are `sha256(leaseId)`, never raw lease IDs.
- Registry is in-memory only with a hard maximum of 256 records; insertion beyond the cap evicts oldest records.
- `ProjectContinuityService.resume()` registers only after worktree revalidation, lease creation, resume-package construction, and operational-state update have succeeded.
- Generic `session_authority_start({profile:"project"})` never registers a resume context.

- [ ] **Step 1: Write RED registry unit tests**

Cover register/require, missing context => `PROJECT_RESUME_REQUIRED`, 256-record bound, and raw lease string absence from serialized/debuggable context values. Start with:

```ts
const registry = new ContinuityResumeRegistry();
registry.register("lease-secret-value", context);
expect(registry.require("lease-secret-value")).toEqual(context);
expect(() => registry.require("another-lease")).toThrowError(
  expect.objectContaining({ code: "PROJECT_RESUME_REQUIRED" }),
);
expect(JSON.stringify(registry)).not.toContain("lease-secret-value");
```

- [ ] **Step 2: Write RED continuity-service test**

Inject a fake registry and assert successful `resume()` records exactly the returned Project lease and exact registered worktree metadata. Assert a failed resume/package rollback does not register. Use a spy shaped as:

```ts
const registrations: Array<[string, ContinuityResumeContext]> = [];
const resumeRegistry = {
  register: (leaseId: string, context: ContinuityResumeContext) => registrations.push([leaseId, context]),
  require: () => { throw new Error("not used"); },
} as ContinuityResumeRegistry;
```

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
npx vitest run tests/continuity-resume-registry.test.ts tests/project-continuity-service.test.ts tests/project-continuity-runtime.test.ts
```

Expected: FAIL because registry integration is absent.

- [ ] **Step 4: Add `ProjectResumeRequiredError` and implement the registry**

Add to `src/errors.ts`:

```ts
export class ProjectResumeRequiredError extends AppError {
  constructor(message = "An active project_resume context is required for publication.") {
    super(message, "PROJECT_RESUME_REQUIRED", { retryable: true });
  }
}
```

Implement SHA-256 keyed bounded storage. `require()` returns a copy of metadata, not internal mutable state.

- [ ] **Step 5: Wire registry through continuity runtime/service**

`ProjectContinuityRuntime` exposes `continuityResumeRegistry`. `createProjectContinuityRuntime()` creates one registry and passes it into `ProjectContinuityService`. Preserve dependency injection for tests.

After successful resume packaging/state update:

```ts
this.resumeRegistry.register(authorityLease.leaseId, {
  projectId: project.id,
  alias: project.alias,
  recordVersion: project.currentRecord.recordVersion,
  canonicalWorktree: project.worktree.canonicalPath,
  repositoryRoot: project.worktree.repositoryRoot,
  repositoryIdentity: project.worktree.repositoryIdentity,
  expiresAt: authorityLease.expiresAt,
});
```

Authority expiry/revocation remains enforced by `AuthorityManager.resolve()` at publication time; a stale registry entry alone never grants authority.

- [ ] **Step 6: Run focused tests and build**

```bash
npx vitest run tests/continuity-resume-registry.test.ts tests/project-continuity-service.test.ts tests/project-continuity-runtime.test.ts tests/project-continuity-integration.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/continuity-resume-registry.ts src/project-continuity-service.ts src/project-continuity-runtime.ts src/errors.ts tests/continuity-resume-registry.test.ts tests/project-continuity-service.test.ts tests/project-continuity-runtime.test.ts
git commit -m "feat: track resumed project contexts"
```

---

### Task 5: Implement the freshness-bound Project Publish Gate

**Files:**
- Create: `src/project-check-factory.ts`
- Modify: `src/project-check-tool-registration.ts:1-120`
- Create: `src/project-publish-gate.ts`
- Modify: `src/git-service.ts:109-360`
- Modify: `src/errors.ts`
- Create: `tests/project-publish-gate.test.ts`
- Modify: `tests/git-service.test.ts`
- Modify: `tests/project-check-mcp.test.ts`

**Interfaces:**

```ts
export interface ProjectCheckRuntimeDependencies {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  projectExecBackend: ProjectExecBackend;
  taskStateRoot: string;
}

export function createProjectCheckService(
  runtime: ProjectCheckRuntimeDependencies,
  authorityLeaseId: string,
): ProjectCheckService;

export interface ProjectPublishGateInput {
  cwd: string;
  resumeContext: ContinuityResumeContext;
}

export interface GitResult {
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ProjectPublishGate {
  constructor(options: {
    projectGit: GitService;
    adminGit: GitService;
    projectCheck: ProjectCheckService;
  });
  push(input: ProjectPublishGateInput): Promise<GitResult>;
}
```

`GitService.push()` becomes an internal verified push API:

```ts
push(cwd?: string, expected?: { branch: string; head: string }): Promise<GitResult>
```

When `expected` is provided, it must re-read the current branch and `HEAD`, require exact equality, and push the verified commit SHA to `refs/heads/<branch>`. Callers still cannot choose arbitrary remotes/refspecs.

- [ ] **Step 1: Extract the existing Project Check factory with no behavior change**

Move `projectCheckFor()` from `project-check-tool-registration.ts` into `project-check-factory.ts`; update the MCP registration to import it.

Run:

```bash
npx vitest run tests/project-check-mcp.test.ts
```

Expected: PASS before introducing the gate.

- [ ] **Step 2: Write RED publish-gate tests**

Use fakes for `GitService` and `ProjectCheckService` to cover all required denial states. A successful fixture must assert the exact verified head is passed to Admin Git:

```ts
const result = await gate.push({ cwd: ".", resumeContext });
expect(adminPush).toHaveBeenCalledWith(".", { branch: "feature/x", head: VERIFIED_HEAD });
expect(result.exitCode).toBe(0);
```

Test parsing of `git status --porcelain=v1 --branch`:

```text
## feature/x
```

is clean, while any second line such as ` M src/x.ts`, `M  src/x.ts`, or `?? tmp.txt` is dirty.

Required errors:

```ts
PROJECT_RESUME_REQUIRED
LOCAL_VERIFICATION_REQUIRED
LOCAL_VERIFICATION_STALE
WORKTREE_NOT_CLEAN
MAIN_PUSH_DENIED
```

Map `NOT_RUN`, `FAIL`, and `UNAVAILABLE` to `LOCAL_VERIFICATION_REQUIRED`; map `STALE` to `LOCAL_VERIFICATION_STALE`.

- [ ] **Step 3: Add explicit publication errors**

Implement `LocalVerificationRequiredError`, `LocalVerificationStaleError`, `WorktreeNotCleanError`, and `MainPushDeniedError` in `src/errors.ts`, each with the exact code above and bounded non-sensitive details only.

- [ ] **Step 4: Implement `ProjectPublishGate.push()`**

The exact order is:

1. `projectGit.status(cwd)`; require exit 0, named branch, branch !== `main`, and no status lines after header.
2. `projectCheck.report(cwd)`.
3. Require `report.repositoryRoot === resumeContext.repositoryRoot` and the exact registered canonical worktree/repository identity semantics supplied by the resume context.
4. Require `report.overallStatus === "PASS"`.
5. Capture `report.observed.head` as the verified commit.
6. Re-read `projectGit.status(cwd)` immediately before publication and require the same clean branch.
7. Call `adminGit.push(cwd, { branch, head: report.observed.head })`.

This preserves the existing ProjectCheck digest freshness rule. Do not persist a second PASS marker.

- [ ] **Step 5: Harden GitService to push the exact verified commit**

Before remote push, when expected state is present:

```ts
const head = await this.run(cwd, ["rev-parse", "HEAD"], "git.read", { operation: "head_lookup" });
if (head.stdout.trim() !== expected.head) throw new LocalVerificationStaleError();
if (branch !== expected.branch) throw new LocalVerificationStaleError();
```

Then use the internally constructed refspec:

```ts
["push", "--porcelain", "origin", `${expected.head}:refs/heads/${branch}`]
```

The branch name and expected SHA come only from trusted gate observations, never caller input at the MCP schema.

- [ ] **Step 6: Run focused gate/Git tests**

```bash
npx vitest run tests/project-publish-gate.test.ts tests/git-service.test.ts tests/project-check-mcp.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/project-check-factory.ts src/project-check-tool-registration.ts src/project-publish-gate.ts src/git-service.ts src/errors.ts tests/project-publish-gate.test.ts tests/git-service.test.ts tests/project-check-mcp.test.ts
git commit -m "feat: require fresh verification before publish"
```

---

### Task 6: Wire dual authority into `git_push` MCP and integration coverage

**Files:**
- Modify: `src/server.ts:66-216,587-600`
- Modify: `tests/authority-mcp.test.ts`
- Modify: `tests/git-authority-boundary.test.ts`
- Modify: `tests/http-transport.test.ts`
- Create: `tests/project-publish-mcp.test.ts`

**Interfaces:**

New MCP input:

```ts
z.object({
  authorityLeaseId: z.string().min(40),          // Admin
  projectAuthorityLeaseId: z.string().min(40),   // exact project_resume lease
  cwd: z.string().default("."),
}).strict()
```

No `remote`, `refspec`, `force`, `branch`, `head`, or verification override fields are exposed.

- [ ] **Step 1: Write RED schema/authority tests**

Update schema assertions so `git_push` has exactly:

```ts
expect(Object.keys(pushSchema.properties).sort()).toEqual([
  "authorityLeaseId",
  "cwd",
  "projectAuthorityLeaseId",
]);
```

Add integration cases proving:

- generic Project lease + valid Admin => `PROJECT_RESUME_REQUIRED`;
- resumed Project lease + Project lease passed as admin => authority denial;
- resumed Project lease for project A cannot publish project B;
- revoked/expired resumed lease fails via authority before registry metadata can help;
- valid dual authority reaches the publish gate.

- [ ] **Step 2: Run focused MCP tests and confirm RED**

```bash
npx vitest run tests/authority-mcp.test.ts tests/git-authority-boundary.test.ts tests/http-transport.test.ts tests/project-publish-mcp.test.ts
```

Expected: FAIL because the schema/handler still accepts one lease.

- [ ] **Step 3: Wire the handler**

In `server.ts`:

1. resolve `authorityLeaseId`; require profile `admin`;
2. resolve `projectAuthorityLeaseId`; require profile `project`;
3. obtain `resumeContext = runtime.continuityResumeRegistry.require(projectAuthorityLeaseId)`;
4. create Admin and Project scoped runtimes;
5. create `ProjectCheckService` using the Project lease via `createProjectCheckService()`;
6. instantiate `ProjectPublishGate` and call `push({ cwd, resumeContext })`.

Do not weaken the existing `GitService` `remoteWriteEnabled` requirement; only the Admin-scoped GitService can execute the final remote write.

- [ ] **Step 4: Run MCP integration tests and full TypeScript build**

```bash
npx vitest run tests/authority-mcp.test.ts tests/git-authority-boundary.test.ts tests/http-transport.test.ts tests/project-publish-mcp.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/server.ts tests/authority-mcp.test.ts tests/git-authority-boundary.test.ts tests/http-transport.test.ts tests/project-publish-mcp.test.ts
git commit -m "feat: require resumed project authority for push"
```

---

### Task 7: Documentation, final local acceptance, continuity handoff, and publication

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/PROJECT_STATE.md`

**Interfaces:**
- Agent boot remains `project_resume -> Git reconciliation -> PROJECT_STATE -> active spec/plan -> work`.
- Typed publication contract is documented exactly as `Admin lease + resumed Project lease + non-main clean tree + fresh PASS`.
- Owner Workstation docs say current-user access, not root; unattended readiness, not TCC/Keychain bypass.

- [ ] **Step 1: Update docs and handoff state**

Document:

```text
Owner Workstation:
  personal admin + owner runtime + terminal/PTY + project exec + computer use + full-host JS
  browser remains independent

Typed git_push:
  authorityLeaseId = Admin
  projectAuthorityLeaseId = exact project_resume Project lease
  branch != main
  clean tree
  project_check = fresh PASS for exact HEAD + workingTreeDigest
```

`docs/PROJECT_STATE.md` must include current implementation branch/worktree/HEAD, verification state, blockers, and one concrete `Next exact step`.

- [ ] **Step 2: Run all focused suites together**

```bash
npx vitest run \
  tests/cli-command.test.ts \
  tests/owner-runtime-config.test.ts \
  tests/setup-chatgpt-tunnel.test.ts \
  tests/daily-driver-runner.test.ts \
  tests/setup-daily-driver.test.ts \
  tests/keychain-helper-native.test.ts \
  tests/owner-workstation-status.test.ts \
  tests/continuity-resume-registry.test.ts \
  tests/project-continuity-service.test.ts \
  tests/project-continuity-runtime.test.ts \
  tests/project-publish-gate.test.ts \
  tests/git-service.test.ts \
  tests/project-check-mcp.test.ts \
  tests/authority-mcp.test.ts \
  tests/git-authority-boundary.test.ts \
  tests/http-transport.test.ts \
  tests/project-publish-mcp.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the complete local repository gate**

```bash
npm run check
npm audit --omit=dev
npm run build:broker:macos
npm run test:computer:macos
npx vitest run tests/terminal-pty-real.test.ts tests/terminal-session-integration.test.ts
npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts
```

Expected: every command PASS; production audit reports 0 vulnerabilities.

- [ ] **Step 4: Run unattended-readiness acceptance on the real Mac**

```bash
npm run setup:daily-driver
npm run owner-workstation:status
```

Expected: daily-driver reuses/stores the app-owned Keychain credential without writing it to plist/logs; readiness JSON reports stable Computer Runtime identity and the actual passive TCC state. If TCC is not pre-authorized, report `ready:false` and the specific boolean; do not modify TCC automatically.

- [ ] **Step 5: Commit final docs/state and re-run freshness-sensitive verification**

```bash
git add AGENTS.md README.md SECURITY.md docs/PROJECT_STATE.md docs/superpowers/specs/2026-09-13-owner-workstation-verified-project-session-design.md docs/superpowers/plans/2026-09-13-owner-workstation-verified-project-session.md
git commit -m "docs: finalize owner workstation workflow"
npm run check
```

Because the final docs commit changes `HEAD`, any earlier ProjectCheck PASS is stale by design.

- [ ] **Step 6: Checkpoint Continuity before publication**

Use `project_checkpoint` for alias `chatgpt-system-desktop` with:

- exact current branch/worktree/HEAD;
- fresh local verification summary;
- status `active`;
- `Next exact step`: run `project_check` on exact final HEAD, then typed `git_push` if PASS.

- [ ] **Step 7: Produce fresh `project_check PASS` for exact final state**

Using the active resumed Project lease:

```text
project_check(operation="run", cwd=".")
project_check(operation="report", cwd=".")
```

Expected: `overallStatus = PASS`, with `head` equal to final branch HEAD and current `workingTreeDigest` matching the clean tree.

If Project Exec/Docker is unavailable, publication must stop with `LOCAL_VERIFICATION_REQUIRED`/`UNAVAILABLE`; do not bypass the gate with raw shell `git push`.

- [ ] **Step 8: Publish only through the new typed gate**

Start/obtain an active Admin lease, then call:

```text
git_push(
  authorityLeaseId=adminLease.leaseId,
  projectAuthorityLeaseId=resume.authorityLease.leaseId,
  cwd="."
)
```

Expected: current non-main branch is pushed only after all gate checks pass.

- [ ] **Step 9: PR, exact-head hosted CI, merge, and cleanup**

After push:

1. open the PR;
2. poll hosted checks with one-shot status queries, never long `--watch`;
3. require exact PR head to pass Node 22, Node 24, and macOS-native checks required by the repository;
4. merge only the verified exact head;
5. synchronize local `main` with `origin/main`;
6. verify merge SHA and clean status;
7. delete the proven merged implementation branch locally/remotely and remove its managed worktree;
8. preserve `origin/feat/computer-use-bridge` unless separately classified;
9. update `docs/PROJECT_STATE.md` and Project Continuity to completed with final evidence.

Expected steady state: authoritative checkout on clean synchronized `main`, no merged implementation branch/worktree left behind.

---

## Plan self-review checklist

Before execution, the implementing agent must verify these mappings remain true:

- Owner Workstation preset -> Task 1.
- App-owned non-interactive Keychain path -> Task 2.
- Stable Computer Runtime + passive TCC/credential readiness -> Task 3.
- Exact `project_resume` provenance -> Task 4.
- Clean non-main + fresh exact-state verification -> Task 5.
- Admin + resumed Project dual authority at MCP boundary -> Task 6.
- Local-first full verification, continuity checkpoint, typed publication, PR/CI/merge/cleanup -> Task 7.

No task may replace `ProjectCheckService` or Project Continuity with parallel persistent state. No task may make Browser Runtime part of the Owner Workstation preset.
