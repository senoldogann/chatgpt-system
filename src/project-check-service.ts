import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { AuditLogger } from "./audit.js";
import type { AuthorityProfile } from "./authority.js";
import type { LimitsConfig } from "./config.js";
import {
  AppError,
  AuthorityDeniedError,
  LimitError,
  PolicyError,
  RecoveryRequiredError,
} from "./errors.js";
import { PathPolicy } from "./policy.js";
import type { ProjectExecResult } from "./project-exec-types.js";
import { ProjectExecService } from "./project-exec-service.js";
import type {
  DetectedProjectCheck,
  ProjectCheckBaseStatus,
  ProjectCheckKind,
  ProjectCheckStatus,
  ProjectCheckView,
  ProjectCheckViewItem,
  StoredProjectCheckEvidence,
  StoredProjectVerification,
} from "./project-check-types.js";
import { TaskStateService } from "./task-state-service.js";
import type { RepositoryStateObservation } from "./task-state-types.js";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_CHECKS = 32;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_HASH = /^[a-f0-9]{40,64}$/i;

interface PackageJsonShape {
  scripts?: Record<string, unknown>;
  packageManager?: unknown;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readRegularText(candidate: string, maxBytes: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw new PolicyError("Project verification configuration must be a regular file.");
    if (info.size > maxBytes) throw new LimitError("Project verification configuration exceeds its bounded size.");
    return (await handle.readFile()).toString("utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code === "ELOOP") throw new PolicyError("Project verification configuration may not be a symbolic link.");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function regularFileExists(candidate: string): Promise<boolean> {
  try {
    const info = await lstat(candidate);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function scriptValue(scripts: Record<string, unknown>, name: string): string | undefined {
  const value = scripts[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function commandForManager(manager: string, script: string): { command: string; args: string[] } {
  return { command: manager, args: ["run", script] };
}

async function detectPackageManager(repositoryRoot: string, packageJson: PackageJsonShape): Promise<string> {
  if (typeof packageJson.packageManager === "string") {
    const match = /^(npm|pnpm|yarn|bun)@/i.exec(packageJson.packageManager.trim());
    if (match?.[1]) return match[1].toLowerCase();
  }
  if (await regularFileExists(path.join(repositoryRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (await regularFileExists(path.join(repositoryRoot, "yarn.lock"))) return "yarn";
  if (await regularFileExists(path.join(repositoryRoot, "bun.lockb"))
    || await regularFileExists(path.join(repositoryRoot, "bun.lock"))) return "bun";
  return "npm";
}

function check(kind: ProjectCheckKind, manager: string, script: string): DetectedProjectCheck {
  const invocation = commandForManager(manager, script);
  return {
    checkId: `package-script:${script}`,
    kind,
    command: invocation.command,
    args: invocation.args,
    cwd: ".",
    source: `package.json#scripts.${script}`,
  };
}

function validEvidence(value: unknown): value is StoredProjectCheckEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Partial<StoredProjectCheckEvidence>;
  return typeof evidence.checkId === "string"
    && typeof evidence.kind === "string"
    && typeof evidence.command === "string"
    && Array.isArray(evidence.args) && evidence.args.every((item) => typeof item === "string")
    && typeof evidence.cwd === "string"
    && typeof evidence.source === "string"
    && (evidence.baseStatus === "PASS" || evidence.baseStatus === "FAIL" || evidence.baseStatus === "UNAVAILABLE")
    && typeof evidence.startedAt === "string"
    && typeof evidence.finishedAt === "string"
    && Number.isFinite(evidence.durationMs) && (evidence.durationMs ?? -1) >= 0
    && (evidence.exitCode === null || Number.isInteger(evidence.exitCode))
    && typeof evidence.head === "string" && GIT_HASH.test(evidence.head)
    && typeof evidence.workingTreeDigest === "string" && SHA256.test(evidence.workingTreeDigest)
    && typeof evidence.stdoutSha256 === "string" && SHA256.test(evidence.stdoutSha256)
    && typeof evidence.stderrSha256 === "string" && SHA256.test(evidence.stderrSha256)
    && Number.isInteger(evidence.stdoutBytes) && (evidence.stdoutBytes ?? -1) >= 0
    && Number.isInteger(evidence.stderrBytes) && (evidence.stderrBytes ?? -1) >= 0
    && typeof evidence.stateChangedDuringRun === "boolean";
}

function validStore(value: unknown, observation: RepositoryStateObservation): value is StoredProjectVerification {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredProjectVerification>;
  if (record.version !== STORE_VERSION
    || record.projectFingerprint !== observation.projectFingerprint
    || record.repositoryRoot !== observation.repositoryRoot
    || typeof record.updatedAt !== "string"
    || !record.evidence
    || typeof record.evidence !== "object"
    || Array.isArray(record.evidence)) return false;
  const entries = Object.entries(record.evidence);
  return entries.length <= MAX_CHECKS && entries.every(([id, evidence]) => id === (evidence as { checkId?: unknown })?.checkId && validEvidence(evidence));
}

function overallStatus(checks: ProjectCheckViewItem[]): ProjectCheckStatus {
  if (checks.length === 0) return "UNAVAILABLE";
  const statuses = new Set(checks.map((item) => item.status));
  if (statuses.has("STALE")) return "STALE";
  if (statuses.has("FAIL")) return "FAIL";
  if (statuses.has("UNAVAILABLE")) return "UNAVAILABLE";
  if (statuses.has("NOT_RUN")) return "NOT_RUN";
  return "PASS";
}

function unavailableError(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  return [
    "PROJECT_EXEC_DISABLED",
    "SANDBOX_UNAVAILABLE",
    "COMMAND_NOT_ALLOWED",
    "EXECUTABLE_NOT_FOUND",
  ].includes(error.code);
}

function failedExecutionError(error: unknown): boolean {
  return error instanceof AppError && error.code === "COMMAND_TIMEOUT";
}

export class ProjectCheckService {
  private readonly observer: TaskStateService;

  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly stateRoot: string,
    private readonly profile: AuthorityProfile,
    private readonly limits: LimitsConfig,
    private readonly projectExec: ProjectExecService,
  ) {
    this.observer = new TaskStateService(policy, audit, stateRoot, profile, limits);
  }

  private assertProject(): void {
    if (this.profile !== "project") {
      throw new AuthorityDeniedError("Structured project verification requires a Project authority lease.");
    }
  }

  private verificationDirectory(observation: RepositoryStateObservation): string {
    return path.join(this.stateRoot, "projects", observation.projectFingerprint, "verification");
  }

  private storePath(observation: RepositoryStateObservation): string {
    return path.join(this.verificationDirectory(observation), "latest.json");
  }

  private async detectChecks(observation: RepositoryStateObservation): Promise<DetectedProjectCheck[]> {
    const packagePath = path.join(observation.repositoryRoot, "package.json");
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
    const manager = await detectPackageManager(observation.repositoryRoot, packageJson);

    if (scriptValue(scripts, "check")) return [check("check", manager, "check")];

    const result: DetectedProjectCheck[] = [];
    if (scriptValue(scripts, "typecheck")) result.push(check("typecheck", manager, "typecheck"));
    else if (scriptValue(scripts, "type-check")) result.push(check("typecheck", manager, "type-check"));
    if (scriptValue(scripts, "lint")) result.push(check("lint", manager, "lint"));
    if (scriptValue(scripts, "test")) result.push(check("test", manager, "test"));
    if (scriptValue(scripts, "build")) result.push(check("build", manager, "build"));
    return result.slice(0, MAX_CHECKS);
  }

  private async loadStore(observation: RepositoryStateObservation): Promise<StoredProjectVerification> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.storePath(observation));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          version: STORE_VERSION,
          projectFingerprint: observation.projectFingerprint,
          repositoryRoot: observation.repositoryRoot,
          updatedAt: new Date(0).toISOString(),
          evidence: {},
        };
      }
      throw error;
    }
    if (bytes.byteLength > MAX_STORE_BYTES) throw new RecoveryRequiredError("Project verification evidence store exceeds its bounded size.");
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!validStore(parsed, observation)) throw new RecoveryRequiredError("Project verification evidence store is invalid.");
      return parsed;
    } catch (error) {
      if (error instanceof RecoveryRequiredError) throw error;
      throw new RecoveryRequiredError("Project verification evidence store contains invalid JSON.");
    }
  }

