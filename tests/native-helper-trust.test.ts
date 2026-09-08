import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MACOS_AUTHORITY_BIN_DIR,
  MACOS_AUTHORITY_ETC_DIR,
  MACOS_AUTHORITY_HELPER_PATH,
  MACOS_AUTHORITY_INSTALL_ROOT,
  MACOS_AUTHORITY_METADATA_PATH,
  MacOSNativeHelperTrustValidator,
  type NativeHelperFileInfo,
  type NativeHelperTrustFs,
} from "../src/native-helper-trust.js";

const helperBytes = Buffer.from("trusted-native-helper", "utf8");
const helperHash = createHash("sha256").update(helperBytes).digest("hex");

function info(kind: NativeHelperFileInfo["kind"], uid = 0, mode = 0o755): NativeHelperFileInfo {
  return { kind, uid, mode };
}

function trustedEntries(): Map<string, NativeHelperFileInfo> {
  return new Map([
    [MACOS_AUTHORITY_INSTALL_ROOT, info("directory", 0, 0o755)],
    [MACOS_AUTHORITY_BIN_DIR, info("directory", 0, 0o755)],
    [MACOS_AUTHORITY_ETC_DIR, info("directory", 0, 0o755)],
    [MACOS_AUTHORITY_HELPER_PATH, info("file", 0, 0o755)],
    [MACOS_AUTHORITY_METADATA_PATH, info("file", 0, 0o644)],
  ]);
}

function fakeFs(
  mutate?: (entries: Map<string, NativeHelperFileInfo>) => void,
  metadata = `${helperHash}\n`,
): NativeHelperTrustFs {
  const entries = trustedEntries();
  mutate?.(entries);
  return {
    async lstat(target) {
      const entry = entries.get(target);
      if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { ...entry };
    },
    async readFile(target) {
      if (target === MACOS_AUTHORITY_HELPER_PATH) return Buffer.from(helperBytes);
      if (target === MACOS_AUTHORITY_METADATA_PATH) return Buffer.from(metadata, "utf8");
      throw new Error("unexpected read");
    },
  };
}

async function expectUntrusted(fs: NativeHelperTrustFs): Promise<void> {
  await expect(new MacOSNativeHelperTrustValidator({ fs }).validate()).rejects.toThrow();
}

describe("MacOSNativeHelperTrustValidator", () => {
  it("accepts a root-owned non-writable helper with matching protected hash metadata", async () => {
    await expect(new MacOSNativeHelperTrustValidator({ fs: fakeFs() }).validate()).resolves.toBeUndefined();
  });

  it("rejects a missing helper", async () => {
    await expectUntrusted(fakeFs((entries) => entries.delete(MACOS_AUTHORITY_HELPER_PATH)));
  });

  it("rejects helper and metadata symlinks", async () => {
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_HELPER_PATH, info("symlink"))));
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_METADATA_PATH, info("symlink", 0, 0o644))));
  });

  it("rejects non-root ownership on helper or metadata", async () => {
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_HELPER_PATH, info("file", 501, 0o755))));
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_METADATA_PATH, info("file", 501, 0o644))));
  });

  it("rejects group or other writable helper and metadata", async () => {
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_HELPER_PATH, info("file", 0, 0o775))));
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_METADATA_PATH, info("file", 0, 0o666))));
  });

  it("rejects an untrusted installation directory", async () => {
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_INSTALL_ROOT, info("directory", 501, 0o755))));
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_BIN_DIR, info("directory", 0, 0o777))));
    await expectUntrusted(fakeFs((entries) => entries.set(MACOS_AUTHORITY_ETC_DIR, info("symlink", 0, 0o755))));
  });

  it("rejects malformed trust metadata", async () => {
    await expectUntrusted(fakeFs(undefined, "not-a-sha256\n"));
    await expectUntrusted(fakeFs(undefined, `${helperHash} extra\n`));
  });

  it("rejects a helper whose SHA-256 does not match protected metadata", async () => {
    await expectUntrusted(fakeFs(undefined, `${"0".repeat(64)}\n`));
  });
});
