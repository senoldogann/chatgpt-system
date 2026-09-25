import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCliCommand } from "../src/cli-command.js";

describe("CLI command routing", () => {
  it("rejects authorize and review-action commands as unknown arguments", () => {
    // Yeni model: yalnızca server modu vardır, yetki CLI komutları kaldırıldı.
    expect(() => parseCliCommand(["authorize", "user"])).toThrow(/Unknown argument/);
    expect(() => parseCliCommand(["authorize", "admin", "--ttl", "1800", "--print-lease"])).toThrow(/Unknown argument/);
    expect(() => parseCliCommand(["review-action"])).toThrow(/Unknown argument/);
  });

  it("ignores the removed personal-admin flag for old tunnel profiles", () => {
    // Eski profiller bu bayrakla üretilmiş olabilir; yükseltmede çökmez.
    expect(parseCliCommand(["stdio", "--personal-admin"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: {},
    });
  });

  it("parses --tool-profile and rejects unknown profiles", () => {
    expect(parseCliCommand(["stdio", "--tool-profile", "dev"]).overrides.toolProfile).toBe("dev");
    expect(parseCliCommand(["stdio", "--tool-profile", "full"]).overrides.toolProfile).toBe("full");
    expect(() => parseCliCommand(["stdio", "--tool-profile", "admin"])).toThrow(/--tool-profile must be one of/);
    expect(() => parseCliCommand(["stdio", "--tool-profile"])).toThrow(/requires a value/);
  });

  it("expands owner-workstation without enabling browser", () => {
    expect(parseCliCommand(["stdio", "--owner-workstation"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: {
        ownerWorkstationEnabled: true,
        ownerRuntimeEnabled: true,
        terminalEnabled: true,
        projectExecEnabled: true,
        computerUseEnabled: true,
        fullHostJsEnabled: true,
        commandTimeoutMs: 120_000,
      },
    });
  });

  it("parses Owner Runtime as explicit server flags without Personal Admin coupling", () => {
    expect(parseCliCommand([
      "stdio",
      "--enable-owner-runtime",
      "--owner-shell-path", "/bin/sh",
    ])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: {
        ownerRuntimeEnabled: true,
        ownerShellPath: "/bin/sh",
      },
    });
  });

  it("rejects an Owner shell path unless Owner Runtime is enabled", () => {
    expect(() => parseCliCommand([
      "stdio",
      "--owner-shell-path", "/bin/sh",
    ])).toThrow(/enable-owner-runtime/i);
  });

  it("documents Owner Runtime server flags in CLI help", async () => {
    const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(source).toContain("--enable-owner-runtime");
    expect(source).toContain("--owner-shell-path");
  });

  it("parses computer use only as an explicit server flag", () => {
    expect(parseCliCommand(["stdio", "--enable-computer-use"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { computerUseEnabled: true },
    });
  });

  it("parses project execution only as an explicit server flag", () => {
    expect(parseCliCommand(["stdio", "--enable-project-exec"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { projectExecEnabled: true },
    });
  });

  it("parses full-host JavaScript only as an explicit independent server flag", () => {
    expect(parseCliCommand(["stdio", "--enable-full-host-js"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { fullHostJsEnabled: true },
    });
  });

  it("parses existing Chrome attach only as explicit browser server flags", () => {
    expect(parseCliCommand([
      "stdio",
      "--enable-browser",
      "--browser-existing-chrome",
      "--browser-existing-chrome-user-data-dir", "~/Library/Application Support/Google/Chrome",
    ])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: {
        browserEnabled: true,
        browserExistingChrome: true,
        browserExistingChromeUserDataDir: "~/Library/Application Support/Google/Chrome",
      },
    });
  });

  it("documents existing Chrome attach flags in CLI help", async () => {
    const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(source).toContain("--browser-existing-chrome");
    expect(source).toContain("--browser-existing-chrome-user-data-dir");
  });

  it("documents the full-host JavaScript server flag in CLI help", async () => {
    const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(source).toContain("--enable-full-host-js");
  });

  it("ignores the removed server control flags for old tunnel profiles", () => {
    // Control düzlemi kaldırıldı: eski profillerdeki bu bayraklar yoksayılır.
    expect(parseCliCommand([
      "stdio",
      "--root", "/tmp/project",
      "--enable-control",
      "--control-socket", "/tmp/chatgpt-system.sock",
    ])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { roots: ["/tmp/project"] },
    });
  });

  it("ignores a server socket override left by old profiles", () => {
    expect(parseCliCommand([
      "stdio",
      "--root", "/tmp/project",
      "--control-socket", "/tmp/chatgpt-system.sock",
    ])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { roots: ["/tmp/project"] },
    });
  });


  it("parses explicit non-loopback HTTP acknowledgement", () => {
    expect(parseCliCommand([
      "http",
      "--host", "0.0.0.0",
      "--allow-non-loopback-http",
    ])).toEqual({
      kind: "server",
      mode: "http",
      help: false,
      overrides: {
        host: "0.0.0.0",
        allowNonLoopbackHttp: true,
      },
    });
  });

  it("documents the non-loopback HTTP acknowledgement flag in CLI help", async () => {
    const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(source).toContain("--allow-non-loopback-http");
  });

  it("rejects unknown flags with an unknown-argument error", () => {
    expect(() => parseCliCommand(["stdio", "--not-a-flag"])).toThrow(/Unknown argument/);
  });
});
