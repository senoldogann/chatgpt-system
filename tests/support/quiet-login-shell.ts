import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Owner shell testleri servisin kendi çıktısını birebir karşılaştırır. Gerçek
// login shell (-l) makinedeki /etc/profile.d betiklerini okur ve bazı
// ortamlarda stdout'a banner basar. Bu sarmalayıcı yalnızca -l bayrağını
// düşürür; betik aynı /bin/sh ile çalışır.
const directory = mkdtempSync(path.join(tmpdir(), "chatgpt-system-quiet-shell-"));
export const quietLoginShellPath = path.join(directory, "sh");

writeFileSync(
  quietLoginShellPath,
  '#!/bin/sh\nif [ "$1" = "-lc" ]; then shift; exec /bin/sh -c "$@"; fi\nexec /bin/sh "$@"\n',
  "utf8",
);
chmodSync(quietLoginShellPath, 0o755);
