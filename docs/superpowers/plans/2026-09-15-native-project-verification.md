# Native Project Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `project_check` so pure SwiftPM/macOS projects can produce freshness-bound local verification evidence through fixed native host checks that require explicit Admin authority, while preserving the existing Node/Docker verification and typed publication contracts.

**Architecture:** Add an explicit execution lane to every detected check. Existing Node checks stay on `project-sandbox`; pure SwiftPM repositories detect fixed `swift test --quiet` and `swift build` checks on `admin-host`. `project_check run` dispatches only detected checks, requires an Admin lease before any `admin-host` execution, persists the same digest-only evidence, and leaves `ProjectPublishGate` unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, MCP HTTP test harness, existing `ProjectExecService`, existing Admin `ProcessService`, Git-backed freshness observation.

**Spec:** `docs/superpowers/specs/2026-09-15-native-project-verification-design.md`

## Global Constraints

- Do not modify the active dirty `feat/computer-use-perception-reliability` worktree.
- Do not weaken clean-branch, exact-resume, freshness, or dual-authority publication rules.
- Do not accept caller-supplied verification command/args/cwd overrides.
- Existing Node checks remain on the Docker Project Exec lane and never fall back to host execution.
- Native host verification requires an explicit active Admin lease and remains `shell=false`, allowlisted, Project-root-confined, bounded, and audited.
- Keep one `ProjectCheckService` evidence store; do not add manual PASS import or a second verification database.
- Persist only output digests/byte counts, never raw verification stdout/stderr.
- Pure SwiftPM detection uses only the repository-root regular non-symlink `Package.swift`.
- SwiftPM check order is exactly `swiftpm:test`, then `swiftpm:build`.
- Fixed native commands are exactly `swift test --quiet` and `swift build`.
- Do not install/restart the live daily-driver runtime from this isolated branch while another runtime feature worktree is dirty; live MacAgent acceptance happens only after safe integration/reconciliation of the runtime line.

---

### Task 1: Add the execution-lane contract without changing behavior

**Files:**
- Modify: `src/project-check-types.ts`
- Modify: `src/project-check-service.ts`
- Modify: `src/tool-output-schemas.ts`
- Test: `tests/project-check-mcp.test.ts`

**Interfaces:**
- Produces: `ProjectCheckExecutionLane = "project-sandbox" | "admin-host"`.
- Produces: required `DetectedProjectCheck.execution: ProjectCheckExecutionLane`.
- Produces: backward-compatible `StoredProjectCheckEvidence.execution?: ProjectCheckExecutionLane`.
- Existing Node detection continues to return the same IDs/commands/order with `execution: "project-sandbox"`.

- [ ] **Step 1: Extend the existing Node detection assertion and local test type with the lane**

In `tests/project-check-mcp.test.ts`, change the existing detected check expectation to require the sandbox lane:

```ts
expect(detectedBody.checks[0]).toMatchObject({
  checkId: "package-script:check",
  kind: "check",
  command: "npm",
  args: ["run", "check"],
  source: "package.json#scripts.check",
  execution: "project-sandbox",
  status: "NOT_RUN",
});
```

Extend the local `ProjectCheckView` test type so both detected checks and evidence expose the new field:

```ts
execution: "project-sandbox" | "admin-host";
```

Use an optional evidence field to represent old stores:

```ts
execution?: "project-sandbox" | "admin-host";
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts
```

Expected: FAIL because detected checks do not yet contain `execution` and/or output-schema typing does not include it.

- [ ] **Step 3: Add the execution-lane types**

In `src/project-check-types.ts`, add:

```ts
export type ProjectCheckExecutionLane = "project-sandbox" | "admin-host";

export interface DetectedProjectCheck {
  checkId: string;
  kind: ProjectCheckKind;
  command: string;
  args: string[];
  cwd: string;
  source: string;
  execution: ProjectCheckExecutionLane;
}

export interface StoredProjectCheckEvidence extends Omit<DetectedProjectCheck, "execution"> {
  execution?: ProjectCheckExecutionLane;
  baseStatus: ProjectCheckBaseStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  head: string;
  workingTreeDigest: string;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutBytes: number;
  stderrBytes: number;
  stateChangedDuringRun: boolean;
}
```

The optional persisted field is only for reading version-1 evidence written before this feature. Every new evidence record still receives the lane by spreading the detected check.

- [ ] **Step 4: Mark all existing Node checks as `project-sandbox`**

