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
        limits: {
          ...baseConfig.limits,
          commandTimeoutMs: Math.min(timeoutMs, baseConfig.limits.commandTimeoutMs),
        },
      };
      return new ProcessService(policy, audit, scopedConfig).run(command, args, cwd);
    },
  };
}
