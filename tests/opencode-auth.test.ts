import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOpencodeGoApiKey, resolveOpencodeAuthPath } from "../src/opencode-auth.js";

async function tempAuthFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-auth-"));
  const file = path.join(dir, "auth.json");
  await writeFile(file, content, "utf8");
  return file;
}

describe("opencode auth okuyucu", () => {
  it("opencode-go api anahtarını okur, diğer providerlara dokunmaz", async () => {
    const key = `go-key-${"x".repeat(24)}`;
    const file = await tempAuthFile(
      JSON.stringify({
        openai: { type: "api", key: "sk-ignored" },
        "opencode-go": { type: "api", key },
      }),
    );
    await expect(readOpencodeGoApiKey(file)).resolves.toBe(key);
  });

  it("dosya yoksa açık hata verir", async () => {
    await expect(readOpencodeGoApiKey("/tmp/opencode-auth-yok/auth.json")).rejects.toThrow(/okunamadı/);
  });

  it("opencode-go kaydı yoksa açık hata verir", async () => {
    const file = await tempAuthFile(JSON.stringify({ openai: { type: "api", key: "sk-ignored" } }));
    await expect(readOpencodeGoApiKey(file)).rejects.toThrow(/bulunamadı/);
  });

  it("oauth tipindeki kaydı anahtar saymaz", async () => {
    const file = await tempAuthFile(JSON.stringify({ "opencode-go": { type: "oauth", key: "x".repeat(32) } }));
    await expect(readOpencodeGoApiKey(file)).rejects.toThrow(/bulunamadı/);
  });

  it("bozuk JSON'u açık hata ile reddeder", async () => {
    const file = await tempAuthFile("{bozuk");
    await expect(readOpencodeGoApiKey(file)).rejects.toThrow(/bozuk/);
  });

  it("OPENCODE_AUTH_PATH ezmesini ve XDG_DATA_HOME'u çözer", async () => {
    const previousOverride = process.env.OPENCODE_AUTH_PATH;
    const previousXdg = process.env.XDG_DATA_HOME;
    try {
      process.env.OPENCODE_AUTH_PATH = "/tmp/ozel/auth.json";
      expect(resolveOpencodeAuthPath("/Users/test")).toBe("/tmp/ozel/auth.json");
      delete process.env.OPENCODE_AUTH_PATH;
      process.env.XDG_DATA_HOME = "/tmp/xdgdata";
      expect(resolveOpencodeAuthPath("/Users/test")).toBe("/tmp/xdgdata/opencode/auth.json");
      delete process.env.XDG_DATA_HOME;
      expect(resolveOpencodeAuthPath("/Users/test")).toBe("/Users/test/.local/share/opencode/auth.json");
    } finally {
      if (previousOverride !== undefined) process.env.OPENCODE_AUTH_PATH = previousOverride;
      else delete process.env.OPENCODE_AUTH_PATH;
      if (previousXdg !== undefined) process.env.XDG_DATA_HOME = previousXdg;
      else delete process.env.XDG_DATA_HOME;
    }
  });
});
