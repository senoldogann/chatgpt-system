import { describe, expect, it } from "vitest";
import { PolicyError } from "../src/errors.js";
import {
  sanitizedChildEnvironment,
  validateProcessInvocation,
} from "../src/process-policy.js";

describe("shared child process policy", () => {
  it("rejects disabled terminal, executable paths, non-allowlisted commands, and NUL args", () => {
    expect(() => validateProcessInvocation(
      { enabled: false, commands: ["node"] },
      "node",
      [],
    )).toThrow(PolicyError);

    expect(() => validateProcessInvocation(
      { enabled: true, commands: ["node"] },
      "/usr/bin/node",
      [],
    )).toThrow(PolicyError);

    expect(() => validateProcessInvocation(
      { enabled: true, commands: ["node"] },
      "sh",
      [],
    )).toThrow(PolicyError);

    expect(() => validateProcessInvocation(
      { enabled: true, commands: ["node"] },
      "node",
      ["bad\u0000arg"],
    )).toThrow(PolicyError);
  });

  it("accepts one allowlisted basename with ordinary arguments", () => {
    expect(() => validateProcessInvocation(
      { enabled: true, commands: ["node", "git"] },
      "node",
      ["--version"],
    )).not.toThrow();
  });

  it("sanitizes child environment to the bounded safe key set", () => {
    const env = sanitizedChildEnvironment({
      HOME: "/Users/tester",
      USER: "tester",
      LOGNAME: "tester",
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      TMPDIR: "/tmp/",
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
      SSH_AUTH_SOCK: "/tmp/ssh.sock",
      SECRET_TOKEN: "must-not-leak",
      CONTROL_PLANE_API_KEY: "must-not-leak",
    });

    expect(env).toEqual({
      HOME: "/Users/tester",
      USER: "tester",
      LOGNAME: "tester",
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      TMPDIR: "/tmp/",
      SHELL: "/bin/zsh",
      TERM: "xterm-256color",
      SSH_AUTH_SOCK: "/tmp/ssh.sock",
      CI: "1",
      NO_COLOR: "1",
    });
  });
});
