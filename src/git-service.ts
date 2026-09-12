import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { PolicyError } from "./errors.js";
import { PathPolicy } from "./policy.js";

interface GitResult {
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitServiceOptions {
  remoteWriteEnabled?: boolean;
  remoteUrlPolicy?: (url: string) => boolean;
}

const SAFE_BRANCH_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GITHUB_HTTPS_REMOTE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/;
const GITHUB_SSH_REMOTE = /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/;
const GITHUB_SSH_URL_REMOTE = /^ssh:\/\/git@github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/;

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

  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly config: AppConfig,
    options: GitServiceOptions = {},
  ) {
    this.remoteWriteEnabled = options.remoteWriteEnabled === true;
    this.remoteUrlPolicy = options.remoteUrlPolicy ?? isAllowedGitHubOrigin;
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
    return this.run(cwd, ["status", "--porcelain=v1", "--branch"], "git.read", { operation: "status" });
  }

  async diff(cwd = ".", staged = false): Promise<GitResult> {
    return this.run(
      cwd,
      ["diff", "--no-ext-diff", "--no-textconv", ...(staged ? ["--cached"] : [])],
      "git.read",
      { operation: "diff", staged },
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

  async stagePaths(cwd = ".", paths: string[]): Promise<GitResult> {
    const resolved = await this.resolveStagePaths(cwd, paths);
    return this.run(
      resolved.cwd,
      ["add", "--", ...resolved.paths],
      "git.write",
      { operation: "stage_paths", pathCount: resolved.paths.length },
    );
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

  async push(cwd = "."): Promise<GitResult> {
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
      ["push", "--porcelain", "origin", `${branch}:refs/heads/${branch}`],
      "git.remote_write",
      { operation: "push_current_branch" },
    );
  }
}
