# Browser Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic Admin-scoped Playwright browser runtime to `chatgpt-system` for semantic web inspection/action, screenshots, and bounded browser diagnostics without a second LLM agent.

**Architecture:** Keep `chatgpt-system` as one modular monolith. A `BrowserRuntime` owns one lazily created persistent Chromium context and opaque page IDs; a `BrowserService` applies URL/target/credential/redaction policy; MCP tools proxy only the narrow safe surface after authority resolution. Tests inject a fake browser backend so CI needs no downloaded browser binary.

**Tech Stack:** TypeScript 6, Node.js 22/24, MCP SDK v2, Zod 4, Playwright 1.63.0, Vitest 3.2.

**Spec:** `docs/superpowers/specs/2026-09-09-browser-runtime-design.md`

## Global Constraints

- Browser capability is disabled by default.
- All browser content/action tools except categorical `browser_health` require Admin authority.
- Playwright is deterministic infrastructure; no secondary LLM/API agent is introduced.
- Production dependency is pinned exactly to `playwright` `1.63.0`.
- The browser uses a dedicated automation user-data directory; the user's default Chrome profile is never the documented/default target.
- MCP accepts no CSS/XPath/raw selector, JavaScript, cookie/storage API, CDP endpoint, proxy, executable path, arbitrary browser argument, file upload, or secret store.
- Caller navigation accepts only `http:` and `https:`.
- Credential-like fields refuse fill/key actions fail-closed.
- Editable ARIA values are redacted before MCP output.
- Page IDs are opaque, in-memory, never audited.
- Browser operation payloads and diagnostics are bounded.
- Browser shutdown is attempted before control/transport shutdown.
- Existing Node 22/24 and native macOS CI must remain green.

---

