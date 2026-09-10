import { describe, expect, it } from "vitest";
import {
  buildComputerInstallPlan,
  selectComputerSigningIdentity,
} from "../scripts/setup-macos-computer-runtime.mjs";
import { buildComputerRuntimeBundlePlan } from "../scripts/package-macos-computer-runtime.mjs";

const stableA = "Apple Development: Tester A (AAAAAAAAAA)";
const stableB = "Developer ID Application: Tester B (BBBBBBBBBB)";

describe("macOS computer runtime stable installer planning", () => {
  it("builds the fixed daily-driver bundle plan for a stable identity", () => {
    const plan = buildComputerInstallPlan({
      homeDir: "/Users/test",
      repoDir: "/Users/test/chatgpt-system",
      identity: stableA,
    });

    expect(plan).toMatchObject({
      destinationBundlePath: "/Users/test/.chatgpt-system/ChatGPTSystemComputerRuntime.app",
      bundleIdentifier: "com.senoldogann.chatgpt-system.computer-runtime",
      executableName: "chatgpt-system-computer-runtime",
      signingIdentity: stableA,
      tccIdentityStable: true,
    });
    expect(plan.stagingBundlePath).toContain("/.chatgpt-system/.ChatGPTSystemComputerRuntime.install-");
    expect(plan.stagingBundlePath).toMatch(/\.app$/);
    expect(plan.rollbackBundlePath).toContain("/.chatgpt-system/.ChatGPTSystemComputerRuntime.rollback-");
    expect(plan.rollbackBundlePath).toMatch(/\.app$/);
    expect(plan.sourceExecutablePath).toBe(
      "/Users/test/chatgpt-system/native/macos-computer-runtime/.build/release/chatgpt-system-computer-runtime",
    );
  });

  it("produces a staging bundle path accepted by the existing macOS packager", () => {
    const plan = buildComputerInstallPlan({
      homeDir: "/Users/test",
      repoDir: "/Users/test/chatgpt-system",
      identity: stableA,
      operationId: "regression",
    });

    expect(() => buildComputerRuntimeBundlePlan({
      repoDir: "/Users/test/chatgpt-system",
      outputPath: plan.stagingBundlePath,
    })).not.toThrow();
  });

  it("uses an explicit valid identity before installed or discovered candidates", () => {
    expect(selectComputerSigningIdentity({
      explicitIdentity: stableA,
      installedIdentity: stableB,
      validIdentities: [stableA, stableB],
      allowAdHoc: false,
    })).toEqual({ identity: stableA, source: "explicit", tccIdentityStable: true });
  });

  it("rejects an explicit identity that is not currently valid", () => {
    expect(() => selectComputerSigningIdentity({
      explicitIdentity: "Apple Development: Missing",
      validIdentities: [stableA],
      allowAdHoc: false,
    })).toThrow(/not a valid code-signing identity/i);
  });

  it("reuses the installed signer when it is still valid", () => {
    expect(selectComputerSigningIdentity({
      installedIdentity: stableB,
      validIdentities: [stableA, stableB],
      allowAdHoc: false,
    })).toEqual({ identity: stableB, source: "installed", tccIdentityStable: true });
  });

  it("auto-selects one unambiguous Apple Development or Developer ID identity", () => {
    expect(selectComputerSigningIdentity({
      validIdentities: [stableA, "Mac Developer: Legacy"],
      allowAdHoc: false,
    })).toEqual({ identity: stableA, source: "discovered", tccIdentityStable: true });
  });

  it("refuses ambiguous stable identities instead of guessing", () => {
    expect(() => selectComputerSigningIdentity({
      validIdentities: [stableA, stableB],
      allowAdHoc: false,
    })).toThrow(/multiple.*code-signing identities/i);
  });

  it("never silently falls back to ad-hoc signing", () => {
    expect(() => selectComputerSigningIdentity({
      validIdentities: [],
      allowAdHoc: false,
    })).toThrow(/stable code-signing identity/i);
  });

  it("permits explicit development-only ad-hoc mode and marks TCC identity unstable", () => {
    expect(selectComputerSigningIdentity({
      validIdentities: [],
      allowAdHoc: true,
    })).toEqual({ identity: "-", source: "ad-hoc", tccIdentityStable: false });

    const plan = buildComputerInstallPlan({
      homeDir: "/Users/test",
      repoDir: "/Users/test/chatgpt-system",
      identity: "-",
    });
    expect(plan.tccIdentityStable).toBe(false);
  });

  it("rejects destination and bundle identity overrides", () => {
    expect(() => buildComputerInstallPlan({
      homeDir: "/Users/test",
      repoDir: "/Users/test/chatgpt-system",
      identity: stableA,
      destinationBundlePath: "/tmp/Fake.app",
    } as never)).toThrow(/unsupported/i);
    expect(() => buildComputerInstallPlan({
      homeDir: "/Users/test",
      repoDir: "/Users/test/chatgpt-system",
      identity: stableA,
      bundleIdentifier: "com.attacker.fake",
    } as never)).toThrow(/unsupported/i);
  });
});
