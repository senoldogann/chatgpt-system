#!/usr/bin/env node

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");

const INSTALL_ROOT = "/Library/Application Support/chatgpt-system";
const BIN_DIR = `${INSTALL_ROOT}/bin`;
const ETC_DIR = `${INSTALL_ROOT}/etc`;
const HELPER_PATH = `${BIN_DIR}/chatgpt-system-authority-broker`;
const METADATA_PATH = `${ETC_DIR}/authority-broker.sha256`;

const ALLOWED_CONTEXT_KEYS = new Set(["repoDir", "platform", "uid"]);

function assertNoOverrides(context) {
  for (const key of Object.keys(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      throw new Error(`Unsupported installer context option: ${key}. Protected paths and credentials are not configurable.`);
    }
  }
}

export function buildInstallPlan(context = {}) {
  assertNoOverrides(context);
  const platform = context.platform ?? process.platform;
  const uid = context.uid ?? process.getuid?.();
  if (platform !== "darwin") throw new Error("The authority broker installer is supported only on macOS.");
  if (uid !== 0) throw new Error("The authority broker installer must run as root. Build first, then run the installer with sudo.");

  const repoDir = path.resolve(context.repoDir ?? defaultRepoDir);
  return {
    sourcePath: path.join(
      repoDir,
      "native",
      "macos-authority-broker",
      ".build",
      "release",
      "chatgpt-system-authority-broker",
    ),
    installRoot: INSTALL_ROOT,
    binDir: BIN_DIR,
    etcDir: ETC_DIR,
    helperPath: HELPER_PATH,
    metadataPath: METADATA_PATH,
    helperMode: 0o755,
    metadataMode: 0o644,
    directoryMode: 0o755,
    owner: { uid: 0, gid: 0 },
  };
}

function classify(info) {
  if (info.isSymbolicLink()) return "symlink";
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  return "other";
}

async function ensureProtectedDirectory(target, mode) {
  await mkdir(target, { recursive: false, mode }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const info = await lstat(target);
  if (classify(info) !== "directory" || info.uid !== 0 || (info.mode & 0o022) !== 0) {
    throw new Error(`Refusing untrusted installation directory: ${target}`);
  }
  await chown(target, 0, 0);
  await chmod(target, mode);
}

async function ensureInstallDirectories(plan) {
  await ensureProtectedDirectory(plan.installRoot, plan.directoryMode);
  await ensureProtectedDirectory(plan.binDir, plan.directoryMode);
  await ensureProtectedDirectory(plan.etcDir, plan.directoryMode);
}

function temporaryPath(target) {
  return `${target}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
}

async function atomicWrite(target, bytes, mode) {
  const temp = temporaryPath(target);
  try {
    await writeFile(temp, bytes, { flag: "wx", mode });
    await chown(temp, 0, 0);
    await chmod(temp, mode);
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

function parseMetadata(bytes) {
  const match = /^([a-f0-9]{64})\n?$/.exec(bytes.toString("utf8"));
  const hash = match?.[1];
  if (!hash) throw new Error("Installed authority broker metadata is malformed.");
  return Buffer.from(hash, "hex");
}

async function verifyInstalled(plan) {
  const [rootInfo, binInfo, etcInfo, helperInfo, metadataInfo] = await Promise.all([
    lstat(plan.installRoot),
    lstat(plan.binDir),
    lstat(plan.etcDir),
    lstat(plan.helperPath),
    lstat(plan.metadataPath),
  ]);

  for (const [target, info, expected] of [
    [plan.installRoot, rootInfo, "directory"],
    [plan.binDir, binInfo, "directory"],
    [plan.etcDir, etcInfo, "directory"],
    [plan.helperPath, helperInfo, "file"],
    [plan.metadataPath, metadataInfo, "file"],
  ]) {
    if (classify(info) !== expected || info.uid !== 0 || (info.mode & 0o022) !== 0) {
      throw new Error(`Installed authority broker trust check failed: ${target}`);
    }
  }

  const [helperBytes, metadataBytes] = await Promise.all([
    readFile(plan.helperPath),
    readFile(plan.metadataPath),
  ]);
  const actual = createHash("sha256").update(helperBytes).digest();
  const expected = parseMetadata(metadataBytes);
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    throw new Error("Installed authority broker SHA-256 verification failed.");
  }
}

export async function installBroker(plan = buildInstallPlan()) {
  const sourceInfo = await lstat(plan.sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error("Release authority broker build output is missing or not a regular file. Run npm run build:broker:macos first.");
  }

  const helperBytes = await readFile(plan.sourcePath);
  const sha256 = createHash("sha256").update(helperBytes).digest("hex");

  await ensureInstallDirectories(plan);
  await atomicWrite(plan.helperPath, helperBytes, plan.helperMode);
  await atomicWrite(plan.metadataPath, Buffer.from(`${sha256}\n`, "utf8"), plan.metadataMode);
  await verifyInstalled(plan);

  return { helperPath: plan.helperPath, metadataPath: plan.metadataPath, sha256 };
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("This installer accepts no arguments. Build as your user, then run it with sudo.");
  }
  const plan = buildInstallPlan();
  const result = await installBroker(plan);
  console.log("Protected macOS authority broker installed.");
  console.log(`  Helper: ${result.helperPath}`);
  console.log(`  Metadata: ${result.metadataPath}`);
  console.log(`  SHA-256: ${result.sha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[chatgpt-system] macOS authority broker install failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
