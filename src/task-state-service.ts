import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import {
  AuthorityDeniedError,
  ConflictError,
  LimitError,
  PolicyError,
  RecoveryRequiredError,
  TaskStateNotFoundError,
} from "./errors.js";
import { withPathLock } from "./path-lock.js";
import { PathPolicy } from "./policy.js";
import type {
  RepositoryStateObservation,
  StoredTaskState,
  TaskCheckpointInput,
  TaskStateCheckpoint,
  TaskStateTerminalStatus,
  TaskStateView,
} from "./task-state-types.js";

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_UNTRACKED_LIST_BYTES = 4 * 1024 * 1024;
const MAX_UNTRACKED_BYTES = 32 * 1024 * 1024;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_CHECKPOINTS = 64;
const MAX_TEXT_BYTES = 8_192;
const MAX_SUMMARY_BYTES = 4_096;
const MAX_ITEM_BYTES = 2_048;
const MAX_EVIDENCE_BYTES = 512;
const MAX_LIST_ITEMS = 100;

interface GitResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "TMPDIR"] as const) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

async function runGit(cwd: string, args: string[], timeoutMs: number, maxBytes = MAX_GIT_OUTPUT_BYTES): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c", "core.hooksPath=/dev/null",
        "-c", "core.fsmonitor=false",
        "-c", "diff.external=",
        "-c", "interactive.diffFilter=",
        ...args,
      ],
      {
        cwd,
        shell: false,
        env: gitEnvironment(process.env),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let tooLarge = false;

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (tooLarge) return;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        tooLarge = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PolicyError("Task-state Git inspection exceeded the configured timeout."));
        return;
      }
      if (tooLarge) {
        reject(new LimitError("Task-state Git inspection exceeded its bounded output limit."));
        return;
      }
      resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

function redacted(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{6,}/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{12,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function boundedText(label: string, value: string, maxBytes: number): string {
  if (!value.trim()) throw new PolicyError(`${label} must not be empty.`);
  if (value.includes("\u0000")) throw new PolicyError(`${label} must not contain NUL characters.`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new LimitError(`${label} exceeds its bounded size.`);
  return redacted(value);
}

function optionalText(label: string, value: string | undefined, maxBytes: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedText(label, value, maxBytes);
}

function boundedList(label: string, values: string[] | undefined, maxItems: number, maxBytes: number): string[] {
  const list = values ?? [];
  if (list.length > maxItems) throw new LimitError(`${label} exceeds its bounded item count.`);
  return list.map((item) => boundedText(label, item, maxBytes));
}

function looksSecretPath(relativePath: string): boolean {
  const basename = path.basename(relativePath).toLowerCase();
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", "credentials", "credentials.json", "secrets.json", "id_ed25519", "id_rsa"].includes(basename)) return true;
  return /\.(?:pem|key|p12|pfx)$/i.test(basename);
}

function normalizedPaths(root: string, values: string[] | undefined): string[] {
  const list = values ?? [];
  if (list.length > MAX_LIST_ITEMS) throw new LimitError("Task-state file list exceeds its bounded item count.");
  const result: string[] = [];
  for (const value of list) {
    if (!value.trim() || value.includes("\u0000") || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
      throw new PolicyError("Task-state file path is invalid.");
    }
    const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
    if (!isInside(root, candidate) || candidate === root) throw new PolicyError("Task-state file paths must stay inside the repository.");
    const relative = path.relative(root, candidate).split(path.sep).join("/");
    result.push(looksSecretPath(relative) ? "[redacted-secret-path]" : relative);
  }
  return [...new Set(result)];
}

async function hashUntrackedFile(
  hash: ReturnType<typeof createHash>,
  root: string,
  relativePath: string,
  remainingBudget: number,
): Promise<number> {
  const absolutePath = path.resolve(root, relativePath);
  if (!isInside(root, absolutePath) || absolutePath === root) return 0;
  hash.update("path\0");
  hash.update(relativePath);
  hash.update("\0");

  try {
    const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) return 0;
      if (info.size > remainingBudget) throw new LimitError("Untracked task-state digest input exceeds its bounded size.");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      let consumed = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        consumed += bytesRead;
        if (consumed > remainingBudget) throw new LimitError("Untracked task-state digest input exceeds its bounded size.");
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      return consumed;
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      const target = await readlink(absolutePath);
      const bytes = Buffer.byteLength(target, "utf8");
      if (bytes > remainingBudget) throw new LimitError("Untracked symlink digest input exceeds its bounded size.");
      hash.update("symlink\0");
      hash.update(target);
      return bytes;
    }
    if (code === "ENOENT") return 0;
    throw error;
  }
}

function validStoredRecord(value: unknown, taskId: string, fingerprint: string): value is StoredTaskState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredTaskState>;
  return record.taskId === taskId
    && record.projectFingerprint === fingerprint
    && (record.status === "active" || record.status === "completed" || record.status === "failed")
    && Number.isInteger(record.revision) && (record.revision ?? 0) >= 1
    && typeof record.goal === "string"
    && typeof record.repositoryRoot === "string"
    && typeof record.baseHead === "string"
    && typeof record.currentHead === "string"
    && typeof record.workingTreeDigest === "string"
    && Array.isArray(record.checkpoints)
    && record.checkpoints.length <= MAX_CHECKPOINTS
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string";
}

