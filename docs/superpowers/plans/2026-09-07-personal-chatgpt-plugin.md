# Personal ChatGPT Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `chatgpt-system` ready to connect as a personal ChatGPT plugin through OpenAI Secure MCP Tunnel, with structured MCP outputs, truthful tool metadata, safe tunnel setup automation, and a reproducible acceptance test.

**Architecture:** Keep the existing filesystem/Git/process execution core unchanged and harden only the ChatGPT-facing MCP descriptor/result layer. Run the MCP server over stdio as a child of OpenAI `tunnel-client`, require an explicit allowed root, and keep `terminal_run` disabled unless the operator explicitly enables it. No public listener, cloud relay, OAuth server, custom widget, or multi-user service is added in Phase 1.

**Tech Stack:** Node.js 22+, TypeScript 6, MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/node`), Zod 4, Vitest 3, OpenAI Secure MCP Tunnel.

**Spec:** `docs/superpowers/specs/2026-09-07-personal-chatgpt-plugin-design.md`

## Global Constraints

- Filesystem roots must be explicit and minimal; never default tunnel setup to `/` or the full home directory.
- `terminal_run` remains disabled by default and is not described as an OS sandbox.
- Existing-file writes/patches/removals retain SHA-256 conflict protection.
- Symlink escape protection and root-deletion protection remain unchanged.
- No API key, tunnel credential, file content, or command output may be written to tracked configuration or new setup logs.
- Primary ChatGPT connection path is outbound-only Secure MCP Tunnel to local stdio MCP.
- Phase 1 does not add a public relay, public MCP endpoint, database, OAuth server, custom widget, billing, or multi-user tenancy.
- CI must stay green on Node 22 and Node 24.

---

## File structure locked for this implementation

- Create `src/tool-output-schemas.ts`: single source of truth for Zod output schemas used by MCP tool descriptors.
- Modify `src/server.ts`: return `structuredContent` on successful calls, attach explicit `outputSchema` to every tool, and preserve error behavior.
- Modify `tests/http-transport.test.ts`: verify descriptor annotations/output schemas and validate real structured tool output through MCP.
- Create `scripts/setup-chatgpt-tunnel.mjs`: pure argument validation + command/profile generation + optional execution of `tunnel-client init`/`doctor`; never handles secrets directly.
- Create `tests/setup-chatgpt-tunnel.test.ts`: test root validation, generated command, terminal default, and secret non-propagation.
- Modify `package.json`: add tunnel setup/doctor convenience scripts.
- Modify `README.md`: add concise personal-plugin quickstart.
- Modify `docs/CHATGPT_INTEGRATION.md`: replace stale connector wording with current Plugin flow and record Work-vs-Chat acceptance sequence.
- Modify `.github/workflows/ci.yml`: smoke-check the tunnel setup CLI help path in both Node matrices.

---

### Task 1: Add typed MCP output schemas and structured success results

**Files:**
- Create: `src/tool-output-schemas.ts`
- Modify: `src/server.ts`
- Test: `tests/http-transport.test.ts`

**Interfaces:**
- Produces: exported Zod schemas `systemCapabilitiesOutputSchema`, `fsListOutputSchema`, `fsStatOutputSchema`, `fsReadOutputSchema`, `fsWriteOutputSchema`, `fsPatchOutputSchema`, `fsMkdirOutputSchema`, `fsMoveOutputSchema`, `fsRemoveOutputSchema`, `gitResultOutputSchema`, `terminalResultOutputSchema`.
- Produces: `safeCall<T>(fn: () => Promise<T>)` returns both JSON text `content` and `structuredContent: T` on success; on error it returns only text content plus `isError: true` so error payloads are not incorrectly validated against success schemas.
- Consumes: existing service return shapes from `FileSystemService`, `GitService`, `ProcessService`, and runtime config.

- [ ] **Step 1: Write failing MCP descriptor/structured-output assertions**

Extend the real MCP integration test after `client.listTools()`:

```ts
for (const tool of tools) {
  expect(tool.annotations).toMatchObject({
    readOnlyHint: expect.any(Boolean),
    destructiveHint: expect.any(Boolean),
    openWorldHint: expect.any(Boolean),
  });
  expect(tool.outputSchema).toMatchObject({ type: "object" });
}

