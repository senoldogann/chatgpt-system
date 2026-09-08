import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
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

  it("keeps bootstrap terminal disabled while enabling the private local control socket", () => {
    const setup = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], {}, context);
    expect(setup.profile).toBe("chatgpt-system");
    expect(setup.mcpCommand).not.toContain("--enable-terminal");
    expect(setup.mcpCommand).toContain("stdio");
    expect(setup.mcpCommand).toContain(ROOT);
    expect(setup.mcpCommand).toContain("--enable-control");
    expect(setup.controlSocketPath).toBe("/home/tester/.chatgpt-system/control.sock");
  });

  it("documents terminal opt-in for the daily-driver ChatGPT profile", async () => {
    const [runbook, readme] = await Promise.all([
      readFile(new URL("../docs/CHATGPT_INTEGRATION.md", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
    ]);

    const runbookSetupStart = runbook.indexOf("## 4. Configure the Secure MCP Tunnel profile");
    const runbookSetupEnd = runbook.indexOf("## 5. Run the tunnel");
    expect(runbookSetupStart).toBeGreaterThanOrEqual(0);
    expect(runbookSetupEnd).toBeGreaterThan(runbookSetupStart);
    expect(runbook.slice(runbookSetupStart, runbookSetupEnd)).toContain("--enable-terminal");

    const readmeSetupStart = readme.indexOf("## Personal ChatGPT Plugin");
    const readmeSetupEnd = readme.indexOf("## Authority privilege ladder");
    expect(readmeSetupStart).toBeGreaterThanOrEqual(0);
    expect(readmeSetupEnd).toBeGreaterThan(readmeSetupStart);
    expect(readme.slice(readmeSetupStart, readmeSetupEnd)).toContain("--enable-terminal");
  });

  it("requires bootstrap terminal opt-in before command allowlisting", () => {
    expect(() => buildTunnelSetup([
      "--root", ROOT,
      "--tunnel-id", VALID_TUNNEL,
      "--allow-command", "git",
    ], {}, context)).toThrow(/enable-terminal/i);
  });

  it("rejects executable paths in the bootstrap terminal allowlist", () => {
    expect(() => buildTunnelSetup([
      "--root", ROOT,
      "--tunnel-id", VALID_TUNNEL,
      "--enable-terminal",
      "--allow-command", "/usr/bin/node",
    ], {}, context)).toThrow(/basename/i);
  });

  it("adds only explicitly allowlisted bootstrap commands when enabled", () => {
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
    expect(setup.mcpCommand).toContain("--enable-control");
  });

  it("does not copy control-plane credentials or authority leases into generated values", () => {
    const secret = "sk-test-do-not-print";
    const setup = buildTunnelSetup(
      ["--root", ROOT, "--tunnel-id", VALID_TUNNEL],
      { CONTROL_PLANE_API_KEY: secret },
      context,
    );
    const serialized = JSON.stringify(setup);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("authorityLeaseId");
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

  it("replaces an existing tunnel profile only when --force is explicit", () => {
    const normal = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], {}, context);
    expect(normal.initArgs).not.toContain("--force");

    const replacement = buildTunnelSetup([
      "--root", ROOT,
      "--tunnel-id", VALID_TUNNEL,
      "--force",
    ], {}, context);
    expect(replacement.initArgs).toEqual([
      "init",
      "--sample", "sample_mcp_stdio_local",
      "--profile", "chatgpt-system",
      "--tunnel-id", VALID_TUNNEL,
      "--mcp-command", replacement.mcpCommand,
      "--force",
    ]);
  });

  it("separates repository build input from fixed protected runtime helper paths", () => {
    const setup = buildTunnelSetup(["--root", ROOT, "--tunnel-id", VALID_TUNNEL], {}, context);
    expect(setup.brokerPackageDir).toBe("/opt/chatgpt-system/native/macos-authority-broker");
    expect(setup.brokerBuildPath).toBe(
      "/opt/chatgpt-system/native/macos-authority-broker/.build/release/chatgpt-system-authority-broker",
    );
    expect(setup.brokerHelperPath).toBe(
      "/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker",
    );
    expect(setup.brokerMetadataPath).toBe(
      "/Library/Application Support/chatgpt-system/etc/authority-broker.sha256",
    );
    expect(setup.brokerHelperPath).not.toContain("/opt/chatgpt-system");
    expect(JSON.stringify(setup)).not.toContain("CONTROL_PLANE_API_KEY");
  });
});
