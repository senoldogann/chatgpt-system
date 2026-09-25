import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

// LaunchAgent ve tunnel profillerine yazılan Node yolu kalıcıdır. Homebrew'de
// process.execPath sürüme bağlı Cellar yoludur (ör. /opt/homebrew/Cellar/node/
// 26.7.0/bin/node) ve `brew upgrade` sonrası silinir. Formülün sabit
// `opt/<formula>` bağlantısı her zaman kurulu sürümü gösterir; yalnızca aynı
// ikiliye çözülüyorsa onu kullanırız, aksi halde çalışan yolu koruruz.
export function stableNodePath(execPath = process.execPath, fsImpl = { existsSync, realpathSync }) {
  const match = /^(.+)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(execPath);
  if (!match) return execPath;
  const [, prefix, formula] = match;
  const candidate = path.join(prefix, "opt", formula, "bin", "node");
  try {
    if (fsImpl.existsSync(candidate) && fsImpl.realpathSync(candidate) === fsImpl.realpathSync(execPath)) {
      return candidate;
    }
  } catch {
    // Sabit bağlantı doğrulanamazsa çalışan yol güvenli varsayılandır.
  }
  return execPath;
}
