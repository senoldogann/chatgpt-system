import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { bridgeHello, clipBridgeText, BRIDGE_APP, BRIDGE_PROTOCOL } from "../src/bridge.js";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of cleanups.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function projectFixture(alias: string, worktreePath: string, brief: string | null) {
  return {
    id: `project-${alias}`,
    alias,
    roots: [worktreePath],
    worktree: {
      canonicalPath: worktreePath,
      repositoryRoot: worktreePath,
      commonGitDir: `${worktreePath}/.git`,
      gitDir: `${worktreePath}/.git`,
      repositoryIdentity: "a".repeat(64),
      worktreeIdentity: "b".repeat(64),
    },
    localState: {
      checkedAt: "2026-09-11T00:00:00.000Z",
      branch: "main",
      headSha: "c".repeat(40),
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      pathsTruncated: false,
    },
    publishedState: {
      remoteName: "origin" as const,
      branch: {
        status: "verified" as const,
        ref: "refs/heads/main",
        currentSha: "d".repeat(40),
        checkedAt: "2026-09-11T00:00:00.000Z",
        lastVerifiedSha: "d".repeat(40),
        lastVerifiedAt: "2026-09-11T00:00:00.000Z",
      },
      main: {
        status: "verified" as const,
        ref: "refs/heads/main",
        currentSha: "d".repeat(40),
        checkedAt: "2026-09-11T00:00:00.000Z",
        lastVerifiedSha: "d".repeat(40),
        lastVerifiedAt: "2026-09-11T00:00:00.000Z",
      },
    },
    semantic: {
      task: {
        goal: `Bridge alias cozumunu ${alias} icin dogrula.`,
        constraints: ["Kayitli worktree korunur."],
        successCriteria: ["Alias'siz istek aktif projeye cozulur."],
        status: "active" as const,
        nextStep: "Kopru testini kos.",
        ...(brief !== null ? { brief } : {}),
      },
      decisions: [],
      uncertainties: [],
      verificationSummary: [],
    },
  };
}

async function fixture(): Promise<{ baseUrl: string; token: string; runtime: RuntimeServices }> {
  const base = await mkdtemp(path.join(tmpdir(), "cos-bridge-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  const token = "bridge-test-token-0123456789abcdef";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node"] },
    projectExec: { enabled: false },
    skills: { enabled: false, directory: path.join(base, "skills") },
    goal: { enabled: false, maxTranscriptChars: 120_000 },
    workers: { enabled: false, maxWorkers: 8, maxParkedRuns: 16 },
    ownerRuntime: {
      enabled: false,
      shellPath: "/bin/sh",
      maxScriptBytes: 262_144,
      maxTimeoutMs: 120_000,
      maxTerminalSessions: 32,
      maxTerminalOutputBytes: 262_144,
      maxTerminalInputBytes: 65_536,
    },
    jevTargeting: { enabled: false, apiKey: null },
    sessionEvents: { enabled: false },
    browser: {
      enabled: false,
      connectionMode: "managed",
      headless: true,
      timeoutMs: 10_000,
      userDataDir: path.join(base, "browser-profile"),
      existingChromeUserDataDir: null,
    },
    continuity: {
      databasePath: path.join(base, "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },
    computerUse: {
      enabled: false,
      fullHostJsEnabled: false,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
      maxAutomaticRetriesPerAction: 2,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, allowNonLoopback: false, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
      maxManagedProcesses: 32,
      maxProcessLogBytesPerStream: 131_072,
      processStopGraceMs: 3_000,
    },
  };
  const runtime = createRuntimeServices(config);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, token, runtime };
}

describe("bridge saf islevleri", () => {
  it("hello kimligi sabittir", () => {
    expect(bridgeHello()).toEqual({ app: BRIDGE_APP, protocol: BRIDGE_PROTOCOL, version: "0.1.0" });
  });

  it("metin kirpma bosluklari tekler ve tavana ceker", () => {
    expect(clipBridgeText("a   b\nc", 10)).toBe("a b c");
    expect(clipBridgeText("x".repeat(100), 10)).toBe("x".repeat(10));
    expect(clipBridgeText(undefined, 10)).toBe("");
  });
});

