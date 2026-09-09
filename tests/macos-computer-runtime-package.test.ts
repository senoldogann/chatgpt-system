import { describe, expect, it } from "vitest";
import { buildComputerRuntimeBundlePlan } from "../scripts/package-macos-computer-runtime.mjs";

describe("computer runtime app bundle plan", () => {
  it("uses fixed identity and executable", () => {
    const plan = buildComputerRuntimeBundlePlan({ repoDir: "/repo" });
    expect(plan.bundleIdentifier).toBe("com.senoldogann.chatgpt-system.computer-runtime");
    expect(plan.executableName).toBe("chatgpt-system-computer-runtime");
    expect(plan.bundlePath).toBe(
      "/repo/native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app",
    );
  });

  it("rejects protected identity overrides", () => {
    expect(() =>
      buildComputerRuntimeBundlePlan({ repoDir: "/repo", bundleIdentifier: "evil" } as {
        repoDir: string;
      }),
    ).toThrow(/Unsupported/);
  });
});
