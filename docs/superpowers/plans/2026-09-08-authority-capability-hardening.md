# Authority Capability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the approved Project/User/Admin privilege ladder and make User/Admin native approval depend only on a protected, root-owned, hash-verified macOS helper installation.

**Architecture:** Authority leases carry explicit capabilities instead of implicitly enabling terminal execution. Project and User leases have filesystem/Git access only; Admin is the sole terminal-capable Phase-1 profile. The macOS approval broker stops executing repository-local build output and validates a fixed protected installation plus root-owned SHA-256 metadata immediately before every native authentication request.

**Tech Stack:** TypeScript/Node.js 22+, MCP SDK 2.x, Zod, Vitest, Swift 6, Foundation/LocalAuthentication, macOS POSIX ownership/mode semantics, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-local-authority-broker-design.md`

## Global Constraints

- `project -> terminalEnabled=false`.
- `user -> terminalEnabled=false`.
- `admin -> terminalEnabled=true`.
- MCP callers cannot override profile capability mapping.
- direct User/Admin start remains `LOCAL_APPROVAL_REQUIRED`.
- production approval helper path is `/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker`.
- production trust metadata path is `/Library/Application Support/chatgpt-system/etc/authority-broker.sha256`.
- helper and trust metadata are root-owned, non-symlinks, and not group/other writable.
- helper SHA-256 must match the protected metadata before every native approval execution.
- repository `.build/release/...` output is build input only, never a production runtime executable.
- no password piping, `sudo -S`, PAM edits, passwordless sudo rule, root shell, ServiceManagement/XPC root operation, or GUI computer-use tool is introduced here.
- existing lease TTL, revocation, filesystem confinement, SHA conflict protection, Git safety, audit redaction, `shell=false`, process timeout/output bounds remain in force.

---

### Task 1: Explicit Lease Capability Mapping

**Files:**
- Modify: `src/authority.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `tests/authority.test.ts`
- Modify: `tests/authority-mcp.test.ts`
- Modify: `tests/authority-approval-mcp.test.ts`

**Interfaces:**
- `AuthorityContext.terminalEnabled: boolean`.
- trusted profile mapping: `project=false`, `user=false`, `admin=true`.
- non-terminal leases expose `commands: []`; Admin exposes configured allowlist.

- [ ] **Step 1: Write failing capability tests**

Add assertions equivalent to:

```ts
expect(project.terminalEnabled).toBe(false);
expect(project.commands).toEqual([]);
expect(user.terminalEnabled).toBe(false);
expect(user.commands).toEqual([]);
expect(admin.terminalEnabled).toBe(true);
expect(admin.commands).toContain("node");
```

In real MCP tests, assert Project lease output reports `terminalEnabled: false` and locally approved User reports `terminalEnabled: false`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/authority.test.ts tests/authority-mcp.test.ts tests/authority-approval-mcp.test.ts
```

Expected: current Project/User leases report terminal enabled and configured commands.

- [ ] **Step 3: Implement minimal mapping**

Change the stored authority capability construction to:

```ts
const terminalEnabled = request.profile === "admin";
const commands = terminalEnabled ? [...this.commands] : [];
```

Make `AuthorityContext.terminalEnabled` a boolean and preserve copied immutable views.

- [ ] **Step 4: Update output schema**

Change `authorityLeaseOutputSchema.terminalEnabled` from `z.literal(true)` to `z.boolean()` without allowing callers to supply that value.

- [ ] **Step 5: Verify GREEN**

Run the focused suite, then:

```bash
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add src/authority.ts src/tool-output-schemas.ts tests/authority.test.ts tests/authority-mcp.test.ts tests/authority-approval-mcp.test.ts
git commit -m "fix: enforce authority terminal capability ladder"
```

---

### Task 2: Terminal Capability Enforcement Through Scoped Runtime

**Files:**
- Modify: `tests/process-service.test.ts`
- Modify: `tests/authority-mcp.test.ts`
- Modify: `tests/authority-approval-mcp.test.ts`
- Modify only if required: `src/scoped-runtime.ts`
- Modify only if required: `src/process-service.ts`

**Interfaces:**
- Existing `createScopedRuntime(base, authority)` copies `authority.terminalEnabled` into scoped `AppConfig.terminal.enabled`.
- Existing `ProcessService.run()` returns policy failure when terminal is disabled.

- [ ] **Step 1: Add end-to-end negative tests**

For Project and approved User leases call:

```ts
client.callTool({
  name: "terminal_run",
  arguments: { authorityLeaseId, command: "node", args: ["--version"], cwd: inScopeRoot },
});
```

Assert `isError === true` and error code `POLICY_DENIED` (or the repository's stable policy code) before any process spawn.

Add an injected-approved Admin test that runs an allowlisted harmless executable in an in-scope cwd and gets `exitCode: 0`.

- [ ] **Step 2: Verify RED/GREEN boundary**

Run:

```bash
npx vitest run tests/process-service.test.ts tests/authority-mcp.test.ts tests/authority-approval-mcp.test.ts
```

If Task 1 already makes the new tests green through the existing scoped runtime, do not add production code. If a test reveals a bypass, make the smallest enforcement change in `src/scoped-runtime.ts` or `src/process-service.ts` and rerun.

- [ ] **Step 3: Verify full suite**

```bash
npm run check
```

- [ ] **Step 4: Commit**

Commit tests and only the production files actually required:

```bash
git commit -am "test: prove terminal requires admin authority"
```

---

### Task 3: Protected Native Helper Trust Validator

**Files:**
- Create: `src/native-helper-trust.ts`
- Create: `tests/native-helper-trust.test.ts`
- Modify: `src/errors.ts` only if a dedicated stable trust failure code is required.

**Interfaces:**

```ts
export const MACOS_AUTHORITY_INSTALL_ROOT = "/Library/Application Support/chatgpt-system";
export const MACOS_AUTHORITY_HELPER_PATH = `${MACOS_AUTHORITY_INSTALL_ROOT}/bin/chatgpt-system-authority-broker`;
export const MACOS_AUTHORITY_METADATA_PATH = `${MACOS_AUTHORITY_INSTALL_ROOT}/etc/authority-broker.sha256`;

