import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  ContinuityWorktreeInvalidError,
  ContinuityWorktreeMismatchError,
} from "./continuity-errors.js";
import type {
  ContinuityLocalState,
  ContinuityPublishedState,
  RemoteRefState,
  RemoteVerificationStatus,
  StoredWorktreeIdentity,
} from "./continuity-types.js";
import { sanitizedChildEnvironment } from "./process-policy.js";

export interface ContinuityGitCommandResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  outputLimitExceeded?: boolean;
}

export interface ContinuityGitInspectorOptions {
  maxTrackedPaths: number;
  remoteVerificationTimeoutMs: number;
  maxCommandOutputBytes: number;
  now?: () => number;
  runGit?: (
    cwd: string,
    args: readonly string[],
    timeoutMs: number | undefined,
  ) => Promise<ContinuityGitCommandResult>;
}

export interface ContinuityInspection {
  identity: StoredWorktreeIdentity;
  local: ContinuityLocalState;
  published: ContinuityPublishedState;
}

type GitRunner = NonNullable<ContinuityGitInspectorOptions["runGit"]>;

const gitPrefixArgs = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "diff.external=",
  "-c", "interactive.diffFilter=",
] as const;

function terminateGitChild(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }

  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return;
    if (code !== "EPERM") throw error;
  }

  child.kill(signal);
}

function createGitRunner(maxCommandOutputBytes: number): GitRunner {
  return async (cwd, args, timeoutMs) => new Promise<ContinuityGitCommandResult>((resolve, reject) => {
    const child = spawn("git", [...gitPrefixArgs, ...args], {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      env: {
        ...sanitizedChildEnvironment(process.env),
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PAGER: "cat",
        PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const collect = (target: Buffer[]) => (chunk: Buffer): void => {
      bytes += chunk.byteLength;
      if (bytes > maxCommandOutputBytes) {
        outputLimitExceeded = true;
        terminateGitChild(child, "SIGKILL");
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        ...(outputLimitExceeded ? { outputLimitExceeded: true } : {}),
      });
    });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        terminateGitChild(child, "SIGKILL");
      }, timeoutMs);
      timer.unref();
    }
  });
}

function text(result: ContinuityGitCommandResult): string {
  return result.stdout.toString("utf8").trim();
}

function causeCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const value = (error as NodeJS.ErrnoException).code;
  return typeof value === "string" ? value : undefined;
}

function ensurePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

function identity(pathname: string, device: bigint, inode: bigint): string {
  return createHash("sha256")
    .update(pathname)
    .update("\0")
    .update(`${device}:${inode}`)
    .digest("hex");
}

function boundedPaths(values: Set<string>, limit: number): { paths: string[]; truncated: boolean } {
  const sorted = [...values].sort();
  return {
    paths: sorted.slice(0, limit),
    truncated: sorted.length > limit,
  };
}

function parsePorcelainStatus(raw: Buffer, maxTrackedPaths: number): Omit<
  ContinuityLocalState,
  "checkedAt" | "branch" | "headSha"
> {
  const staged = new Set<string>();
  const unstaged = new Set<string>();
  const untracked = new Set<string>();
  const entries = raw.toString("utf8").split("\0");

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.length < 4 || entry[2] !== " ") {
      throw new ContinuityWorktreeInvalidError("Git returned invalid porcelain status data.");
    }

    const x = entry[0] ?? " ";
    const y = entry[1] ?? " ";
    const pathname = entry.slice(3);
    if (!pathname) throw new ContinuityWorktreeInvalidError("Git returned an empty porcelain path.");

    if (x === "?" && y === "?") {
      untracked.add(pathname);
      continue;
    }

    if (x !== " " && x !== "!" && x !== "?") staged.add(pathname);
    if (y !== " " && y !== "!" && y !== "?") unstaged.add(pathname);

    if (x === "R" || x === "C" || y === "R" || y === "C") {
      index += 1;
      if (!entries[index]) {
        throw new ContinuityWorktreeInvalidError("Git returned incomplete rename/copy porcelain data.");
      }
    }
  }

  const stagedResult = boundedPaths(staged, maxTrackedPaths);
  const unstagedResult = boundedPaths(unstaged, maxTrackedPaths);
  const untrackedResult = boundedPaths(untracked, maxTrackedPaths);
  return {
    stagedPaths: stagedResult.paths,
    unstagedPaths: unstagedResult.paths,
    untrackedPaths: untrackedResult.paths,
    pathsTruncated: stagedResult.truncated || unstagedResult.truncated || untrackedResult.truncated,
  };
}

function previousForRef(previous: RemoteRefState | undefined, ref: string | null): RemoteRefState | undefined {
  return previous?.ref === ref ? previous : undefined;
}