export interface TaskStateVerifiedObservation {
  head: string;
  workingTreeDigest: string;
}

export class TaskStateService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly stateRoot: string,
    private readonly profile: "project" | "user" | "admin",
    private readonly limits: Pick<LimitsConfig, "commandTimeoutMs">,
  ) {}

  private assertProject(): void {
    if (this.profile !== "project") {
      throw new AuthorityDeniedError("Durable task state requires a Project authority lease.");
    }
  }

  async observeRepositoryState(cwdInput: string): Promise<RepositoryStateObservation> {
    const cwd = await this.policy.resolve(cwdInput);
    const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], this.limits.commandTimeoutMs, 64 * 1024);
    if (rootResult.exitCode !== 0) throw new PolicyError("Task state requires a Git repository.");
    const discoveredRoot = rootResult.stdout.toString("utf8").trim();
    if (!discoveredRoot) throw new PolicyError("Task state could not determine the repository root.");
    const repositoryRoot = await this.policy.resolve(discoveredRoot);

    const commonResult = await runGit(repositoryRoot, ["rev-parse", "--git-common-dir"], this.limits.commandTimeoutMs, 64 * 1024);
    if (commonResult.exitCode !== 0) throw new PolicyError("Task state could not determine repository identity.");
    const commonRaw = commonResult.stdout.toString("utf8").trim();
    const commonPath = path.isAbsolute(commonRaw) ? commonRaw : path.resolve(repositoryRoot, commonRaw);
    const commonDirectory = await realpath(commonPath);

    const headResult = await runGit(repositoryRoot, ["rev-parse", "HEAD"], this.limits.commandTimeoutMs, 64 * 1024);
    if (headResult.exitCode !== 0) throw new PolicyError("Task state requires a repository with a valid HEAD commit.");
    const head = headResult.stdout.toString("utf8").trim();
    if (!/^[a-f0-9]{40,64}$/i.test(head)) throw new RecoveryRequiredError("Git returned an invalid HEAD while computing durable task state.");

    const diffResult = await runGit(
      repositoryRoot,
      ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"],
      this.limits.commandTimeoutMs,
      MAX_GIT_OUTPUT_BYTES,
    );
    if (diffResult.exitCode !== 0) throw new PolicyError("Task state could not inspect tracked working-tree changes.");

    const untrackedResult = await runGit(
      repositoryRoot,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      this.limits.commandTimeoutMs,
      MAX_UNTRACKED_LIST_BYTES,
    );
    if (untrackedResult.exitCode !== 0) throw new PolicyError("Task state could not inspect untracked working-tree files.");

    const digest = createHash("sha256");
    digest.update("tracked-diff\0");
    digest.update(diffResult.stdout);
    digest.update("\0untracked\0");
    let untrackedBytes = 0;
    const untracked = untrackedResult.stdout.toString("utf8").split("\u0000").filter(Boolean);
    for (const relativePath of untracked) {
      if (untrackedBytes >= MAX_UNTRACKED_BYTES) throw new LimitError("Untracked task-state digest input exceeds its bounded size.");
      const consumed = await hashUntrackedFile(digest, repositoryRoot, relativePath, MAX_UNTRACKED_BYTES - untrackedBytes);
      untrackedBytes += consumed;
      digest.update("\0");
    }

    const projectFingerprint = createHash("sha256")
      .update("git-common-dir\0")
      .update(commonDirectory)
      .update("\0repository-root\0")
      .update(repositoryRoot)
      .digest("hex");

    return {
      repositoryRoot,
      projectFingerprint,
      head,
      workingTreeDigest: digest.digest("hex"),
    };
  }

  private tasksDirectory(observation: RepositoryStateObservation): string {
    return path.join(this.stateRoot, "projects", observation.projectFingerprint, "tasks");
  }

  private recordPath(observation: RepositoryStateObservation, taskId: string): string {
    if (!TASK_ID_PATTERN.test(taskId)) throw new PolicyError("Task state ID is invalid.");
    return path.join(this.tasksDirectory(observation), `${taskId}.json`);
  }

  private async load(observation: RepositoryStateObservation, taskId: string): Promise<StoredTaskState> {
    const recordPath = this.recordPath(observation, taskId);
    let bytes: Buffer;
    try {
      bytes = await readFile(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TaskStateNotFoundError();
      throw error;
    }
    if (bytes.byteLength > MAX_STATE_BYTES) throw new RecoveryRequiredError("Durable task state record exceeds its bounded size.");
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!validStoredRecord(parsed, taskId, observation.projectFingerprint)) {
        throw new RecoveryRequiredError("Durable task state record is invalid or belongs to a different project.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof RecoveryRequiredError) throw error;
      throw new RecoveryRequiredError("Durable task state record contains invalid JSON.");
    }
  }

  private async persist(observation: RepositoryStateObservation, record: StoredTaskState): Promise<void> {
    const directory = this.tasksDirectory(observation);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = this.recordPath(observation, record.taskId);
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
      throw new LimitError("Durable task state record exceeds its bounded size.");
    }
    const temporary = path.join(directory, `.${record.taskId}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, destination);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private view(record: StoredTaskState, observation: RepositoryStateObservation): TaskStateView {
    const headMatches = record.currentHead === observation.head;
    const workingTreeMatches = record.workingTreeDigest === observation.workingTreeDigest;
    return {
      ...record,
      checkpointCount: record.checkpoints.length,
      observed: {
        head: observation.head,
        workingTreeDigest: observation.workingTreeDigest,
      },
      freshness: {
        fresh: headMatches && workingTreeMatches,
        headMatches,
        workingTreeMatches,
      },
    };
  }

  async start(goalInput: string, cwdInput = ".", nextStepInput?: string): Promise<TaskStateView> {
    this.assertProject();
    const observation = await this.observeRepositoryState(cwdInput);
    const now = new Date().toISOString();
    const record: StoredTaskState = {
      taskId: randomUUID(),
      status: "active",
      revision: 1,
      goal: boundedText("Task goal", goalInput, MAX_TEXT_BYTES),
      repositoryRoot: observation.repositoryRoot,
      projectFingerprint: observation.projectFingerprint,
      baseHead: observation.head,
      currentHead: observation.head,
      workingTreeDigest: observation.workingTreeDigest,
      ...(nextStepInput !== undefined ? { nextStep: boundedText("Task next step", nextStepInput, MAX_SUMMARY_BYTES) } : {}),
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };
    return this.audit.run(
      "task.state",
      this.policy.display(observation.repositoryRoot),
      async () => {
        await this.persist(observation, record);
        return this.view(record, observation);
      },
      { operation: "start", status: record.status, revision: record.revision },
    );
  }

  async checkpoint(
    taskId: string,
    input: TaskCheckpointInput,
    cwdInput = ".",
  ): Promise<TaskStateView> {
    this.assertProject();
    const observation = await this.observeRepositoryState(cwdInput);
    return this.audit.run(
      "task.state",
      this.policy.display(observation.repositoryRoot),
      async () => withPathLock(this.recordPath(observation, taskId), async () => {
        const record = await this.load(observation, taskId);
        if (record.status !== "active") throw new ConflictError("Only an active task can accept a checkpoint.");
        if (record.checkpoints.length >= MAX_CHECKPOINTS) throw new LimitError("Task checkpoint count exceeded its bounded limit.");
        const revision = record.revision + 1;
        const now = new Date().toISOString();
        const checkpoint: TaskStateCheckpoint = {
          revision,
          summary: boundedText("Checkpoint summary", input.summary, MAX_SUMMARY_BYTES),
          findings: boundedList("Checkpoint finding", input.findings, 20, MAX_ITEM_BYTES),
          decisions: boundedList("Checkpoint decision", input.decisions, 20, MAX_ITEM_BYTES),
          inspectedFiles: normalizedPaths(observation.repositoryRoot, input.inspectedFiles),
          modifiedFiles: normalizedPaths(observation.repositoryRoot, input.modifiedFiles),
          ...(input.nextStep !== undefined ? { nextStep: boundedText("Checkpoint next step", input.nextStep, MAX_SUMMARY_BYTES) } : {}),
          evidenceRefs: boundedList("Checkpoint evidence reference", input.evidenceRefs, 50, MAX_EVIDENCE_BYTES),
          head: observation.head,
          workingTreeDigest: observation.workingTreeDigest,
          createdAt: now,
        };
        const updated: StoredTaskState = {
          ...record,
          revision,
          currentHead: observation.head,
          workingTreeDigest: observation.workingTreeDigest,
          ...(checkpoint.nextStep !== undefined ? { nextStep: checkpoint.nextStep } : {}),
          checkpoints: [...record.checkpoints, checkpoint],
          updatedAt: now,
        };
        await this.persist(observation, updated);
        return this.view(updated, observation);
      }),
      { operation: "checkpoint" },
    );
  }

  async status(taskId: string, cwdInput = "."): Promise<TaskStateView> {
    this.assertProject();
    const observation = await this.observeRepositoryState(cwdInput);
    return this.audit.run(
      "task.state",
      this.policy.display(observation.repositoryRoot),
      async () => this.view(await this.load(observation, taskId), observation),
      { operation: "status" },
    );
  }

  private async terminal(
    status: TaskStateTerminalStatus,
    taskId: string,
    summaryInput: string,
    evidenceRefsInput: string[] | undefined,
    cwdInput: string,
    verified: TaskStateVerifiedObservation | undefined,
  ): Promise<TaskStateView> {
    this.assertProject();
    const observation = await this.observeRepositoryState(cwdInput);
    if (verified !== undefined
      && (verified.head !== observation.head || verified.workingTreeDigest !== observation.workingTreeDigest)) {
      throw new ConflictError("Repository state changed between verification and task completion.", {
        verified,
        observed: { head: observation.head, workingTreeDigest: observation.workingTreeDigest },
      });
    }
    return this.audit.run(
      "task.state",
      this.policy.display(observation.repositoryRoot),
      async () => withPathLock(this.recordPath(observation, taskId), async () => {
        const record = await this.load(observation, taskId);
        if (record.status !== "active") throw new ConflictError("Only an active task can enter a terminal state.");
        const revision = record.revision + 1;
        const now = new Date().toISOString();
        const summary = boundedText("Task outcome summary", summaryInput, MAX_SUMMARY_BYTES);
        const evidenceRefs = boundedList("Task outcome evidence reference", evidenceRefsInput, 50, MAX_EVIDENCE_BYTES);
        const updated: StoredTaskState = {
          ...record,
          status,
          revision,
          currentHead: observation.head,
          workingTreeDigest: observation.workingTreeDigest,
          outcome: {
            status,
            summary,
            evidenceRefs,
            head: observation.head,
            workingTreeDigest: observation.workingTreeDigest,
            createdAt: now,
          },
          updatedAt: now,
        };
        await this.persist(observation, updated);
        return this.view(updated, observation);
      }),
      { operation: status === "completed" ? "complete" : "fail", status },
    );
  }

  async complete(
    taskId: string,
    summaryInput: string,
    evidenceRefsInput: string[] | undefined,
    cwdInput: string,
    verified: TaskStateVerifiedObservation,
  ): Promise<TaskStateView> {
    return this.terminal("completed", taskId, summaryInput, evidenceRefsInput, cwdInput, verified);
  }

  async fail(taskId: string, summaryInput: string, evidenceRefsInput: string[] | undefined, cwdInput = "."): Promise<TaskStateView> {
    return this.terminal("failed", taskId, summaryInput, evidenceRefsInput, cwdInput, undefined);
  }
}
