import { once } from "node:events";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { arch, homedir, platform, tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import type { AppConfig } from "../src/config.js";
import {
  resolutionSearchDirs,
  resolveAllowedCommands,
  resolveExecutablePath,
} from "../src/executable-resolution.js";
import { PathPolicy } from "../src/policy.js";
import { ProcessService } from "../src/process-service.js";
import { createRuntimeServices } from "../src/server.js";
import { describeSystemEnvironment, prettyOperatingSystemName } from "../src/system-environment.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
  delete process.env.CHATGPT_SYSTEM_TEST_CANARY;
});

async function makeExecutable(directory: string, name: string, body = "echo fake-tool-output"): Promise<string> {
  const file = path.join(directory, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(file, 0o755);
  return file;
}

async function tempHome(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-home-"));
  cleanups.push(base);
  return base;
}

function serviceConfig(root: string, base: string, commands: string[], commandTimeoutMs: number): AppConfig {
  return {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands },
    projectExec: { enabled: false },
    computerUse: {
      enabled: true,
      fullHostJsEnabled: true,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    http: { host: "127.0.0.1", port: 4312 },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 64 * 1024,
      commandTimeoutMs,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  } as AppConfig;
}

describe("executable resolution", () => {
  it("resolves a basename through PATH entries in order", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-path-"));
    cleanups.push(base);
    const first = path.join(base, "first");
    const second = path.join(base, "second");
    await mkdir(first);
    await mkdir(second);
    await makeExecutable(second, "fake-tool");
    await makeExecutable(first, "fake-tool");

    const resolved = await resolveExecutablePath("fake-tool", {
      pathValue: [first, second].join(path.delimiter),
      homeDir: base,
    });
    expect(resolved).toBe(path.join(first, "fake-tool"));
  });

  it("falls back to ~/.local/bin for user-local binaries such as uv", async () => {
    const home = await tempHome();
    const localBin = path.join(home, ".local", "bin");
    await mkdir(localBin, { recursive: true });
    const expected = await makeExecutable(localBin, "uv", "echo 'uv 0.0.0-test'");

    const resolved = await resolveExecutablePath("uv", {
      pathValue: "/usr/bin:/bin",
      homeDir: home,
    });
    expect(resolved).toBe(expected);
  });

  it("falls back to ~/bin when ~/.local/bin does not contain the binary", async () => {
    const home = await tempHome();
    const homeBin = path.join(home, "bin");
    await mkdir(homeBin, { recursive: true });
    const expected = await makeExecutable(homeBin, "fake-tool");

    const resolved = await resolveExecutablePath("fake-tool", {
      pathValue: "/usr/bin:/bin",
      homeDir: home,
    });
    expect(resolved).toBe(expected);
  });

  it("skips non-executable files and rejects path inputs", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-skip-"));
    cleanups.push(base);
    await writeFile(path.join(base, "fake-tool"), "not executable\n", "utf8");

    expect(await resolveExecutablePath("fake-tool", { pathValue: base, homeDir: base })).toBeNull();
    expect(await resolveExecutablePath("missing-binary-xyz", { pathValue: base, homeDir: base })).toBeNull();
    expect(await resolveExecutablePath("/bin/ls", { pathValue: base, homeDir: base })).toBeNull();
    expect(await resolveExecutablePath("../fake-tool", { pathValue: base, homeDir: base })).toBeNull();
    expect(await resolveExecutablePath("", { pathValue: base, homeDir: base })).toBeNull();
  });

  it("reports allowed-but-unavailable binaries with a null resolved path", async () => {
    const home = await tempHome();
    const resolutions = await resolveAllowedCommands(
      ["node", "chatgpt-system-missing-binary-xyz", "node"],
      { pathValue: process.env.PATH, homeDir: home },
    );
    expect(resolutions).toHaveLength(2);
    expect(resolutions[0]).toMatchObject({ name: "node", allowed: true, available: true });
    expect(typeof resolutions[0]?.resolvedPath).toBe("string");
    expect(resolutions[1]).toEqual({
      name: "chatgpt-system-missing-binary-xyz",
      allowed: true,
      available: false,
      resolvedPath: null,
    });
  });

  it("maps platforms to display names", () => {
    expect(prettyOperatingSystemName("darwin")).toBe("macOS");
    expect(prettyOperatingSystemName("linux")).toBe("Linux");
    expect(prettyOperatingSystemName("win32")).toBe("Windows");
  });
});