export interface NativeHelperTrustValidator {
  validate(): Promise<void>;
}

export class MacOSNativeHelperTrustValidator implements NativeHelperTrustValidator {
  validate(): Promise<void>;
}
```

- [ ] **Step 1: Write failing validator tests with injected filesystem adapter**

Cover all of these cases independently:

```text
trusted root-owned regular helper + matching root-owned metadata => pass
missing helper => fail
helper symlink => fail
metadata symlink => fail
uid != 0 on helper => fail
uid != 0 on metadata => fail
helper mode with group/other write bit => fail
metadata mode with group/other write bit => fail
installation directory not root-owned => fail
hash metadata malformed => fail
helper SHA-256 mismatch => fail
```

Use fake `lstat/readFile` dependencies so Linux CI does not require root-owned fixtures.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/native-helper-trust.test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement validator**

Use `lstat` for directories/helper/metadata, reject symbolic links, require UID 0, reject `(mode & 0o022) !== 0`, require regular files for helper/metadata, parse metadata as exactly one lowercase 64-hex SHA-256 token, read helper bytes, hash with Node `createHash("sha256")`, compare with `timingSafeEqual` over equal-length buffers.

- [ ] **Step 4: Verify GREEN and regression suite**

```bash
npx vitest run tests/native-helper-trust.test.ts
npm run check
```

- [ ] **Step 5: Commit**

```bash
git add src/native-helper-trust.ts tests/native-helper-trust.test.ts src/errors.ts
git commit -m "feat: validate protected macOS authority helper"
```

---

### Task 4: Bind Broker to Protected Helper Only

**Files:**
- Modify: `src/local-authority-broker.ts`
- Modify: `src/server.ts`
- Modify: `tests/local-authority-broker.test.ts`
- Modify: `tests/authority-approval-mcp.test.ts`

**Interfaces:**
- `MacOSLocalAuthorityBroker` production default uses `MACOS_AUTHORITY_HELPER_PATH` and `MacOSNativeHelperTrustValidator`.
- Tests may inject a fake `NativeHelperTrustValidator` and process runner.
- MCP input contains neither helper path nor metadata path.

- [ ] **Step 1: Write failing trust-before-spawn tests**

Prove:

```ts
trust.validate -> spawn helper -> validate JSON
```

and when trust validation rejects, the process runner is never called and the broker returns `LOCAL_APPROVAL_UNAVAILABLE` without leaking validator details.

Also assert the production runtime no longer contains the repository `.build/release` helper path.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/local-authority-broker.test.ts tests/authority-approval-mcp.test.ts
```

- [ ] **Step 3: Wire trust validator**

Call `await this.trustValidator.validate()` immediately before every helper spawn. Map trust errors to the existing safe categorical local-approval error surface. Remove `DEFAULT_APPROVAL_HELPER_PATH` derived from `import.meta.url` in `src/server.ts`.

- [ ] **Step 4: Verify GREEN and full suite**

```bash
npx vitest run tests/local-authority-broker.test.ts tests/authority-approval-mcp.test.ts
npm run check
```

- [ ] **Step 5: Commit**

```bash
git add src/local-authority-broker.ts src/server.ts tests/local-authority-broker.test.ts tests/authority-approval-mcp.test.ts
git commit -m "fix: bind local approval to protected helper"
```

---

### Task 5: Root-Owned Helper Installer and Setup Diagnostics

