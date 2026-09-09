import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildComputerRuntimeFixtureBundlePlan,
  stageComputerRuntimeFixtureBundle,
} from "../scripts/package-macos-computer-runtime-fixture.mjs";

describe("computer runtime fixture app bundle plan", () => {
  it("uses fixed fixture identity, executable, and default path", () => {
    const plan = buildComputerRuntimeFixtureBundlePlan({ repoDir: "/repo" });
    expect(plan.bundleIdentifier).toBe("com.senoldogann.chatgpt-system.computer-runtime.fixture");
    expect(plan.executableName).toBe("chatgpt-system-computer-runtime-fixture");
    expect(plan.bundlePath).toBe(
      "/repo/native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app",
    );
  });

  it("rejects protected fixture identity overrides", () => {
    expect(() =>
      buildComputerRuntimeFixtureBundlePlan({ repoDir: "/repo", bundleIdentifier: "evil" } as {
        repoDir: string;
      }),
    ).toThrow(/Unsupported/);
  });

  it("stages a runnable fixed-identity app bundle", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "computer-runtime-fixture-"));
    try {
      const plan = buildComputerRuntimeFixtureBundlePlan({ repoDir });
      await mkdir(path.dirname(plan.sourcePath), { recursive: true });
      await writeFile(plan.sourcePath, "fixture-binary", { mode: 0o755 });

      const stagedPath = await stageComputerRuntimeFixtureBundle(plan);
      const bundleInfo = await stat(stagedPath);
      const executableInfo = await stat(plan.executablePath);
      const plist = await readFile(plan.infoPlistPath, "utf8");

      expect(bundleInfo.isDirectory()).toBe(true);
      expect(executableInfo.isFile()).toBe(true);
      expect(executableInfo.mode & 0o111).not.toBe(0);
      expect(plist).toContain("<string>com.senoldogann.chatgpt-system.computer-runtime.fixture</string>");
      expect(plist).toContain("<string>chatgpt-system-computer-runtime-fixture</string>");
      expect(plist).toContain("<key>LSUIElement</key>\n  <false/>");
      expect(plist).toContain("<key>LSMinimumSystemVersion</key>\n  <string>14.0</string>");
      expect(plan.bundlePath).toBe(
        path.join(
          repoDir,
          "native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntimeFixture.app",
        ),
      );
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