const result = await client.callTool({
  name: "fs_read",
  arguments: { path: "hello.txt", encoding: "utf8" },
});
expect(result.structuredContent).toMatchObject({
  path: "hello.txt",
  encoding: "utf8",
  content: "hello from mcp\n",
  bytes: 15,
  sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
});
```

Also assert the initial plugin-facing set has exactly the intended core tools and that `terminal_run` remains discoverable but reports disabled through `system_capabilities` in the default fixture.

- [ ] **Step 2: Run the integration test and verify it fails**

Run:

```bash
npm test -- --run tests/http-transport.test.ts
```

Expected: failure because tools currently omit `outputSchema` and successful calls currently omit `structuredContent`.

- [ ] **Step 3: Create exact Zod output schemas**

Create `src/tool-output-schemas.ts` with shared primitives and schemas that match current service outputs, including:

```ts
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pathTypeSchema = z.enum(["directory", "file", "symlink", "other"]);

export const fsReadOutputSchema = z.object({
  path: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema,
});

export const gitResultOutputSchema = z.object({
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});
```

Define the other schemas from the actual service return values. Use `z.record(z.string(), z.unknown())` only for the nested config/limit maps whose exact values are intentionally configuration-driven; do not weaken filesystem/Git result schemas to generic records.

- [ ] **Step 4: Change `safeCall` to return structured success output**

Replace the success path with:

```ts
function successResult<T>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

async function safeCall<T>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(errorPayload(error)), isError: true };
  }
}
```

- [ ] **Step 5: Attach `outputSchema` to every registered tool**

For each `registerTool`, set the matching Zod schema, for example:

```ts
server.registerTool(
  "fs_read",
  {
    description: "Read a regular file and return its content plus SHA-256. Use that hash for later modifications.",
    inputSchema: z.object({ path: z.string(), encoding: z.enum(["utf8", "base64"]).default("utf8") }),
    outputSchema: fsReadOutputSchema,
    annotations: readAnnotations,
  },
  async ({ path, encoding }) => safeCall(() => runtime.fs.read(path, encoding)),
);
```

Use the same `gitResultOutputSchema` for `git_status`, `git_diff`, and `git_log`.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
npm test -- --run tests/http-transport.test.ts
npm run check
```

Expected: all tests pass and TypeScript accepts every structured result against its declared schema.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/tool-output-schemas.ts src/server.ts tests/http-transport.test.ts
git commit -m "feat: add structured MCP tool outputs"
```

---

### Task 2: Add a safe Secure MCP Tunnel setup helper

**Files:**
- Create: `scripts/setup-chatgpt-tunnel.mjs`
- Create: `tests/setup-chatgpt-tunnel.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: exported pure function `buildTunnelSetup(argv, env, context)` returning `{ profile, root, tunnelId, mcpCommand, initArgs, doctorArgs, runArgs }` without reading or returning an API-key value.
- Produces CLI flags: `--root <absolute-path>`, `--tunnel-id <tunnel_id>`, optional `--profile <name>`, optional `--enable-terminal`, repeated `--allow-command <basename>`, `--doctor`, `--run`, and `--help`.
- Default profile: `chatgpt-system`.
- Default behavior: print the exact non-secret `tunnel-client init` and doctor commands; execute only when `--doctor` or `--run` is explicitly requested after profile initialization.

- [ ] **Step 1: Write failing unit tests for argument safety**

Test these exact cases:

```ts
it("requires an explicit absolute root", () => {
  expect(() => buildTunnelSetup(["--tunnel-id", VALID_TUNNEL], {}, context)).toThrow(/--root/);
  expect(() => buildTunnelSetup(["--root", ".", "--tunnel-id", VALID_TUNNEL], {}, context)).toThrow(/absolute/);
});

it("keeps terminal disabled by default", () => {
  const setup = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], {}, context);
  expect(setup.mcpCommand).not.toContain("--enable-terminal");
});

it("does not copy the control plane key into generated values", () => {
  const secret = "sk-test-do-not-print";
  const setup = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], { CONTROL_PLANE_API_KEY: secret }, context);
  expect(JSON.stringify(setup)).not.toContain(secret);
});
```

