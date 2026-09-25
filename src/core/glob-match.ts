import { PolicyError } from "./errors.js";

// Depo içi yol filtresi için küçük glob eşleyici (POSIX göreli yollar).
// Desteklenen: `**` (sıfır veya daha çok dizin), `*` (tek segment içinde),
// `?`, `{a,b}` ve `[...]`. Eğik çizgi içermeyen desen (ör. `*.ts`) her
// derinlikteki dosya adına uygulanır; ripgrep/gitignore davranışıyla aynıdır.

const MAX_GLOB_CHARS = 1_024;

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function translate(glob: string): string {
  let pattern = "";
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        const atSegmentStart = index === 0 || glob[index - 1] === "/";
        const atSegmentEnd = index + 2 === glob.length || glob[index + 2] === "/";
        if (atSegmentStart && atSegmentEnd) {
          // `**/` sıfır ya da daha çok dizini, sondaki `**` her şeyi eşler.
          if (glob[index + 2] === "/") {
            pattern += "(?:[^/]*/)*";
            index += 2;
          } else {
            pattern += ".*";
            index += 1;
          }
          continue;
        }
      }
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      pattern += "(?:";
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      pattern += ")";
      continue;
    }
    if (char === "," && braceDepth > 0) {
      pattern += "|";
      continue;
    }
    if (char === "[") {
      const close = glob.indexOf("]", index + 1);
      if (close > index + 1) {
        const body = glob.slice(index + 1, close).replace(/\\/g, "\\\\");
        pattern += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
        index = close;
        continue;
      }
    }
    pattern += escapeRegExp(char);
  }
  if (braceDepth !== 0) throw new PolicyError("Glob has an unclosed '{' group.");
  return pattern;
}

export function compileGlob(glob: string): (relativePath: string) => boolean {
  const trimmed = glob.trim().replace(/^\.\//, "");
  if (trimmed === "" || trimmed.length > MAX_GLOB_CHARS || trimmed.includes("\u0000")) {
    throw new PolicyError(`Glob must contain 1-${MAX_GLOB_CHARS} non-NUL characters.`);
  }
  const basenameOnly = !trimmed.includes("/");
  const regex = new RegExp(`^${translate(trimmed)}$`);
  return (relativePath: string) => {
    const target = basenameOnly ? relativePath.slice(relativePath.lastIndexOf("/") + 1) : relativePath;
    return regex.test(target);
  };
}