**Files:**
- Create: `scripts/install-macos-authority-broker.mjs`
- Create: `tests/install-macos-authority-broker.test.ts`
- Modify: `package.json`
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`

**Interfaces:**
- Human-run installation command:

```bash
npm run build:broker:macos
sudo node scripts/install-macos-authority-broker.mjs
```

- Installer source: `native/macos-authority-broker/.build/release/chatgpt-system-authority-broker`.
- Installer destination: fixed protected helper path.
- Metadata: lowercase SHA-256 plus newline at fixed metadata path.

- [ ] **Step 1: Write installer plan tests before implementation**

Extract a pure `buildInstallPlan(context)` that, for Darwin + effective UID 0, returns deterministic mkdir/copy/chown/chmod/hash metadata targets. Assert non-Darwin and non-root invocations fail before mutation and no password/credential input is accepted.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/install-macos-authority-broker.test.ts tests/setup-chatgpt-tunnel.test.ts
```

- [ ] **Step 3: Implement installer safely**

Use Node filesystem APIs, not a shell command string. Create root-owned `bin` and `etc` directories, copy to a temporary file in the protected directory, set helper mode `0755`, rename atomically, write metadata through a temporary file with mode `0644`, rename atomically, and verify final ownership/modes/hash. Refuse to run unless `process.platform === "darwin"` and `process.getuid?.() === 0`.

- [ ] **Step 4: Add package command without credential automation**

Add:

```json
"install:broker:macos": "node scripts/install-macos-authority-broker.mjs"
```

Documentation will instruct the human to run the installer with `sudo` explicitly after the non-root build. The script never reads a password from stdin or arguments.

- [ ] **Step 5: Update tunnel setup diagnostics**

`buildTunnelSetup()` reports the fixed protected helper and metadata paths. On macOS doctor/run preflight, validate the protected installation through the compiled trust validator and fail with a concise local remediation message when absent/untrusted. Linux setup smoke remains unaffected.

- [ ] **Step 6: Verify GREEN and full CI**

```bash
npx vitest run tests/install-macos-authority-broker.test.ts tests/setup-chatgpt-tunnel.test.ts
npm run check
```

Require GitHub Actions Node 22, Node 24, and `macos-native` Swift build jobs all green.

- [ ] **Step 7: Commit**

```bash
git add scripts/install-macos-authority-broker.mjs tests/install-macos-authority-broker.test.ts package.json scripts/setup-chatgpt-tunnel.mjs tests/setup-chatgpt-tunnel.test.ts
git commit -m "feat: install protected macOS authority helper"
```

---

### Task 6: Documentation, Security Review, and Manual Mac Acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `docs/superpowers/plans/2026-09-07-local-authority-broker.md` to mark the superseding hardening requirement if useful.

**Interfaces:**
- Web remains canonical plugin acceptance surface.
- Desktop uses the same installed plugin/backend.
- User/Admin approval uses native LocalAuthentication.
- Only Admin has Phase-1 terminal capability.

- [ ] **Step 1: Update public documentation**

Document the actual privilege table, protected install command, trust paths, approval flow, terminal limitation, and the distinction between Admin authority and UID 0.

- [ ] **Step 2: Run fresh automated verification**

Require a fresh exact-head result for:

```bash
npm run check
```

and GitHub Actions Node 22, Node 24, `macos-native`, setup smoke.

- [ ] **Step 3: Review the full PR diff against the spec**

Check specifically for: repo-local helper execution, any MCP-controlled executable/reason path, raw request IDs in audit, Project/User terminal bypass, shell execution, password handling, helper trust bypass, or unprotected metadata.

- [ ] **Step 4: Manual macOS acceptance**

On the user's Mac:

```bash
cd ~/chatgpt-system
git checkout feat/local-authority-broker
git pull --ff-only
npm install
npm run check
npm run build:broker:macos
sudo npm run install:broker:macos
```

Then restart `tunnel-client`, Refresh the plugin, and perform:

```text
Project lease -> fs/git success -> terminal_run POLICY_DENIED
User request -> Touch ID -> one User lease -> home read success -> terminal_run POLICY_DENIED -> revoke
Admin request -> Touch ID -> one Admin lease -> /etc/hosts read success -> harmless allowlisted terminal success -> revoke
Cancelled User/Admin request -> no lease
```

- [ ] **Step 5: Integrate only after manual acceptance**

PR #7 stays draft until Mac acceptance is recorded. Then run final review and integrate stacked branches in dependency order.

## Self-Review Results

- Spec coverage: explicit capability ladder, terminal negative/positive tests, protected helper path, owner/mode/symlink/hash trust, installer, setup diagnostics, CI, docs, and manual acceptance all map to tasks.
- Placeholder scan: no TODO/TBD or unspecified implementation step remains.
- Type consistency: `AuthorityContext.terminalEnabled` is boolean throughout; protected helper constants and trust validator are defined before broker/setup tasks consume them.
- Scope: root-only ServiceManagement/XPC remains explicitly out of this plan.