In `src/project-check-service.ts`, update the existing package-script check builder:

```ts
function check(kind: ProjectCheckKind, manager: string, script: string): DetectedProjectCheck {
  const invocation = commandForManager(manager, script);
  return {
    checkId: `package-script:${script}`,
    kind,
    command: invocation.command,
    args: invocation.args,
    cwd: ".",
    source: `package.json#scripts.${script}`,
    execution: "project-sandbox",
  };
}
```

Update `validEvidence` to accept only an absent legacy lane or one of the two known values:

```ts
&& (evidence.execution === undefined
  || evidence.execution === "project-sandbox"
  || evidence.execution === "admin-host")
```

Do not change store version or freshness rules.

- [ ] **Step 5: Update the output schema while keeping old evidence readable**

In `src/tool-output-schemas.ts`, split the common check fields from the lane:

```ts
const projectCheckExecutionSchema = z.enum(["project-sandbox", "admin-host"]);
const projectCheckCommonFields = {
  checkId: z.string(),
  kind: projectCheckKindSchema,
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  source: z.string(),
};
const projectCheckDetectedFields = {
  ...projectCheckCommonFields,
  execution: projectCheckExecutionSchema,
};
const projectCheckEvidenceSchema = z.object({
  ...projectCheckCommonFields,
  execution: projectCheckExecutionSchema.optional(),
  baseStatus: z.enum(["PASS", "FAIL", "UNAVAILABLE"]),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: nonNegativeInt,
  exitCode: z.number().int().nullable(),
  head: z.string().regex(/^[a-f0-9]{40,64}$/i),
  workingTreeDigest: sha256Schema,
  stdoutSha256: sha256Schema,
  stderrSha256: sha256Schema,
  stdoutBytes: nonNegativeInt,
  stderrBytes: nonNegativeInt,
  stateChangedDuringRun: z.boolean(),
}).strict();
```

Keep `projectCheckItemSchema` based on `projectCheckDetectedFields`, so current detection/report output always states the lane even when attached legacy evidence did not store it.

- [ ] **Step 6: Run focused regression and build**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts
npm run build
```

Expected: project-check tests PASS and TypeScript build exits 0. Existing Node execution still uses only `ProjectExecService`.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/project-check-types.ts src/project-check-service.ts src/tool-output-schemas.ts tests/project-check-mcp.test.ts
git commit -m "feat: classify project verification execution lanes"
```

---

### Task 2: Detect SwiftPM checks and fail closed before any host execution exists

**Files:**
- Modify: `src/project-check-service.ts`
- Modify: `tests/project-check-mcp.test.ts`

**Interfaces:**
- Consumes: `DetectedProjectCheck.execution` from Task 1.
- Produces: deterministic SwiftPM checks:
  - `swiftpm:test` → `swift test --quiet` → `admin-host`.
  - `swiftpm:build` → `swift build` → `admin-host`.
- Produces: `ProjectCheckService.run(..., hostExecutor?)` contract that refuses `admin-host` checks when no executor was explicitly supplied.

- [ ] **Step 1: Generalize the project-check fixture to create Node, SwiftPM, and mixed repositories**

In `tests/project-check-mcp.test.ts`, make the fixture accept:

```ts
type FixtureKind = "node" | "swiftpm" | "mixed";

