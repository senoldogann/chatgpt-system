import { lstat } from "node:fs/promises";
import path from "node:path";
import type { DetectedProjectCheck } from "./project-check-types.js";

// Native scripts are metadata, never shell input. Only the fixed Swift test form
// is eligible for an explicitly Admin-authorized host verification lane.
const MACOS_TEST_SCRIPT = /^test(?::[a-z0-9][a-z0-9-]*)*:macos$/;
const SWIFT_TEST = /^swift test(?: --package-path ([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+){0,7}))?$/;

export function isNativeMacosScriptInvocation(command: string, args: readonly string[]): boolean {
  if (!["npm", "pnpm", "yarn", "bun"].includes(command)) return false;
  // yarn and bun also run a package script without an explicit `run` subcommand.
  const name = (args[0] === "run" || args[0] === "run-script")
    ? args[1] : (command === "yarn" || command === "bun" ? args[0] : undefined);
  return typeof name === "string" && name.length <= 100 && /^[a-z][a-z0-9:_-]*:macos$/.test(name);
}

async function safePackageManifest(root: string, relativePackage: string): Promise<boolean> {
  let current = root;
  if (relativePackage !== ".") {
    for (const component of relativePackage.split("/")) {
      current = path.join(current, component);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink()) return false;
    }
  }
  try {
    const info = await lstat(path.join(current, "Package.swift"));
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Discover explicitly declared native Swift tests without ever executing package scripts. */
export async function discoverNativeSwiftTestChecks(
  repositoryRoot: string,
  scripts: Record<string, unknown>,
): Promise<DetectedProjectCheck[]> {
  const result: DetectedProjectCheck[] = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (name.length > 100 || !MACOS_TEST_SCRIPT.test(name)
        || typeof value !== "string" || value.length > 512) continue;
    const match = SWIFT_TEST.exec(value.trim());
    if (!match) continue;
    const packagePath = match[1] ?? ".";
    if (!(await safePackageManifest(repositoryRoot, packagePath))) continue;
    result.push({
      checkId: `package-script:${name}`,
      kind: "test",
      command: "swift",
      args: packagePath === "." ? ["test"] : ["test", "--package-path", packagePath],
      cwd: ".",
      source: `package.json#scripts.${name}`,
      execution: "admin-host",
    });
    if (result.length >= 32) break;
  }
  return result;
}
