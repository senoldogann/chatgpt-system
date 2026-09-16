import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveComputerFlowMetrics, type ComputerFlowRuntimeBuild } from "../benchmarks/computer-use-flow-performance/contract.js";
import {
  deriveMachineClassId,
  deriveRuntimeBuildIdentity,
  readComputerFlowRuntimeIdentity,
  type ComputerFlowRuntimeIdentityAdapters,
} from "../benchmarks/computer-use-flow-performance/identity.js";

function sha256(...parts: (string | Uint8Array)[]): string {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest("hex");
}

function adapters(overrides: Partial<ComputerFlowRuntimeIdentityAdapters> = {}): ComputerFlowRuntimeIdentityAdapters {
  return {
    execGit: async (_cwd, args) => {
      const command = args.join(" ");
      if (command === "rev-parse HEAD") return { exitCode: 0, stdout: Buffer.from("a".repeat(40) + "\n") };
      if (command === "diff --no-ext-diff --no-textconv --binary HEAD --") return { exitCode: 0, stdout: Buffer.alloc(0) };
      if (command === "ls-files --others --exclude-standard -z") return { exitCode: 0, stdout: Buffer.alloc(0) };
      throw new Error(`unexpected git command ${command}`);
    },
    listArtifactFiles: async () => ["z.js", "a.js"],
    readFile: async (file) => Buffer.from(file.endsWith("a.js") ? "A" : file.endsWith("z.js") ? "Z" : "HELPER"),
    machine: () => ({
      platform: "darwin",
      architecture: "arm64",
      osMajorVersion: "25",
      cpuModel: "Apple M4",
      logicalCpuCount: 10,
      memoryGiBBucket: 32,
    }),
    ...overrides,
  };
}

describe("computer flow runtime identity", () => {
  it("derives machine class only from the approved coarse fields", () => {
    const base = {
      platform: "darwin" as const,
      architecture: "arm64",
      osMajorVersion: "25",
      cpuModel: "Apple M4",
      logicalCpuCount: 10,
      memoryGiBBucket: 32,
    };
    const first = deriveMachineClassId(base);
    expect(first).toBe(deriveMachineClassId({ ...base }));
    for (const changed of [
      { ...base, architecture: "x64" },
      { ...base, osMajorVersion: "26" },
      { ...base, cpuModel: "Other" },
      { ...base, logicalCpuCount: 12 },
      { ...base, memoryGiBBucket: 48 },
    ]) expect(deriveMachineClassId(changed)).not.toBe(first);
  });

  it("derives build id from every immutable runtime-build identity field", () => {
    const base: Omit<ComputerFlowRuntimeBuild, "buildId"> = {
      gitCommit: "a".repeat(40),
      workingTreeDigest: "b".repeat(64),
      computerProtocolVersion: 1,
      typeScriptArtifactSha256: "c".repeat(64),
      nativeHelperExecutableSha256: "d".repeat(64),
    };
    const build = deriveRuntimeBuildIdentity(base);
    expect(build.buildId).toHaveLength(64);
    for (const changed of [
      { ...base, gitCommit: "f".repeat(40) },
      { ...base, workingTreeDigest: "e".repeat(64) },
      { ...base, computerProtocolVersion: 2 },
      { ...base, typeScriptArtifactSha256: "1".repeat(64) },
      { ...base, nativeHelperExecutableSha256: "2".repeat(64) },
    ]) expect(deriveRuntimeBuildIdentity(changed).buildId).not.toBe(build.buildId);
  });

  it("reads only a clean tree, matches task-state clean digest, sorts artifact paths, and hashes exact helper bytes", async () => {
    const identity = await readComputerFlowRuntimeIdentity({
      repositoryRoot: "/repo",
      distDirectory: "/repo/dist",
      nativeHelperExecutablePath: "/helper",
      protocolVersion: 1,
    }, adapters());

    const expectedWorkingTreeDigest = sha256("tracked-diff\0", Buffer.alloc(0), "\0untracked\0");
    expect(identity.runtimeBuild.workingTreeDigest).toBe(expectedWorkingTreeDigest);
    expect(identity.runtimeBuild.nativeHelperExecutableSha256).toBe(sha256("HELPER"));
    expect(identity.runtimeBuild.typeScriptArtifactSha256).toBe(sha256("a.js\0", "A", "\0", "z.js\0", "Z", "\0"));
    expect(identity.machineClassId).toBe(deriveMachineClassId(adapters().machine()));
  });

  it("rejects tracked or untracked working-tree changes", async () => {
    await expect(readComputerFlowRuntimeIdentity({
      repositoryRoot: "/repo",
      distDirectory: "/repo/dist",
      nativeHelperExecutablePath: "/helper",
      protocolVersion: 1,
    }, adapters({ execGit: async (_cwd, args) => args[0] === "diff"
      ? { exitCode: 0, stdout: Buffer.from("dirty") }
      : args[0] === "ls-files"
        ? { exitCode: 0, stdout: Buffer.alloc(0) }
        : { exitCode: 0, stdout: Buffer.from("a".repeat(40) + "\n") } }))).rejects.toThrow(/clean/i);

    await expect(readComputerFlowRuntimeIdentity({
      repositoryRoot: "/repo",
      distDirectory: "/repo/dist",
      nativeHelperExecutablePath: "/helper",
      protocolVersion: 1,
    }, adapters({ execGit: async (_cwd, args) => args[0] === "diff"
      ? { exitCode: 0, stdout: Buffer.alloc(0) }
      : args[0] === "ls-files"
        ? { exitCode: 0, stdout: Buffer.from("new.txt\0") }
        : { exitCode: 0, stdout: Buffer.from("a".repeat(40) + "\n") } }))).rejects.toThrow(/clean/i);
  });

  it("keeps metric derivation mode-aware instead of manufacturing unavailable Agent metrics", () => {
    const metrics = deriveComputerFlowMetrics([], [], "agent");
    expect(metrics.computerToolCallCount).toEqual({ availability: "unavailable", reason: "lossy_audit_source" });
    expect(metrics.modelRoundTripCount).toEqual({ availability: "unavailable", reason: "missing_turn_correlation" });
    expect(metrics.endToEndDurationMs).toEqual({ availability: "unavailable", reason: "missing_turn_correlation" });
  });
});
