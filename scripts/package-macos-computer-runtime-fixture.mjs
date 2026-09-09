#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");

const BUNDLE_IDENTIFIER = "com.senoldogann.chatgpt-system.computer-runtime.fixture";
const BUNDLE_NAME = "ChatGPTSystemComputerRuntimeFixture";
const EXECUTABLE_NAME = "chatgpt-system-computer-runtime-fixture";
const ALLOWED_CONTEXT_KEYS = new Set(["repoDir", "outputPath"]);

function assertSupportedContext(context) {
  for (const key of Object.keys(context)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      throw new Error(`Unsupported bundle-plan option: ${key}. Protected bundle identity is fixed.`);
    }
  }
}

function assertSafeBundlePath(bundlePath) {
  const resolved = path.resolve(bundlePath);
  if (resolved === path.parse(resolved).root || path.extname(resolved) !== ".app") {
    throw new Error("Unsupported output path. Computer runtime fixture bundle output must be a non-root .app path.");
  }
}

export function buildComputerRuntimeFixtureBundlePlan(context = {}) {
  assertSupportedContext(context);

  const repoDir = path.resolve(context.repoDir ?? defaultRepoDir);
  const defaultBundlePath = path.join(
    repoDir,
    "native",
    "macos-computer-runtime",
    ".build",
    "staged",
    `${BUNDLE_NAME}.app`,
  );
  const bundlePath = context.outputPath === undefined
    ? defaultBundlePath
    : path.resolve(repoDir, context.outputPath);
  assertSafeBundlePath(bundlePath);

  const contentsPath = path.join(bundlePath, "Contents");
  const macOSPath = path.join(contentsPath, "MacOS");

  return {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    bundleName: BUNDLE_NAME,
    executableName: EXECUTABLE_NAME,
    sourcePath: path.join(
      repoDir,
      "native",
      "macos-computer-runtime",
      ".build",
      "release",
      EXECUTABLE_NAME,
    ),
    bundlePath,
    contentsPath,
    macOSPath,
    executablePath: path.join(macOSPath, EXECUTABLE_NAME),
    infoPlistPath: path.join(contentsPath, "Info.plist"),
  };
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>${EXECUTABLE_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_IDENTIFIER}</string>
  <key>CFBundleName</key>
  <string>${BUNDLE_NAME}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>LSUIElement</key>
  <false/>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
</dict>
</plist>
`;
}

async function readExistingBundleState(bundlePath) {
  try {
    const info = await lstat(bundlePath);
    if (info.isSymbolicLink()) {
      throw new Error(`Refusing to replace symlink bundle output: ${bundlePath}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Refusing to replace non-directory bundle output: ${bundlePath}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertReleaseExecutable(sourcePath) {
  let info;
  try {
    info = await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Release computer runtime fixture executable is missing. Build the Swift package first.");
    }
    throw error;
  }

  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Release computer runtime fixture executable must be a regular file.");
  }
}

function temporaryBundlePath(bundlePath) {
  const parent = path.dirname(bundlePath);
  const name = path.basename(bundlePath);
  return path.join(parent, `.${name}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
}

export async function stageComputerRuntimeFixtureBundle(plan = buildComputerRuntimeFixtureBundlePlan()) {
  await assertReleaseExecutable(plan.sourcePath);
  await mkdir(path.dirname(plan.bundlePath), { recursive: true });

  const temporaryBundle = temporaryBundlePath(plan.bundlePath);
  let movedIntoPlace = false;

  try {
    await mkdir(path.join(temporaryBundle, "Contents", "MacOS"), { recursive: true, mode: 0o755 });

    const temporaryExecutable = path.join(
      temporaryBundle,
      "Contents",
      "MacOS",
      plan.executableName,
    );
    await copyFile(plan.sourcePath, temporaryExecutable);
    await chmod(temporaryExecutable, 0o755);
    await writeFile(
      path.join(temporaryBundle, "Contents", "Info.plist"),
      infoPlist(),
      { encoding: "utf8", mode: 0o644 },
    );

    const existingBundle = await readExistingBundleState(plan.bundlePath);
    if (existingBundle) {
      await rm(plan.bundlePath, { recursive: true, force: false });
    }
    await rename(temporaryBundle, plan.bundlePath);
    movedIntoPlace = true;
    return plan.bundlePath;
  } finally {
    if (!movedIntoPlace) {
      await rm(temporaryBundle, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function signBundle(bundlePath, identity) {
  if (typeof identity !== "string" || identity.length === 0) {
    throw new Error("Signing identity must be a non-empty string.");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/codesign",
      [
        "--force",
        "--sign",
        identity,
        "--identifier",
        BUNDLE_IDENTIFIER,
        bundlePath,
      ],
      {
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const diagnostic = stderr.trim();
        reject(new Error(diagnostic ? `codesign failed: ${diagnostic}` : `codesign failed with exit code ${code}.`));
      }
    });
  });
}

function parseCliArguments(argv) {
  let outputPath;
  let signIdentity;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--help":
        help = true;
        break;
      case "--output": {
        if (outputPath !== undefined) throw new Error("--output may be provided only once.");
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("--output requires a path.");
        outputPath = value;
        index += 1;
        break;
      }
      case "--sign": {
        if (signIdentity !== undefined) throw new Error("--sign may be provided only once.");
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("--sign requires an identity.");
        signIdentity = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unsupported argument: ${argument}`);
    }
  }

  return { help, outputPath, signIdentity };
}

function printHelp() {
  console.log(`Usage: node scripts/package-macos-computer-runtime-fixture.mjs [options]

Options:
  --output <path>   Stage the fixed app bundle at this .app path.
  --sign <identity> Sign the staged bundle with the exact identity (use - for ad hoc signing).
  --help            Show this help text.
`);
}

async function main() {
  const args = parseCliArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const plan = buildComputerRuntimeFixtureBundlePlan({
    ...(args.outputPath === undefined ? {} : { outputPath: args.outputPath }),
  });
  await stageComputerRuntimeFixtureBundle(plan);
  if (args.signIdentity !== undefined) {
    await signBundle(plan.bundlePath, args.signIdentity);
  }
  console.log(plan.bundlePath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[chatgpt-system] macOS computer runtime fixture packaging failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
