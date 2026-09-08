# Personal Admin Daily Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `chatgpt-system` a zero-terminal daily driver after one-time setup by adding explicit MCP self-service Admin authority and a Keychain-backed macOS LaunchAgent for the Secure MCP Tunnel.

**Architecture:** Keep the existing authority model and terminal gate intact. Personal-admin is an opt-in runtime mode that only widens `session_authority_start` to include the existing fixed Admin profile; all downstream tools still consume opaque leases. A separate macOS runner retrieves the tunnel credential from Keychain at runtime, launches `tunnel-client` with `shell:false`, and is supervised by a user LaunchAgent.

**Tech Stack:** TypeScript 6, Node.js >=22, MCP TypeScript SDK v2, Vitest 3, macOS `security`, macOS `launchctl`, LaunchAgent plist.

**Spec:** `docs/superpowers/specs/2026-09-08-personal-admin-daily-driver-design.md`

## Global Constraints

- `--personal-admin` MUST default to disabled.
- Existing Project/User/Admin authority behavior MUST remain unchanged when personal-admin is disabled.
- Personal-admin MUST reuse `AuthorityManager`; no parallel lease store or persisted Admin token.
- Personal-admin MUST NOT bypass the runtime `--enable-terminal` gate.
- `CONTROL_PLANE_API_KEY` MUST NOT appear in command-line arguments, LaunchAgent plist, repository files, audit logs, or runner logs.
- LaunchAgent MUST run in the logged-in user's `gui/<uid>` domain, never as root.
- No shell execution, sudo, password piping, or executable allowlist widening.
- Existing process supervisor and product-layer safety behavior remain unchanged.
- Use TDD for each behavior change and run `npm run check` before integration.

---

### Task 1: Personal-admin configuration and CLI contract

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli.ts`
- Modify: `tests/control-config.test.ts`
- Modify: `tests/cli-command.test.ts`

**Interfaces:**
- Produces: `AppConfig.personalAdmin.enabled: boolean`
- Produces: `ConfigOverrides.personalAdminEnabled?: boolean`
- Produces CLI server flag: `--personal-admin`
- Consumes existing boolean environment parsing pattern.

- [ ] **Step 1: Write failing config tests**

Add assertions equivalent to:

```ts
it("keeps personal admin disabled by default", async () => {
  const config = await loadConfig({ roots: [root] });
  expect(config.personalAdmin).toEqual({ enabled: false });
});

it("enables personal admin only through explicit override", async () => {
  const config = await loadConfig({ roots: [root], personalAdminEnabled: true });
  expect(config.personalAdmin).toEqual({ enabled: true });
});
```

Add an env fixture for `CHATGPT_SYSTEM_PERSONAL_ADMIN=true` and assert the same enabled result.

- [ ] **Step 2: Write failing CLI parsing tests**

Add:

```ts
expect(parseCliCommand(["stdio", "--personal-admin"])).toMatchObject({
  kind: "server",
  overrides: { personalAdminEnabled: true },
});
```

Keep authorize command parsing unchanged.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/control-config.test.ts tests/cli-command.test.ts
```

Expected: failures because `personalAdmin` and `--personal-admin` do not exist.

- [ ] **Step 4: Implement minimal config/CLI support**

In `src/config.ts` add:

```ts
personalAdmin: { enabled: boolean };
```

and:

```ts
personalAdminEnabled?: boolean;
```

Add `CHATGPT_SYSTEM_PERSONAL_ADMIN` to `EnvSchema`, and construct:

```ts
personalAdmin: {
  enabled: overrides.personalAdminEnabled ?? enabled(env.CHATGPT_SYSTEM_PERSONAL_ADMIN),
},
```

In `src/cli-command.ts`, parse `--personal-admin` only as a server flag and set `personalAdminEnabled: true`.

In `src/cli.ts`, document `--personal-admin` in server help and describe it as explicit personal-workstation opt-in.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/cli-command.ts src/cli.ts tests/control-config.test.ts tests/cli-command.test.ts
git commit -m "feat: add personal admin runtime flag"
```

---

### Task 2: Personal Admin MCP authority start and capability reporting

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tool-output-schemas.ts`
- Modify: `tests/authority-mcp.test.ts`
- Modify: `tests/authority-catalog.test.ts`
- Modify: `tests/authority.test.ts` only if helper configs require the new `personalAdmin` field.
- Modify additional `AppConfig` fixtures found by TypeScript/test failures only to add explicit `personalAdmin: { enabled: false }` or the intended test value.