Also test rejection of `/`, rejection of a home-directory root when `context.homeDir === root`, command allowlist flags without `--enable-terminal`, malformed tunnel IDs, and non-basename `--allow-command /usr/bin/node`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- --run tests/setup-chatgpt-tunnel.test.ts
```

Expected: module/function does not exist.

- [ ] **Step 3: Implement pure parser/generator first**

The generated MCP command must be equivalent to:

```text
node /absolute/repo/dist/cli.js stdio --root /absolute/project
```

and only append:

```text
--enable-terminal --allow-command git --allow-command node
```

when terminal was explicitly enabled and commands were explicitly supplied.

Build `initArgs` as an argv array, not a shell string:

```js
[
  "init",
  "--sample", "sample_mcp_stdio_local",
  "--profile", profile,
  "--tunnel-id", tunnelId,
  "--mcp-command", mcpCommand,
]
```

Validate tunnel IDs with `^tunnel_[A-Za-z0-9_-]{8,}$` so obviously malformed values fail locally without pretending to validate OpenAI ownership.

- [ ] **Step 4: Add execution mode with `spawnSync` and inherited environment**

When execution is requested, invoke `tunnel-client` with `shell: false`, `stdio: "inherit"`, and `env: process.env`. Do not log or inspect `CONTROL_PLANE_API_KEY`.

Before `init`, verify:

- `dist/cli.js` exists;
- `tunnel-client --version` or `tunnel-client help quickstart` exits successfully;
- root exists and is a directory.

On `--doctor`, run exactly:

```text
tunnel-client doctor --profile <profile> --explain
```

On `--run`, require doctor success in the same invocation before running:

```text
tunnel-client run --profile <profile>
```

- [ ] **Step 5: Add package scripts**

Add:

```json
"setup:chatgpt": "npm run build && node scripts/setup-chatgpt-tunnel.mjs",
"doctor:chatgpt": "node scripts/setup-chatgpt-tunnel.mjs --doctor"
```

Do not add credentials or root defaults to `package.json`.

- [ ] **Step 6: Run focused and full tests**

```bash
npm test -- --run tests/setup-chatgpt-tunnel.test.ts
npm run check
```

Expected: all pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add scripts/setup-chatgpt-tunnel.mjs tests/setup-chatgpt-tunnel.test.ts package.json
git commit -m "feat: add Secure MCP Tunnel setup helper"
```

---

### Task 3: Make plugin metadata security assertions explicit

**Files:**
- Modify: `tests/http-transport.test.ts`
- Modify: `src/server.ts` only if an annotation is proven inaccurate by the test/review.

**Interfaces:**
- Consumes MCP `tools/list` descriptors from the real server.
- Produces a regression test that treats missing or incorrect plugin-facing safety hints as a CI failure.

- [ ] **Step 1: Add an explicit expected-annotation table**

Use a literal table so future tool additions cannot silently inherit unsafe assumptions:

```ts
const expectedAnnotations = {
  system_capabilities: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_list: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_stat: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  fs_write: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_apply_patch: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_mkdir: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  fs_move: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  fs_remove: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  git_status: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_diff: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  git_log: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  terminal_run: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
} as const;
```

Assert every discovered tool is present in this table and every table entry is discovered. This intentionally forces review when tool surface changes.

- [ ] **Step 2: Run test and inspect any mismatch instead of weakening expectations**

```bash
npm test -- --run tests/http-transport.test.ts
```

Expected: pass if current annotations remain truthful; if not, inspect actual service side effects before editing source.

- [ ] **Step 3: Add default terminal capability assertion**

Call `system_capabilities` over the real MCP client and assert:

```ts
expect(result.structuredContent).toMatchObject({
  terminal: { enabled: false },
  safety: { terminalOsSandboxed: false },
});
```

- [ ] **Step 4: Run full check and commit**

```bash
npm run check
git add tests/http-transport.test.ts src/server.ts
git commit -m "test: lock plugin safety metadata"
```

---

### Task 4: Update the operator runbook for current ChatGPT Plugins

**Files:**
- Modify: `docs/CHATGPT_INTEGRATION.md`
- Modify: `README.md`

**Interfaces:**
- Produces exact operator path for `npm run setup:chatgpt`, `tunnel-client doctor`, ChatGPT Plugins creation, Work acceptance, and normal Chat acceptance.
- Documents OpenAI product boundary: Work is documented by OpenAI Quickstart; normal Chat must be tested on the real account and not claimed in advance.

- [ ] **Step 1: Rewrite the quickstart around current Plugin terminology**

README quickstart must use this order:

```bash
npm install
npm run check
npm run setup:chatgpt -- \
  --root /absolute/path/to/project \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx
```

Then explain that the operator must have `CONTROL_PLANE_API_KEY` in the environment used by `tunnel-client`, without printing a sample real-looking secret value.

- [ ] **Step 2: Add exact ChatGPT UI sequence**

Document:

1. Settings → Security and login → Developer mode ON.
2. Plugins → `+`.
3. Connection → Tunnel.
4. Select/paste the configured tunnel.
5. Scan tools and verify the intended tool list.
6. Install the personal plugin.
7. Test `@chatgpt-system` in Work first.
8. Test normal Chat separately.

- [ ] **Step 3: Add disposable acceptance fixture instructions**

