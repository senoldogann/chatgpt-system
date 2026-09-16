import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ComputerFlowRuntimeBuild } from "./contract.js";

export interface ComputerFlowMachineClassInput {
  platform: NodeJS.Platform;
  architecture: string;
  osMajorVersion: string;
  cpuModel: string;
  logicalCpuCount: number;
  memoryGiBBucket: number;
}

export interface ComputerFlowRuntimeIdentityInput {
  repositoryRoot: string;
  distDirectory: string;
  nativeHelperExecutablePath: string;
  protocolVersion: number;
}

export interface ComputerFlowGitCommandResult {
  exitCode: number;
  stdout: Buffer;
}

export interface ComputerFlowRuntimeIdentityAdapters {
  execGit(cwd: string, args: readonly string[]): Promise<ComputerFlowGitCommandResult>;
  listArtifactFiles(distDirectory: string): Promise<readonly string[]>;
  readFile(filePath: string): Promise<Buffer>;
  machine(): ComputerFlowMachineClassInput;
}

const execFileAsync = promisify(execFile);

function hashParts(...parts: readonly (string | Uint8Array)[]): string {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest("hex");
}

function canonicalMachine(input: ComputerFlowMachineClassInput): string {
  return JSON.stringify({
    architecture: input.architecture,
    cpuModel: input.cpuModel,
    logicalCpuCount: input.logicalCpuCount,
    memoryGiBBucket: input.memoryGiBBucket,
    osMajorVersion: input.osMajorVersion,
    platform: input.platform,
  });
}

function canonicalBuild(input: Omit<ComputerFlowRuntimeBuild, "buildId">): string {
  return JSON.stringify({
    computerProtocolVersion: input.computerProtocolVersion,
    gitCommit: input.gitCommit,
    nativeHelperExecutableSha256: input.nativeHelperExecutableSha256,
    typeScriptArtifactSha256: input.typeScriptArtifactSha256,
    workingTreeDigest: input.workingTreeDigest,
  });
}

export function deriveMachineClassId(input: ComputerFlowMachineClassInput): string {
  return hashParts("computer-use-flow-machine-v1\0", canonicalMachine(input));
}

export function deriveRuntimeBuildIdentity(
  input: Omit<ComputerFlowRuntimeBuild, "buildId">,
): ComputerFlowRuntimeBuild {
  return {
    ...input,
    buildId: hashParts("computer-use-flow-build-v1\0", canonicalBuild(input)),
  };
}

async function listJavaScriptFiles(directory: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? path.posix.join(prefix.split(path.sep).join(path.posix.sep), entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(directory, relative));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(relative.split(path.sep).join(path.posix.sep));
    }
  }
  return files;
}

function defaultMachine(): ComputerFlowMachineClassInput {
  const releaseMajor = os.release().split(".")[0] ?? "0";
  const osMajorVersion = /^\d+$/.test(releaseMajor) ? releaseMajor : "0";
  const totalGiB = os.totalmem() / 2 ** 30;
  return {
    platform: process.platform,
    architecture: os.arch(),
    osMajorVersion,
    cpuModel: os.cpus()[0]?.model ?? "unavailable",
    logicalCpuCount: os.cpus().length,
    memoryGiBBucket: Math.max(16, Math.ceil(totalGiB / 16) * 16),
  };
}

const defaultAdapters: ComputerFlowRuntimeIdentityAdapters = {
  async execGit(cwd, args) {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "buffer",
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
    });
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
    return { exitCode: 0, stdout };
  },
  listArtifactFiles: async (distDirectory) => listJavaScriptFiles(distDirectory),
  readFile,
  machine: defaultMachine,
};

function requireGitSuccess(result: ComputerFlowGitCommandResult, description: string): Buffer {
  if (result.exitCode !== 0) throw new Error(`Computer flow identity could not ${description}.`);
  return result.stdout;
}

export async function readComputerFlowRuntimeIdentity(
  input: ComputerFlowRuntimeIdentityInput,
  adapters: ComputerFlowRuntimeIdentityAdapters = defaultAdapters,
): Promise<{ runtimeBuild: ComputerFlowRuntimeBuild; machineClassId: string }> {
  const commitBytes = requireGitSuccess(
    await adapters.execGit(input.repositoryRoot, ["rev-parse", "HEAD"]),
    "read the Git commit",
  );
  const trackedDiff = requireGitSuccess(
    await adapters.execGit(input.repositoryRoot, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"]),
    "inspect tracked working-tree changes",
  );
  const untracked = requireGitSuccess(
    await adapters.execGit(input.repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    "inspect untracked working-tree files",
  );
  if (trackedDiff.byteLength !== 0 || untracked.byteLength !== 0) {
    throw new Error("Computer flow runtime identity requires a clean Git working tree.");
  }

  const gitCommit = commitBytes.toString("utf8").trim();
  if (!gitCommit) throw new Error("Computer flow runtime identity requires a Git commit.");

  const workingTreeDigest = hashParts("tracked-diff\0", trackedDiff, "\0untracked\0");
  const artifactFiles = [...await adapters.listArtifactFiles(input.distDirectory)].sort();
  const artifactDigest = createHash("sha256");
  for (const relativePath of artifactFiles) {
    const normalized = relativePath.split(path.sep).join(path.posix.sep);
    if (!normalized.endsWith(".js") || path.isAbsolute(relativePath) || normalized.startsWith("../")) {
      throw new Error("Computer flow artifact list contains an invalid relative JavaScript path.");
    }
    artifactDigest.update(normalized);
    artifactDigest.update("\0");
    artifactDigest.update(await adapters.readFile(path.join(input.distDirectory, relativePath)));
    artifactDigest.update("\0");
  }

  const helperBytes = await adapters.readFile(input.nativeHelperExecutablePath);
  const runtimeBuild = deriveRuntimeBuildIdentity({
    gitCommit,
    workingTreeDigest,
    computerProtocolVersion: input.protocolVersion,
    typeScriptArtifactSha256: artifactDigest.digest("hex"),
    nativeHelperExecutableSha256: hashParts(helperBytes),
  });
  return {
    runtimeBuild,
    machineClassId: deriveMachineClassId(adapters.machine()),
  };
}