### Task 1: Browser configuration and contracts

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `src/cli-command.ts`
- Create: `src/browser-types.ts`
- Test: `tests/browser-config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces `BrowserConfig` with `enabled`, `headless`, `timeoutMs`, and `userDataDir`.
- Produces `BrowserTarget`, `BrowserRole`, `BrowserKey`, `BrowserHealth`, `BrowserTabView`, and stable browser error-code constants.
- Extends `ConfigOverrides` with `browserEnabled`, `browserHeadless`, `browserTimeoutMs`, and `browserUserDataDir`.
- CLI produces the same overrides through `--enable-browser`, `--browser-headless`, `--browser-timeout-ms`, and `--browser-user-data-dir`.

- [ ] **Step 1: Write failing browser config tests**

Create `tests/browser-config.test.ts` asserting:

```ts
const config = await loadConfig({ roots: [projectRoot] });
expect(config.browser.enabled).toBe(false);
expect(config.browser.headless).toBe(false);
expect(config.browser.timeoutMs).toBe(10_000);
expect(config.browser.userDataDir).toBe(path.join(homeDir, ".chatgpt-system", "browser-profile"));
```

Also assert CLI parsing:

```ts
expect(parseCliCommand([
  "stdio",
  "--enable-browser",
  "--browser-headless",
  "--browser-timeout-ms", "15000",
  "--browser-user-data-dir", "~/browser-test",
])).toMatchObject({
  kind: "server",
  overrides: {
    browserEnabled: true,
    browserHeadless: true,
    browserTimeoutMs: 15000,
    browserUserDataDir: "~/browser-test",
  },
});
```

Invalid/non-positive timeout must throw.

- [ ] **Step 2: Run RED verification**

Run the test workflow against the test-only commit. Expected: `tests/browser-config.test.ts` fails because browser config and CLI fields do not exist.

- [ ] **Step 3: Implement minimal config/contracts**

Add exact Playwright dependency:

```json
"playwright": "1.63.0"
```

Add:

```ts
export interface BrowserConfig {
  enabled: boolean;
  headless: boolean;
  timeoutMs: number;
  userDataDir: string;
}
```

Normalize `~` with the same explicit startup-only path semantics used for the control socket. Add strict target/key type definitions in `src/browser-types.ts`.

- [ ] **Step 4: Run GREEN verification**

Require the browser-config tests and all existing tests to pass.

- [ ] **Step 5: Commit**

Commit config/contracts separately before runtime behavior.

---

### Task 2: Browser service policy with a fake backend

**Files:**
- Create: `src/browser-backend.ts`
- Create: `src/browser-service.ts`
- Modify: `src/errors.ts`
- Test: `tests/browser-service.test.ts`

**Interfaces:**
- Produces `BrowserBackend` interface whose production implementation can launch/close a context, list/create/select/close pages, navigate, resolve semantic targets, inspect target metadata, snapshot, click/fill/select/press/wait, screenshot, and read bounded diagnostics.
- Produces `BrowserService` methods:

```ts
health(): Promise<BrowserHealth>
tabs(): Promise<{ tabs: BrowserTabView[] }>
newTab(url?: string): Promise<BrowserTabView>
selectTab(pageId: string): Promise<BrowserTabView>
closeTab(pageId: string): Promise<{ closed: true }>
navigate(pageId: string, url: string): Promise<BrowserTabView>
snapshot(pageId: string): Promise<{ pageId: string; snapshot: string }>
click(pageId: string, target: BrowserTarget): Promise<{ ok: true }>
fill(pageId: string, target: BrowserTarget, text: string): Promise<{ ok: true }>
selectOption(pageId: string, target: BrowserTarget, value: string): Promise<{ ok: true }>
pressKey(pageId: string, key: BrowserKey): Promise<{ ok: true }>
waitForText(pageId: string, text: string, timeoutMs?: number): Promise<{ found: true }>
screenshot(pageId: string): Promise<BrowserScreenshot>
consoleErrors(pageId: string): Promise<BrowserConsoleResult>
networkErrors(pageId: string): Promise<BrowserNetworkResult>
close(): Promise<{ closed: true }>
```

- [ ] **Step 1: Write failing policy tests using an in-test fake backend**

Cover one behavior per test:

```ts
await expect(service.navigate(pageId, "file:///tmp/a")).rejects.toMatchObject({ code: "BROWSER_NAVIGATION_REFUSED" });
```

```ts
fake.targetMetadata = { tagName: "INPUT", type: "password", autocomplete: "", labels: ["Password"] };
await expect(service.fill(pageId, target, "secret")).rejects.toMatchObject({ code: "BROWSER_CREDENTIAL_ENTRY_REFUSED" });
expect(fake.fillCalls).toHaveLength(0);
```

```ts
fake.snapshotText = '- textbox "Email": user@example.com\n- button "Save"';
expect((await service.snapshot(pageId)).snapshot).toBe('- textbox "Email"\n- button "Save"');
```

Also cover autocomplete credential tokens, credential keyword metadata, target not found/ambiguous mapping, timeout cap, network URL query/fragment stripping, bounded diagnostics, and operation serialization.

- [ ] **Step 2: Run RED verification**

Expected: tests fail because `BrowserService`/backend contracts do not exist.

- [ ] **Step 3: Implement minimal policy layer**

Implement URL parsing with `new URL()` and explicit `http:`/`https:` allowlist. Implement credential checks using deterministic metadata only. Implement editable snapshot redaction with line-oriented parsing limited to editable ARIA roles. Implement one internal promise chain around every backend operation.

- [ ] **Step 4: Run GREEN verification**

Require all browser-service tests plus the existing suite to pass.

- [ ] **Step 5: Commit**

Commit service/policy independently.

---

### Task 3: Production Playwright backend and lifecycle

**Files:**
- Create: `src/playwright-browser-backend.ts`
- Create: `src/browser-runtime.ts`
- Test: `tests/browser-runtime.test.ts`

**Interfaces:**
- `PlaywrightBrowserBackend` implements `BrowserBackend` using `chromium.launchPersistentContext(userDataDir, { headless })`.
- `BrowserRuntime` lazily creates one backend/context, maps Playwright pages to random opaque page IDs, owns bounded diagnostics, and is idempotently closable.
- Tests inject a backend factory; production factory imports Playwright only when the enabled runtime first starts.

- [ ] **Step 1: Write failing lifecycle tests**

Assert:

```ts
await runtime.tabs();
await runtime.tabs();
expect(factoryStarts).toBe(1);
```

```ts
const tab = await runtime.newTab();
expect(tab.pageId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
expect(tab).not.toHaveProperty("pid");
```

```ts
await runtime.close();
await runtime.close();
expect(closeCalls).toBe(1);
```

Also assert closed/unknown pages map to `BROWSER_PAGE_NOT_FOUND` and buffers obey configured maximum counts/bytes.

- [ ] **Step 2: Run RED verification**

Expected: lifecycle tests fail because runtime/backend do not exist.

- [ ] **Step 3: Implement production adapter**

Use Playwright semantic APIs only:

```ts
page.getByRole(role, { name, exact });
page.getByText(text, { exact });
page.getByLabel(label, { exact });
page.getByTestId(testId);
```

Enforce exactly one target before mutation. Use `page.locator("body").ariaSnapshot({ mode: "ai", depth: boundedDepth })` for snapshots. Capture screenshots to memory without a filesystem path. Capture context/page console and request failure/HTTP error events into bounded in-memory tails.

- [ ] **Step 4: Run GREEN verification**

The unit suite must pass without launching a real browser. Production adapter compile/type checking must pass under Node 22/24 CI.

- [ ] **Step 5: Commit**

Commit runtime/backend.

---

### Task 4: Authority-scoped MCP browser tools and audit

**Files:**
- Modify: `src/server.ts`
- Modify: `src/scoped-runtime.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/browser-mcp.test.ts`
- Test: `tests/browser-audit.test.ts`

**Interfaces:**
- `RuntimeServices` owns one optional/lazy `BrowserService`/`BrowserRuntime` instance configured at startup.
- `createScopedRuntime` exposes browser operations only when `authority.profile === "admin"`; otherwise browser calls fail with `POLICY_DENIED`.
- `browser_health` is registered outside authority scope and returns categorical state only.
- Browser action tool schemas are strict and contain no selector/javascript/storage/CDP/launch escape fields.

- [ ] **Step 1: Write failing MCP catalog/policy tests**

Use a real MCP client test harness as existing authority tests do. Assert tool discovery includes the browser surface when configured, health is callable lease-free, Admin calls reach the fake browser service, and Project/User calls fail with `POLICY_DENIED`.

Assert schemas reject extra fields such as:

```json
{"selector":"#password","javascript":"...","cdpEndpoint":"...","executablePath":"..."}
```

- [ ] **Step 2: Write failing audit-redaction tests**

Invoke browser operations with sentinel values and assert the audit file does not contain page IDs, fill text, snapshot text, screenshot bytes, console payloads, query strings, fragments, or authority lease IDs.

- [ ] **Step 3: Run RED verification**

Expected: new MCP/audit tests fail because tools are not registered.

- [ ] **Step 4: Implement MCP surface and output schemas**

Register the exact v1 tools from the spec. Screenshot uses MCP `image/png` content plus bounded structured metadata. All other successful tools return validated structured content.

- [ ] **Step 5: Run GREEN verification**

Require new MCP/audit tests and the full suite to pass.

- [ ] **Step 6: Commit**

Commit MCP/audit integration.

---

### Task 5: Shutdown ordering, setup, and documentation

**Files:**
- Modify: `src/runtime-shutdown.ts`
- Modify: `tests/runtime-shutdown.test.ts`
- Create: `scripts/setup-browser.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `.github/workflows/ci.yml` only if setup/help smoke validation requires it
- Test: `tests/setup-browser.test.ts`

**Interfaces:**
- Runtime shutdown phase order becomes `processes -> browser -> control -> transport`.
- `npm run setup:browser` performs a bounded spawn of the repository-local Playwright CLI equivalent to `playwright install chromium`; it accepts no arbitrary browser/channel/command arguments.

- [ ] **Step 1: Write failing shutdown/setup tests**

Assert browser close is attempted after managed processes and before control/transport, and one phase failure does not skip later phases.

Assert setup script rejects extra arguments and uses fixed Chromium installation semantics.

- [ ] **Step 2: Run RED verification**

Expected: tests fail because browser shutdown/setup is not wired.

- [ ] **Step 3: Implement shutdown/setup minimally**

Add browser cleanup to `closeRuntimeResources`. Add fixed setup script; do not run the actual browser download in CI unit tests.

- [ ] **Step 4: Update docs**

Document enablement, dedicated automation profile, Admin boundary, excluded unsafe tools, one-time browser setup, and real-Mac acceptance steps. Do not claim the runtime is an OS/network sandbox.

- [ ] **Step 5: Full GREEN verification**

Require all repository CI jobs on the exact feature head to pass:

```text
Node 22 build/tests
Node 24 build/tests
macOS native helper build/install verification
setup CLI smoke checks
```

- [ ] **Step 6: PR review and merge**

Open `feat/browser-runtime -> main`, inspect the exact diff and all jobs, correct any reproducible defect with a RED test first, then merge only the verified exact head.

---

### Task 6: Real-Mac acceptance after merge

**Files:**
- No code changes unless acceptance reveals a reproducible defect.

**Interfaces:**
- Uses merged `main` plus the existing Secure MCP Tunnel daily-driver path.

- [ ] **Step 1: Refresh merged local checkout and install browser binary**

Run the merged `npm run setup:browser` once on the Mac.

- [ ] **Step 2: Enable browser in the daily-driver/tunnel startup configuration**

Keep the profile path at the dedicated `~/.chatgpt-system/browser-profile` unless the operator deliberately selects another dedicated automation profile.

- [ ] **Step 3: Run Admin acceptance**

Verify health, tab lifecycle, HTTPS navigation, snapshot, benign click/fill/select/key/wait, screenshot, console/network diagnostics, and clean close.

- [ ] **Step 4: Run safety acceptance**

Verify password fill refusal, non-HTTP(S) navigation refusal, User/Project denial, revoked Admin denial, and runtime shutdown cleanup.

- [ ] **Step 5: Fix only evidence-driven defects**

For each acceptance defect: reproduce in an automated RED test, implement the minimal fix, rerun full CI, open a focused fix PR, and merge only after exact-head CI is green.

## Self-review

- Spec coverage: every spec section maps to Tasks 1-6.
- Placeholder scan: no TBD/TODO/"implement later" steps remain.
- Type consistency: `BrowserConfig`, `BrowserTarget`, `BrowserBackend`, `BrowserService`, and page-ID semantics are defined before consumers.
- Scope: execution queue and Computer-Use Bridge are explicitly excluded from this plan and receive separate plans after Browser Runtime acceptance.
