import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatProjectBindings, MAX_CHAT_BINDINGS, normalizeChatId } from "../src/chat-bindings.js";

const cleanups: string[] = [];

afterEach(async () => {
  for (const dir of cleanups.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function fixture(): Promise<{ directory: string; bindings: ChatProjectBindings }> {
  const directory = await mkdtemp(path.join(tmpdir(), "cos-chat-bindings-"));
  cleanups.push(directory);
  return { directory, bindings: new ChatProjectBindings(directory) };
}

describe("chat project bindings", () => {
  it("sohbet alias'ini yazar ve okur", async () => {
    const { bindings } = await fixture();
    expect(await bindings.read("chat-1")).toBeNull();
    await bindings.bind("chat-1", "alpha");
    expect(await bindings.read("chat-1")).toBe("alpha");
  });

  it("gecersiz sohbet kimligini ve bos alias'i reddeder", async () => {
    const { bindings } = await fixture();
    await expect(bindings.bind("../evil", "alpha")).rejects.toThrow();
    await expect(bindings.bind("chat-1", "   ")).rejects.toThrow();
    expect(normalizeChatId("../../etc/passwd")).toBe("");
    expect(normalizeChatId("c-123_a.b")).toBe("c-123_a.b");
  });

  it("tavan asilinca en eski baglari budar", async () => {
    const { bindings } = await fixture();
    for (let index = 0; index < MAX_CHAT_BINDINGS + 5; index += 1) {
      await bindings.bind(`chat-${index}`, `alias-${index}`);
    }
    expect(await bindings.read("chat-0")).toBeNull();
    expect(await bindings.read(`chat-${MAX_CHAT_BINDINGS + 4}`)).toBe(`alias-${MAX_CHAT_BINDINGS + 4}`);
  });

  it("bozuk bag dosyasini yok sayar ve yeniden yazabilir", async () => {
    const { directory, bindings } = await fixture();
    await writeFile(path.join(directory, "chat-bindings.json"), "{not-json", "utf8");
    expect(await bindings.read("chat-1")).toBeNull();
    await bindings.bind("chat-1", "alpha");
    expect(await bindings.read("chat-1")).toBe("alpha");
  });

  it("okunamayan bag dosyasinda otomatige duser", async () => {
    const { directory, bindings } = await fixture();
    await bindings.bind("chat-1", "alpha");
    await chmod(directory, 0o000);
    try {
      expect(await bindings.read("chat-1")).toBeNull();
    } finally {
      await chmod(directory, 0o700);
    }
    expect(await bindings.read("chat-1")).toBe("alpha");
  });
});
