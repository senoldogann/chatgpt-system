import { describe, expect, it } from "vitest";
import { buildInstallPlan } from "../scripts/install-macos-authority-broker.mjs";

const context = {
  repoDir: "/Users/tester/chatgpt-system",
  platform: "darwin",
  uid: 0,
};

describe("macOS authority broker installer", () => {
  it("builds a deterministic root-owned installation plan", () => {
    const plan = buildInstallPlan(context);

    expect(plan.sourcePath).toBe(
      "/Users/tester/chatgpt-system/native/macos-authority-broker/.build/release/chatgpt-system-authority-broker",
    );
    expect(plan.installRoot).toBe("/Library/Application Support/chatgpt-system");
    expect(plan.binDir).toBe("/Library/Application Support/chatgpt-system/bin");
    expect(plan.etcDir).toBe("/Library/Application Support/chatgpt-system/etc");
    expect(plan.helperPath).toBe(
      "/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker",
    );
    expect(plan.metadataPath).toBe(
      "/Library/Application Support/chatgpt-system/etc/authority-broker.sha256",
    );
    expect(plan.helperMode).toBe(0o755);
    expect(plan.metadataMode).toBe(0o644);
    expect(plan.owner).toEqual({ uid: 0, gid: 0 });
  });

  it("refuses non-macOS execution before mutation", () => {
    expect(() => buildInstallPlan({ ...context, platform: "linux" })).toThrow(/macOS/i);
  });

  it("refuses non-root execution before mutation", () => {
    expect(() => buildInstallPlan({ ...context, uid: 501 })).toThrow(/root/i);
  });

  it("does not accept password, credential, destination, or helper override arguments", () => {
    expect(() => buildInstallPlan({
      ...context,
      password: "secret",
    } as typeof context)).toThrow(/unsupported/i);
    expect(() => buildInstallPlan({
      ...context,
      helperPath: "/tmp/fake-helper",
    } as typeof context)).toThrow(/unsupported/i);
  });
});
