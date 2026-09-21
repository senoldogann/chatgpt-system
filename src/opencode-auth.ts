import { homedir } from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { PolicyError } from "./errors.js";

// OpenCode abonelik auth okuyucusu: daemon ile aynı kullanıcının
// ~/.local/share/opencode/auth.json dosyasındaki opencode-go anahtarı
// her çağrıda diskten okunur; anahtar bellekte tutulmaz, log/audit/
// hata mesajlarının hiçbirine yazılmaz. Dosya 1.5KB mertebesindedir,
// okuma maliyeti ihmal edilir; böylece opencode tarafında yenilenen
// anahtar bir sonraki çağrıda geçerli olur.

export const OPENCODE_GO_PROVIDER_ID = "opencode-go";
const AUTH_RELATIVE_PATH = path.join("opencode", "auth.json");
const MIN_KEY_CHARS = 16;

// Testler gerçek ev dizinine dokunmasın diye dosya yolu env ile ezilir.
export function resolveOpencodeAuthPath(homeDir: string): string {
  const override = process.env.OPENCODE_AUTH_PATH;
  if (override !== undefined && override.trim() !== "") return override;
  const dataHome = process.env.XDG_DATA_HOME;
  if (dataHome !== undefined && dataHome.trim() !== "") {
    return path.join(dataHome, AUTH_RELATIVE_PATH);
  }
  return path.join(homeDir, ".local", "share", AUTH_RELATIVE_PATH);
}

export function defaultOpencodeAuthPath(): string {
  return resolveOpencodeAuthPath(homedir());
}

interface OpencodeAuthEntry {
  type: string;
  key: unknown;
}

function entryApiKey(providerId: string, entry: unknown): string | null {
  if (entry === null || typeof entry !== "object") return null;
  const candidate = entry as Partial<OpencodeAuthEntry>;
  if (candidate.type !== "api") return null;
  if (typeof candidate.key !== "string" || candidate.key.length < MIN_KEY_CHARS) return null;
  return candidate.key;
}

// Dosya yoksa ya da opencode-go kaydı yoksa PolicyError atar; anahtar
// değeri hata nesnesine asla konmaz.
export async function readOpencodeGoApiKey(authPath: string): Promise<string> {
  let raw: string;
  try {
    const info = await stat(authPath);
    if (!info.isFile()) {
      throw new PolicyError("OpenCode auth yolu bir dosya değil; /connect ile giriş yap.");
    }
    if ((info.mode & 0o077) !== 0) {
      console.warn("[chatgpt-system] OpenCode auth dosyası grup/diğer kullanıcılara okunabilir.", {
        path: authPath,
      });
    }
    raw = await readFile(authPath, "utf8");
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new PolicyError("OpenCode auth dosyası okunamadı; /connect ile giriş yap.", {
      path: authPath,
      causeCode: (error as NodeJS.ErrnoException).code ?? "unknown",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PolicyError("OpenCode auth dosyası bozuk JSON içeriyor.", { path: authPath });
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new PolicyError("OpenCode auth dosyası beklenen biçimde değil.", { path: authPath });
  }
  const key = entryApiKey(OPENCODE_GO_PROVIDER_ID, (parsed as Record<string, unknown>)[OPENCODE_GO_PROVIDER_ID]);
  if (key === null) {
    throw new PolicyError("OpenCode Go anahtarı bulunamadı; TUI'da /connect ile OpenCode Go seç.", {
      path: authPath,
    });
  }
  return key;
}