**Interfaces:**
- Consumes: `runtime.config.personalAdmin.enabled`
- Produces conditional `session_authority_start` schema.
- Produces `system_capabilities.personalAdmin = { enabled, adminLeaseMaxTtlSeconds: 3600 }`.

- [ ] **Step 1: Write failing secure-default catalog test**

Assert that with `personalAdmin.enabled=false`, the authority start tool still rejects `profile="admin"` and accepts the existing Project input.

- [ ] **Step 2: Write failing personal-admin MCP test**

Create runtime config with:

```ts
personalAdmin: { enabled: true },
terminal: { enabled: false, commands: ["node"] },
```

Call `session_authority_start` with:

```ts
{ profile: "admin", requestedTtlSeconds: 60 }
```

Assert:

```ts
{
  profile: "admin",
  roots: ["/"],
  terminalEnabled: false,
  commands: [],
}
```

Repeat with terminal enabled and assert `terminalEnabled=true` and the command allowlist is present.

- [ ] **Step 3: Write failing capabilities test**

Assert `system_capabilities` includes:

```ts
personalAdmin: {
  enabled: true,
  adminLeaseMaxTtlSeconds: 3600,
}
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/authority-mcp.test.ts tests/authority-catalog.test.ts
```

Expected: personal Admin input rejected or missing capability fields.

- [ ] **Step 5: Implement conditional authority schema**

In `createMcpServer`, build either:

```ts
const projectAuthorityStartSchema = z.object({
  profile: z.literal("project"),
  projectRoots: z.array(z.string()).min(1),
  requestedTtlSeconds: z.number().int().positive().optional(),
}).strict();
```

or, when personal-admin is enabled:

```ts
const personalAuthorityStartSchema = z.discriminatedUnion("profile", [
  projectAuthorityStartSchema,
  z.object({
    profile: z.literal("admin"),
    requestedTtlSeconds: z.number().int().positive().optional(),
  }).strict(),
]);
```

Branch the handler by `profile`. Admin calls existing:

```ts
runtime.authority.start({ profile: "admin", ...ttl })
```

Project calls the existing project-root path.

Do not expose User direct start.

- [ ] **Step 6: Extend capability schema/output**

Update `systemCapabilitiesOutputSchema` and server output with the exact `personalAdmin` object above.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the same focused tests. Expected: PASS.

- [ ] **Step 8: Run TypeScript/test discovery for config fixtures**

Run:

```bash
npm run build
```

Then:

```bash
npm test
```

Update only test/config fixtures that now require the new explicit field. Do not change unrelated behavior.

- [ ] **Step 9: Commit**

```bash
git add src/server.ts src/tool-output-schemas.ts tests
git commit -m "feat: allow explicit personal admin authority"
```

---

### Task 3: Tunnel profile support for personal-admin

**Files:**
- Modify: `scripts/setup-chatgpt-tunnel.mjs`
- Modify: `tests/setup-chatgpt-tunnel.test.ts`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- Produces setup option `--personal-admin`.
- Produces MCP child command suffix `--personal-admin` only when requested.

- [ ] **Step 1: Write failing setup tests**

Add one secure-default assertion:

```ts
expect(setup.mcpCommand).not.toContain("--personal-admin");
```

and one opt-in assertion:

```ts
const setup = buildTunnelSetup([
  "--root", ROOT,
  "--tunnel-id", TUNNEL_ID,
  "--enable-terminal",
  "--personal-admin",
]);
expect(setup.mcpCommand).toContain("--personal-admin");
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npx vitest run tests/setup-chatgpt-tunnel.test.ts
```

Expected: unknown option `--personal-admin`.

- [ ] **Step 3: Implement setup flag**

Extend parser state with `personalAdmin: false`, accept `--personal-admin`, append the flag to `commandParts` when true, and display:

```text
Personal Admin: EXPLICITLY ENABLED
```

or `disabled`.

Do not automatically imply `--enable-terminal`.

- [ ] **Step 4: Update runbook copy**

Document the daily-driver profile as explicitly using:

```text
--enable-terminal --personal-admin
```

State that this mode permits ChatGPT to mint short-lived Admin leases without local approval and is intended only for the user's private workstation.

- [ ] **Step 5: Run focused test and verify GREEN**

