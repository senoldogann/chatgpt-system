import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserError } from "../src/errors.js";
import {
  defaultExistingChromeUserDataDir,
  discoverExistingChromeEndpoint,
} from "../src/existing-chrome-discovery.js";

const cleanups: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-existing-chrome-"));
  cleanups.push(root);
  return root;
}

async function expectUnavailable(
  operation: Promise<unknown>,
  forbidden: readonly string[],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected existing Chrome discovery to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserError);
    const browserError = error as BrowserError;
    expect(browserError.code).toBe("BROWSER_UNAVAILABLE");
    expect(browserError.message).toContain("chrome://inspect/#remote-debugging");
    for (const value of forbidden) {
      expect(browserError.message).not.toContain(value);
      expect(JSON.stringify(browserError.details ?? {})).not.toContain(value);
    }
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("existing Chrome discovery", () => {
  it("resolves platform-specific Google Chrome Stable user-data directories", () => {
    expect(defaultExistingChromeUserDataDir("darwin", "/Users/test", undefined)).toBe(
      "/Users/test/Library/Application Support/Google/Chrome",
    );
    expect(defaultExistingChromeUserDataDir("linux", "/home/test", undefined)).toBe(
      "/home/test/.config/google-chrome",
    );
    expect(
      defaultExistingChromeUserDataDir(
        "win32",
        "C:\\Users\\test",
        "C:\\Users\\test\\AppData\\Local",
      ),
    ).toBe(path.win32.join("C:\\Users\\test\\AppData\\Local", "Google", "Chrome", "User Data"));
  });

  it("discovers a hard-coded loopback endpoint from bounded LF or CRLF metadata", async () => {
    const root = await makeRoot();
    const chromeDir = path.join(root, "Chrome");
    await mkdir(chromeDir, { recursive: true });
    const metadataPath = path.join(chromeDir, "DevToolsActivePort");

    await writeFile(metadataPath, "9222\n/devtools/browser/test-browser-token\n");
    await expect(discoverExistingChromeEndpoint({ userDataDir: chromeDir })).resolves.toEqual({
      endpoint: "ws://127.0.0.1:9222/devtools/browser/test-browser-token",
    });

    await writeFile(metadataPath, "9333\r\n/devtools/browser/crlf-token\r\n");
    await expect(discoverExistingChromeEndpoint({ userDataDir: chromeDir })).resolves.toEqual({
      endpoint: "ws://127.0.0.1:9333/devtools/browser/crlf-token",
    });
  });

  it("rejects missing, non-regular, and symlinked metadata without exposing local paths", async () => {
    const root = await makeRoot();
    const chromeDir = path.join(root, "Chrome");
    await mkdir(chromeDir, { recursive: true });
    const metadataPath = path.join(chromeDir, "DevToolsActivePort");

    await expectUnavailable(
      discoverExistingChromeEndpoint({ userDataDir: chromeDir }),
      [root, metadataPath],
    );

    await mkdir(metadataPath);
    await expectUnavailable(
      discoverExistingChromeEndpoint({ userDataDir: chromeDir }),
      [root, metadataPath],
    );
    await rm(metadataPath, { recursive: true });

    const targetPath = path.join(root, "real-metadata");
    await writeFile(targetPath, "9222\n/devtools/browser/hidden-token\n");
    await symlink(targetPath, metadataPath);
    await expectUnavailable(
      discoverExistingChromeEndpoint({ userDataDir: chromeDir }),
      [root, metadataPath, "hidden-token", "9222"],
    );
  });

  it("rejects oversized metadata before accepting otherwise valid leading content", async () => {
    const root = await makeRoot();
    const chromeDir = path.join(root, "Chrome");
    await mkdir(chromeDir, { recursive: true });
    const metadataPath = path.join(chromeDir, "DevToolsActivePort");
    const token = "secret-browser-token";
    await writeFile(
      metadataPath,
      `9222\n/devtools/browser/${token}\n${"x".repeat(4096)}`,
    );

    await expectUnavailable(
      discoverExistingChromeEndpoint({ userDataDir: chromeDir }),
      [root, token, "9222"],
    );
  });

  it.each([
    ["zero port", "0\n/devtools/browser/token\n"],
    ["too-large port", "65536\n/devtools/browser/token\n"],
    ["non-integer port", "9x22\n/devtools/browser/token\n"],
    ["signed port", "+9222\n/devtools/browser/token\n"],
    ["whitespace port", " 9222\n/devtools/browser/token\n"],
    ["wrong browser path", "9222\n/not-devtools/browser/token\n"],
    ["full URL injection", "9222\nws://evil.invalid/devtools/browser/token\n"],
    ["query injection", "9222\n/devtools/browser/token?x=1\n"],
    ["fragment injection", "9222\n/devtools/browser/token#x\n"],
    ["path whitespace", "9222\n/devtools/browser/token value\n"],
    ["bare carriage return", "9222\r/devtools/browser/token\n"],
    ["additional line", "9222\n/devtools/browser/token\nunexpected\n"],
    ["multiple trailing lines", "9222\n/devtools/browser/token\n\n"],
  ])("rejects malformed DevToolsActivePort content: %s", async (_name, content) => {
    const root = await makeRoot();
    const chromeDir = path.join(root, "Chrome");
    await mkdir(chromeDir, { recursive: true });
    await writeFile(path.join(chromeDir, "DevToolsActivePort"), content);

    await expectUnavailable(
      discoverExistingChromeEndpoint({ userDataDir: chromeDir }),
      [root, "9222", "token", "evil.invalid"],
    );
  });
});
