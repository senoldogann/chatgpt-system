import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Araç kataloğu yayın takibi: ChatGPT tarafındaki Refresh ihtiyacını erken
// görünür kılar. Yalnızca araç adı kümesi ile üst seviye girdi anahtarlarını
// izler; girdi şemalarının derin yapısını özetlemez. Kayıt bilgilendirme
// amaçlıdır, otorite kararlarını etkilemez ve başlangıcı engellemez.

export interface ToolSurfaceEntry {
  name: string;
  inputKeys: string[];
}

export interface ToolSurfaceRecord {
  version: 1;
  schemaId: string;
  toolCount: number;
  toolNames: string[];
  firstSeenAt: string;
  updatedAt: string;
}

export interface ToolSurfaceUpdate {
  record: ToolSurfaceRecord;
  changed: boolean;
}

export class ToolSurfaceRecordError extends Error {
  readonly recordPath: string;
  constructor(recordPath: string, message: string) {
    super(message);
    this.name = "ToolSurfaceRecordError";
    this.recordPath = recordPath;
  }
}

const TOOL_SURFACE_FILENAME = "tool-surface.json";
const MAX_TOOL_ENTRIES = 256;
const MAX_INPUT_KEYS = 64;
const MAX_NAME_BYTES = 256;

function boundedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || Buffer.byteLength(trimmed, "utf8") > MAX_NAME_BYTES) return null;
  return trimmed;
}

// Zod nesnelerinin üst seviye anahtarlarını güvenli şekilde çıkarır; tanınmayan
// şema biçimlerinde boş liste döner, asla istisna fırlatmaz.
export function extractInputKeys(inputSchema: unknown): string[] {
  if (inputSchema === null || typeof inputSchema !== "object") return [];
  const shapeCandidate = (inputSchema as { shape?: unknown }).shape;
  const shape = typeof shapeCandidate === "function"
    ? (shapeCandidate as () => unknown).call(inputSchema)
    : shapeCandidate;
  if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return [];
  const keys: string[] = [];
  for (const key of Object.keys(shape)) {
    if (keys.length >= MAX_INPUT_KEYS) break;
    const bounded = boundedName(key);
    if (bounded !== null && !keys.includes(bounded)) keys.push(bounded);
  }
  return keys.sort();
}

// Sıralamadan bağımsız kararlı bildirim üretir; aynı araç kümesi her zaman aynı
// dizgeyi verir.
export function canonicalToolSurface(entries: readonly ToolSurfaceEntry[]): string {
  const normalized = entries
    .map((entry) => ({ name: entry.name, inputKeys: [...entry.inputKeys].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return JSON.stringify(normalized);
}

export function hashToolSurface(entries: readonly ToolSurfaceEntry[]): string {
  return createHash("sha256").update(canonicalToolSurface(entries)).digest("hex");
}

export function toolSurfaceRecordPath(homeDir: string): string {
  return path.join(homeDir, ".chatgpt-system", TOOL_SURFACE_FILENAME);
}

function isToolSurfaceRecord(value: unknown): value is ToolSurfaceRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record["version"] === 1
    && typeof record["schemaId"] === "string"
    && /^[0-9a-f]{64}$/.test(record["schemaId"] as string)
    && typeof record["toolCount"] === "number"
    && Number.isInteger(record["toolCount"])
    && Array.isArray(record["toolNames"])
    && (record["toolNames"] as unknown[]).every((name) => typeof name === "string")
    && typeof record["firstSeenAt"] === "string"
    && typeof record["updatedAt"] === "string";
}

// Kayıt yoksa ya da bozuksa null döner; çağrı tarafı bunu ilk kurulum sayar.
export async function loadToolSurfaceRecord(recordPath: string): Promise<ToolSurfaceRecord | null> {
  let raw: string;
  try {
    raw = await readFile(recordPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new ToolSurfaceRecordError(recordPath, `Tool surface record okunamadı: ${(error as Error).message}`);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isToolSurfaceRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface UpdateToolSurfaceArgs {
  recordPath: string;
  entries: readonly ToolSurfaceEntry[];
  nowIso: string;
}

// Mevcut katalog özetini kalıcı kayıtla uzlaştırır. Şema değişmediyse ilk
// görülme zamanını korur; değiştiyse yeni kayıt yazar. Atomik yazar (tmp+rename).
export async function updateToolSurfaceRecord(args: UpdateToolSurfaceArgs): Promise<ToolSurfaceUpdate> {
  const names = args.entries.map((entry) => entry.name).sort();
  if (names.length === 0) {
    throw new ToolSurfaceRecordError(args.recordPath, "Boş araç kataloğu yayınlanamaz.");
  }
  if (names.length > MAX_TOOL_ENTRIES) {
    throw new ToolSurfaceRecordError(args.recordPath, `Araç sayısı sınırı aşıldı: ${names.length}`);
  }
  const schemaId = hashToolSurface(args.entries);
  const previous = await loadToolSurfaceRecord(args.recordPath);
  if (previous !== null && previous.schemaId === schemaId) {
    const record: ToolSurfaceRecord = {
      ...previous,
      toolCount: names.length,
      toolNames: names,
      updatedAt: args.nowIso,
    };
    await writeRecordAtomically(args.recordPath, record);
    return { record, changed: false };
  }
  const record: ToolSurfaceRecord = {
    version: 1,
    schemaId,
    toolCount: names.length,
    toolNames: names,
    firstSeenAt: args.nowIso,
    updatedAt: args.nowIso,
  };
  await writeRecordAtomically(args.recordPath, record);
  return { record, changed: true };
}

async function writeRecordAtomically(recordPath: string, record: ToolSurfaceRecord): Promise<void> {
  try {
    await mkdir(path.dirname(recordPath), { recursive: true });
    const temporaryPath = `${recordPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record, null, 2), "utf8");
    await rename(temporaryPath, recordPath);
  } catch (error) {
    throw new ToolSurfaceRecordError(recordPath, `Tool surface record yazılamadı: ${(error as Error).message}`);
  }
}

export interface ToolSurfaceTrackableServer {
  registerTool: (...args: Array<never>) => unknown;
}

// Kayıtlı araçları bellekte izler; G/Ç yapmaz. Kayıtlar sunucuya WeakMap ile
// bağlanır, sunucu çöp toplanınca iz kaybolur.
const trackedSurfaces = new WeakMap<object, ToolSurfaceEntry[]>();

export function trackToolSurface(server: ToolSurfaceTrackableServer): void {
  if (trackedSurfaces.has(server)) return;
  const entries: ToolSurfaceEntry[] = [];
  trackedSurfaces.set(server, entries);
  const original = server.registerTool.bind(server);
  server.registerTool = (...args: Array<never>): unknown => {
    const toolName = args[0];
    const toolConfig = args[1] as { inputSchema?: unknown } | undefined;
    if (typeof toolName === "string") {
      entries.push({ name: toolName, inputKeys: extractInputKeys(toolConfig?.inputSchema) });
    }
    return (original as (...callArgs: Array<never>) => unknown)(...args);
  };
}

export function getTrackedToolSurface(server: ToolSurfaceTrackableServer): readonly ToolSurfaceEntry[] {
  return trackedSurfaces.get(server) ?? [];
}
