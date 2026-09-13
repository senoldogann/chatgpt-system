#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from "./daily-driver-runner.mjs";
import { inspectInstalledComputerRuntime } from "./setup-macos-computer-runtime.mjs";

const BUNDLE_IDENTIFIER = "com.senoldogann.chatgpt-system.computer-runtime";
const BUNDLE_NAME = "ChatGPTSystemComputerRuntime.app";
const KEYCHAIN_HELPER_NAME = "chatgpt-system-keychain-helper";

const falseHealth = Object.freeze({
  accessibilityTrusted: false,
  screenCaptureAuthorized: false,
  eventListenAuthorized: false,
  eventPostAuthorized: false,
});

export function buildOwnerWorkstationStatus(input) {
  const computerRuntime = {
    available: input.runtime.available === true,
    tccIdentityStable: input.runtime.tccIdentityStable === true,
    bundleIdentifierVerified: input.runtime.bundleIdentifierVerified === true,
    signatureVerified: input.runtime.signatureVerified === true,
  };
  const permissions = {
    accessibilityTrusted: input.health.accessibilityTrusted === true,
    screenCaptureAuthorized: input.health.screenCaptureAuthorized === true,
    eventListenAuthorized: input.health.eventListenAuthorized === true,
    eventPostAuthorized: input.health.eventPostAuthorized === true,
  };
  const credential = { readableNonInteractively: input.credentialReadable === true };
  const ready = Object.values(computerRuntime).every(Boolean)
    && Object.values(permissions).every(Boolean)
    && credential.readableNonInteractively;
  return { ready, computerRuntime, permissions, credential };
}

function probeCredential(helperPath, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(helperPath, ["read", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE], {
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return !result.error && result.status === 0;
}

export async function collectOwnerWorkstationStatus(options = {}) {
  const homeDir = path.resolve(options.homeDir ?? homedir());
  const bundlePath = path.join(homeDir, ".chatgpt-system", BUNDLE_NAME);
  const helperPath = path.join(homeDir, ".chatgpt-system", "bin", KEYCHAIN_HELPER_NAME);
  const inspectRuntime = options.inspectRuntime ?? inspectInstalledComputerRuntime;
  const state = await inspectRuntime(bundlePath);

  const runtime = {
    available: state?.available === true,
    tccIdentityStable: state?.available === true && state.tccIdentityStable === true,
    bundleIdentifierVerified: state?.available === true && state.bundleIdentifier === BUNDLE_IDENTIFIER,
    signatureVerified: state?.available === true,
  };

  let health = { ...falseHealth };
  if (runtime.available) {
    let supervisor;
    try {
      if (options.createSupervisor) {
        supervisor = await options.createSupervisor({ bundlePath });
      } else {
        const { ComputerNativeSupervisor } = await import("../dist/computer-native-supervisor.js");
        supervisor = new ComputerNativeSupervisor({
          enabled: true,
          hostBundlePath: bundlePath,
          requestTimeoutMs: 5_000,
        });
      }
      const native = await supervisor.request("health", {}, 5_000);
      if (native && typeof native === "object") {
        health = {
          accessibilityTrusted: native.accessibilityTrusted === true,
          screenCaptureAuthorized: native.screenCaptureAuthorized === true,
          eventListenAuthorized: native.eventListenAuthorized === true,
          eventPostAuthorized: native.eventPostAuthorized === true,
        };
      }
    } catch {
      health = { ...falseHealth };
    } finally {
      await supervisor?.close?.().catch?.(() => undefined);
    }
  }

  const credentialReadable = (options.probeCredential ?? probeCredential)(helperPath);
  return buildOwnerWorkstationStatus({ runtime, health, credentialReadable });
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  collectOwnerWorkstationStatus()
    .then((status) => {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify(buildOwnerWorkstationStatus({
        runtime: { available: false, tccIdentityStable: false, bundleIdentifierVerified: false, signatureVerified: false },
        health: falseHealth,
        credentialReadable: false,
      }), null, 2)}\n`);
      process.exitCode = 1;
    });
}
