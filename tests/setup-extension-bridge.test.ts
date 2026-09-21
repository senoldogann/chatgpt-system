import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  buildExtensionBridgePlist,
  EXTENSION_BRIDGE_LABEL,
  DEFAULT_BRIDGE_PORT,
  generateBridgeToken,
  parseExtensionBridgeArgs,
  probeExtensionBridge,
  statusSummary,
} from "../scripts/setup-extension-bridge.mjs";

describe("uzanti koprusu kurulumu", () => {
  it("argumanlari dogrular", () => {
    expect(parseExtensionBridgeArgs(["install", "--root", "/tmp/x"])).toMatchObject({
      command: "install",
      root: "/tmp/x",
      port: DEFAULT_BRIDGE_PORT,
    });
    expect(parseExtensionBridgeArgs(["install", "--root", "/tmp/x", "--port", "4321"]).port).toBe(4321);
    expect(() => parseExtensionBridgeArgs(["install"])).toThrow();
    expect(() => parseExtensionBridgeArgs(["kur"])).toThrow();
    expect(() => parseExtensionBridgeArgs(["install", "--root", "/tmp/x", "--port", "0"])).toThrow();
  });

  it("token uretir", () => {
    const token = generateBridgeToken();
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(generateBridgeToken()).not.toBe(token);
  });

  it("plist beklenen ajan ve komutu tasir", () => {
    const plist = buildExtensionBridgePlist({
      nodePath: "/opt/homebrew/bin/node",
      cliPath: "/tmp/dist/cli.js",
      root: "/tmp/proj",
      port: 4312,
    });
    expect(plist).toContain(EXTENSION_BRIDGE_LABEL);
    expect(plist).toContain("/tmp/dist/cli.js");
    expect(plist).toContain("CHATGPT_SYSTEM_HTTP_TOKEN");
    expect(plist).toContain("--port");
    expect(() => buildExtensionBridgePlist({
      nodePath: "node",
      cliPath: "/tmp/dist/cli.js",
      root: "/tmp/proj",
      port: 4312,
    })).toThrow();
  });

  it("durum ozeti asamayi ayirt eder", () => {
    expect(statusSummary({ plistExists: false, agentLoaded: false, helloOk: false }).state).toBe("yok");
    expect(statusSummary({ plistExists: true, agentLoaded: false, helloOk: false }).state).toBe("durmus");
    expect(statusSummary({ plistExists: true, agentLoaded: true, helloOk: false }).state).toBe("erisimsiz");
    expect(statusSummary({ plistExists: true, agentLoaded: true, helloOk: true, version: "0.1.0" }).state)
      .toBe("calisiyor");
  });
});

type FakeBridgeOptions = {
  rejectExtensionOrigin?: boolean;
  handoffReady?: boolean;
  token?: string;
};

// Gercek bir yerel HTTP sunucusu: eski sunucu davranisi (uzanti Origin'ini
// JSON olmayan 403 ile reddetme) ve yeni sunucu davranisi taklit edilir.
function startFakeBridge(options: FakeBridgeOptions) {
  const token = options.token ?? "t".repeat(32);
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const reply = (status: number, body: string, json: boolean) => {
      res.writeHead(status, { "content-type": json ? "application/json" : "text/plain" });
      res.end(body);
    };
    if (url === "/bridge/hello") {
      reply(200, JSON.stringify({ app: "chatgpt-system", protocol: 1, version: "9.9.9" }), true);
      return;
    }
    if (options.rejectExtensionOrigin && String(req.headers.origin ?? "").startsWith("chrome-extension://")) {
      reply(403, "Invalid Origin: extension", false);
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      reply(401, JSON.stringify({ error: "unauthorized" }), true);
      return;
    }
    if (url.startsWith("/bridge/handoff/prepare")) {
      if (options.handoffReady) reply(200, JSON.stringify({ bootstrap: "devam" }), true);
      else reply(422, JSON.stringify({ error: "handoff_unavailable" }), true);
      return;
    }
    reply(200, JSON.stringify({ projects: { count: 1 } }), true);
  });
  return new Promise<{ server: Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

async function withFakeBridge<T>(options: FakeBridgeOptions, run: (port: number) => Promise<T>): Promise<T> {
  const { server, port } = await startFakeBridge(options);
  try {
    return await run(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("uzanti koprusu verify sondasi", () => {
  const origin = "chrome-extension://extension-bridge-verify";
  const token = "t".repeat(32);

  it("verify argumanlarini dogrular", () => {
    expect(parseExtensionBridgeArgs(["verify"])).toMatchObject({ command: "verify", port: DEFAULT_BRIDGE_PORT });
    expect(parseExtensionBridgeArgs(["verify", "--alias", "proje"]).alias).toBe("proje");
    expect(() => parseExtensionBridgeArgs(["install", "--alias", "proje"])).toThrow();
    expect(() => parseExtensionBridgeArgs(["verify", "--port", "0"])).toThrow();
  });

  it("saglikli sunucuyu gecer", async () => {
    await withFakeBridge({ handoffReady: true }, async (port) => {
      const result = await probeExtensionBridge({ port, token, alias: "proje", origin });
      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.name)).toEqual(["hello", "status", "handoff"]);
      expect(result.checks.find((check) => check.name === "handoff")?.detail).toContain("brif");
    });
  });

  it("kayitli brif yokken yolu gecerli sayar", async () => {
    await withFakeBridge({}, async (port) => {
      const result = await probeExtensionBridge({ port, token, alias: "proje", origin });
      expect(result.ok).toBe(true);
      expect(result.checks.find((check) => check.name === "handoff")?.detail).toContain("checkpoint");
    });
  });

  it("eski sunucunun Origin reddini yakalar", async () => {
    await withFakeBridge({ rejectExtensionOrigin: true }, async (port) => {
      const result = await probeExtensionBridge({ port, token, alias: "", origin });
      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.name === "status")?.detail).toContain("403");
    });
  });

  it("token uyusmazligini yakalar", async () => {
    await withFakeBridge({}, async (port) => {
      const result = await probeExtensionBridge({ port, token: "x".repeat(32), alias: "", origin });
      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.name === "status")?.detail).toContain("401");
    });
  });

  it("token dosyasi yokken bunu acikca soyler", async () => {
    await withFakeBridge({}, async (port) => {
      const result = await probeExtensionBridge({ port, token: "", alias: "", origin });
      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.name === "token")?.detail).toContain("token");
    });
  });
});
