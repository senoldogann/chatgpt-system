import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import {
  ConflictError,
  PolicyError,
  RecoveryRequiredError,
  WorktreeDirtyError,
  WorktreeNotFoundError,
} from "./errors.js";
import { validateBranchName } from "./git-service.js";
import { PathPolicy } from "./policy.js";

const REGISTRY_VERSION = 1;
const WORKTREE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ManagedWorktreeRecord {
  version: 1;
  worktreeId: string;
  repositoryRoot: string;
  commonDir: string;
  repositoryFingerprint: string;
  path: string;
  branch: string;
  createdAt: string;
}

export interface ManagedWorktreeView {
  operation: "create" | "status" | "remove";
  worktreeId: string;
  path: string;
  repositoryRoot: string;
  branch: string;
  head: string;
  dirty: boolean;
  removed: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function fingerprint(commonDir: string): string {
  return createHash("sha256").update("git-common-dir\0").update(commonDir).digest("hex");
}

function gitEnvironment(source: NodeJS.ProcessEnv, write: boolean): NodeJS.ProcessEnv {
  const keys = ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "TMPDIR"] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.GIT_OPTIONAL_LOCKS = write ? "1" : "0";
  return env;
}

async function runGit(cwd: string, args: string[], limits: LimitsConfig, write = false): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c", "core.hooksPath=/dev/null",
        "-c", "core.fsmonitor=false",
        "-c", "diff.external=",
        "-c", "interactive.diffFilter=",
        "-c", "commit.gpgSign=false",
        ...args,
      ],
      {
        cwd,
        shell: false,
        env: gitEnvironment(process.env, write),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let tooLarge = false;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (tooLarge) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > limits.maxCommandOutputBytes) {
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
    }, limits.commandTimeoutMs);
    timer.unref();
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PolicyError("Managed Git worktree command exceeded the configured timeout."));
        return;
      }
      if (tooLarge) {
        reject(new PolicyError("Managed Git worktree command exceeded the configured output limit."));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function recordShape(value: unknown): value is ManagedWorktreeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ManagedWorktreeRecord>;
  return record.version === REGISTRY_VERSION
    && typeof record.worktreeId === "string"
    && WORKTREE_ID.test(record.worktreeId)
    && typeof record.repositoryRoot === "string"
    && typeof record.commonDir === "string"
    && typeof record.repositoryFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(record.repositoryFingerprint)
    && typeof record.path === "string"
    && typeof record.branch === "string"
    && typeof record.createdAt === "string";
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function safeUnlink(candidate: string): Promise<void> {
  await unlink(candidate).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

export class ManagedWorktreeService {
  private readonly registryDirectory: string;
  private readonly managedRoot: string;

  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly limits: LimitsConfig,
    stateRoot: string,
    worktreeRoot: string,
  ) {
    this.registryDirectory = path.resolve(stateRoot, "managed-worktrees");
    this.managedRoot = path.resolve(worktreeRoot);
  }

  private registryPath(worktreeId: string): string {
    if (!WORKTREE_ID.test(worktreeId)) throw new WorktreeNotFoundError();
    return path.join(this.registryDirectory, `${worktreeId}.json`);
  }

  private async repository(cwdInput: string): Promise<{
    repositoryRoot: string;
    commonDir: string;
    repositoryFingerprint: string;
  }> {
    const cwd = await this.policy.resolve(cwdInput);
    const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], this.limits);
    if (rootResult.exitCode !== 0 || !rootResult.stdout.trim()) {
      throw new PolicyError("Managed worktree operations require a Git repository.");
    }
    const repositoryRoot = await this.policy.resolve(rootResult.stdout.trim());
    const canonicalRoot = await realpath(repositoryRoot);
    const commonResult = await runGit(repositoryRoot, ["rev-parse", "--git-common-dir"], this.limits);
    if (commonResult.exitCode !== 0 || !commonResult.stdout.trim()) {
      throw new PolicyError("Managed worktree operations could not determine the Git common directory.");
    }
    const commonCandidate = path.isAbsolute(commonResult.stdout.trim())
      ? commonResult.stdout.trim()
      : path.resolve(repositoryRoot, commonResult.stdout.trim());
    const commonDir = await realpath(commonCandidate);
    return {
      repositoryRoot: canonicalRoot,
      commonDir,
      repositoryFingerprint: fingerprint(commonDir),
    };
  }

  private async isDirty(worktreePath: string): Promise<boolean> {
    const status = await runGit(
      worktreePath,
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      this.limits,
    );
    if (status.exitCode !== 0) throw new RecoveryRequiredError("Managed worktree status could not be verified.");
    return status.stdout.length > 0;
  }

  private async head(worktreePath: string): Promise<string> {
    const result = await runGit(worktreePath, ["rev-parse", "HEAD"], this.limits);
    const head = result.stdout.trim();
    if (result.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(head)) {
      throw new RecoveryRequiredError("Managed worktree HEAD could not be verified.");
    }
    return head;
  }

  private async currentBranch(worktreePath: string): Promise<string> {
    const result = await runGit(worktreePath, ["branch", "--show-current"], this.limits);
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      throw new RecoveryRequiredError("Managed worktree branch could not be verified.");
    }
    return validateBranchName(result.stdout.trim());
  }

  private async writeRecord(record: ManagedWorktreeRecord): Promise<void> {
    await mkdir(this.registryDirectory, { recursive: true, mode: 0o700 });
    const destination = this.registryPath(record.worktreeId);
    const temp = path.join(this.registryDirectory, `.${record.worktreeId}.${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, destination);
    } catch (error) {
      await safeUnlink(temp);
      throw error;
    }
  }

  private async loadRecord(worktreeId: string): Promise<ManagedWorktreeRecord> {
    const registryPath = this.registryPath(worktreeId);
    let parsed: unknown;
    try {
      const bytes = await readFile(registryPath);
      if (bytes.byteLength > 64 * 1024) throw new RecoveryRequiredError("Managed worktree registry entry is oversized.");
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new WorktreeNotFoundError();
      if (error instanceof RecoveryRequiredError) throw error;
      throw new RecoveryRequiredError("Managed worktree registry entry is unreadable or malformed.");
    }
    if (!recordShape(parsed) || parsed.worktreeId !== worktreeId) {
      throw new RecoveryRequiredError("Managed worktree registry entry is invalid.");
    }
    return parsed;
  }

  private validateOwnedPath(record: ManagedWorktreeRecord): void {
    const expected = path.resolve(this.managedRoot, record.repositoryFingerprint, record.worktreeId);
    if (path.resolve(record.path) !== expected || !isInside(this.managedRoot, expected)) {
      throw new RecoveryRequiredError("Managed worktree registry path is outside the plugin-owned root.");
    }
  }

  private async verifyRecord(record: ManagedWorktreeRecord): Promise<{ head: string; dirty: boolean }> {
    this.validateOwnedPath(record);
    await this.policy.resolve(record.repositoryRoot);
    if (!(await exists(record.path))) throw new RecoveryRequiredError("Managed worktree path is missing.");

    const commonResult = await runGit(record.path, ["rev-parse", "--git-common-dir"], this.limits);
    if (commonResult.exitCode !== 0 || !commonResult.stdout.trim()) {
      throw new RecoveryRequiredError("Managed worktree Git metadata is unavailable.");
    }
    const commonCandidate = path.isAbsolute(commonResult.stdout.trim())
      ? commonResult.stdout.trim()
      : path.resolve(record.path, commonResult.stdout.trim());
    const commonDir = await realpath(commonCandidate);
    if (commonDir !== record.commonDir || fingerprint(commonDir) !== record.repositoryFingerprint) {
      throw new RecoveryRequiredError("Managed worktree Git common directory no longer matches its registry.");
    }
    const branch = await this.currentBranch(record.path);
    if (branch !== record.branch) {
      throw new RecoveryRequiredError("Managed worktree branch no longer matches its registry.");
    }
    return { head: await this.head(record.path), dirty: await this.isDirty(record.path) };
  }

  async create(cwdInput: string, branchInput: string): Promise<ManagedWorktreeView> {
    const branch = validateBranchName(branchInput);
    const repository = await this.repository(cwdInput);
    return this.audit.run(
      "git.worktree",
      this.policy.display(repository.repositoryRoot),
      async () => {
        if (await this.isDirty(repository.repositoryRoot)) {
          throw new WorktreeDirtyError("A managed worktree can only be created from a clean source worktree.");
        }
        const branchExists = await runGit(
          repository.repositoryRoot,
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          this.limits,
        );
        if (branchExists.exitCode === 0) throw new ConflictError("The requested worktree branch already exists.");
        if (branchExists.exitCode !== 1) throw new PolicyError("Could not safely verify the requested worktree branch.");

        const worktreeId = randomUUID();
        const destination = path.join(this.managedRoot, repository.repositoryFingerprint, worktreeId);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const add = await runGit(
          repository.repositoryRoot,
          ["worktree", "add", "-b", branch, destination, "HEAD"],
          this.limits,
          true,
        );
        if (add.exitCode !== 0) throw new ConflictError("Git could not create the managed worktree.");

        const record: ManagedWorktreeRecord = {
          version: REGISTRY_VERSION,
          worktreeId,
          repositoryRoot: repository.repositoryRoot,
          commonDir: repository.commonDir,
          repositoryFingerprint: repository.repositoryFingerprint,
          path: destination,
          branch,
          createdAt: new Date().toISOString(),
        };
        try {
          await this.writeRecord(record);
        } catch (error) {
          const rollback = await runGit(
            repository.repositoryRoot,
            ["worktree", "remove", destination],
            this.limits,
            true,
          );
          if (rollback.exitCode !== 0) {
            throw new RecoveryRequiredError("Managed worktree registry write failed and worktree rollback did not complete.");
          }
          await runGit(repository.repositoryRoot, ["branch", "-D", branch], this.limits, true);
          throw error;
        }

        return {
          operation: "create",
          worktreeId,
          path: destination,
          repositoryRoot: repository.repositoryRoot,
          branch,
          head: await this.head(destination),
          dirty: false,
          removed: false,
        };
      },
      { operation: "create" },
    );
  }

  async status(worktreeId: string): Promise<ManagedWorktreeView> {
    return this.audit.run(
      "git.worktree",
      ".",
      async () => {
        const record = await this.loadRecord(worktreeId);
        const verified = await this.verifyRecord(record);
        return {
          operation: "status",
          worktreeId: record.worktreeId,
          path: record.path,
          repositoryRoot: record.repositoryRoot,
          branch: record.branch,
          head: verified.head,
          dirty: verified.dirty,
          removed: false,
        };
      },
      { operation: "status" },
    );
  }

  async remove(worktreeId: string): Promise<ManagedWorktreeView> {
    return this.audit.run(
      "git.worktree",
      ".",
      async () => {
        const record = await this.loadRecord(worktreeId);
        const verified = await this.verifyRecord(record);
        if (verified.dirty) throw new WorktreeDirtyError();
        const remove = await runGit(
          record.repositoryRoot,
          ["worktree", "remove", record.path],
          this.limits,
          true,
        );
        if (remove.exitCode !== 0) {
          throw new RecoveryRequiredError("Git refused to remove the clean managed worktree.");
        }
        await safeUnlink(this.registryPath(record.worktreeId));
        return {
          operation: "remove",
          worktreeId: record.worktreeId,
          path: record.path,
          repositoryRoot: record.repositoryRoot,
          branch: record.branch,
          head: verified.head,
          dirty: false,
          removed: true,
        };
      },
      { operation: "remove" },
    );
  }
}
