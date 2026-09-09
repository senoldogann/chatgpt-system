import { access, constants, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface ExecutableResolution {
  name: string;
  allowed: boolean;
  available: boolean;
  resolvedPath: string | null;
}

export interface ExecutableResolutionOptions {
  pathValue?: string | undefined;
  homeDir?: string | undefined;
}

// Kullanıcı-home altındaki ek binary konumları. PATH davranışını değiştirmez,
// yalnızca allowlist'teki basename'lerin bulunamadığı durumda yedek arama yapar.
export function userLocalBinDirs(homeDir: string): string[] {
  return [
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, "bin"),
  ];
}

// Çözümleme için taranacak dizinler: PATH'teki mutlak girdiler önce,
// ardından PATH'te yoksa kullanıcı-local dizinler. Göreli PATH girdileri
// dışarıda bırakılır; spawn yedeği OS aramasını aynen korur.
export function resolutionSearchDirs(
  pathValue: string | undefined,
  homeDir: string,
): string[] {
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const entry of (pathValue ?? "").split(path.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed === "" || !path.isAbsolute(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    directories.push(trimmed);
  }
  for (const directory of userLocalBinDirs(homeDir)) {
    if (seen.has(directory)) continue;
    seen.add(directory);
    directories.push(directory);
  }
  return directories;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
  } catch {
    return false;
  }
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

// Yalnızca basename kabul eder; path girdileri her zaman çözümsüz döner.
export async function resolveExecutablePath(
  name: string,
  options: ExecutableResolutionOptions = {},
): Promise<string | null> {
  if (name === "" || name !== path.basename(name)) return null;
  const homeDir = options.homeDir ?? homedir();
  for (const directory of resolutionSearchDirs(options.pathValue, homeDir)) {
    const candidate = path.join(directory, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export async function resolveAllowedCommands(
  commands: string[],
  options: ExecutableResolutionOptions = {},
): Promise<ExecutableResolution[]> {
  const seen = new Set<string>();
  const resolutions: ExecutableResolution[] = [];
  for (const name of commands) {
    if (seen.has(name)) continue;
    seen.add(name);
    const resolvedPath = await resolveExecutablePath(name, options);
    resolutions.push({
      name,
      allowed: true,
      available: resolvedPath !== null,
      resolvedPath,
    });
  }
  return resolutions;
}
