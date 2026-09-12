#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_EXEC_IMAGE = "chatgpt-system-project-exec:0.1.0";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");
const BUILD_TIMEOUT_MS = 600_000;

export function parseProjectExecSetupArgs(args) {
  if (!Array.isArray(args)) {
    throw new TypeError("Project execution setup arguments must be an array.");
  }
  if (args.length > 0) {
    throw new Error("Project execution setup does not accept arguments.");
  }
  return {};
}

export function buildProjectExecImageInvocation({
  repoDir = defaultRepoDir,
  dockerPath = "docker",
} = {}) {
  if (!path.isAbsolute(repoDir)) {
    throw new Error("Project execution setup repo path must be absolute.");
  }
  if (!path.isAbsolute(dockerPath)) {
    throw new Error("Project execution setup Docker path must be absolute.");
  }

  const normalizedRepoDir = path.resolve(repoDir);
  const contextDir = path.join(normalizedRepoDir, "docker", "project-exec");
  return {
    command: dockerPath,
    args: [
      "build",
      "--pull",
      "--tag",
      PROJECT_EXEC_IMAGE,
      "--file",
      path.join(contextDir, "Dockerfile"),
      contextDir,
    ],
    cwd: normalizedRepoDir,
  };
}

export function runProjectExecSetup(options = {}, dependencies = {}) {
  const invocation = buildProjectExecImageInvocation(options);
  const run = dependencies.spawnSync ?? spawnSync;
  const result = run(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: "inherit",
    shell: false,
    timeout: BUILD_TIMEOUT_MS,
  });

  if (result.error) {
    const timedOut = result.error?.code === "ETIMEDOUT";
    throw new Error(
      timedOut
        ? "Project execution sandbox image build timed out."
        : "Project execution sandbox image build failed to start.",
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    const detail = result.status === null
      ? `signal ${result.signal ?? "unknown"}`
      : `exit code ${result.status}`;
    throw new Error(`Project execution sandbox image build failed with ${detail}.`);
  }

  return { installed: true, image: PROJECT_EXEC_IMAGE };
}

function main() {
  try {
    const options = parseProjectExecSetupArgs(process.argv.slice(2));
    const dockerPath = process.env.CHATGPT_SYSTEM_DOCKER_PATH ?? "/usr/local/bin/docker";
    const result = runProjectExecSetup({ ...options, dockerPath });
    console.log(`Built ${result.image}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
