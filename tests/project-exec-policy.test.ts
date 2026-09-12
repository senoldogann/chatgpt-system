import { describe, expect, it } from "vitest";
import {
  PROJECT_EXEC_IMAGE,
  buildDockerProjectExecInvocation,
} from "../src/docker-project-exec-backend.js";


describe("Docker project execution policy", () => {
  it("builds a fixed fail-closed sandbox invocation without host escape surfaces", () => {
    const invocation = buildDockerProjectExecInvocation({
      projectRoot: "/tmp/example-project",
      cwd: "/tmp/example-project/packages/app",
      command: "npm",
      args: ["test", "--", "--runInBand"],
      containerName: "chatgpt-system-project-test",
      uid: 501,
      gid: 20,
    });

    expect(invocation.command).toBe("docker");
    expect(invocation.args).toContain("--pull=never");
    expect(invocation.args).toContain("--network=none");
    expect(invocation.args).toContain("--read-only");
    expect(invocation.args).toContain("--cap-drop=ALL");
    expect(invocation.args).toContain("--security-opt=no-new-privileges");
    expect(invocation.args).toContain("--pids-limit=256");
    expect(invocation.args).toContain("--memory=4g");
    expect(invocation.args).toContain("--cpus=4");
    expect(invocation.args).toContain("--user=501:20");
    expect(invocation.args).toContain("--workdir=/workspace/packages/app");
    expect(invocation.args).toContain("type=bind,source=/tmp/example-project,target=/workspace");
    expect(invocation.args).toContain("HOME=/tmp");
    expect(invocation.args).toContain("CI=1");
    expect(invocation.args).toContain("NO_COLOR=1");
    expect(invocation.args).toContain(PROJECT_EXEC_IMAGE);

    const imageIndex = invocation.args.indexOf(PROJECT_EXEC_IMAGE);
    expect(invocation.args.slice(imageIndex + 1)).toEqual(["npm", "test", "--", "--runInBand"]);

    expect(invocation.args.join(" ")).not.toContain("/Users/");
    expect(invocation.args).not.toContain("--privileged");
    expect(invocation.args.join(" ")).not.toContain("docker.sock");
    expect(invocation.args.join(" ")).not.toContain("--network=host");
    expect(invocation.args.join(" ")).not.toContain("--pid=host");
  });

  it("rejects a cwd outside the mounted project root", () => {
    expect(() => buildDockerProjectExecInvocation({
      projectRoot: "/tmp/example-project",
      cwd: "/tmp/other-project",
      command: "node",
      args: ["--version"],
      containerName: "chatgpt-system-project-test",
      uid: 501,
      gid: 20,
    })).toThrow(/outside project root/i);
  });

  it("rejects project roots that cannot be represented safely in Docker mount syntax", () => {
    expect(() => buildDockerProjectExecInvocation({
      projectRoot: "/tmp/example,project",
      cwd: "/tmp/example,project",
      command: "node",
      args: ["--version"],
      containerName: "chatgpt-system-project-test",
      uid: 501,
      gid: 20,
    })).toThrow(/mount syntax/i);
  });
});