function remoteRefState(
  status: RemoteVerificationStatus,
  ref: string | null,
  currentSha: string | undefined,
  checkedAt: string,
  previous: RemoteRefState | undefined,
  reason: RemoteRefState["reason"] | undefined,
): RemoteRefState {
  const matchingPrevious = previousForRef(previous, ref);
  const lastVerifiedSha = status === "verified" ? currentSha : matchingPrevious?.lastVerifiedSha;
  const lastVerifiedAt = status === "verified" ? checkedAt : matchingPrevious?.lastVerifiedAt;
  return {
    status,
    ref,
    checkedAt,
    ...(status === "verified" && currentSha !== undefined ? { currentSha } : {}),
    ...(lastVerifiedSha !== undefined ? { lastVerifiedSha } : {}),
    ...(lastVerifiedAt !== undefined ? { lastVerifiedAt } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function parseRemoteRefs(raw: Buffer): Map<string, string> | null {
  const refs = new Map<string, string>();
  const lines = raw.toString("utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const separator = line.indexOf("\t");
    if (separator <= 0) return null;
    const sha = line.slice(0, separator);
    const ref = line.slice(separator + 1);
    if (!/^[a-f0-9]{40,64}$/.test(sha) || !ref.startsWith("refs/heads/")) return null;
    refs.set(ref, sha);
  }
  return refs;
}

export class ContinuityGitInspector {
  private readonly maxTrackedPaths: number;
  private readonly remoteVerificationTimeoutMs: number;
  private readonly runGit: GitRunner;
  private readonly now: () => number;

  constructor(options: ContinuityGitInspectorOptions) {
    ensurePositiveInteger(options.maxTrackedPaths, "maxTrackedPaths");
    ensurePositiveInteger(options.remoteVerificationTimeoutMs, "remoteVerificationTimeoutMs");
    ensurePositiveInteger(options.maxCommandOutputBytes, "maxCommandOutputBytes");
    this.maxTrackedPaths = options.maxTrackedPaths;
    this.remoteVerificationTimeoutMs = options.remoteVerificationTimeoutMs;
    this.runGit = options.runGit ?? createGitRunner(options.maxCommandOutputBytes);
    this.now = options.now ?? Date.now;
  }

  async inspect(
    worktreePath: string,
    previousPublished?: ContinuityPublishedState,
  ): Promise<ContinuityInspection> {
    const checkedAt = new Date(this.now()).toISOString();
    const canonicalInput = await this.canonicalWorktreePath(worktreePath);

    const inside = text(await this.runRequired(canonicalInput, ["rev-parse", "--is-inside-work-tree"]));
    const bare = text(await this.runRequired(canonicalInput, ["rev-parse", "--is-bare-repository"]));
    if (inside !== "true" || bare !== "false") {
      throw new ContinuityWorktreeInvalidError("The requested path is not a non-bare Git worktree.");
    }

    const topLevelRaw = text(await this.runRequired(canonicalInput, ["rev-parse", "--show-toplevel"]));
    const commonGitDirRaw = text(await this.runRequired(canonicalInput, [
      "rev-parse", "--path-format=absolute", "--git-common-dir",
    ]));
    const gitDirRaw = text(await this.runRequired(canonicalInput, [
      "rev-parse", "--path-format=absolute", "--git-dir",
    ]));
    const canonicalPath = await this.realpathOrInvalid(topLevelRaw);
    const commonGitDir = await this.realpathOrInvalid(commonGitDirRaw);
    const gitDir = await this.realpathOrInvalid(gitDirRaw);
    if (canonicalPath !== canonicalInput) {
      throw new ContinuityWorktreeInvalidError("The registered worktree path must be the Git worktree root.");
    }

    const commonInfo = await stat(commonGitDir, { bigint: true });
    const gitDirInfo = await stat(gitDir, { bigint: true });
    if (!commonInfo.isDirectory() || !gitDirInfo.isDirectory()) {
      throw new ContinuityWorktreeInvalidError("The Git metadata path is not a directory.");
    }

    const repositoryRoot = path.basename(commonGitDir) === ".git"
      ? path.dirname(commonGitDir)
      : canonicalPath;
    const branchText = text(await this.runRequired(canonicalInput, ["branch", "--show-current"]));
    const branch = branchText === "" ? null : branchText;
    const headSha = text(await this.runRequired(canonicalInput, ["rev-parse", "HEAD"]));
    if (!/^[a-f0-9]{40,64}$/.test(headSha)) {
      throw new ContinuityWorktreeInvalidError("Git returned an invalid HEAD object ID.");
    }
    const status = await this.runRequired(canonicalInput, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const paths = parsePorcelainStatus(status.stdout, this.maxTrackedPaths);

    const identityValue: StoredWorktreeIdentity = {
      canonicalPath,
      repositoryRoot,
      commonGitDir,
      gitDir,
      repositoryIdentity: identity(commonGitDir, commonInfo.dev, commonInfo.ino),
      worktreeIdentity: identity(gitDir, gitDirInfo.dev, gitDirInfo.ino),
    };
    const local: ContinuityLocalState = {
      checkedAt,
      branch,
      headSha,
      ...paths,
    };
    const published = await this.inspectPublished(canonicalInput, branch, checkedAt, previousPublished);
    return { identity: identityValue, local, published };
  }

  async verifyIdentity(
    worktreePath: string,
    expected: StoredWorktreeIdentity,
    previousPublished?: ContinuityPublishedState,
  ): Promise<ContinuityInspection> {
    const current = await this.inspect(worktreePath, previousPublished);
    if (
      current.identity.canonicalPath !== expected.canonicalPath
      || current.identity.repositoryIdentity !== expected.repositoryIdentity
      || current.identity.worktreeIdentity !== expected.worktreeIdentity
    ) {
      throw new ContinuityWorktreeMismatchError();
    }
    return current;
  }

  private async canonicalWorktreePath(worktreePath: string): Promise<string> {
    if (!worktreePath.trim()) throw new ContinuityWorktreeInvalidError("Worktree path must not be empty.");
    return this.realpathOrInvalid(path.resolve(worktreePath));
  }

  private async realpathOrInvalid(pathname: string): Promise<string> {
    try {
      return await realpath(pathname);
    } catch (error) {
      throw new ContinuityWorktreeInvalidError(
        "The registered continuity worktree path could not be resolved.",
        { path: pathname, ...(causeCode(error) !== undefined ? { causeCode: causeCode(error) } : {}) },
      );
    }
  }

  private async runRequired(cwd: string, args: readonly string[]): Promise<ContinuityGitCommandResult> {
    let result: ContinuityGitCommandResult;
    try {
      result = await this.runGit(cwd, args, undefined);
    } catch (error) {
      throw new ContinuityWorktreeInvalidError(
        "Git worktree inspection failed.",
        { ...(causeCode(error) !== undefined ? { causeCode: causeCode(error) } : {}) },
      );
    }
    if (result.timedOut || result.outputLimitExceeded === true || result.exitCode !== 0) {
      throw new ContinuityWorktreeInvalidError("Git worktree inspection failed.", {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded === true,
      });
    }
    return result;
  }

  private async inspectPublished(
    cwd: string,
    branch: string | null,
    checkedAt: string,
    previous: ContinuityPublishedState | undefined,
  ): Promise<ContinuityPublishedState> {
    const branchRef = branch === null ? null : `refs/heads/${branch}`;
    const mainRef = "refs/heads/main";
    let originResult: ContinuityGitCommandResult;
    try {
      originResult = await this.runGit(cwd, ["remote", "get-url", "origin"], undefined);
    } catch {
      return this.remoteUnavailable(null, branchRef, mainRef, checkedAt, previous, "remote_error");
    }

    if (originResult.timedOut || originResult.outputLimitExceeded === true) {
      return this.remoteUnavailable(null, branchRef, mainRef, checkedAt, previous, "remote_error");
    }
    if (originResult.exitCode !== 0) {
      return this.remoteUnavailable(null, branchRef, mainRef, checkedAt, previous, "remote_missing");
    }

    const requestedRefs = [...new Set([...(branchRef === null ? [] : [branchRef]), mainRef])];
    let remoteResult: ContinuityGitCommandResult;
    try {
      remoteResult = await this.runGit(
        cwd,
        ["ls-remote", "--heads", "origin", ...requestedRefs],
        this.remoteVerificationTimeoutMs,
      );
    } catch {
      return this.remoteUnavailable("origin", branchRef, mainRef, checkedAt, previous, "remote_error");
    }

    if (
      remoteResult.timedOut
      || remoteResult.outputLimitExceeded === true
      || remoteResult.exitCode !== 0
    ) {
      return this.remoteUnavailable("origin", branchRef, mainRef, checkedAt, previous, "remote_error");
    }

    const refs = parseRemoteRefs(remoteResult.stdout);
    if (refs === null) {
      return this.remoteUnavailable("origin", branchRef, mainRef, checkedAt, previous, "remote_error");
    }

    const branchState = branchRef === null
      ? remoteRefState("not_found", null, undefined, checkedAt, previous?.branch, "detached_head")
      : this.authoritativeRefState(branchRef, refs, checkedAt, previous?.branch);
    const mainState = this.authoritativeRefState(mainRef, refs, checkedAt, previous?.main);
    return { remoteName: "origin", branch: branchState, main: mainState };
  }

  private authoritativeRefState(
    ref: string,
    refs: Map<string, string>,
    checkedAt: string,
    previous: RemoteRefState | undefined,
  ): RemoteRefState {
    const sha = refs.get(ref);
    return sha === undefined
      ? remoteRefState("not_found", ref, undefined, checkedAt, previous, undefined)
      : remoteRefState("verified", ref, sha, checkedAt, previous, undefined);
  }

  private remoteUnavailable(
    remoteName: "origin" | null,
    branchRef: string | null,
    mainRef: string,
    checkedAt: string,
    previous: ContinuityPublishedState | undefined,
    reason: "remote_missing" | "remote_error",
  ): ContinuityPublishedState {
    const branchState = branchRef === null
      ? remoteRefState("not_found", null, undefined, checkedAt, previous?.branch, "detached_head")
      : remoteRefState("unverified", branchRef, undefined, checkedAt, previous?.branch, reason);
    return {
      remoteName,
      branch: branchState,
      main: remoteRefState("unverified", mainRef, undefined, checkedAt, previous?.main, reason),
    };
  }
}
