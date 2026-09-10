#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildComputerRuntimeBundlePlan,
  stageComputerRuntimeBundle,
} from "./package-macos-computer-runtime.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");

const BUNDLE_IDENTIFIER = "com.senoldogann.chatgpt-system.computer-runtime";
const BUNDLE_NAME = "ChatGPTSystemComputerRuntime";
const EXECUTABLE_NAME = "chatgpt-system-computer-runtime";
const AUTO_IDENTITY_PREFIXES = ["Apple Development:", "Developer ID Application:"];
const PLAN_KEYS = new Set(["homeDir", "repoDir", "identity", "operationId"]);

function assertSupportedPlanContext(context) {
  for (const key of Object.keys(context)) {
    if (!PLAN_KEYS.has(key)) {
      throw new Error(`Unsupported computer installer option: ${key}. Bundle identity and destination are fixed.`);
    }
  }
}

function assertOperationId(value) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error("Computer installer operation id is invalid.");
  }
}

export function buildComputerInstallPlan(context = {}) {
  assertSupportedPlanContext(context);
  const homeDir = path.resolve(context.homeDir ?? homedir());
  const repoDir = path.resolve(context.repoDir ?? defaultRepoDir);
  const signingIdentity = context.identity;
  if (typeof signingIdentity !== "string" || signingIdentity.length === 0) {
    throw new Error("A selected code-signing identity is required to build the install plan.");
  }
  const operationId = context.operationId ?? "plan";
  assertOperationId(operationId);

  const destinationParent = path.join(homeDir, ".chatgpt-system");
  const destinationBundlePath = path.join(destinationParent, `${BUNDLE_NAME}.app`);
  return {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    bundleName: BUNDLE_NAME,
    executableName: EXECUTABLE_NAME,
    signingIdentity,
    tccIdentityStable: signingIdentity !== "-",
    repoDir,
    sourceExecutablePath: path.join(
      repoDir,
      "native",
      "macos-computer-runtime",
      ".build",
      "release",
      EXECUTABLE_NAME,
    ),
    destinationParent,
    destinationBundlePath,
    destinationExecutablePath: path.join(destinationBundlePath, "Contents", "MacOS", EXECUTABLE_NAME),
    stagingBundlePath: path.join(destinationParent, `.${BUNDLE_NAME}.install-${operationId}.app`),
    rollbackBundlePath: path.join(destinationParent, `.${BUNDLE_NAME}.rollback-${operationId}.app`),
  };
}

