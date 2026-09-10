import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_EXEC_IMAGE as runtimeImage } from "../src/docker-project-exec-backend.js";
import {
  PROJECT_EXEC_IMAGE as setupImage,
  buildProjectExecImageInvocation,
  parseProjectExecSetupArgs,
  runProjectExecSetup,
} from "../scripts/setup-project-exec.mjs";


describe("project execution sandbox setup", () => {
  it("builds the exact fixed local image without forwarding caller-controlled Docker flags", () => {
    const invocation = buildProjectExecImageInvocation({
      repoDir: "/Users/test/chatgpt-system",
      dockerPath: "/usr/local/bin/docker",
    });

    expect(setupImage).toBe(runtimeImage);
    expect(invocation).toEqual({
      command: "/usr/local/bin/docker",
      args: [
        "build",
        "--pull",
        "--tag",
        runtimeImage,
        "--file",
        path.join("/Users/test/chatgpt-system", "docker", "project-exec", "Dockerfile"),
        path.join("/Users/test/chatgpt-system", "docker", "project-exec"),
      ],
      cwd: "/Users/test/chatgpt-system",
    });
    expect(invocation.args.join(" ")).not.toContain("--privileged");
    expect(invocation.args.join(" ")).not.toContain("--build-arg");
  });

  it("rejects every caller-supplied setup argument", () => {
    expect(parseProjectExecSetupArgs([])).toEqual({});
    expect(() => parseProjectExecSetupArgs(["--build-arg", "TOKEN=x"])).toThrow(/does not accept arguments/i);
    expect(() => parseProjectExecSetupArgs(["--tag", "other"])).toThrow(/does not accept arguments/i);
  });

  it("runs the image build with shell disabled and a bounded timeout", () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Record<string, unknown>;
    }> = [];

    const result = runProjectExecSetup({
      repoDir: "/Users/test/chatgpt-system",
      dockerPath: "/usr/local/bin/docker",
    }, {
      spawnSync: (command: string, args: string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return { status: 0, signal: null, error: undefined };
      },
    });

    expect(result).toEqual({ installed: true, image: runtimeImage });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "/usr/local/bin/docker",
      options: {
        cwd: "/Users/test/chatgpt-system",
        stdio: "inherit",
        shell: false,
        timeout: 600_000,
      },
    });
  });

  it("fails closed when Docker cannot build the fixed image", () => {
    expect(() => runProjectExecSetup({
      repoDir: "/Users/test/chatgpt-system",
      dockerPath: "/usr/local/bin/docker",
    }, {
      spawnSync: () => ({ status: 7, signal: null, error: undefined }),
    })).toThrow(/project execution sandbox image build failed.*7/i);
  });
});
