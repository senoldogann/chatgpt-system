import { describe, expect, it } from "vitest";
import { parseCliCommand } from "../src/cli-command.js";

describe("CLI command routing", () => {
  it("routes authorize without creating server-mode overrides", () => {
    expect(parseCliCommand(["authorize", "user"])).toEqual({
      kind: "authorize",
      args: { profile: "user", printLease: false },
    });
    expect(parseCliCommand(["authorize", "admin", "--ttl", "1800", "--print-lease"])).toEqual({
      kind: "authorize",
      args: { profile: "admin", requestedTtlSeconds: 1800, printLease: true },
    });
  });

  it("parses personal admin only as an explicit server flag", () => {
    expect(parseCliCommand(["stdio", "--personal-admin"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { personalAdminEnabled: true },
    });
  });

  it("parses computer use only as an explicit server flag", () => {
    expect(parseCliCommand(["stdio", "--enable-computer-use"])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: { computerUseEnabled: true },
    });
  });

  it("parses server control flags independently", () => {
    expect(parseCliCommand([
      "stdio",
      "--root", "/tmp/project",
      "--enable-control",
      "--control-socket", "/tmp/chatgpt-system.sock",
    ])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: {
        roots: ["/tmp/project"],
        controlEnabled: true,
        controlSocketPath: "/tmp/chatgpt-system.sock",
      },
    });
  });

  it("rejects a server socket override unless control is enabled", () => {
    expect(() => parseCliCommand([
      "stdio",
      "--root", "/tmp/project",
      "--control-socket", "/tmp/chatgpt-system.sock",
    ])).toThrow(/enable-control/i);
  });

  it("rejects server-only flags in authorize mode", () => {
    expect(() => parseCliCommand(["authorize", "user", "--root", "/tmp/project"])).toThrow();
    expect(() => parseCliCommand(["authorize", "admin", "--enable-control"])).toThrow();
    expect(() => parseCliCommand(["authorize", "admin", "--personal-admin"])).toThrow();
    expect(() => parseCliCommand(["authorize", "admin", "--enable-computer-use"])).toThrow();
  });
});
