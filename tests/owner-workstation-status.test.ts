import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildOwnerWorkstationStatus, collectOwnerWorkstationStatus } from "../scripts/owner-workstation-status.mjs";

const readyInput = {
  runtime: {
    available: true,
    tccIdentityStable: true,
    bundleIdentifierVerified: true,
    signatureVerified: true,
  },
  health: {
    accessibilityTrusted: true,
    screenCaptureAuthorized: true,
    eventListenAuthorized: true,
    eventPostAuthorized: true,
  },
  credentialReadable: true,
};

describe("Owner Workstation readiness status", () => {
  it("reports ready only when runtime identity, passive permissions, and credential are all ready", () => {
    expect(buildOwnerWorkstationStatus(readyInput)).toEqual({
      ready: true,
      computerRuntime: readyInput.runtime,
      permissions: readyInput.health,
      credential: { readableNonInteractively: true },
    });
  });

  it.each([
    ["runtime available", { runtime: { available: false } }],
    ["stable TCC identity", { runtime: { tccIdentityStable: false } }],
    ["bundle identifier", { runtime: { bundleIdentifierVerified: false } }],
    ["signature", { runtime: { signatureVerified: false } }],
    ["Accessibility", { health: { accessibilityTrusted: false } }],
    ["Screen Recording", { health: { screenCaptureAuthorized: false } }],
    ["event listen", { health: { eventListenAuthorized: false } }],
    ["event post", { health: { eventPostAuthorized: false } }],
    ["credential", { credentialReadable: false }],
  ])("reports not ready when %s is unavailable", (_label, override) => {
    const input = {
      runtime: { ...readyInput.runtime, ...(override.runtime ?? {}) },
      health: { ...readyInput.health, ...(override.health ?? {}) },
      credentialReadable: override.credentialReadable ?? true,
    };
    expect(buildOwnerWorkstationStatus(input).ready).toBe(false);
  });

  it("collects passive runtime health and closes the native supervisor", async () => {
    let closed = 0;
    let requested: unknown[] = [];
    const status = await collectOwnerWorkstationStatus({
      homeDir: "/Users/test",
      inspectRuntime: async () => ({
        available: true,
        tccIdentityStable: true,
        bundleIdentifier: "com.senoldogann.chatgpt-system.computer-runtime",
      }),
      createSupervisor: async () => ({
        request: async (...args: unknown[]) => {
          requested = args;
          return {
            accessibilityTrusted: true,
            screenCaptureAuthorized: true,
            eventListenAuthorized: true,
            eventPostAuthorized: true,
          };
        },
        close: async () => { closed += 1; },
      }),
      probeCredential: (helperPath: string) => {
        expect(helperPath).toBe("/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper");
        return true;
      },
    });

    expect(requested).toEqual(["health", {}, 5_000]);
    expect(closed).toBe(1);
    expect(status.ready).toBe(true);
  });

  it("does not start the native host when the installed runtime is unavailable", async () => {
    let supervisorCreated = false;
    const status = await collectOwnerWorkstationStatus({
      homeDir: "/Users/test",
      inspectRuntime: async () => ({ available: false, reason: "missing-or-untrusted" }),
      createSupervisor: async () => { supervisorCreated = true; throw new Error("must not run"); },
      probeCredential: () => false,
    });

    expect(supervisorCreated).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.permissions).toEqual({
      accessibilityTrusted: false,
      screenCaptureAuthorized: false,
      eventListenAuthorized: false,
      eventPostAuthorized: false,
    });
  });

  it("documents a passive status command without TCC mutation", async () => {
    const [source, packageJson] = await Promise.all([
      readFile(new URL("../scripts/owner-workstation-status.mjs", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);
    expect(source).not.toContain("tccutil");
    expect(source).not.toMatch(/request.*permission/i);
    expect(JSON.parse(packageJson).scripts["owner-workstation:status"]).toBe(
      "npm run build && node scripts/owner-workstation-status.mjs",
    );
  });
});