describe("describeSystemEnvironment", () => {
  it("reports platform, architecture, search path, roots, and per-command resolution without secrets", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-desc-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    process.env.CHATGPT_SYSTEM_TEST_CANARY = "canary-secret-value-12345";
    const config = serviceConfig(root, base, ["node", "chatgpt-system-missing-binary-xyz"], 1_000);

    const environment = await describeSystemEnvironment(config);

    expect(environment.platform).toBe(platform());
    expect(environment.arch).toBe(arch());
    expect(environment.os).toBe(prettyOperatingSystemName(platform()));
    expect(environment.roots).toEqual([root]);
    expect(environment.terminal).toEqual({ enabled: true });
    expect(environment.computerUse).toEqual({ enabled: true, fullHostJsEnabled: true });
    expect(environment.pathEntries).toEqual(resolutionSearchDirs(process.env.PATH, homedir()));
    expect(environment.executables).toHaveLength(2);
    expect(environment.executables[0]).toMatchObject({ name: "node", allowed: true, available: true });
    expect(environment.executables[1]).toEqual({
      name: "chatgpt-system-missing-binary-xyz",
      allowed: true,
      available: false,
      resolvedPath: null,
    });
    expect(JSON.stringify(environment)).not.toContain("canary-secret-value-12345");
    expect(Object.keys(environment).sort()).toEqual(
      ["arch", "computerUse", "executables", "os", "pathEntries", "platform", "roots", "terminal"],
    );
  });
});

describe("terminal_run resolution and error ergonomics", () => {
  it("runs a user-local binary resolved outside PATH, such as uv in ~/.local/bin", async () => {
    const home = await tempHome();
    const localBin = path.join(home, ".local", "bin");
    await mkdir(localBin, { recursive: true });
    await makeExecutable(localBin, "uv", "echo 'uv 0.0.0-test'");

    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-run-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    const config = serviceConfig(root, base, ["uv"], 5_000);
    const service = new ProcessService(new PathPolicy([root]), new AuditLogger(config.auditFile), config);

    // Gerçek uv PATH'te olabilir; yedek arama yolunu izole etmek için
    // PATH ve HOME geçici olarak daraltılır ve sonunda geri yüklenir.
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    process.env.HOME = home;
    process.env.PATH = ["/usr/bin", "/bin"].join(path.delimiter);
    try {
      const result = await service.run("uv", ["--version"], root);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("uv 0.0.0-test");
      expect(result.timedOut).toBe(false);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it("returns a structured executable-not-found error for allowlisted but missing binaries", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-enoent-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    const config = serviceConfig(root, base, ["chatgpt-system-missing-binary-xyz"], 5_000);
    const service = new ProcessService(new PathPolicy([root]), new AuditLogger(config.auditFile), config);

    await expect(service.run("chatgpt-system-missing-binary-xyz", [], root)).rejects.toMatchObject({
      code: "EXECUTABLE_NOT_FOUND",
      details: {
        command: "chatgpt-system-missing-binary-xyz",
        allowed: true,
        available: false,
      },
    });
  });

  it("returns a structured timeout hint pointing at process_start without auto-delegating", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-timeout-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    const config = serviceConfig(root, base, ["node"], 250);
    const service = new ProcessService(new PathPolicy([root]), new AuditLogger(config.auditFile), config);

    await expect(
      service.run("node", ["-e", "setInterval(() => {}, 1000)"], root),
    ).rejects.toMatchObject({
      code: "COMMAND_TIMEOUT",
      details: {
        timedOutAfterMs: 250,
        recommendedTool: "process_start",
        retryable: true,
      },
    });
  });
});

describe("system_environment MCP tool", () => {
  it("is advertised as read-only and answers without an authority lease", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-env-mcp-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    const token = "system-environment-token-0123456789";
    const config: AppConfig = {
      roots: [root],
      auditFile: path.join(base, "audit.jsonl"),
      terminal: { enabled: false, commands: ["node", "chatgpt-system-missing-binary-xyz"] },
      projectExec: { enabled: false },
      computerUse: {
        enabled: true,
        fullHostJsEnabled: true,
        hostBundlePath: "/tmp/ChatGPTSystemComputerRuntime.app",
        requestTimeoutMs: 10_000,
        maxObservationElements: 500,
        maxObservationChars: 262_144,
        maxScreenshotBytes: 8_388_608,
        maxActionProgramActions: 100,
        maxActionProgramRuntimeMs: 30_000,
        maxJsSourceBytes: 262_144,
        maxJsRuntimeMs: 30_000,
        maxJsOutputBytes: 1_048_576,
      },
      control: { enabled: false, socketPath: path.join(base, "control.sock") },
      http: { host: "127.0.0.1", port: 0, token },
      limits: {
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        maxDirectoryEntries: 100,
        maxCommandOutputBytes: 1024 * 1024,
        commandTimeoutMs: 2_000,
        maxManagedProcesses: 8,
        maxProcessLogBytesPerStream: 4096,
        processStopGraceMs: 100,
      },
    };
    const server = startHttp(createRuntimeServices(config));
    servers.push(server);
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const client = new Client({ name: "system-environment-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "system_environment");
      expect(tool).toBeDefined();
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool?.outputSchema).toMatchObject({ type: "object" });

      const result = await client.callTool({ name: "system_environment", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        platform: platform(),
        arch: arch(),
        roots: [root],
        terminal: { enabled: false },
        computerUse: { enabled: true, fullHostJsEnabled: true },
      });
      const executables = (result.structuredContent as { executables: unknown }).executables as Array<{
        name: string;
        allowed: boolean;
        available: boolean;
        resolvedPath: string | null;
      }>;
      expect(executables).toHaveLength(2);
      expect(executables[1]).toEqual({
        name: "chatgpt-system-missing-binary-xyz",
        allowed: true,
        available: false,
        resolvedPath: null,
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
