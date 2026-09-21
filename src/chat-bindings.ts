// Sohbet bazlı proje bağları: aynı anda birden çok ChatGPT sohbeti farklı
// projelerde çalışırken panelin yanlış projeye düşmesini engeller. Bağ
// yalnızca kullanıcı eylemiyle kurulur (panelden açık alias seçimi ya da
// Daralt); otomatik çözümleme sırası: açık alias → sohbet bağı → aktif proje
// → en güncel kayıt. Yazım başarısız olsa bile köprü isteği düşmez; çözüm
// en güncel kayda düşerek çalışmaya devam eder.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CHAT_BINDINGS_FILE_NAME = "chat-bindings.json";
export const MAX_CHAT_BINDINGS = 200;
export const MAX_CHAT_ID_CHARS = 128;
export const MAX_CHAT_ALIAS_CHARS = 128;

const CHAT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

interface ChatBindingEntry {
  alias: string;
  boundAt: string;
}

interface ChatBindingsPayload {
  version: 1;
  bindings: Record<string, ChatBindingEntry>;
}

// Sohbet kimliği yalnızca güvenli karakterlerden oluşur; dosya adı ve
// sorgu parametresi olarak kullanılabildiği için katı bir kalıp uygulanır.
export function normalizeChatId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, MAX_CHAT_ID_CHARS);
  return CHAT_ID_PATTERN.test(trimmed) ? trimmed : "";
}

function emptyPayload(): ChatBindingsPayload {
  return { version: 1, bindings: {} };
}

function pruneBindings(payload: ChatBindingsPayload): void {
  const entries = Object.entries(payload.bindings);
  if (entries.length <= MAX_CHAT_BINDINGS) return;
  entries.sort((left, right) => {
    if (left[1].boundAt === right[1].boundAt) return 0;
    return left[1].boundAt < right[1].boundAt ? -1 : 1;
  });
  for (const [chatId] of entries.slice(0, entries.length - MAX_CHAT_BINDINGS)) {
    delete payload.bindings[chatId];
  }
}

export class ChatProjectBindings {
  private readonly filePath: string;

  constructor(stateDirectory: string) {
    this.filePath = path.join(stateDirectory, CHAT_BINDINGS_FILE_NAME);
  }

  async bind(rawChatId: string, rawAlias: string): Promise<void> {
    const chatId = normalizeChatId(rawChatId);
    const alias = rawAlias.trim().slice(0, MAX_CHAT_ALIAS_CHARS);
    if (chatId === "") throw new Error("Chat binding requires a valid chat id.");
    if (alias === "") throw new Error("Chat binding requires a non-empty alias.");
    const payload = await this.readPayload();
    payload.bindings[chatId] = { alias, boundAt: new Date().toISOString() };
    pruneBindings(payload);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  async read(rawChatId: string): Promise<string | null> {
    const chatId = normalizeChatId(rawChatId);
    if (chatId === "") return null;
    let payload: ChatBindingsPayload;
    try {
      payload = await this.readPayload();
    } catch {
      // Bağ dosyası okunamazsa çözüm otomatiğe düşer; köprü isteği düşmez.
      return null;
    }
    const entry = payload.bindings[chatId];
    if (entry === undefined) return null;
    const alias = entry.alias.trim().slice(0, MAX_CHAT_ALIAS_CHARS);
    return alias === "" ? null : alias;
  }

  private async readPayload(): Promise<ChatBindingsPayload> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return emptyPayload();
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") return emptyPayload();
      const bindingsRaw = (parsed as { bindings?: unknown }).bindings;
      const bindings: Record<string, ChatBindingEntry> = {};
      if (bindingsRaw !== null && typeof bindingsRaw === "object") {
        for (const [key, value] of Object.entries(bindingsRaw as Record<string, unknown>)) {
          const chatId = normalizeChatId(key);
          if (chatId === "" || value === null || typeof value !== "object") continue;
          const alias = (value as { alias?: unknown }).alias;
          if (typeof alias !== "string" || alias.trim() === "") continue;
          const boundAt = (value as { boundAt?: unknown }).boundAt;
          bindings[chatId] = {
            alias: alias.trim().slice(0, MAX_CHAT_ALIAS_CHARS),
            boundAt: typeof boundAt === "string" ? boundAt : "",
          };
        }
      }
      return { version: 1, bindings };
    } catch {
      // Bozuk dosya bağ sayılmaz; köprü en güncel kayda düşer.
      return emptyPayload();
    }
  }
}