  private async persistStore(observation: RepositoryStateObservation, store: StoredProjectVerification): Promise<void> {
    const directory = this.verificationDirectory(observation);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const serialized = `${JSON.stringify(store, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
      throw new LimitError("Project verification evidence store exceeds its bounded size.");
    }
    const destination = this.storePath(observation);
    const temporary = path.join(directory, `.latest.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private render(
    operation: ProjectCheckView["operation"],
    observation: RepositoryStateObservation,
    detected: DetectedProjectCheck[],
    store?: StoredProjectVerification,
  ): ProjectCheckView {
    const checks: ProjectCheckViewItem[] = detected.map((item) => {
      const evidence = store?.evidence[item.checkId];
      if (!evidence) return { ...item, status: "NOT_RUN" as const };
      const headMatches = evidence.head === observation.head;
      const workingTreeMatches = evidence.workingTreeDigest === observation.workingTreeDigest;
      const status: ProjectCheckStatus = evidence.stateChangedDuringRun || !headMatches || !workingTreeMatches
        ? "STALE"
        : evidence.baseStatus;
      return {
        ...item,
        status,
        evidence,
        freshness: { headMatches, workingTreeMatches },
      };
    });
    return {
      operation,
      repositoryRoot: observation.repositoryRoot,
      required: checks.length > 0,
      overallStatus: overallStatus(checks),
      observed: {
        head: observation.head,
        workingTreeDigest: observation.workingTreeDigest,
      },
      checks,
    };
  }

  async detect(cwdInput = "."): Promise<ProjectCheckView> {
    this.assertProject();
    const observation = await this.observer.observeRepositoryState(cwdInput);
    return this.audit.run(
      "project.check",
      this.policy.display(observation.repositoryRoot),
      async () => this.render("detect", observation, await this.detectChecks(observation)),
      { operation: "detect" },
    );
  }

  async report(cwdInput = "."): Promise<ProjectCheckView> {
    this.assertProject();
    const observation = await this.observer.observeRepositoryState(cwdInput);
    return this.audit.run(
      "project.check",
      this.policy.display(observation.repositoryRoot),
      async () => {
        const detected = await this.detectChecks(observation);
        const store = await this.loadStore(observation);
        return this.render("report", observation, detected, store);
      },
      { operation: "report" },
    );
  }

  private evidence(
    detected: DetectedProjectCheck,
    before: RepositoryStateObservation,
    after: RepositoryStateObservation,
    startedAt: string,
    startedMs: number,
    result: ProjectExecResult | undefined,
    baseStatus: ProjectCheckBaseStatus,
  ): StoredProjectCheckEvidence {
    const stdout = result?.stdout ?? "";
    const stderr = result?.stderr ?? "";
    return {
      ...detected,
      baseStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedMs),
      exitCode: result?.exitCode ?? null,
      head: before.head,
      workingTreeDigest: before.workingTreeDigest,
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
      stdoutBytes: Buffer.byteLength(stdout, "utf8"),
      stderrBytes: Buffer.byteLength(stderr, "utf8"),
      stateChangedDuringRun: before.head !== after.head || before.workingTreeDigest !== after.workingTreeDigest,
    };
  }