Run the same focused test. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/setup-chatgpt-tunnel.mjs tests/setup-chatgpt-tunnel.test.ts README.md docs/CHATGPT_INTEGRATION.md
git commit -m "feat: add personal admin tunnel profile"
```

---

### Task 4: Keychain-backed daily-driver runner

**Files:**
- Create: `scripts/daily-driver-runner.mjs`
- Create: `tests/daily-driver-runner.test.ts`

**Interfaces:**
- Export: `KEYCHAIN_SERVICE = "chatgpt-system-control-plane"`
- Export: `KEYCHAIN_ACCOUNT = "chatgpt-system"`
- Export: `MAX_LOG_BYTES = 1_048_576`
- Export: `parseRunnerArgs(argv): { tunnelClientPath: string; profile: string; logDir: string }`
- Export: `readControlPlaneKey(options?): string`
- Export: `appendBoundedLog(file, chunk, maxBytes?): Promise<void>`
- Export: `runDailyDriver(options?): Promise<number>`

- [ ] **Step 1: Write failing argument/keychain tests**

Test that non-absolute tunnel paths are rejected and that Keychain retrieval constructs exactly:

```ts
["find-generic-password", "-w", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE]
```

No secret exists in these arguments.

- [ ] **Step 2: Write failing bounded-log test**

Write >1 MiB into a temporary log through `appendBoundedLog` and assert:

```ts
expect((await stat(file)).size).toBeLessThanOrEqual(MAX_LOG_BYTES);
```

and that retained data is the newest tail.

- [ ] **Step 3: Write failing spawn contract test**

Inject a fake spawn implementation and assert runner starts:

```ts
spawn(tunnelClientPath, ["run", "--profile", profile], {
  shell: false,
  env: expect.objectContaining({ CONTROL_PLANE_API_KEY: "sentinel" }),
  stdio: ["ignore", "pipe", "pipe"],
});
```

Assert the sentinel key never appears in runner log content.

- [ ] **Step 4: Run focused test and verify RED**

```bash
npx vitest run tests/daily-driver-runner.test.ts
```

Expected: module missing.

- [ ] **Step 5: Implement runner**

Use `spawnSync("/usr/bin/security", ...)` for Keychain read, trim only the trailing newline, throw a generic non-secret error on failure, spawn tunnel-client with `shell:false`, pipe outputs through per-stream serialized bounded writes, forward SIGTERM/SIGINT to child, and resolve with the child's exit code.

The executable path, profile, and log dir are validated before Keychain access.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same test. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/daily-driver-runner.mjs tests/daily-driver-runner.test.ts
git commit -m "feat: add keychain backed tunnel runner"
```

---

### Task 5: LaunchAgent installer, status, and uninstall

**Files:**
- Create: `scripts/setup-daily-driver.mjs`
- Create: `tests/setup-daily-driver.test.ts`
- Modify: `package.json`

**Interfaces:**
- Export: `LAUNCH_AGENT_LABEL = "com.senoldogann.chatgpt-system.daily-driver"`
- Export: `buildLaunchAgent(options): string`
- Export: `keychainStoreInvocation(): { command: string; args: string[] }`
- Export: `buildLaunchctlCommands(options): { bootout: string[]; bootstrap: string[] }`
- CLI commands: `install`, `status`, `uninstall`.

- [ ] **Step 1: Write failing plist privacy test**

Build a plist with a sentinel API key present in the test environment and assert:

```ts
expect(plist).not.toContain("CONTROL_PLANE_API_KEY");
expect(plist).not.toContain("sentinel-secret");
expect(plist).toContain("com.senoldogann.chatgpt-system.daily-driver");
expect(plist).toContain("<key>RunAtLoad</key>");
expect(plist).toContain("<key>KeepAlive</key>");
```

Also assert ProgramArguments are absolute Node/runner/tunnel-client paths and contain only non-secret values.

- [ ] **Step 2: Write failing Keychain storage test**

Assert the invocation args end in a bare `-w`:

```ts
expect(args.at(-1)).toBe("-w");
expect(args.join(" ")).not.toContain("sentinel-secret");
```

Inject the child-process runner and assert the secret is supplied only through stdin input.

- [ ] **Step 3: Write failing launchctl command tests**

For UID 501 and plist path `/Users/test/Library/LaunchAgents/...plist`, assert:

