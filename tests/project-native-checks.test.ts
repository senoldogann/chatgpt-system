import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverNativeSwiftTestChecks, isNativeMacosScriptInvocation } from "../src/project-native-checks.js";

describe("native project-check discovery", () => {
  it("classifies macOS package-manager scripts without reclassifying portable checks", () => {
    expect(isNativeMacosScriptInvocation("npm", ["run", "test:computer:macos"])).toBe(true);
    expect(isNativeMacosScriptInvocation("pnpm", ["run", "build:macos"])).toBe(true);
    expect(isNativeMacosScriptInvocation("yarn", ["test:computer:macos"])).toBe(true);
    expect(isNativeMacosScriptInvocation("bun", ["test:computer:macos"])).toBe(true);
    expect(isNativeMacosScriptInvocation("npm", ["run", "check"])).toBe(false);
    expect(isNativeMacosScriptInvocation("bun", ["install"])).toBe(false);
    expect(isNativeMacosScriptInvocation("bun", ["test"])).toBe(false);
    expect(isNativeMacosScriptInvocation("swift", ["test"])).toBe(false);
  });

  it("accepts only exact in-repository Swift tests and rejects shell syntax, traversal and symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "native-check-vitest-"));
    try {
      await mkdir(path.join(root, "native", "computer"), { recursive: true });
      await writeFile(path.join(root, "native", "computer", "Package.swift"), "// fixture");
      await symlink(path.join(root, "native", "computer"), path.join(root, "native", "linked"));
      const checks = await discoverNativeSwiftTestChecks(root, {
        "test:computer:macos": "swift test --package-path native/computer",
        "test:escape:macos": "swift test --package-path ../outside",
        "test:shell:macos": "swift test --package-path native/computer && echo unexpected",
        "test:linked:macos": "swift test --package-path native/linked",
        "test:missing:macos": "swift test --package-path native/absent",
        "test:linux": "swift test --package-path native/computer",
      });
      expect(checks).toEqual([{
        checkId: "package-script:test:computer:macos", kind: "test", command: "swift",
        args: ["test", "--package-path", "native/computer"], cwd: ".",
        source: "package.json#scripts.test:computer:macos", execution: "admin-host",
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