export function selectComputerSigningIdentity({
  explicitIdentity,
  installedIdentity,
  validIdentities = [],
  allowAdHoc = false,
} = {}) {
  const valid = [...new Set(validIdentities.filter((value) => typeof value === "string" && value.length > 0))];
  const validSet = new Set(valid);

  if (explicitIdentity !== undefined) {
    if (explicitIdentity === "-") {
      throw new Error("Use explicit development-only ad-hoc mode instead of passing '-' as an identity.");
    }
    if (!validSet.has(explicitIdentity)) {
      throw new Error(`Requested identity is not a valid code-signing identity: ${explicitIdentity}`);
    }
    return { identity: explicitIdentity, source: "explicit", tccIdentityStable: true };
  }

  if (installedIdentity && validSet.has(installedIdentity)) {
    return { identity: installedIdentity, source: "installed", tccIdentityStable: true };
  }

  const automatic = valid.filter((identity) => AUTO_IDENTITY_PREFIXES.some((prefix) => identity.startsWith(prefix)));
  if (automatic.length === 1) {
    return { identity: automatic[0], source: "discovered", tccIdentityStable: true };
  }
  if (automatic.length > 1) {
    throw new Error(
      "Multiple valid Apple Development/Developer ID code-signing identities are available. Re-run with --identity and the exact identity to avoid changing the Computer Runtime identity by guesswork.",
    );
  }

  if (allowAdHoc) {
    return { identity: "-", source: "ad-hoc", tccIdentityStable: false };
  }

  throw new Error(
    "No stable code-signing identity is available. Create or install a Code Signing certificate in Keychain, then re-run with --identity. For disposable development only, --ad-hoc-development is available and does not preserve TCC identity across builds.",
  );
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed${diagnostic ? `: ${diagnostic}` : ` with exit code ${result.status}`}.`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function parseCodeSigningIdentities(output) {
  const identities = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\)\s+[0-9A-Fa-f]+\s+"(.+)"\s*$/);
    if (match) identities.push(match[1]);
  }
  return [...new Set(identities)];
}

export function discoverValidSigningIdentities() {
  const result = runCommand(
    "/usr/bin/security",
    ["find-identity", "-v", "-p", "codesigning"],
    "code-signing identity discovery",
  );
  return parseCodeSigningIdentities(result.stdout);
}

async function pathState(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function plistValue(bundlePath, key) {
  return runCommand(
    "/usr/bin/plutil",
    ["-extract", key, "raw", "-o", "-", path.join(bundlePath, "Contents", "Info.plist")],
    `Computer Runtime ${key} inspection`,
  ).stdout.trim();
}

function codesignDetails(bundlePath) {
  const display = runCommand(
    "/usr/bin/codesign",
    ["-d", "--verbose=4", bundlePath],
    "Computer Runtime signature inspection",
  );
  const combined = `${display.stdout}\n${display.stderr}`;
  const authority = combined.match(/^Authority=(.+)$/m)?.[1]?.trim();
  return { authority };
}

function designatedRequirement(bundlePath) {
  const result = runCommand(
    "/usr/bin/codesign",
    ["-d", "-r-", bundlePath],
    "Computer Runtime designated requirement inspection",
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  const match = combined.match(/designated\s*=>\s*(.+)$/m);
  if (!match?.[1]) throw new Error("Computer Runtime designated requirement was not reported.");
  return match[1].trim();
}

function verifySignature(bundlePath) {
  runCommand(
    "/usr/bin/codesign",
    ["--verify", "--strict", "--deep", bundlePath],
    "Computer Runtime strict signature verification",
  );
}

async function verifyBundleContract(bundlePath) {
  const bundleInfo = await pathState(bundlePath);
  if (!bundleInfo || !bundleInfo.isDirectory() || bundleInfo.isSymbolicLink()) {
    throw new Error("Computer Runtime bundle is missing, not a directory, or is a symlink.");
  }

  const bundleIdentifier = plistValue(bundlePath, "CFBundleIdentifier");
  if (bundleIdentifier !== BUNDLE_IDENTIFIER) {
    throw new Error(`Computer Runtime bundle identifier mismatch: ${bundleIdentifier || "missing"}`);
  }
  const executableName = plistValue(bundlePath, "CFBundleExecutable");
  if (executableName !== EXECUTABLE_NAME) {
    throw new Error(`Computer Runtime executable name mismatch: ${executableName || "missing"}`);
  }

  const executablePath = path.join(bundlePath, "Contents", "MacOS", EXECUTABLE_NAME);
  const executableInfo = await pathState(executablePath);
  if (!executableInfo || !executableInfo.isFile() || executableInfo.isSymbolicLink()) {
    throw new Error("Computer Runtime executable is missing or is not a regular file.");
  }
  await access(executablePath, fsConstants.X_OK);

  verifySignature(bundlePath);
  const requirement = designatedRequirement(bundlePath);
  const { authority } = codesignDetails(bundlePath);
  return {
    bundleIdentifier,
    executableName,
    executablePath,
    designatedRequirement: requirement,
    signingIdentity: authority,
    tccIdentityStable: !/\bcdhash\b/i.test(requirement),
  };
}

export async function inspectInstalledComputerRuntime(bundlePath, context = {}) {
  const platform = context.platform ?? process.platform;
  if (platform !== "darwin") return { available: false, reason: "not-macos" };
  try {
    const verified = await verifyBundleContract(bundlePath);
    return { available: true, ...verified };
  } catch {
    return { available: false, reason: "missing-or-untrusted" };
  }
}

async function assertReplaceableDestination(destinationBundlePath) {
  const existing = await pathState(destinationBundlePath);
  if (!existing) return false;
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    throw new Error("Refusing to replace a Computer Runtime destination that is not a real app-bundle directory.");
  }
  return true;
}

function signBundle(bundlePath, identity) {
  runCommand(
    "/usr/bin/codesign",
    ["--force", "--sign", identity, "--identifier", BUNDLE_IDENTIFIER, bundlePath],
    "Computer Runtime signing",
  );
}

async function buildRelease(repoDir) {
  runCommand(
    "/usr/bin/xcrun",
    ["swift", "build", "-c", "release", "--package-path", path.join(repoDir, "native", "macos-computer-runtime")],
    "Computer Runtime release build",
  );
}

async function installedState(destinationBundlePath) {
  const exists = await assertReplaceableDestination(destinationBundlePath);
  if (!exists) return undefined;
  try {
    return await verifyBundleContract(destinationBundlePath);
  } catch (error) {
    throw new Error(`Existing Computer Runtime install is not trustworthy enough for an in-place identity-preserving update: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function installComputerRuntime(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") throw new Error("Computer Runtime installation is supported only on macOS.");

  const homeDir = path.resolve(options.homeDir ?? homedir());
  const repoDir = path.resolve(options.repoDir ?? defaultRepoDir);
  const destinationBundlePath = path.join(homeDir, ".chatgpt-system", `${BUNDLE_NAME}.app`);
  const oldState = await installedState(destinationBundlePath);
  const validIdentities = options.validIdentities ?? discoverValidSigningIdentities();
  const selected = selectComputerSigningIdentity({
    explicitIdentity: options.identity,
    installedIdentity: oldState?.signingIdentity,
    validIdentities,
    allowAdHoc: options.allowAdHoc === true,
  });
  const operationId = randomBytes(10).toString("hex");
  const plan = buildComputerInstallPlan({ homeDir, repoDir, identity: selected.identity, operationId });

  await mkdir(plan.destinationParent, { recursive: true, mode: 0o700 });
  await rm(plan.stagingBundlePath, { recursive: true, force: true });
  await rm(plan.rollbackBundlePath, { recursive: true, force: true });
  await buildRelease(repoDir);

  const stagingPlan = buildComputerRuntimeBundlePlan({ repoDir, outputPath: plan.stagingBundlePath });
  await stageComputerRuntimeBundle(stagingPlan);
  signBundle(plan.stagingBundlePath, selected.identity);
  const newState = await verifyBundleContract(plan.stagingBundlePath);

  if (selected.tccIdentityStable && !newState.tccIdentityStable) {
    throw new Error("Stable Computer Runtime signing unexpectedly produced an unstable designated requirement.");
  }
  if (oldState?.tccIdentityStable && oldState.designatedRequirement !== newState.designatedRequirement) {
    throw new Error(
      "Refusing to replace the existing stable Computer Runtime because the designated requirement would change. Reuse the current signing identity or remove the old install explicitly if an identity migration is intentional.",
    );
  }

  let oldMoved = false;
  let newMoved = false;
  try {
    if (oldState) {
      await rename(plan.destinationBundlePath, plan.rollbackBundlePath);
      oldMoved = true;
    }
    await rename(plan.stagingBundlePath, plan.destinationBundlePath);
    newMoved = true;
    const installed = await verifyBundleContract(plan.destinationBundlePath);
    if (selected.tccIdentityStable && !installed.tccIdentityStable) {
      throw new Error("Installed Computer Runtime lost its stable designated requirement.");
    }
    if (oldMoved) await rm(plan.rollbackBundlePath, { recursive: true, force: true });
    return {
      destinationBundlePath: plan.destinationBundlePath,
      bundleIdentifier: BUNDLE_IDENTIFIER,
      executableName: EXECUTABLE_NAME,
      signingIdentity: selected.identity,
      signingIdentitySource: selected.source,
      tccIdentityStable: installed.tccIdentityStable,
      designatedRequirement: installed.designatedRequirement,
    };
  } catch (error) {
    if (newMoved) {
      await rm(plan.destinationBundlePath, { recursive: true, force: true }).catch(() => {});
    } else {
      await rm(plan.stagingBundlePath, { recursive: true, force: true }).catch(() => {});
    }
    if (oldMoved) {
      await rename(plan.rollbackBundlePath, plan.destinationBundlePath).catch(() => {});
    }
    throw error;
  } finally {
    await rm(plan.stagingBundlePath, { recursive: true, force: true }).catch(() => {});
  }
}

function parseArgs(argv) {
  const options = { identity: undefined, allowAdHoc: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--ad-hoc-development") {
      options.allowAdHoc = true;
      continue;
    }
    if (arg === "--identity") {
      if (options.identity !== undefined) throw new Error("--identity may be supplied only once.");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--identity requires the exact code-signing identity.");
      options.identity = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (options.allowAdHoc && options.identity !== undefined) {
    throw new Error("--identity and --ad-hoc-development are mutually exclusive.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: npm run setup:computer:macos -- [options]

Installs the fixed Computer Runtime bundle at:
  ~/.chatgpt-system/ChatGPTSystemComputerRuntime.app

Options:
  --identity <name>        Use one exact currently valid Code Signing identity.
  --ad-hoc-development     Explicit development-only ad-hoc signing. TCC identity is not stable across builds.
  --help                   Show this help.

Stable mode never silently falls back to ad-hoc signing. The installer builds and
stages the helper, verifies the fixed bundle identity and executable, signs it,
checks the designated requirement, and performs a rollback-capable atomic replace.
It never invokes tccutil or permission-request APIs.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const result = await installComputerRuntime({
    identity: args.identity,
    allowAdHoc: args.allowAdHoc,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[chatgpt-system] macOS Computer Runtime setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
