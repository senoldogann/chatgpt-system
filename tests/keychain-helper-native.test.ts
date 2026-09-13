import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const maybeIt = process.platform === "darwin" ? it : it.skip;

describe("macOS Keychain helper native integration", () => {
  maybeIt("stores, reads non-interactively, and deletes an isolated fixture credential", () => {
    const packagePath = path.resolve("native/macos-authority-broker");
    const build = spawnSync("/usr/bin/swift", [
      "build", "-c", "release",
      "--package-path", packagePath,
      "--product", "chatgpt-system-keychain-helper",
    ], { encoding: "utf8", shell: false });
    expect(build.status, build.stderr).toBe(0);

    const helperPath = path.join(packagePath, ".build", "release", "chatgpt-system-keychain-helper");
    const suffix = `${process.pid}-${Date.now()}`;
    const account = `chatgpt-system-test-${suffix}`;
    const service = `chatgpt-system-test-service-${suffix}`;
    const secret = `fixture-secret-${suffix}`;

    try {
      const store = spawnSync(helperPath, ["store", account, service], {
        input: secret, encoding: "utf8", shell: false,
      });
      expect(store.status, store.stderr).toBe(0);

      const read = spawnSync(helperPath, ["read", account, service], { encoding: "utf8", shell: false });
      expect(read.status, read.stderr).toBe(0);
      expect(read.stdout).toBe(secret);
    } finally {
      const remove = spawnSync(helperPath, ["delete", account, service], { encoding: "utf8", shell: false });
      expect(remove.status, remove.stderr).toBe(0);
    }
  }, 30_000);
});
