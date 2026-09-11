import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DockerProjectExecBackend } from "../src/docker-project-exec-backend.js";

const cleanups: string[] = [];

afterEach(async () => {
  delete process.env.CHATGPT_SYSTEM_PROJECT_EXEC_SECRET_CANARY;
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

type FakeDockerMode = "normal" | "image-missing";

async function fakeDockerFixture(endpoint: string, mode: FakeDockerMode): Promise<{ base: string; executable: string; logFile: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-fake-docker-"));
  cleanups.push(base);
  const executable = path.join(base, "docker-fixture.mjs");
  const logFile = path.join(base, "calls.jsonl");
  const source = `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
const args = process.argv.slice(2);
const logFile = ${JSON.stringify(logFile)};
const mode = ${JSON.stringify(mode)};
await appendFile(logFile, JSON.stringify(args) + "\\n");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (args[0] === "context" && args[1] === "inspect") {
  console.log(${JSON.stringify(endpoint)});
  process.exit(0);
}
if (args[0] === "info") {
  await delay(300);
  console.log("29.7.2");
  process.exit(0);
}
if (args[0] === "image" && args[1] === "inspect") {
  await delay(300);
  if (mode === "image-missing") process.exit(1);
  console.log("sha256:fixture");
  process.exit(0);
}
if (args[0] === "rm") {
  process.exit(0);
}
if (args[0] === "run") {
  if (args.includes("SECRET_CASE")) {
    console.log(process.env.CHATGPT_SYSTEM_PROJECT_EXEC_SECRET_CANARY ?? "secret-missing");
    process.exit(0);
  }
  if (args.includes("OUTPUT_CASE")) {
    process.stdout.write("x".repeat(4096));
    await delay(10_000);
    process.exit(0);
  }
  await delay(10_000);
  process.exit(0);
}
process.exit(7);
`;
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o755);
  return { base, executable, logFile };
}

async function calls(logFile: string): Promise<string[][]> {
  const content = await readFile(logFile, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
}

describe("DockerProjectExecBackend process lifecycle", () => {
  it("does not spend the project command timeout budget on Docker preflight and cleans up a timed-out run", async () => {
    const fixture = await fakeDockerFixture("unix:///tmp/docker.sock", "normal");
    const backend = new DockerProjectExecBackend({
      maxOutputBytes: 65_536,
      cleanupTimeoutMs: 1_000,
      dockerPath: fixture.executable,
    });

    await expect(backend.run({
      projectRoot: fixture.base,
      cwd: fixture.base,
      command: "node",
      args: ["TIMEOUT_CASE"],
      timeoutMs: 150,
    })).rejects.toMatchObject({ code: "COMMAND_TIMEOUT" });

    const recorded = await calls(fixture.logFile);
    const operations = recorded.map((args) => args[0]);
    expect(operations.slice(0, 3)).toEqual(["context", "info", "image"]);
    expect(operations.filter((operation) => operation !== "run")).toEqual(["context", "info", "image", "rm"]);
    expect(recorded.at(-1)?.slice(0, 2)).toEqual(["rm", "-f"]);
  });

  it("enforces the combined output limit and removes the container after interruption", async () => {
    const fixture = await fakeDockerFixture("unix:///tmp/docker.sock", "normal");
    const backend = new DockerProjectExecBackend({
      maxOutputBytes: 128,
      cleanupTimeoutMs: 1_000,
      dockerPath: fixture.executable,
    });

    await expect(backend.run({
      projectRoot: fixture.base,
      cwd: fixture.base,
      command: "node",
      args: ["OUTPUT_CASE"],
      timeoutMs: 2_000,
    })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });

    const recorded = await calls(fixture.logFile);
    expect(recorded.map((args) => args[0])).toEqual(["context", "info", "image", "run", "rm"]);
  });

  it("fails closed when the active Docker context is not a local Unix socket", async () => {
    const fixture = await fakeDockerFixture("tcp://remote.example:2375", "normal");
    const backend = new DockerProjectExecBackend({
      maxOutputBytes: 65_536,
      cleanupTimeoutMs: 1_000,
      dockerPath: fixture.executable,
    });

    await expect(backend.run({
      projectRoot: fixture.base,
      cwd: fixture.base,
      command: "node",
      args: ["--version"],
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "SANDBOX_UNAVAILABLE",
      details: { backend: "docker", reason: "nonlocal_docker_context" },
    });

    expect((await calls(fixture.logFile)).map((args) => args[0])).toEqual(["context"]);
  });

  it("fails closed when the fixed sandbox image is unavailable", async () => {
    const fixture = await fakeDockerFixture("unix:///tmp/docker.sock", "image-missing");
    const backend = new DockerProjectExecBackend({
      maxOutputBytes: 65_536,
      cleanupTimeoutMs: 1_000,
      dockerPath: fixture.executable,
    });

    await expect(backend.run({
      projectRoot: fixture.base,
      cwd: fixture.base,
      command: "node",
      args: ["--version"],
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "SANDBOX_UNAVAILABLE",
      details: { backend: "docker", reason: "image_unavailable" },
    });
  });

  it("does not forward daemon secret environment values to the Docker client process", async () => {
    const fixture = await fakeDockerFixture("unix:///tmp/docker.sock", "normal");
    process.env.CHATGPT_SYSTEM_PROJECT_EXEC_SECRET_CANARY = "SHOULD_NOT_LEAK";
    const backend = new DockerProjectExecBackend({
      maxOutputBytes: 65_536,
      cleanupTimeoutMs: 1_000,
      dockerPath: fixture.executable,
    });

    const result = await backend.run({
      projectRoot: fixture.base,
      cwd: fixture.base,
      command: "node",
      args: ["SECRET_CASE"],
      timeoutMs: 1_000,
    });

    expect(result.stdout).toContain("secret-missing");
    expect(result.stdout).not.toContain("SHOULD_NOT_LEAK");
  });

  it("fails closed when the Docker executable is unavailable", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-missing-docker-"));
    cleanups.push(base);
    const backend = new DockerProjectExecBackend({
      maxOutputBytes: 65_536,
      cleanupTimeoutMs: 1_000,
      dockerPath: path.join(base, "missing-docker"),
    });

    await expect(backend.run({
      projectRoot: base,
      cwd: base,
      command: "node",
      args: ["--version"],
      timeoutMs: 1_000,
    })).rejects.toMatchObject({
      code: "SANDBOX_UNAVAILABLE",
      details: { backend: "docker", reason: "docker_unavailable" },
    });
  });
});
