import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { AuditLogger } from "./audit.js";
import type { AuthorityProfile } from "./authority.js";
import type { LimitsConfig } from "./config.js";
import { AuthorityDeniedError, CommandNotAllowedError, PolicyError, ProjectExecDisabledError } from "./errors.js";
import { PathPolicy } from "./policy.js";
import type { ProjectExecBackend, ProjectExecResult } from "./project-exec-types.js";

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function projectRootForCwd(roots: string[], cwd: string): string {
  const candidates = roots.filter((root) => isInside(root, cwd)).sort((left, right) => right.length - left.length);
  const root = candidates[0];
  if (!root) throw new PolicyError("Project execution cwd is outside all authority roots.");
  return root;
}

function validateProjectCommand(commands: string[], command: string, args: string[]): void {
  if (command !== basename(command) || !commands.includes(command)) {
    throw new CommandNotAllowedError(command, commands);
  }
  if (args.some((arg) => arg.includes("\u0000"))) {
    throw new PolicyError("Command arguments may not contain NUL bytes.");
  }
}

export class ProjectExecService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly backend: ProjectExecBackend,
    private readonly enabled: boolean,
    private readonly authorityProfile: AuthorityProfile,
    private readonly commands: string[],
    private readonly limits: Pick<LimitsConfig, "commandTimeoutMs">,
  ) {}

  async run(command: string, args: string[], cwdInput: string, timeoutMs: number): Promise<ProjectExecResult> {
    if (this.authorityProfile !== "project") {
      throw new AuthorityDeniedError("Sandboxed project execution requires a Project authority lease.");
    }
    if (!this.enabled) throw new ProjectExecDisabledError();
    validateProjectCommand(this.commands, command, args);

    const resolvedCwd = await this.policy.resolve(cwdInput);
    const info = await stat(resolvedCwd);
    if (!info.isDirectory()) throw new PolicyError("Project execution cwd must be a directory.");
    const [cwd, ...canonicalRoots] = await Promise.all([
      realpath(resolvedCwd),
      ...this.policy.roots.map((root) => realpath(root)),
    ]);
    const projectRoot = projectRootForCwd(canonicalRoots, cwd);
    const boundedTimeoutMs = Math.min(timeoutMs, this.limits.commandTimeoutMs);

    return this.audit.run(
      "project.exec",
      this.policy.display(resolvedCwd),
      () => this.backend.run({
        projectRoot,
        cwd,
        command,
        args: [...args],
        timeoutMs: boundedTimeoutMs,
      }),
      {
        command,
        argCount: args.length,
        backend: "docker",
        network: "none",
        timeoutMs: boundedTimeoutMs,
      },
    );
  }
}
