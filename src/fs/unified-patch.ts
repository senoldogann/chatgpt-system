import { parsePatch } from "diff";
import { PatchInvalidError } from "../core/errors.js";

export interface UnifiedPatchNormalization {
  /** Normalize edilmiş patch metni; gövde asla değiştirilmez. */
  patch: string;
  /** En az bir `@@` başlığındaki yedekli satır sayısı gövdeden düzeltildiyse true. */
  normalized: boolean;
}

interface HunkHeader {
  oldStart: number;
  newStart: number;
  trailer: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function parseHunkHeader(line: string): { header: HunkHeader; oldLines: number; newLines: number } | null {
  const match = HUNK_HEADER.exec(line);
  if (match === null) return null;
  return {
    header: {
      oldStart: Number(match[1]),
      newStart: Number(match[3]),
      trailer: match[5] ?? "",
    },
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function isFileHeader(line: string): boolean {
  return line.startsWith("--- ")
    || line.startsWith("+++ ")
    || line.startsWith("diff ")
    || line.startsWith("Index:");
}

function formatHunkHeader(header: HunkHeader, oldLines: number, newLines: number): string {
  return `@@ -${header.oldStart},${oldLines} +${header.newStart},${newLines} @@${header.trailer}`;
}

/**
 * `@@` başlığındaki satır sayıları gövdeden türetilebilen yedekli meta veridir.
 * Model üretimi diff'lerde en sık bozulan alan budur ve jsdiff bunu ayrıştırma
 * hatasıyla reddeder. Bu fonksiyon yalnızca sayıları gövdeye göre düzeltir;
 * bağlam satırlarını, eklenen/silinen içeriği veya başlangıç satırlarını
 * değiştirmez, dolayısıyla eşleşme ve yazma semantiği aynı kalır.
 *
 * Gövdede geçersiz önek bulunursa normalize edilmez; çağıran tipli hata üretir.
 */
export function normalizeUnifiedPatchHunkHeaders(patchText: string): UnifiedPatchNormalization {
  const lines = patchText.split("\n");
  const output: string[] = [];
  let normalized = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const parsed = parseHunkHeader(line);
    if (parsed === null) {
      output.push(line);
      index += 1;
      continue;
    }

    const body: string[] = [];
    let oldLines = 0;
    let newLines = 0;
    let malformed = false;
    let cursor = index + 1;

    while (cursor < lines.length) {
      const candidate = lines[cursor]!;
      if (HUNK_HEADER.test(candidate) || isFileHeader(candidate)) break;
      // jsdiff son satırdaki boş dizeyi sonlandırıcı sayar, aradaki boş satırı
      // bağlam satırı sayar.
      if (candidate.length === 0) {
        if (cursor === lines.length - 1) break;
        body.push(candidate);
        oldLines += 1;
        newLines += 1;
        cursor += 1;
        continue;
      }
      const prefix = candidate[0]!;
      if (prefix === " ") {
        oldLines += 1;
        newLines += 1;
      } else if (prefix === "-") {
        oldLines += 1;
      } else if (prefix === "+") {
        newLines += 1;
      } else if (prefix !== "\\") {
        malformed = true;
        break;
      }
      body.push(candidate);
      cursor += 1;
    }

    if (malformed || body.length === 0) return { patch: patchText, normalized: false };

    const corrected = formatHunkHeader(parsed.header, oldLines, newLines);
    if (oldLines !== parsed.oldLines || newLines !== parsed.newLines) normalized = true;
    output.push(corrected, ...body);
    index = cursor;
  }

  return { patch: normalized ? output.join("\n") : patchText, normalized };
}

/**
 * jsdiff'in serbest metin ayrıştırma hatasını tipli, eyleme dönüştürülebilir
 * bir hataya çevirir. Ham kütüphane mesajı `INTERNAL_ERROR` olarak sızmaz.
 */
export function patchInvalidError(error: unknown): PatchInvalidError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("only works with a single input")) {
    return new PatchInvalidError(
      "multiple_files",
      "The patch contains more than one file. Send one file per patch, or use fs_apply_patch_set for a multi-file change.",
      message,
    );
  }
  if (message.includes("contained invalid line")) {
    return new PatchInvalidError(
      "invalid_hunk_line",
      "A hunk body line does not start with ' ', '+', '-' or '\\'. Every context line needs its leading space.",
      message,
    );
  }
  if (message.startsWith("Missing ")) {
    return new PatchInvalidError(
      "missing_file_header",
      "The patch is missing its '--- a/<path>' and '+++ b/<path>' header lines.",
      message,
    );
  }
  if (message.includes("line count did not match") || message.includes("has more lines than expected")) {
    return new PatchInvalidError(
      "hunk_line_count_mismatch",
      "The hunk body could not be reconciled with its '@@' header. Re-read the file and rebuild the hunk.",
      message,
    );
  }
  return new PatchInvalidError(
    "unparseable",
    "The patch is not a valid single-file unified diff. Re-read the file with fs_read and rebuild the diff.",
    message,
  );
}

/**
 * Reject structurally invalid unified diffs before they reach the diff library.
 * Without this guard `applyPatch` either throws an untyped error that surfaces
 * as INTERNAL_ERROR, or silently returns the unchanged source for patch text
 * that contains no hunks.
 */
export function validateUnifiedPatch(patchText: string): void {
  let parsed;
  try {
    parsed = parsePatch(patchText);
  } catch (error) {
    // Ayrıştırıcı nedeni yutulmaz; çağıran hangi alanın bozuk olduğunu görür.
    throw patchInvalidError(error);
  }
  if (parsed.length !== 1 || parsed[0]!.hunks.length < 1) {
    throw new PatchInvalidError(
      "multiple_files",
      "A unified diff must contain exactly one file with at least one hunk.",
      `parsed ${parsed.length} files`,
    );
  }
  for (const hunk of parsed[0]!.hunks) {
    if (!Number.isInteger(hunk.oldStart)
      || !Number.isInteger(hunk.oldLines)
      || !Number.isInteger(hunk.newStart)
      || !Number.isInteger(hunk.newLines)
      || hunk.oldLines < 0
      || hunk.newLines < 0
      || hunk.lines.length < 1) {
      throw new PatchInvalidError(
        "unparseable",
        "A hunk carries invalid start or line-count metadata.",
        "hunk metadata failed structural validation",
      );
    }
  }
}
