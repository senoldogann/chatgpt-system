import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import type { DetectedProjectCheck } from "./project-check-types.js";

// The repository determines the project and shared scheme; callers never supply
// xcodebuild arguments or execute scheme names as shell text.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_SCHEME_BYTES = 1024 * 1024;

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    const stat = await lstat(candidate);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function isRealDirectory(candidate: string): Promise<boolean> {
  try {
    const stat = await lstat(candidate);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function containsBuildAndTestActions(candidate: string): Promise<boolean> {
  // O_NOFOLLOW protects the final component after discovery; no symlinked
  // intermediate components are allowed by the directory checks above.
  let handle;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_SCHEME_BYTES) return false;
    const scheme = (await handle.readFile()).toString("utf8");
    return /<BuildAction(?:\s|\/|>)/.test(scheme) && /<TestAction(?:\s|\/|>)/.test(scheme);
  } catch (error) {
    if (["ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

/** Detect an unambiguous root Xcode project with exactly one shared build-and-test scheme. */
export async function discoverXcodeProjectChecks(repositoryRoot: string): Promise<DetectedProjectCheck[]> {
  const projects = (await readdir(repositoryRoot)).filter((name) => name.endsWith(".xcodeproj"));
  if (projects.length !== 1) return [];
  const projectName = projects[0]!;
  if (!SAFE_NAME.test(projectName.slice(0, -".xcodeproj".length))) return [];
  const project = path.join(repositoryRoot, projectName);
  if (!(await isRealDirectory(project)) || !(await isRegularFile(path.join(project, "project.pbxproj")))) return [];

  const shared = path.join(project, "xcshareddata");
  const schemeDirectory = path.join(shared, "xcschemes");
  if (!(await isRealDirectory(shared)) || !(await isRealDirectory(schemeDirectory))) return [];
  const schemes = (await readdir(schemeDirectory)).filter((name) => name.endsWith(".xcscheme"));
  if (schemes.length !== 1) return [];
  const schemeFile = schemes[0]!;
  const schemeName = schemeFile.slice(0, -".xcscheme".length);
  if (!SAFE_NAME.test(schemeName)) return [];
  const scheme = path.join(schemeDirectory, schemeFile);
  if (!(await isRegularFile(scheme)) || !(await containsBuildAndTestActions(scheme))) return [];

  const source = `${projectName}/xcshareddata/xcschemes/${schemeFile}`;
  const common = ["-project", projectName, "-scheme", schemeName] as const;
  return [
    {
      checkId: "xcode:test", kind: "test", command: "xcodebuild",
      args: ["-quiet", ...common, "-configuration", "Debug", "-destination", "platform=macOS",
        "-parallel-testing-enabled", "NO", "-jobs", "2",
        "CODE_SIGNING_ALLOWED=NO", "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES", "test"],
      cwd: ".", source, execution: "admin-host",
    },
    {
      checkId: "xcode:release-build", kind: "build", command: "xcodebuild",
      args: ["-quiet", ...common, "-configuration", "Release", "-destination", "platform=macOS",
        "-jobs", "2", "CODE_SIGNING_ALLOWED=NO", "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES", "build"],
      cwd: ".", source, execution: "admin-host",
    },
  ];
}
