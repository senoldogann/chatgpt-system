import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { AuditLogger } from "./audit.js";
import { buildGitDiffArgs } from "./git-diff-command.js";
import type { AppConfig } from "./config.js";
import { ConflictError, LocalVerificationStaleError, PolicyError } from "./errors.js";
import { PathPolicy } from "./policy.js";

export interface GitResult {
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface VerifiedGitPush {
  branch: string;
  head: string;
}

export type GitInventoryCategory = "modified" | "untracked" | "deleted" | "ignored";

export type GitRiskClass = "none" | "secret" | "binary" | "artifact";

export interface GitInventoryEntry {
  path: string;
  category: GitInventoryCategory;
  risk: GitRiskClass;
  indexStatus?: string;
  worktreeStatus?: string;
}

export interface GitInventoryPage {
  cwd: string;
  entries: GitInventoryEntry[];
  cursor: number;
  snapshot: string;
  nextCursor?: number;
  complete: boolean;
}

export interface GitFileReview {
  cwd: string;
  path: string;
  diff: string;
  diffBytes: number;
  diffSha256: string;
  contentSha256: string | null;
  deletion: boolean;
  deletionEvidence: "worktree-path-missing" | "not-deleted";
  risk: GitRiskClass;
  contentEncoding: "utf8" | "base64";
}

export interface GitServiceOptions {
  remoteWriteEnabled?: boolean;
  remoteUrlPolicy?: (url: string) => boolean;
  beforeStage?: () => Promise<void> | void;
  beforeIndexWrite?: () => Promise<void> | void;
}

const SAFE_BRANCH_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GITHUB_HTTPS_REMOTE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/;
const GITHUB_SSH_REMOTE = /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/;
const GITHUB_SSH_URL_REMOTE = /^ssh:\/\/git@github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/i;
const SECRET_BASENAMES = /^(?:\.env(?:\..*)?|secrets?|credentials?|.*\.pem|.*\.key|id_rsa|id_ed25519)$/i;
const ARTIFACT_PATH = /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|target)(?:\/|$)|\.(?:o|a|so|dylib|dll|exe|bin|zip|tar|gz|tgz|wasm|pyc)$/i;

function riskForPath(relative: string): GitRiskClass {
  const basename = path.basename(relative);
  if (SECRET_BASENAMES.test(basename)) return "secret";
  if (ARTIFACT_PATH.test(relative)) return "artifact";
  if (/\.(?:png|jpe?g|gif|pdf|woff2?|ttf|mp3|mp4|mov)$/i.test(relative)) return "binary";
  return "none";
}

function isBinaryContent(content: Buffer): boolean {
  return content.includes(0);
}

export function validateBranchName(branch: string): string {
  if (branch.length < 1 || branch.length > 200 || branch !== branch.trim() || branch === "HEAD") {
    throw new PolicyError("Git branch name is not allowed.");
  }
  const components = branch.split("/");
  if (components.some((component) =>
    !SAFE_BRANCH_COMPONENT.test(component)
    || component.includes("..")
    || component.endsWith(".")
    || component.endsWith(".lock")
  )) {
    throw new PolicyError("Git branch name is not allowed.");
  }
  return branch;
}

function validateCommitMessage(message: string): string {
  if (!message.trim() || message.length > 500 || message.includes("\u0000")) {
    throw new PolicyError("Git commit message must contain 1-500 non-NUL characters.");
  }
  return message;
}