  async run(cwdInput = ".", checkIds?: string[], timeoutMs?: number): Promise<ProjectCheckView> {
    this.assertProject();
    const initial = await this.observer.observeRepositoryState(cwdInput);
    const detected = await this.detectChecks(initial);
    if (detected.length === 0) return this.render("run", initial, detected);
    if (checkIds !== undefined && (checkIds.length < 1 || checkIds.length > MAX_CHECKS)) {
      throw new PolicyError("Project verification checkIds must contain 1-32 entries when provided.");
    }
    const requested = checkIds === undefined ? detected : checkIds.map((id) => {
      const found = detected.find((item) => item.checkId === id);
      if (!found) throw new PolicyError("Project verification requested an unknown detected check ID.");
      return found;
    });
    if (new Set(requested.map((item) => item.checkId)).size !== requested.length) {
      throw new PolicyError("Project verification checkIds must be unique.");
    }

    return this.audit.run(
      "project.check",
      this.policy.display(initial.repositoryRoot),
      async () => {
        let store = await this.loadStore(initial);
        for (const detectedCheck of requested) {
          const before = await this.observer.observeRepositoryState(cwdInput);
          const startedAt = new Date().toISOString();
          const startedMs = Date.now();
          let result: ProjectExecResult | undefined;
          let baseStatus: ProjectCheckBaseStatus;
          try {
            result = await this.projectExec.run(
              detectedCheck.command,
              detectedCheck.args,
              before.repositoryRoot,
              timeoutMs ?? this.limits.commandTimeoutMs,
            );
            baseStatus = result.exitCode === 0
              ? "PASS"
              : (result.exitCode === 126 || result.exitCode === 127 ? "UNAVAILABLE" : "FAIL");
          } catch (error) {
            if (unavailableError(error)) baseStatus = "UNAVAILABLE";
            else if (failedExecutionError(error)) baseStatus = "FAIL";
            else throw error;
          }
          const after = await this.observer.observeRepositoryState(cwdInput);
          const storedEvidence = this.evidence(detectedCheck, before, after, startedAt, startedMs, result, baseStatus);
          store = {
            ...store,
            updatedAt: new Date().toISOString(),
            evidence: { ...store.evidence, [detectedCheck.checkId]: storedEvidence },
          };
          await this.persistStore(initial, store);
        }
        const current = await this.observer.observeRepositoryState(cwdInput);
        const currentDetected = await this.detectChecks(current);
        return this.render("run", current, currentDetected, store);
      },
      { operation: "run", checkCount: requested.length },
    );
  }
}
