import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBrowserInstallInvocation,
  runBrowserSetup,
} from "../scripts/setup-browser.mjs";

describe("browser setup", () => {
  it("installs only Chromium through the repository-pinned Playwright CLI without a shell", () => {
    const invocation = buildBrowserInstallInvocation({
      repoDir: "/Users/test/chatgpt-system",
      nodePath: "/opt/homebrew/bin/node",
    });

    expect(invocation).toEqual({
      command: "/opt/homebrew/bin/node",
      args: [
        path.join("/Users/test/chatgpt-system", "node_modules", "playwright", "cli.js"),
        "install",
        "chromium",
      ],
      cwd: "/Users/test/chatgpt-system",
    });
    expect(invocation.args).not.toContain("--with-deps");
    expect(invocation.args.join(" ")).not.toContain("sudo");
  });

  it("refuses relative repository and node paths", () => {
    expect(() => buildBrowserInstallInvocation({
      repoDir: "./chatgpt-system",
      nodePath: "/usr/bin/node",
    })).toThrow(/repo.*absolute/i);

    expect(() => buildBrowserInstallInvocation({
      repoDir: "/Users/test/chatgpt-system",
      nodePath: "node",
    })).toThrow(/node.*absolute/i);
  });

  it("runs the exact install invocation with shell disabled and inherits browser download output", () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Record<string, unknown>;
    }> = [];

    const result = runBrowserSetup({
      repoDir: "/Users/test/chatgpt-system",
      nodePath: "/opt/homebrew/bin/node",
    }, {
      spawnSync: (command: string, args: string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return { status: 0, signal: null, error: undefined };
      },
    });

    expect(result).toEqual({ installed: true, browser: "chromium" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "/opt/homebrew/bin/node",
      args: [
        path.join("/Users/test/chatgpt-system", "node_modules", "playwright", "cli.js"),
        "install",
        "chromium",
      ],
      options: {
        cwd: "/Users/test/chatgpt-system",
        stdio: "inherit",
        shell: false,
      },
    });
  });

  it("fails closed when the Playwright installer exits unsuccessfully", () => {
    expect(() => runBrowserSetup({
      repoDir: "/Users/test/chatgpt-system",
      nodePath: "/opt/homebrew/bin/node",
    }, {
      spawnSync: () => ({ status: 7, signal: null, error: undefined }),
    })).toThrow(/Chromium installation failed.*7/i);
  });
});