function isInside(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isAllowedGitHubOrigin(url: string): boolean {
  return GITHUB_HTTPS_REMOTE.test(url)
    || GITHUB_SSH_REMOTE.test(url)
    || GITHUB_SSH_URL_REMOTE.test(url);
}

const LEASE_WRITABLE_CONFIG_SCOPES: ReadonlySet<string> = new Set(["local", "worktree"]);
const COMMAND_CAPABLE_CONFIG_SECTIONS: ReadonlySet<string> = new Set(["alias", "pager"]);
const COMMAND_CAPABLE_CONFIG_VARIABLES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["browser", new Set(["cmd", "path"])],
  ["core", new Set([
    "alternaterefscommand",
    "askpass",
    "editor",
    "fsmonitor",
    "gitproxy",
    "hookspath",
    "pager",
    "sshcommand",
  ])],
  ["credential", new Set(["helper"])],
  ["diff", new Set(["command", "external", "textconv"])],
  ["filter", new Set(["clean", "process", "smudge"])],
  ["gpg", new Set(["program"])],
  ["init", new Set(["templatedir"])],
  ["interactive", new Set(["difffilter"])],
  ["merge", new Set(["driver"])],
  ["protocol", new Set(["command"])],
  ["remote", new Set(["receivepack", "uploadpack"])],
  ["sequence", new Set(["editor"])],
  ["trailer", new Set(["command"])],
  ["uploadpack", new Set(["packobjectshook"])],
  ["web", new Set(["browser"])],
]);

function isCommandCapableConfigKey(key: string): boolean {
  const segments = key.split(".");
  if (segments.length < 2) return false;
  const section = segments[0]!.toLowerCase();
  const variable = segments[segments.length - 1]!.toLowerCase();
  return COMMAND_CAPABLE_CONFIG_SECTIONS.has(section)
    || COMMAND_CAPABLE_CONFIG_VARIABLES.get(section)?.has(variable) === true;
}

function commandCapableConfigKeys(listing: string): string[] {
  const records = listing.split("\u0000");
  const offending: string[] = [];
  for (let index = 0; index + 1 < records.length; index += 2) {
    if (!LEASE_WRITABLE_CONFIG_SCOPES.has(records[index]!)) continue;
    const key = records[index + 1]!.split("\n")[0]!;
    if (isCommandCapableConfigKey(key)) offending.push(key);
  }
  return [...new Set(offending)].sort();
}