async function fixture(projectExecEnabled = true, kind: FixtureKind = "node") {
```

Before the initial Git commit, write `package.json` only for `node`/`mixed` and write a regular root `Package.swift` for `swiftpm`/`mixed`:

```ts
if (kind === "swiftpm" || kind === "mixed") {
  await writeFile(
    path.join(root, "Package.swift"),
    "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"Fixture\")\n",
    "utf8",
  );
}
```

Keep the repository committed before Project authority starts.

- [ ] **Step 2: Add RED detection/precedence tests**

Add tests that assert a pure SwiftPM fixture detects exactly:

```ts
expect(detectedBody.checks).toEqual([
  expect.objectContaining({
    checkId: "swiftpm:test",
    kind: "test",
    command: "swift",
    args: ["test", "--quiet"],
    source: "Package.swift",
    execution: "admin-host",
    status: "NOT_RUN",
  }),
  expect.objectContaining({
    checkId: "swiftpm:build",
    kind: "build",
    command: "swift",
    args: ["build"],
    source: "Package.swift",
    execution: "admin-host",
    status: "NOT_RUN",
  }),
]);
```

Add a mixed fixture assertion that the existing Node aggregate `package-script:check` remains the only detected check.

Add a symlink guard test by replacing `Package.swift` with a symlink to a regular file before detection and asserting `checks` is empty / `overallStatus === "UNAVAILABLE"`.

- [ ] **Step 3: Add a RED run-without-host test**

On a pure SwiftPM fixture, call `project_check run` with only the Project lease. Assert:

```ts
expect(run.isError).toBe(true);
expect(resultText(run)).toContain("AUTHORITY_DENIED");
expect(backend.requests).toHaveLength(0);
```

This is the safety gate: adding SwiftPM detection must never send `swift` into the Docker backend.

- [ ] **Step 4: Run the new focused tests and verify RED**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts
```

Expected: SwiftPM detection assertions fail because the detector currently returns no checks.

- [ ] **Step 5: Split Node detection and add SwiftPM fallback detection**

In `src/project-check-service.ts`, preserve malformed-JSON behavior and rewrite detection into explicit helpers:

```ts
private async detectNodeChecks(repositoryRoot: string): Promise<DetectedProjectCheck[]> {
  const packagePath = path.join(repositoryRoot, "package.json");
  const packageText = await readRegularText(packagePath, MAX_PACKAGE_BYTES);
  if (packageText === null) return [];

  let packageJson: PackageJsonShape;
  try {
    const parsed: unknown = JSON.parse(packageText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    packageJson = parsed as PackageJsonShape;
  } catch {
    throw new PolicyError("Project verification package.json is invalid JSON.");
  }
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  const manager = await detectPackageManager(repositoryRoot, packageJson);
  if (scriptValue(scripts, "check")) return [check("check", manager, "check")];

  const result: DetectedProjectCheck[] = [];
  if (scriptValue(scripts, "typecheck")) result.push(check("typecheck", manager, "typecheck"));
  else if (scriptValue(scripts, "type-check")) result.push(check("typecheck", manager, "type-check"));
  if (scriptValue(scripts, "lint")) result.push(check("lint", manager, "lint"));
  if (scriptValue(scripts, "test")) result.push(check("test", manager, "test"));
  if (scriptValue(scripts, "build")) result.push(check("build", manager, "build"));
  return result.slice(0, MAX_CHECKS);
}

private async detectSwiftPMChecks(repositoryRoot: string): Promise<DetectedProjectCheck[]> {
  if (!(await regularFileExists(path.join(repositoryRoot, "Package.swift")))) return [];
  return [
    {
      checkId: "swiftpm:test",
      kind: "test",
      command: "swift",
      args: ["test", "--quiet"],
      cwd: ".",
      source: "Package.swift",
      execution: "admin-host",
    },
    {
      checkId: "swiftpm:build",
      kind: "build",
      command: "swift",
      args: ["build"],
      cwd: ".",
      source: "Package.swift",
      execution: "admin-host",
    },
  ];
}

private async detectChecks(observation: RepositoryStateObservation): Promise<DetectedProjectCheck[]> {
  const nodeChecks = await this.detectNodeChecks(observation.repositoryRoot);
  if (nodeChecks.length > 0) return nodeChecks.slice(0, MAX_CHECKS);
  return (await this.detectSwiftPMChecks(observation.repositoryRoot)).slice(0, MAX_CHECKS);
}
```

Do not catch invalid existing `package.json`; it must continue throwing `PolicyError` rather than silently falling through to SwiftPM.

- [ ] **Step 6: Introduce the executor interface and fail-closed run signature**

In `src/project-check-types.ts`, add a common executor shape:

```ts
export interface ProjectCheckCommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProjectCheckExecutor {
  run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProjectCheckCommandResult>;
}

export type ProjectCheckExecutorFactory = (repositoryRoot: string) => ProjectCheckExecutor;
```

Change the `ProjectCheckService` constructor’s sandbox executor type from concrete `ProjectExecService` to `ProjectCheckExecutor`; `ProjectExecService` is structurally compatible.

Extend `run`:

```ts
async run(
  cwdInput = ".",
  checkIds?: string[],
  timeoutMs?: number,
  hostExecutorFactory?: ProjectCheckExecutorFactory,
): Promise<ProjectCheckView> {
```

After resolving `requested` checks and before entering the audit/execution loop:

```ts
const requiresHost = requested.some((item) => item.execution === "admin-host");
if (requiresHost && hostExecutorFactory === undefined) {
  throw new AuthorityDeniedError("Native project verification requires an active Admin authority lease.");
}
const hostExecutor = requiresHost
  ? hostExecutorFactory!(initial.repositoryRoot)
  : undefined;
```

Inside the loop, select the executor explicitly:

```ts
const executor = detectedCheck.execution === "admin-host"
  ? hostExecutor!
  : this.projectExec;
```

There is no fallback between lanes.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts
npm run build
```

Expected: SwiftPM detection and no-Admin fail-closed tests PASS; Node tests stay green; Docker backend receives zero SwiftPM requests.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/project-check-types.ts src/project-check-service.ts tests/project-check-mcp.test.ts
git commit -m "feat: detect swiftpm project checks"
```

---

### Task 3: Add explicit Admin host execution and deterministic MCP wiring

**Files:**
- Create: `src/project-check-host-executor.ts`
- Modify: `src/project-check-factory.ts`
- Modify: `src/project-check-tool-registration.ts`
- Modify: `src/server.ts`
- Modify: `tests/project-check-mcp.test.ts`
- Create: `tests/project-check-host-executor.test.ts`

**Interfaces:**
- Consumes: `ProjectCheckExecutor` and `admin-host` lane from Tasks 1-2.
- Consumes: `ProjectCheckExecutorFactory = (repositoryRoot: string) => ProjectCheckExecutor` from Task 2.
- Produces: `ProjectCheckHostExecutorFactory = (authority: AuthorityContext, repositoryRoot: string) => ProjectCheckExecutor` for deterministic runtime injection.
- Produces: `createAdminHostProjectCheckExecutor(authority, repositoryRoot, audit, config)`.
- Produces: `createProjectCheckHostExecutorFactory(runtime, adminAuthorityLeaseId)` which rejects non-Admin leases and binds execution to the canonical Project repository root supplied by `ProjectCheckService`.
- Extends only `project_check run` input with optional `adminAuthorityLeaseId`; detect/report schemas remain unchanged.

- [ ] **Step 1: Add a deterministic fake host executor to the MCP fixture and RED Admin tests**

In `tests/project-check-mcp.test.ts`, add:

```ts
class HostVerificationExecutor implements ProjectCheckExecutor {
  readonly requests: Array<{ command: string; args: string[]; cwd: string; timeoutMs: number }> = [];
  mode: "pass" | "fail" | "mutate" | "unavailable" = "pass";

  constructor(private readonly projectRoot: string) {}

  async run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProjectCheckCommandResult> {
    this.requests.push({ command, args: [...args], cwd, timeoutMs });
    if (this.mode === "unavailable") throw new ExecutableNotFoundError(command);
    if (this.mode === "mutate") {
      await writeFile(path.join(this.projectRoot, "during-native-check.txt"), "changed\n", "utf8");
    }
    return {
      command,
      args: [...args],
      cwd,
      exitCode: this.mode === "fail" ? 2 : 0,
      signal: null,
      stdout: "TOKEN=native-secret\nnative output\n",
      stderr: this.mode === "fail" ? "password=native-error\n" : "",
      timedOut: false,
    };
  }
}
```

Construct and return one host executor per fixture, then inject it through runtime options so the test never launches real Swift:

```ts
const host = new HostVerificationExecutor(root);
const boundRoots: string[] = [];
const runtime = createRuntimeServices(config, {
  taskStateRoot,
  projectExecBackend: backend,
  projectCheckHostExecutorFactory: (_authority, repositoryRoot) => {
    boundRoots.push(repositoryRoot);
    return host;
  },
});
// include `host` and `boundRoots` in the fixture return value
```

Add three assertions:

1. SwiftPM run without `adminAuthorityLeaseId` → `AUTHORITY_DENIED`, zero host requests.
2. Passing the Project lease in `adminAuthorityLeaseId` → `AUTHORITY_DENIED`, zero host requests.
3. A real Admin lease plus injected host executor → overall `PASS`, exactly two fixed requests in test/build order, Docker backend requests remain zero.

For the valid Admin call:

```ts
const run = await client.callTool({
  name: "project_check",
  arguments: {
    authorityLeaseId: projectLeaseId,
    adminAuthorityLeaseId: adminLeaseId,
    operation: "run",
    cwd: root,
    timeoutMs: 1500,
  },
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts
```

Expected: the tool schema rejects `adminAuthorityLeaseId` and/or the runtime has no host-executor factory plumbing.

- [ ] **Step 3: Implement the real Admin host executor**

Create `src/project-check-host-executor.ts` with the explicit Admin-scoped process adapter:

```ts
import path from "node:path";
import type { AuthorityContext } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { CommandNotAllowedError } from "./errors.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import type { ProjectCheckExecutor } from "./project-check-types.js";

export type ProjectCheckHostExecutorFactory = (
  authority: AuthorityContext,
  repositoryRoot: string,
) => ProjectCheckExecutor;

export function createAdminHostProjectCheckExecutor(
  authority: AuthorityContext,
  repositoryRoot: string,
  audit: AuditLogger,
  baseConfig: AppConfig,
): ProjectCheckExecutor {
  const policy = new PathPolicy([repositoryRoot]);
  const terminal = {
    enabled: authority.terminalEnabled,
    commands: [...authority.commands],
  };

  return {
    async run(command, args, cwd, timeoutMs) {
      if (!terminal.enabled || command !== path.basename(command) || !terminal.commands.includes(command)) {
        throw new CommandNotAllowedError(command, terminal.commands);
      }
      const scopedConfig: AppConfig = {
        ...baseConfig,
        roots: [repositoryRoot],
        terminal,
        limits: { ...baseConfig.limits, commandTimeoutMs: timeoutMs },
      };
      return new ProcessService(policy, audit, scopedConfig).run(command, args, cwd);
    },
  };
}
```

This deliberately reuses `ProcessService` for `shell=false`, executable resolution, sanitized environment, audit, output bound, and timeout behavior.

- [ ] **Step 4: Add the factory-level Admin authority check and test injection hook**

In `src/project-check-factory.ts`, extend `ProjectCheckRuntimeDependencies`:

```ts
projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
```

Add:

```ts
export function createProjectCheckHostExecutorFactory(
  runtime: ProjectCheckRuntimeDependencies,
  adminAuthorityLeaseId: string,
): ProjectCheckExecutorFactory {
  const authority = runtime.authority.resolve(adminAuthorityLeaseId);
  if (authority.profile !== "admin") {
    throw new AuthorityDeniedError("Native project verification requires an active Admin authority lease.");
  }
  return (repositoryRoot) => runtime.projectCheckHostExecutorFactory?.(authority, repositoryRoot)
    ?? createAdminHostProjectCheckExecutor(authority, repositoryRoot, runtime.audit, runtime.config);
}
```

The injected factory exists only to make the authority/tool integration deterministic in tests; production defaults to the real ProcessService adapter.

- [ ] **Step 5: Thread the optional host factory through runtime construction**

In `src/server.ts`, add to both `RuntimeServices` and `RuntimeOptions`:

```ts
projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
```

Return:

```ts
projectCheckHostExecutorFactory: options.projectCheckHostExecutorFactory,
```

Import the factory type from `project-check-host-executor.ts`.

- [ ] **Step 6: Extend only the `run` tool input and dispatch the host executor**

In `src/project-check-tool-registration.ts`, change the run schema to:

```ts
z.object({
  ...baseFields,
  operation: z.literal("run"),
  adminAuthorityLeaseId: z.string().min(40).optional(),
  checkIds: z.array(z.string().min(1).max(256)).min(1).max(32).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
}).strict()
```

Keep detect/report without that field. On run:

```ts
const hostExecutorFactory = input.adminAuthorityLeaseId === undefined
  ? undefined
  : createProjectCheckHostExecutorFactory(runtime, input.adminAuthorityLeaseId);
return service.run(input.cwd, input.checkIds, input.timeoutMs, hostExecutorFactory);
```

Update the tool description to say detected checks may execute in the Project sandbox or, for explicitly native checks, through an Admin-authorized host lane.

- [ ] **Step 7: Add focused real-adapter policy tests**

Create `tests/project-check-host-executor.test.ts` using a manually constructed Admin `AuthorityContext` whose natural root is `/`, plus a separate temporary Project repository root passed to `createAdminHostProjectCheckExecutor`.

Test that a context whose commands omit `swift` rejects:

```ts
await expect(executor.run("swift", ["build"], root, 1000)).rejects.toMatchObject({
  code: "COMMAND_NOT_ALLOWED",
});
```

Test Project-root confinement by keeping `authority.roots` as `[path.parse(root).root]`, constructing the executor with the narrower `repositoryRoot: root`, then passing a sibling cwd outside `root`; assert `POLICY_DENIED` before process launch. This proves Admin's `/` authority does not become the verification filesystem scope.

Do not execute a real `swift build` in this unit test.

- [ ] **Step 8: Run focused suites and build**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts tests/project-check-host-executor.test.ts
npm run build
```

Expected: valid Admin SwiftPM run passes through the injected host executor; wrong/missing authority fails before execution; adapter policy tests pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/project-check-host-executor.ts src/project-check-factory.ts src/project-check-tool-registration.ts src/server.ts tests/project-check-mcp.test.ts tests/project-check-host-executor.test.ts
git commit -m "feat: authorize native project verification"
```

---

### Task 4: Harden host failure mapping, freshness, privacy, and legacy evidence

**Files:**
- Modify: `src/project-check-service.ts`
- Modify: `tests/project-check-mcp.test.ts`

**Interfaces:**
- Host `EXECUTABLE_NOT_FOUND` / `COMMAND_NOT_ALLOWED` → check `UNAVAILABLE`.
- Host timeout → check `FAIL`.
- Non-zero host exit → `FAIL`.
- Repository mutation during either host check → `STALE`.
- Raw host stdout/stderr never appears in persisted verification evidence.
- Legacy evidence without `execution` remains loadable.

- [ ] **Step 1: Add RED host failure/freshness/privacy tests**

Extend the SwiftPM MCP fixture tests to cover:

```ts
host.mode = "fail";
// run -> overallStatus === "FAIL"
```

```ts
host.mode = "unavailable";
// run -> overallStatus === "UNAVAILABLE"
```

```ts
host.mode = "mutate";
// run -> overallStatus === "STALE"
// first stored evidence has stateChangedDuringRun === true
```

After a successful run, read the verification store exactly as the existing Node privacy test does and assert it does not contain:

```text
native-secret
native output
native-error
```

Also assert evidence generated now records `execution: "admin-host"`.

- [ ] **Step 2: Add a RED no-fallback test for Node/Docker unavailability**

Extend `VerificationBackend` with an unavailable mode that throws `SandboxUnavailableError("docker_unavailable")`.

On a Node fixture, even if a valid `adminAuthorityLeaseId` is supplied, assert:

```ts
expect(body.overallStatus).toBe("UNAVAILABLE");
expect(host.requests).toHaveLength(0);
```

This locks the rule that Admin authority does not create a generic Docker→host escape hatch.

- [ ] **Step 3: Add a backward-compatible evidence-store test**

After a normal Node PASS creates `latest.json`, remove the `execution` field from its persisted evidence entry and write the file back. Then call `project_check report` and assert:

```ts
expect(report.isError).not.toBe(true);
expect(reportBody.checks[0]?.execution).toBe("project-sandbox");
expect(reportBody.checks[0]?.evidence?.execution).toBeUndefined();
expect(reportBody.overallStatus).toBe("PASS");
```

This proves version-1 evidence remains readable without pretending it contained the new field.

- [ ] **Step 4: Run focused tests and verify RED where mapping is incomplete**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts
```

Expected: any unmapped host errors or legacy-evidence schema mismatch fail here.

- [ ] **Step 5: Keep error classification narrow**

In `src/project-check-service.ts`, keep the existing categorical helper based on explicit AppError codes only:

```ts
function unavailableError(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  return [
    "PROJECT_EXEC_DISABLED",
    "SANDBOX_UNAVAILABLE",
    "COMMAND_NOT_ALLOWED",
    "EXECUTABLE_NOT_FOUND",
  ].includes(error.code);
}
```

Do not classify general `POLICY_DENIED` as unavailable. The host adapter from Task 3 is responsible for translating command allowlist absence into the specific `COMMAND_NOT_ALLOWED` code before `ProcessService` runs.

Keep timeout classification:

```ts
function failedExecutionError(error: unknown): boolean {
  return error instanceof AppError && error.code === "COMMAND_TIMEOUT";
}
```

Do not catch unrelated exceptions as PASS/FAIL; unexpected faults remain tool errors.

- [ ] **Step 6: Verify evidence generation remains executor-neutral**

Keep one `evidence(...)` function and make its result parameter the shared `ProjectCheckCommandResult` type rather than `ProjectExecResult`:

```ts
private evidence(
  detected: DetectedProjectCheck,
  before: RepositoryStateObservation,
  after: RepositoryStateObservation,
  startedAt: string,
  startedMs: number,
  result: ProjectCheckCommandResult | undefined,
  baseStatus: ProjectCheckBaseStatus,
): StoredProjectCheckEvidence
```

Because it spreads `detected`, every newly written host/sandbox record persists the lane while still hashing raw output exactly once.

- [ ] **Step 7: Run project-check, publish-gate, and build regressions**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts tests/project-publish-gate.test.ts
npm run build
```

Expected: all PASS. `ProjectPublishGate` source remains unchanged.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/project-check-service.ts tests/project-check-mcp.test.ts
git commit -m "test: harden native verification evidence"
```

---

### Task 5: Prove publication integration without changing the publish gate

**Files:**
- Modify: `tests/project-publish-mcp.test.ts`
- Verify unchanged: `src/project-publish-gate.ts`

**Interfaces:**
- Consumes: fresh native `project_check` evidence from Tasks 1-4.
- Produces: an MCP-level proof that a resumed SwiftPM project with Admin-authorized native PASS reaches the existing final remote-policy boundary without `LOCAL_VERIFICATION_*` denial.

- [ ] **Step 1: Add a SwiftPM publish fixture with an injected host executor**

In `tests/project-publish-mcp.test.ts`, add a separate fixture rather than weakening the existing Node fixture.

Create the project with root `Package.swift`, `README.md`, a non-main `feat/native-verify` branch, and the same credential-free-invalid local remote used to prove the final Git boundary.

Enable terminal/Admin capability in config and inject a passing `ProjectCheckHostExecutorFactory` whose executor records requests but returns exit code 0 without launching Swift.

- [ ] **Step 2: Add the RED end-to-end publication test**

The test sequence must be:

```ts
project_register
session_authority_start(profile: "admin")
project_resume
project_check run({
  authorityLeaseId: projectLeaseId,
  adminAuthorityLeaseId: adminLeaseId,
  cwd: projectRoot,
})
git_push({
  authorityLeaseId: adminLeaseId,
  projectAuthorityLeaseId: projectLeaseId,
  cwd: projectRoot,
})
```

Assert the check is `PASS`, then assert push reaches the existing remote URL policy failure and does **not** contain:

```text
PROJECT_RESUME_REQUIRED
LOCAL_VERIFICATION_REQUIRED
LOCAL_VERIFICATION_STALE
```

Also assert the host executor saw exactly `swift test --quiet` and `swift build`.

- [ ] **Step 3: Run the focused publish tests**

Run:

```bash
npm test -- tests/project-publish-mcp.test.ts tests/project-publish-gate.test.ts
```

Expected after Tasks 1-4: PASS without modifying `src/project-publish-gate.ts`.

- [ ] **Step 4: Verify the publish gate source was not widened**

Do not edit `src/project-publish-gate.ts` or `tests/project-publish-gate.test.ts` for this feature. Verify both files have no diff from the design base:

```bash
git diff --exit-code d5a24e469ad0fa948dfdbb52e16c4609e0c017da -- src/project-publish-gate.ts tests/project-publish-gate.test.ts
```

Expected: exit 0. The existing behavioral matrix continues to prove that publication consumes only `projectCheck.report(cwd)` and rejects non-PASS/stale/wrong-worktree state.

- [ ] **Step 5: Commit Task 5**

```bash
git add tests/project-publish-mcp.test.ts
git commit -m "test: verify native checks satisfy publish gate"
```

---

### Task 6: Update current documentation and run the exact-head verification gate

**Files:**
- Modify: `docs/CODING_HARNESS_V2.md`
- Modify: `README.md`
- Do not modify: `docs/PROJECT_STATE.md` while the active perception worktree owns dirty edits there.

**Interfaces:**
- Documents the two execution lanes and dual-authority native run input.
- Does not claim that Project authority alone can execute native host checks.
- Does not claim that Docker verifies macOS-native projects.

- [ ] **Step 1: Update the coding-harness contract**

In `docs/CODING_HARNESS_V2.md` under `project_check`, replace the Node-only description with this exact paragraph:

```text
Detection is repository-derived. Existing Node package scripts keep their current precedence and run in the Project Docker sandbox. If no Node check is detected and the repository root contains a regular non-symlink Package.swift, project_check detects fixed SwiftPM test/build checks. Those checks are marked admin-host and project_check run requires an explicit active Admin lease; callers still cannot submit command/args/cwd overrides. Detect/report remain Project-only. All lanes write the same freshness-bound digest-only evidence.
```

Document that Docker failure never causes automatic host fallback.

- [ ] **Step 2: Update README publication guidance**

Near the existing `git_push` paragraph, add that a native verification Admin lease authorizes the local check run only; `git_push` still independently requires its own current Admin lease plus the exact resumed Project lease and fresh report PASS.

Explicitly say that raw terminal output is not stored as verification evidence.

- [ ] **Step 3: Run documentation/source hygiene checks**

Run:

```bash
git diff --check
python3 - <<'PY'
from pathlib import Path
paths = [
    Path('docs/CODING_HARNESS_V2.md'),
    Path('README.md'),
    Path('docs/superpowers/plans/2026-09-15-native-project-verification.md'),
]
for path in paths:
    text = path.read_text()
    for token in ('TODO', 'TBD', 'PLACEHOLDER', 'FIXME'):
        assert token not in text, (path, token)
print('doc hygiene ok')
PY
```

Expected: no whitespace errors and `doc hygiene ok`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- tests/project-check-mcp.test.ts tests/project-check-host-executor.test.ts tests/project-publish-gate.test.ts tests/project-publish-mcp.test.ts
npm run build
```

Expected: all focused tests PASS; build exits 0.

- [ ] **Step 5: Run the complete repository gate on the exact current HEAD/tree**

Run:

```bash
npm run check
```

Expected: TypeScript build and full Vitest suite PASS with zero failures.

Then run:

```bash
git diff --check
git status --short --branch
git rev-parse HEAD
```

Expected before the docs commit: only the intended documentation files are dirty; no unrelated paths.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/CODING_HARNESS_V2.md README.md
git commit -m "docs: document native project verification"
```

- [ ] **Step 7: Re-run completion verification on the committed exact HEAD**

Run fresh after the commit:

```bash
npm run check
npm run build
git diff --check
git status --short --branch
git rev-parse HEAD
```

Expected: full gate PASS and worktree clean.

- [ ] **Step 8: Review the complete implementation diff against the design base**

Run:

```bash
git diff --check d5a24e469ad0fa948dfdbb52e16c4609e0c017da...HEAD
git diff --stat d5a24e469ad0fa948dfdbb52e16c4609e0c017da...HEAD
```

Review specifically for:

- any arbitrary caller-controlled host command path;
- any Node sandbox→host fallback;
- any raw verification output persistence;
- any `ProjectPublishGate` widening;
- any modifications to the concurrently owned perception worktree.

- [ ] **Step 9: Record the live-runtime integration boundary instead of bypassing it**

Do not restart/install the daily-driver runtime from this isolated main-based branch while the active perception implementation worktree remains dirty.

Checkpoint the native-verification project with:

```text
Implementation locally verified. Next: integrate/reconcile this branch into the runtime line that owns the active perception work, then rebuild/restart the daily-driver through its normal setup path. After the new runtime is active, resume MacAgent-activity-theme and run project_check detect -> run with Admin -> report -> safe git_push -> PR.
```

If the active runtime line becomes clean and explicitly integrated during execution, perform that integration first; otherwise stop at this boundary rather than installing a stale runtime composition.

- [ ] **Step 10: Commit/checkpoint status only where ownership is safe**

Do not edit the shared `docs/PROJECT_STATE.md` from this worktree if another worktree still has uncommitted ownership of that file. Use `project_checkpoint(chatgpt-system-project-check-native)` for the durable handoff instead.

---

## Post-integration real macOS acceptance

This acceptance is intentionally after safe runtime integration, not part of the isolated design branch’s unit-test completion claim.

1. Resume `MacAgent-activity-theme` and verify exact clean HEAD/worktree.
2. `project_check detect` must return exactly `swiftpm:test` then `swiftpm:build`, both `admin-host`.
3. `project_check run` without Admin must return an authority denial and execute nothing.
4. Start explicit Admin authority and rerun; host-native `swift test --quiet` and `swift build` must complete on macOS.
5. `project_check report` must be fresh `PASS` for the exact MacAgent HEAD + working-tree digest.
6. Safe `git_push` must use the exact resumed Project lease plus current Admin lease; do not raw-push.
7. Open the PR only after safe push succeeds; then use exact-head hosted checks before merge.