describe("bridge HTTP uclari", () => {
  it("hello kimlik istemez, veri uclari 401 ister", async () => {
    const { baseUrl } = await fixture();
    const hello = await fetch(`${baseUrl}/bridge/hello`);
    expect(hello.status).toBe(200);
    expect(await hello.json()).toMatchObject({ app: "chatgpt-system", protocol: 1 });
    const denied = await fetch(`${baseUrl}/bridge/status`);
    expect(denied.status).toBe(401);
  });

  it("status bombeli ozet doner", async () => {
    const { baseUrl, token } = await fixture();
    const res = await fetch(`${baseUrl}/bridge/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      app: "chatgpt-system",
      protocol: 1,
      projects: { count: 0 },
      skills: { enabled: false, count: 0 },
    });
  });

  it("aliasiz context 400, kayitsiz alias 404 doner", async () => {
    const { baseUrl, token } = await fixture();
    const auth = { authorization: `Bearer ${token}` };
    const missing = await fetch(`${baseUrl}/bridge/context`, { headers: auth });
    expect(missing.status).toBe(400);
    const unknown = await fetch(`${baseUrl}/bridge/context?alias=nope`, { headers: auth });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "alias_not_found" });
  });

  it("alias verilmezse aktif proje ipucundan cozulur", async () => {
    const { baseUrl, token, runtime } = await fixture();
    const auth = { authorization: `Bearer ${token}` };
    runtime.continuityStore.register(projectFixture("alpha", "/tmp/cos-bridge-alpha", "Alpha brifi."));
    runtime.continuityStore.register(projectFixture("beta", "/tmp/cos-bridge-beta", "Beta brifi."));
    await runtime.activeProject.record("beta");

    const status = await (await fetch(`${baseUrl}/bridge/status`, { headers: auth })).json();
    expect(status.projects.count).toBe(2);
    expect(status.projects.activeAlias).toBe("beta");
    expect(status.projects.aliases.map((entry: { alias: string }) => entry.alias).sort()).toEqual(["alpha", "beta"]);

    const context = await (await fetch(`${baseUrl}/bridge/context`, { headers: auth })).json();
    expect(context.alias).toBe("beta");

    // Kayıtta olmayan ölü ipucu yok sayılır ve en güncel kayda düşülür.
    await runtime.activeProject.record("ghost");
    const fallback = await (await fetch(`${baseUrl}/bridge/context`, { headers: auth })).json();
    expect(["alpha", "beta"]).toContain(fallback.alias);
  });

  it("alias verilmemis handoff istegi aktif projeye cozulur", async () => {
    const { baseUrl, token, runtime } = await fixture();
    const auth = { authorization: `Bearer ${token}` };
    runtime.continuityStore.register(projectFixture("alpha", "/tmp/cos-bridge-alpha", "Alpha brifi."));
    runtime.continuityStore.register(projectFixture("beta", "/tmp/cos-bridge-beta", "Beta brifi."));
    await runtime.activeProject.record("alpha");

    const res = await fetch(`${baseUrl}/bridge/handoff/prepare`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.llmDrafted).toBe(false);
    expect(String(payload.bootstrap)).toContain("Alpha brifi.");
  });

  it("bozuk handoff govdesi 400 doner", async () => {
    const { baseUrl, token } = await fixture();
    const res = await fetch(`${baseUrl}/bridge/handoff/prepare`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "not-json{{{",
    });
    expect(res.status).toBe(400);
  });

  it("bilinmeyen bridge yolu 404 doner", async () => {
    const { baseUrl, token } = await fixture();
    const res = await fetch(`${baseUrl}/bridge/yok`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("tarayici uzantisi kaynagiyla gelen istekleri reddetmez", async () => {
    const { baseUrl, token } = await fixture();
    const extensionOrigin = "chrome-extension://nokniemlonfonpnaibakchhkmckogfo";
    const status = await fetch(`${baseUrl}/bridge/status`, {
      headers: { authorization: `Bearer ${token}`, origin: extensionOrigin },
    });
    expect(status.status).toBe(200);
    const handoff = await fetch(`${baseUrl}/bridge/handoff/prepare`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: extensionOrigin,
      },
      body: JSON.stringify({ alias: "yok" }),
    });
    expect(handoff.status).not.toBe(403);
    expect(handoff.status).toBe(404);
  });

  it("mcp ucu yabanci tarayici kaynagini yine reddeder", async () => {
    const { baseUrl, token } = await fixture();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "chrome-extension://nokniemlonfonpnaibakchhkmckogfo",
      },
    });
    expect(res.status).toBe(403);
  });
});
