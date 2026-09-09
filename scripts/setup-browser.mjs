#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");

export function buildBrowserInstallInvocation({
  repoDir = defaultRepoDir,
  nodePath = process.execPath,
} = {}) {
  if (!path.isAbsolute(repoDir)) {
    throw new Error("Browser setup repo path must be absolute.");
  }
  if (!path.isAbsolute(nodePath)) {
    throw new Error("Browser setup Node path must be absolute.");
  }

  const normalizedRepoDir = path.resolve(repoDir);
  return {
    command: nodePath,
    args: [
      path.join(normalizedRepoDir, "node_modules", "playwright", "cli.js"),
      "install",
      "chromium",
    ],
    cwd: normalizedRepoDir,
  };
}

export function runBrowserSetup(options = {}, dependencies = {}) {
  const invocation = buildBrowserInstallInvocation(options);
  const run = dependencies.spawnSync ?? spawnSync;
  const result = run(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw new Error("Playwright Chromium installation failed to start.", { cause: result.error });
  }
  if (result.status !== 0) {
    const detail = result.status === null
      ? `signal ${result.signal ?? "unknown"}`
      : `exit code ${result.status}`;
    throw new Error(`Playwright Chromium installation failed with ${detail}.`);
  }

  return { installed: true, browser: "chromium" };
}

function main() {
  try {
    const result = runBrowserSetup();
    console.log(`Installed Playwright ${result.browser}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