```ts
bootout === ["bootout", "gui/501", plistPath]
bootstrap === ["bootstrap", "gui/501", plistPath]
```

Status uses:

```text
launchctl print gui/501/com.senoldogann.chatgpt-system.daily-driver
```

Uninstall bootouts before deleting the plist and deletes the fixed Keychain service/account item.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
npx vitest run tests/setup-daily-driver.test.ts
```

Expected: module missing.

- [ ] **Step 5: Implement pure builders and install flow**

Install must validate, before mutating state:

- `process.platform === "darwin"`;
- `CONTROL_PLANE_API_KEY` is non-empty;
- tunnel-client resolves to an absolute executable path;
- runner script exists;
- profile name matches `[A-Za-z0-9_-]+`.

Then:

1. create `~/Library/LaunchAgents` and `~/.chatgpt-system/daily-driver` with user-private modes where applicable;
2. store/update Keychain secret with `/usr/bin/security ... -w` and secret on stdin;
3. atomically write the plist;
4. best-effort `launchctl bootout gui/<uid> <plist>`;
5. require successful `launchctl bootstrap gui/<uid> <plist>`.

Never print the key or child environment.

- [ ] **Step 6: Add npm scripts**

Add exactly:

```json
"setup:daily-driver": "npm run build && node scripts/setup-daily-driver.mjs install",
"daily-driver:status": "node scripts/setup-daily-driver.mjs status",
"daily-driver:uninstall": "node scripts/setup-daily-driver.mjs uninstall"
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the same setup test plus runner test. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/setup-daily-driver.mjs tests/setup-daily-driver.test.ts package.json
git commit -m "feat: add macos daily driver launch agent"
```

---

### Task 6: Documentation, full verification, CI, and live Mac install

**Files:**
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `SECURITY.md`
- Modify tests only if documentation assertions already cover these sections.

**Interfaces:**
- User-facing steady state: Mac login -> LaunchAgent -> tunnel -> personal Admin tool flow.

- [ ] **Step 1: Document trust trade-off and one-time setup**

README must state:

```text
Personal Admin is intentionally less restrictive than the default local-approval model. Enable it only on a private workstation you control.
```

Document that the API key authenticates `tunnel-client` to the Secure MCP Tunnel control plane; it is not an OpenAI model API call made by `chatgpt-system`.

- [ ] **Step 2: Document recovery/status/uninstall**

Document only these normal maintenance commands:

```bash
npm run daily-driver:status
npm run daily-driver:uninstall
```

Normal daily use must not require a Terminal window.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run check
```

Expected: build success, all tests green.

Then:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only known unrelated untracked `.build/` and `package-lock.json` remain outside staged work.

- [ ] **Step 4: Security scan generated artifacts**

Generate a test LaunchAgent plist using a sentinel key and assert/search that the sentinel and `CONTROL_PLANE_API_KEY` are absent. Run focused runner/setup tests again.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/CHATGPT_INTEGRATION.md docs/ARCHITECTURE.md SECURITY.md
git commit -m "docs: document personal admin daily driver"
```

- [ ] **Step 6: Push branch and run CI**

Push `feat/personal-admin-daily-driver`, create PR against `main`, and require Node 22, Node 24, and macOS native jobs to pass.

- [ ] **Step 7: Merge only after fresh CI evidence**

Merge through PR semantics, then run `npm run check` on merged `main` before pushing/confirming integration if a local merge path is required.

- [ ] **Step 8: One-time live Mac migration**

After main is merged:

1. rebuild `dist`;
2. replace the existing tunnel profile with `--enable-terminal --personal-admin --force`;
3. stop the manually running tunnel;
4. run daily-driver install while the current shell has `CONTROL_PLANE_API_KEY`;
5. verify LaunchAgent status and tunnel connection;
6. refresh ChatGPT plugin catalog;
7. verify `system_capabilities.personalAdmin.enabled=true` and `terminal.enabled=true`;
8. have ChatGPT mint an Admin lease directly and run benign filesystem/Node/process smoke tests;
9. verify generated plist, bounded logs, and audit contain no control-plane key or raw authority lease;
10. leave the LaunchAgent running as the daily-driver endpoint.

- [ ] **Step 9: Final product state**

Record the operational contract:

```text
Daily use: open ChatGPT and use the plugin.
Terminal: only setup, explicit uninstall, or troubleshooting.
Admin lease paste: not required in personal-admin mode.
```
