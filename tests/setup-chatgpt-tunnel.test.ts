import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTunnelSetup, validateRootBoundary } from "../scripts/setup-chatgpt-tunnel.mjs";

const VALID_TUNNEL = "tunnel_0123456789abcdef";
const ROOT = "/tmp/chatgpt-system-fixture";
const context = {
  repoDir: "/opt/chatgpt-system",
  homeDir: "/home/tester",
};
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("ChatGPT Secure MCP Tunnel setup", () => {
  it("requires an explicit absolute root", () => {
    expect(() => buildTunnelSetup(["--tunnel-id", VALID_TUNNEL], {}, context)).toThrow(/--root/);
    expect(() => buildTunnelSetup(["--root", ".", "--tunnel-id", VALID_TUNNEL], {}, context)).toThrow(/absolute/i);
  });

  it("rejects dangerously broad roots", () => {
    expect(() => buildTunnelSetup(["--root", "/", "--tunnel-id", VALID_TUNNEL], {}, context)).toThrow(/root directory/i);
    expect(() => buildTunnelSetup(["--root", context.homeDir, "--tunnel-id", VALID_TUNNEL], {}, context)).toThrow(/home directory/i);
  });

  it("rejects a symlink alias of the entire home directory", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-tunnel-root-"));
    cleanups.push(base);
    const fakeHome = path.join(base, "home");
    const homeAlias = path.join(base, "project-link");
    await mkdir(fakeHome);
    await symlink(fakeHome, homeAlias, "dir");

    await expect(validateRootBoundary(homeAlias, fakeHome)).rejects.toThrow(/home directory/i);
  });

  it("requires a plausible tunnel id", () => {
    expect(() => buildTunnelSetup(["--root", ROOT, "--tunnel-id", "abc"], {}, context)).toThrow(/tunnel id/i);
  });

  it("keeps terminal disabled by default", () => {
    const setup = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], {}, context);
    expect(setup.profile).toBe("chatgpt-system");
    expect(setup.mcpCommand).not.toContain("--enable-terminal");
    expect(setup.mcpCommand).toContain("stdio");
    expect(setup.mcpCommand).toContain(ROOT);
  });

  it("requires terminal opt-in before command allowlisting", () => {
    expect(() => buildTunnelSetup([
      "--root", ROOT,
      "--tunnel-id", VALID_TUNNEL,
      "--allow-command", "git",
    ], {}, context)).toThrow(/enable-terminal/i);
  });

  it("rejects executable paths in the terminal allowlist", () => {
    expect(() => buildTunnelSetup([
      "--root", ROOT,
      "--tunnel-id", VALID_TUNNEL,
      "--enable-terminal",
      "--allow-command", "/usr/bin/node",
    ], {}, context)).toThrow(/basename/i);
  });

  it("adds only explicitly allowlisted commands when terminal is enabled", () => {
    const setup = buildTunnelSetup([
      "--root", ROOT,
      "--tunnel-id", VALID_TUNNEL,
      "--enable-terminal",
      "--allow-command", "git",
      "--allow-command", "node",
    ], {}, context);

    expect(setup.mcpCommand).toContain("--enable-terminal");
    expect(setup.mcpCommand).toContain("--allow-command git");
    expect(setup.mcpCommand).toContain("--allow-command node");
  });

  it("does not copy control-plane credentials into generated values", () => {
    const secret = "sk-test-do-not-print";
    const setup = buildTunnelSetup(
      ["--root", ROOT, "--tunnel-id", VALID_TUNNEL],
      { CONTROL_PLANE_API_KEY: secret },
      context,
    );
    expect(JSON.stringify(setup)).not.toContain(secret);
  });

  it("generates argv for init, doctor, and run without a shell", () => {
    const setup = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], {}, context);
    expect(setup.initArgs).toEqual([
      "init",
      "--sample", "sample_mcp_stdio_local",
      "--profile", "chatgpt-system",
      "--tunnel-id", VALID_TUNNEL,
      "--mcp-command", setup.mcpCommand,
    ]);
    expect(setup.doctorArgs).toEqual(["doctor", "--profile", "chatgpt-system", "--explain"]);
    expect(setup.runArgs).toEqual(["run", "--profile", "chatgpt-system"]);
  });
});
