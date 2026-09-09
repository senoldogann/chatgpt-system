import { arch, homedir, platform } from "node:os";
import type { AppConfig } from "./config.js";
import {
  resolutionSearchDirs,
  resolveAllowedCommands,
  type ExecutableResolution,
} from "./executable-resolution.js";

export interface SystemEnvironment {
  os: string;
  platform: NodeJS.Platform;
  arch: string;
  pathEntries: string[];
  roots: string[];
  terminal: {
    enabled: boolean;
  };
  executables: ExecutableResolution[];
}

export function prettyOperatingSystemName(current: NodeJS.Platform): string {
  if (current === "darwin") return "macOS";
  if (current === "linux") return "Linux";
  if (current === "win32") return "Windows";
  return current;
}

// Salt-okunur ortam özeti. Secret değerleri asla içermez: yalnızca efektif
// arama PATH'i, çözümlenmiş executable yolları ve zaten public olan
// allowlist isimleri döndürülür.
export async function describeSystemEnvironment(config: AppConfig): Promise<SystemEnvironment> {
  const current = platform();
  return {
    os: prettyOperatingSystemName(current),
    platform: current,
    arch: arch(),
    pathEntries: resolutionSearchDirs(process.env.PATH, homedir()),
    roots: [...config.roots],
    terminal: {
      enabled: config.terminal.enabled,
    },
    executables: await resolveAllowedCommands(config.terminal.commands, {
      pathValue: process.env.PATH,
    }),
  };
}