Use a small temporary Git repository, never the user's full home directory, for the first mutation test. The documented sequence is:

```text
system_capabilities -> fs_list -> fs_read -> fs_apply_patch -> stale hash conflict -> git_diff -> path escape rejection
```

Record `terminal_run` as disabled for this acceptance test.

- [ ] **Step 4: Document the Phase 2 trigger clearly**

State that public plugin/cloud relay work begins only if normal Chat does not expose/permit the personal plugin or the product blocks required write capability. Do not present fallback infrastructure as already required.

- [ ] **Step 5: Review docs for stale claims and commit**

Search the two files for obsolete phrases such as `custom app`, `connector`, or plan-specific claims that conflict with the current Plugin docs; retain terminology only when referring to historical/API compatibility behavior.

```bash
git add README.md docs/CHATGPT_INTEGRATION.md
git commit -m "docs: add personal ChatGPT plugin runbook"
```

---

### Task 5: Extend CI and perform repository-side release readiness verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: all existing and new tests

**Interfaces:**
- Produces CI guarantee that the setup script at least parses/prints help on both supported Node versions without requiring a real tunnel credential.

- [ ] **Step 1: Add a no-network setup CLI smoke step**

After build/test in both Node matrix jobs, run:

```yaml
- name: Validate ChatGPT tunnel setup CLI
  run: node scripts/setup-chatgpt-tunnel.mjs --help
```

The help path must not require `tunnel-client`, root paths, tunnel IDs, or credentials.

- [ ] **Step 2: Run repository checks locally where available**

```bash
npm run check
node scripts/setup-chatgpt-tunnel.mjs --help
```

Expected: both succeed.

- [ ] **Step 3: Commit CI change**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: validate ChatGPT tunnel setup"
```

- [ ] **Step 4: Open PR and require green Node 22 + Node 24 jobs**

PR title:

```text
feat: add personal ChatGPT plugin tunnel path
```

PR body must explicitly state that ChatGPT Work/normal Chat product acceptance remains a manual post-CI test because repository CI cannot simulate the user's ChatGPT account or Platform tunnel association.

- [ ] **Step 5: Do not merge until CI is green and diff is reviewed**

Review changed files for secret material, overly broad permissions, weakened path policy, or accidental terminal enablement. Merge only after both Node jobs pass.

---

### Task 6: Real-account acceptance checkpoint after merge-ready code exists

**Files:**
- No code file required unless the acceptance test finds a product/API incompatibility.
- Record findings in `docs/CHATGPT_INTEGRATION.md` only after the behavior is actually observed.

**Interfaces:**
- Consumes: the user's real ChatGPT Developer Mode, personal Platform organization/tunnel permissions, `tunnel-client`, and a disposable local test root.
- Produces: one of two factual outcomes: `normal Chat personal plugin = supported` or `normal Chat personal plugin = not supported/blocked`, with the observed failure mode.

- [ ] **Step 1: Operator creates/associates the tunnel in OpenAI Platform**

Use the personal Platform organization belonging to the same account and associate the tunnel with the target ChatGPT workspace/account as the current OpenAI tunnel guide requires.

- [ ] **Step 2: Run setup and doctor on the Mac**

```bash
npm run setup:chatgpt -- \
  --root /absolute/path/to/disposable-fixture \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxx \
  --doctor
```

Expected: `tunnel-client doctor --profile chatgpt-system --explain` succeeds before any ChatGPT tool call is attempted.

- [ ] **Step 3: Run tunnel client and perform Work smoke test**

```bash
tunnel-client run --profile chatgpt-system
```

In ChatGPT Work, invoke the personal plugin explicitly and run the read-first smoke sequence. Do not enable terminal.

- [ ] **Step 4: Perform normal Chat test**

Open a normal Chat conversation and attempt explicit plugin invocation. If available, repeat the read-only checks before one guarded disposable-file write.

- [ ] **Step 5: Branch on the observed result**

If normal Chat works, update the integration doc with the confirmed surface and stop Phase 2 work. If it does not, record the exact product limitation/error and begin a new Phase 2 design for a submission-ready public Plugin + cloud gateway + private device relay; do not improvise that architecture inside this Phase 1 branch.

---

## Self-review results

- Spec coverage: every Phase 1 requirement maps to Tasks 1–6; Phase 2 remains explicitly deferred.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step remains.
- Type consistency: tool output schemas are named once in Task 1 and consumed by `src/server.ts`; tunnel helper interface is defined once in Task 2 and used by its tests/docs.
- Scope check: no public hosting, OAuth, custom UI, database, or relay work leaked into Phase 1.