export class GitService {
  private readonly remoteWriteEnabled: boolean;
  private readonly remoteUrlPolicy: (url: string) => boolean;
  private readonly beforeStage: (() => Promise<void> | void) | undefined;
  private readonly beforeIndexWrite: (() => Promise<void> | void) | undefined;

  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly config: AppConfig,
    options: GitServiceOptions = {},
  ) {
    this.remoteWriteEnabled = options.remoteWriteEnabled === true;
    this.remoteUrlPolicy = options.remoteUrlPolicy ?? isAllowedGitHubOrigin;
    this.beforeStage = options.beforeStage;
    this.beforeIndexWrite = options.beforeIndexWrite;
  }

  private async run(
    cwdInput: string,
    args: string[],
    auditAction = "git.read",
    metadata: Record<string, unknown> = {},
  ): Promise<GitResult> {
    const cwd = await this.policy.resolve(cwdInput);
    return this.audit.run(auditAction, this.policy.display(cwd), async () => {
      await this.assertRepositoryAuthority(cwd);
      return this.spawnGit(cwd, args, auditAction);
    }, metadata);
  }

  private async assertRepositoryAuthority(cwd: string): Promise<void> {
    const toplevel = await this.spawnGit(cwd, ["rev-parse", "--show-toplevel"], "git.read");
    const repositoryRoot = toplevel.stdout.trim();
    if (toplevel.exitCode !== 0 || !repositoryRoot) {
      throw new PolicyError("Git operations require a repository inside an allowed root.", {
        cwd: this.policy.display(cwd),
        stderr: toplevel.stderr.trim(),
      });
    }
    await this.policy.resolve(repositoryRoot);

    const listed = await this.spawnGit(cwd, ["config", "--list", "--show-scope", "--null"], "git.read");
    if (listed.exitCode !== 0) {
      throw new PolicyError("Git repository configuration could not be inspected for command-capable settings.", {
        cwd: this.policy.display(cwd),
        exitCode: listed.exitCode,
        stderr: listed.stderr.trim(),
      });
    }
    const offending = commandCapableConfigKeys(listed.stdout);
    if (offending.length > 0) {
      throw new PolicyError(
        "Git repository configuration can run external commands; remove these repository-scoped settings before using Git tools.",
        { cwd: this.policy.display(cwd), keys: offending },
      );
    }
  }

  private spawnGitWithInput(cwd: string, args: string[], input: Buffer, auditAction: string): Promise<GitResult> {
    return new Promise<GitResult>((resolve, reject) => {
      const child = spawn("git", [
        "-c", "core.hooksPath=/dev/null",
        "-c", "core.fsmonitor=false",
        "-c", "diff.external=",
        "-c", "interactive.diffFilter=",
        "-c", "commit.gpgSign=false",
        ...args,
      ], {
        cwd,
        shell: false,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: auditAction === "git.read" ? "0" : "1",
          GIT_LITERAL_PATHSPECS: "1",
          GIT_PAGER: "cat",
          PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, this.config.limits.commandTimeoutMs);
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut) { reject(new PolicyError("Git command exceeded the configured timeout.")); return; }
        resolve({ cwd: this.policy.display(cwd), exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      });
      child.stdin.end(input);
    });
  }

  private async runWithInput(cwdInput: string, args: string[], input: Buffer, auditAction: string, metadata: Record<string, unknown> = {}): Promise<GitResult> {
    const cwd = await this.policy.resolve(cwdInput);
    return this.audit.run(auditAction, this.policy.display(cwd), async () => {
      await this.assertRepositoryAuthority(cwd);
      return this.spawnGitWithInput(cwd, args, input, auditAction);
    }, metadata);
  }

  private spawnGit(cwd: string, args: string[], auditAction: string): Promise<GitResult> {
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
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: auditAction === "git.read" ? "0" : "1",
            GIT_LITERAL_PATHSPECS: "1",
            GIT_PAGER: "cat",
            PAGER: "cat",
            GIT_TERMINAL_PROMPT: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let tooLarge = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.config.limits.commandTimeoutMs);
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > this.config.limits.maxCommandOutputBytes) {
          tooLarge = true;
          child.kill("SIGKILL");
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new PolicyError("Git command exceeded the configured timeout."));
          return;
        }
        if (tooLarge) {
          reject(new PolicyError("Git output exceeded the configured limit."));
          return;
        }
        resolve({
          cwd: this.policy.display(cwd),
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  }

  private async resolveStagePaths(cwdInput: string, inputs: string[]): Promise<{ cwd: string; paths: string[] }> {
    if (inputs.length < 1 || inputs.length > 100) {
      throw new PolicyError("Git staging requires between 1 and 100 explicit paths.");
    }
    const cwd = await this.policy.resolve(cwdInput);
    const resolvedPaths: string[] = [];

    for (const input of inputs) {
      if (!input || input.includes("\u0000")) throw new PolicyError("Git stage path is not allowed.");
      const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(cwd, input);
      const resolved = await this.policy.resolve(candidate);
      if (!isInside(cwd, resolved) || resolved === cwd) {
        throw new PolicyError("Git stage paths must be explicit files inside the selected repository directory.");
      }
      try {
        const info = await lstat(resolved);
        if (info.isDirectory()) {
          throw new PolicyError("Git stage paths must name files, not directories.");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      resolvedPaths.push(path.relative(cwd, resolved));
    }

    return { cwd, paths: [...new Set(resolvedPaths)] };
  }

  async status(cwd = "."): Promise<GitResult> {
    return this.run(cwd, ["status", "--porcelain=v1", "--branch", "--untracked-files=all"], "git.read", { operation: "status" });
  }

  async inventory(cwdInput = ".", cursor = 0, pageSize = 100, snapshot?: string): Promise<GitInventoryPage> {
    if (!Number.isInteger(cursor) || cursor < 0) throw new PolicyError("Git inventory cursor must be a non-negative integer.");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new PolicyError("Git inventory page size must be between 1 and 200.");
    const status = await this.run(cwdInput, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], "git.read", { operation: "inventory" });
    const ignored = await this.run(cwdInput, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], "git.read", { operation: "inventory_ignored" });
    if (status.exitCode !== 0 || ignored.exitCode !== 0) throw new PolicyError("Git inventory could not be collected.", { exitCode: status.exitCode || ignored.exitCode });
    if (cursor > 0 && (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot))) {
      throw new ConflictError("A Git inventory snapshot is required to continue pagination.", { cursor });
    }
    const snapshotDigest = createHash("sha256").update(`${status.stdout}\0${ignored.stdout}`).digest("hex");
    if (snapshot !== undefined && snapshot !== snapshotDigest) {
      throw new ConflictError("The Git worktree changed while inventory pages were being read.", { snapshot, currentSnapshot: snapshotDigest });
    }
    const entries = new Map<string, GitInventoryEntry>();
    const statusRecords = status.stdout.split("\0");
    for (let index = 0; index < statusRecords.length; index += 1) {
      const record = statusRecords[index]!;
      if (!record) continue;
      if (record.length < 4 || record[2] !== " ") throw new PolicyError("Git returned invalid inventory status data.");
      const indexStatus = record[0]!;
      const worktreeStatus = record[1]!;
      const pathname = record.slice(3);
      const category: GitInventoryCategory = indexStatus === "?" && worktreeStatus === "?"
        ? "untracked"
        : indexStatus === "D" || worktreeStatus === "D" ? "deleted" : "modified";
      entries.set(pathname, { path: pathname, category, risk: riskForPath(pathname), indexStatus, worktreeStatus });
      if (["R", "C"].includes(indexStatus) || ["R", "C"].includes(worktreeStatus)) index += 1;
    }
    for (const pathname of ignored.stdout.split("\0").filter(Boolean)) {
      if (!entries.has(pathname)) entries.set(pathname, { path: pathname, category: "ignored", risk: riskForPath(pathname) });
    }
    const ordered = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path) || left.category.localeCompare(right.category));
    const page = ordered.slice(cursor, cursor + pageSize);
    const nextCursor = cursor + page.length < ordered.length ? cursor + page.length : undefined;
    return {
      cwd: status.cwd,
      entries: page,
      cursor,
      snapshot: snapshotDigest,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      complete: nextCursor === undefined,
    };
  }

  async fileReview(cwdInput: string, inputPath: string): Promise<GitFileReview> {
    if (!inputPath || inputPath.includes("\u0000") || path.isAbsolute(inputPath)) throw new PolicyError("Git file review requires a relative path.");
    const cwd = await this.policy.resolve(cwdInput);
    const candidate = path.resolve(cwd, inputPath);
    if (!isInside(cwd, candidate) || candidate === cwd) throw new PolicyError("Git file review path must stay inside the selected repository.");
    const relative = path.relative(cwd, candidate);
    const result = await this.run(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", relative], "git.read", { operation: "file_review" });
    let diff = result.stdout;
    let contentSha256: string | null = null;
    let deletion = false;
    let contentEncoding: "utf8" | "base64" = "utf8";
    const risk = riskForPath(relative);
    try {
      const info = await lstat(candidate);
      if (!info.isFile()) throw new PolicyError("Git file review only supports regular files.", { path: relative });
      if (info.size > this.config.limits.maxReadBytes) throw new PolicyError("Git file review exceeds the configured size limit.", { path: relative, size: info.size });
      const content = await readFile(candidate);
      contentSha256 = createHash("sha256").update(content).digest("hex");
      if (isBinaryContent(content)) {
        contentEncoding = "base64";
        if (diff.length === 0) diff = content.toString("base64");
      } else if (diff.length === 0) {
        diff = content.toString("utf8");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      deletion = true;
    }
    if (risk === "secret") diff = "[REDACTED: secret-risk path; content hash retained]";
    return {
      cwd: result.cwd,
      path: relative,
      diff,
      diffBytes: Buffer.byteLength(diff, "utf8"),
      diffSha256: createHash("sha256").update(diff).digest("hex"),
      contentSha256,
      deletion,
      deletionEvidence: deletion ? "worktree-path-missing" : "not-deleted",
      risk: contentEncoding === "base64" ? "binary" : risk,
      contentEncoding,
    };
  }

  async diff(cwd = ".", staged = false, check = false): Promise<GitResult> {
    return this.run(
      cwd,
      buildGitDiffArgs(staged, check),
      "git.read",
      { operation: check ? "diff_check" : "diff", staged },
    );
  }

  async log(cwd = ".", limit = 20): Promise<GitResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new PolicyError("Git log limit must be between 1 and 100.");
    return this.run(
      cwd,
      ["log", `-${limit}`, "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%an%x09%s"],
      "git.read",
      { operation: "log", limit },
    );
  }

  async createBranch(cwd = ".", branch: string): Promise<GitResult> {
    const safeBranch = validateBranchName(branch);
    return this.run(cwd, ["switch", "-c", safeBranch], "git.write", { operation: "create_branch" });
  }

  async switchBranch(cwd = ".", branch: string): Promise<GitResult> {
    const safeBranch = validateBranchName(branch);
    return this.run(cwd, ["switch", safeBranch], "git.write", { operation: "switch_branch" });
  }

  async stagePaths(cwd = ".", paths: string[], expectedSha256?: Record<string, string>): Promise<GitResult> {
    const resolved = await this.resolveStagePaths(cwd, paths);
    if (!expectedSha256 || Object.keys(expectedSha256).length !== resolved.paths.length || resolved.paths.some((item) => expectedSha256[item] === undefined)) {
      throw new ConflictError("Safe Git staging requires expectedSha256 for every explicit path.", { paths: resolved.paths });
    }
    for (const [inputPath, expected] of Object.entries(expectedSha256)) {
      if (!resolved.paths.includes(inputPath)) throw new PolicyError("Every expected Git path must be included in paths.");
      if (!/^[a-f0-9]{64}$/.test(expected) && expected !== "deleted") throw new PolicyError("Git expected SHA-256 is invalid.");
      const absolute = path.resolve(resolved.cwd, inputPath);
      try {
        const content = await readFile(absolute);
        const actual = createHash("sha256").update(content).digest("hex");
        if (actual !== expected) throw new ConflictError("A staged file changed since its expected SHA-256 was observed.", { path: inputPath });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && expected === "deleted") continue;
        throw error;
      }
    }
    await this.beforeStage?.();
    // Re-read immediately before the index mutation; no caller-controlled path is used
    // as a Git argument other than after PathPolicy resolution above.
    const approved = new Map<string, Buffer>();
    for (const inputPath of resolved.paths) {
      const expected = expectedSha256[inputPath]!;
      const absolute = path.resolve(resolved.cwd, inputPath);
      try {
        const content = await readFile(absolute);
        const actual = createHash("sha256").update(content).digest("hex");
        if (expected !== actual) throw new ConflictError("A file changed during the review-to-stage window.", { path: inputPath });
        approved.set(inputPath, content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && expected === "deleted") continue;
        throw error;
      }
    }
    await this.beforeIndexWrite?.();
    const stagedResults: GitResult[] = [];
    for (const inputPath of resolved.paths) {
      const expected = expectedSha256[inputPath]!;
      if (expected === "deleted") {
        stagedResults.push(await this.run(resolved.cwd, ["update-index", "--remove", "--", inputPath], "git.write", { operation: "stage_deletion", path: inputPath }));
        continue;
      }
      const content = approved.get(inputPath);
      if (!content) throw new ConflictError("Approved file content was not retained for staging.", { path: inputPath });
      const info = await lstat(path.resolve(resolved.cwd, inputPath));
      if (!info.isFile()) throw new ConflictError("The reviewed file type changed before staging.", { path: inputPath });
      const mode = (info.mode & 0o111) !== 0 ? "100755" : "100644";
      const blob = await this.runWithInput(resolved.cwd, ["hash-object", "-w", "--stdin"], content, "git.write", { operation: "create_approved_blob", path: inputPath });
      if (blob.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(blob.stdout.trim())) throw new ConflictError("Git could not create the approved content blob.", { path: inputPath });
      stagedResults.push(await this.run(resolved.cwd, ["update-index", "--add", "--cacheinfo", `${mode},${blob.stdout.trim()},${inputPath}`], "git.write", { operation: "stage_approved_blob", path: inputPath }));
    }
    const failed = stagedResults.find((result) => result.exitCode !== 0);
    if (failed) return failed;
    for (const inputPath of resolved.paths) {
      const expected = expectedSha256[inputPath]!;
      const index = await this.run(resolved.cwd, ["ls-files", "--stage", "-z", "--", inputPath], "git.read", { operation: "verify_staged_blob", path: inputPath });
      if (expected === "deleted") {
        if (index.stdout.length > 0) throw new ConflictError("The Git index contains content for an approved deletion.", { path: inputPath });
        continue;
      }
      const indexHeader = index.stdout.split("\0", 1)[0];
      const blobId = indexHeader?.split(" ")[1]?.split("\t", 1)[0];
      const approvedContent = approved.get(inputPath)!;
      const expectedBlob = (await this.runWithInput(resolved.cwd, ["hash-object", "--stdin"], approvedContent, "git.read", { operation: "verify_approved_blob", path: inputPath })).stdout.trim();
      if (index.exitCode !== 0 || blobId !== expectedBlob) throw new ConflictError("The Git index does not contain the approved raw blob.", { path: inputPath });
    }
    return stagedResults[stagedResults.length - 1]!;
  }

  async commit(cwd = ".", message: string): Promise<GitResult> {
    const safeMessage = validateCommitMessage(message);
    return this.run(cwd, ["commit", "-m", safeMessage], "git.write", { operation: "commit" });
  }

  async mergeBranch(cwd = ".", branch: string): Promise<GitResult> {
    const safeBranch = validateBranchName(branch);
    return this.run(
      cwd,
      ["merge", "--no-ff", "--no-edit", "--", safeBranch],
      "git.write",
      { operation: "merge_branch" },
    );
  }

  async push(cwd = ".", expected?: VerifiedGitPush): Promise<GitResult> {
    if (!this.remoteWriteEnabled) {
      throw new PolicyError("Git push requires an Admin authority lease.");
    }

    const branchResult = await this.run(
      cwd,
      ["branch", "--show-current"],
      "git.read",
      { operation: "current_branch" },
    );
    if (branchResult.exitCode !== 0 || !branchResult.stdout.trim()) {
      throw new PolicyError("Git push requires a named current branch.");
    }
    const branch = validateBranchName(branchResult.stdout.trim());

    let source = branch;
    if (expected !== undefined) {
      const expectedBranch = validateBranchName(expected.branch);
      if (!GIT_OBJECT_ID.test(expected.head) || branch !== expectedBranch) {
        throw new LocalVerificationStaleError();
      }
      const headResult = await this.run(
        cwd,
        ["rev-parse", "HEAD"],
        "git.read",
        { operation: "head_lookup" },
      );
      if (headResult.exitCode !== 0 || headResult.stdout.trim() !== expected.head) {
        throw new LocalVerificationStaleError();
      }
      source = expected.head;
    }

    const remoteResult = await this.run(
      cwd,
      ["remote", "get-url", "--push", "origin"],
      "git.read",
      { operation: "origin_lookup" },
    );
    const remoteUrl = remoteResult.stdout.trim();
    if (remoteResult.exitCode !== 0 || !this.remoteUrlPolicy(remoteUrl)) {
      throw new PolicyError("Git push is restricted to a credential-free GitHub origin URL.");
    }

    return this.run(
      cwd,
      ["push", "--porcelain", "origin", `${source}:refs/heads/${branch}`],
      "git.remote_write",
      { operation: expected === undefined ? "push_current_branch" : "push_verified_head" },
    );
  }
}
