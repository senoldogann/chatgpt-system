// Tarayıcı uzantısı için salt-okunur loopback köprüsü: bağlam, daraltma
// brifi, iş kuyruğu ve terminal çıktılarının sınırlı özetleri. MCP yüzeyine
// dokunmaz; yalnızca HTTP taşıma katmanından token ile sunulur. Tüm metinler
// veridir, talimat değildir; uzantı bunları olduğu gibi gösterir.

import { defaultOpencodeAuthPath } from "../agent/opencode-auth.js";
import { normalizeChatId } from "./chat-bindings.js";
import { prepareHandoff, type HandoffPrepareResult } from "../agent/handoff-tool-registration.js";
import { SkillsStore } from "../agent/skills-store.js";
import type { TerminalMirrorSession } from "../terminal/terminal-mirror.js";
import { WorkerStore } from "../agent/worker-store.js";
import type { RuntimeServices } from "../server.js";

export const BRIDGE_PROTOCOL = 1;
export const BRIDGE_APP = "chatgpt-system";
export const BRIDGE_VERSION = "0.1.0";

const MAX_ALIAS_CHARS = 128;
const MAX_TEXT_CHARS = 8_000;
const MAX_ITEMS = 50;
const MAX_LINE_CHARS = 500;
const MAX_SESSIONS = 8;
const MAX_TAIL_CHARS = 2_000;
const MAX_INBOX_SHOWN = 20;

export interface BridgeHello {
  app: string;
  protocol: number;
  version: string;
}

export interface BridgeProjectEntry {
  alias: string;
  recordVersion: number;
  updatedAt: string;
}

export interface BridgeStatus {
  app: string;
  protocol: number;
  version: string;
  projects: { count: number; activeAlias: string | null; aliases: BridgeProjectEntry[] };
  skills: { enabled: boolean; count: number };
  workers: { enabled: boolean; runs: number; activeWorkers: number; unread: number };
  terminal: { enabled: boolean; sessions: number; running: number };
  goal: { enabled: boolean; llm: boolean };
}

export interface BridgePlanStep {
  step: string;
  status: string;
  details?: string;
}

export interface BridgeContext {
  alias: string;
  recordVersion: number;
  status: string;
  goal: string;
  nextStep: string;
  brief: string | null;
  planSteps: BridgePlanStep[];
  activity: string[];
  decisionCount: number;
  uncertainties: string[];
  verificationSummary: string[];
  worktree: {
    canonicalPath: string;
    repositoryRoot: string;
    branch: string | null;
    headSha: string;
    staged: number;
    unstaged: number;
    untracked: number;
    pathsTruncated: boolean;
  };
  roots: string[];
  updatedAt: string;
}

export interface BridgeActivityItem {
  kind: "record" | "terminal" | "worker";
  label: string;
  text: string;
}

// Metinleri güvenli tavana çeker; asla istisna fırlatmaz.
export function clipBridgeText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  return single.slice(0, maxChars);
}

function clipLines(values: readonly unknown[], maxItems: number, maxChars: number): string[] {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .slice(0, maxItems)
    .map((value) => clipBridgeText(value, maxChars));
}

function aliasOf(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_ALIAS_CHARS);
}

export function bridgeHello(): BridgeHello {
  return { app: BRIDGE_APP, protocol: BRIDGE_PROTOCOL, version: BRIDGE_VERSION };
}

// Uzantı alias seçmediğinde sırayla: sohbet bağı (kullanıcı panelden o
// sohbete proje sabitlediyse), sohbette en son dokunulan proje (izleyici),
// sonra en güncel kayıt. Hiçbiri yoksa boş döner ve taşıma katmanı
// alias_required ile kapatır.
export async function resolveBridgeAlias(
  runtime: RuntimeServices,
  rawAlias: string,
  rawChatId: string,
): Promise<string> {
  const explicit = aliasOf(rawAlias);
  const projects = runtime.continuityStore.listProjects();
  if (explicit !== "") return explicit;
  const chatId = normalizeChatId(rawChatId);
  if (chatId !== "") {
    const bound = await runtime.chatBindings.read(chatId);
    if (bound !== null && projects.some((project) => project.alias === bound)) return bound;
  }
  const tracked = await runtime.activeProject.read();
  if (tracked !== null && projects.some((project) => project.alias === tracked)) return tracked;
  return projects[0]?.alias ?? "";
}

// Ayna okuması gözlemdir; erişilemez ya da bozuk dizin köprü isteğini
// düşürmez, terminal bölümü boş kalır.
async function safeMirrorSessions(runtime: RuntimeServices): Promise<TerminalMirrorSession[]> {
  try {
    return await runtime.terminalMirror.list();
  } catch {
    return [];
  }
}

// Hiç kayıt yokken bile yetenek bayrağı yapılandırmadan okunur; ayna
// dosyaları MCP sürecinin terminal oturumlarını taşır.
async function terminalSummary(runtime: RuntimeServices): Promise<{ enabled: boolean; sessions: number; running: number }> {
  const sessions = await safeMirrorSessions(runtime);
  let running = 0;
  for (const session of sessions) {
    if (session.state === "running") running += 1;
  }
  return {
    enabled: runtime.config.ownerRuntime.enabled === true || sessions.length > 0,
    sessions: sessions.length,
    running,
  };
}

export async function readBridgeStatus(runtime: RuntimeServices): Promise<BridgeStatus> {
  const projects = runtime.continuityStore.listProjects();
  let skillCount = 0;
  if (runtime.config.skills.enabled) {
    try {
      skillCount = (await (await SkillsStore.open(runtime.config.skills.directory, runtime.audit)).list()).length;
    } catch {
      skillCount = 0;
    }
  }
  return {
    app: BRIDGE_APP,
    protocol: BRIDGE_PROTOCOL,
    version: BRIDGE_VERSION,
    projects: {
      count: projects.length,
      activeAlias: await runtime.activeProject.read(),
      aliases: projects.map((project) => ({
        alias: project.alias,
        recordVersion: project.recordVersion,
        updatedAt: project.updatedAt,
      })),
    },
    skills: { enabled: runtime.config.skills.enabled, count: skillCount },
    workers: { enabled: runtime.config.workers.enabled, runs: 0, activeWorkers: 0, unread: 0 },
    terminal: await terminalSummary(runtime),
    goal: { enabled: runtime.config.goal.enabled, llm: runtime.config.goal.llm !== undefined },
  };
}

async function workerSummary(
  runtime: RuntimeServices,
  alias: string,
): Promise<{ runs: number; activeWorkers: number; unread: number }> {
  if (!runtime.config.workers.enabled) return { runs: 0, activeWorkers: 0, unread: 0 };
  try {
    const store = await WorkerStore.open(
      runtime.taskStateRoot,
      runtime.audit,
      runtime.config.workers.maxWorkers,
      runtime.config.workers.maxParkedRuns,
    );
    const runs = await store.listForPrime(alias);
    let activeWorkers = 0;
    let unread = 0;
    for (const run of runs) {
      if (!run.parked) {
        for (const worker of run.workers) {
          if (worker.state === "active") activeWorkers += 1;
          unread += worker.inbox.filter((message) => message.readAt === null).length;
        }
      }
    }
    return { runs: runs.length, activeWorkers, unread };
  } catch {
    return { runs: 0, activeWorkers: 0, unread: 0 };
  }
}

export async function readBridgeContext(runtime: RuntimeServices, rawAlias: string): Promise<BridgeContext> {
  const alias = await resolveBridgeAlias(runtime, rawAlias, "");
  const stored = runtime.continuityStore.getByAlias(alias);
  const task = stored.currentRecord.task;
  return {
    alias: stored.alias,
    recordVersion: stored.currentRecord.recordVersion,
    status: task.status,
    goal: clipBridgeText(task.goal, MAX_TEXT_CHARS),
    nextStep: clipBridgeText(task.nextStep, MAX_TEXT_CHARS),
    brief: task.brief === undefined ? null : clipBridgeText(task.brief, MAX_TEXT_CHARS),
    planSteps: (task.planSteps ?? []).slice(0, MAX_ITEMS).map((step) => ({
      step: clipBridgeText(step.step, MAX_LINE_CHARS),
      status: clipBridgeText(step.status, 64),
      ...(step.details !== undefined ? { details: clipBridgeText(step.details, MAX_LINE_CHARS) } : {}),
    })),
    activity: clipLines(task.activity ?? [], MAX_ITEMS, MAX_LINE_CHARS),
    decisionCount: stored.currentRecord.decisions.length,
    uncertainties: clipLines(stored.currentRecord.uncertainties, MAX_ITEMS, MAX_LINE_CHARS),
    verificationSummary: clipLines(stored.currentRecord.verificationSummary, MAX_ITEMS, MAX_LINE_CHARS),
    worktree: {
      canonicalPath: stored.worktree.canonicalPath,
      repositoryRoot: stored.worktree.repositoryRoot,
      branch: stored.localState.branch,
      headSha: stored.localState.headSha,
      staged: stored.localState.stagedPaths.length,
      unstaged: stored.localState.unstagedPaths.length,
      untracked: stored.localState.untrackedPaths.length,
      pathsTruncated: stored.localState.pathsTruncated,
    },
    roots: [...stored.roots],
    updatedAt: stored.updatedAt,
  };
}

export async function readBridgeActivity(
  runtime: RuntimeServices,
  rawAlias: string,
  rawLimit: number,
): Promise<{ alias: string; items: BridgeActivityItem[] }> {
  const alias = await resolveBridgeAlias(runtime, rawAlias, "");
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_ITEMS) : MAX_ITEMS;
  const stored = runtime.continuityStore.getByAlias(alias);
  const items: BridgeActivityItem[] = [];
  for (const line of (stored.currentRecord.task.activity ?? []).slice(-limit)) {
    items.push({ kind: "record", label: "checkpoint", text: clipBridgeText(line, MAX_LINE_CHARS) });
  }
  // Terminal çıktısı ayrı süreçte üretilir; canlı yerine sınırlı disk
  // aynasından okunur ki MCP süreciyle köprü süreci ayrı olsa da aksın.
  const mirrored = await safeMirrorSessions(runtime);
  for (const session of mirrored.slice(0, MAX_SESSIONS)) {
    if (session.tail === "") continue;
    items.push({
      kind: "terminal",
      label: `terminal ${session.sessionId.slice(0, 8)} ${session.state}`,
      text: clipBridgeText(session.tail, MAX_TAIL_CHARS),
    });
  }
  if (runtime.config.workers.enabled) {
    try {
      const store = await WorkerStore.open(
        runtime.taskStateRoot,
        runtime.audit,
        runtime.config.workers.maxWorkers,
        runtime.config.workers.maxParkedRuns,
      );
      for (const run of await store.listForPrime(alias)) {
        for (const worker of run.workers) {
          for (const message of worker.inbox.filter((entry) => entry.readAt === null).slice(-MAX_INBOX_SHOWN)) {
            items.push({
              kind: "worker",
              label: `worker ${worker.label} ${message.from}`,
              text: clipBridgeText(message.text, MAX_LINE_CHARS),
            });
          }
        }
      }
    } catch {
      // Kuyruk okunamazsa kayıt ve terminal öğeleri yeterlidir.
    }
  }
  return { alias: stored.alias, items: items.slice(0, limit + MAX_SESSIONS) };
}

// Kayıtlı brif varsa aynen taşınır; yoksa goal/Activity/plan malzemesinden
// OpenCode Go ile taslak yazdırılır. LLM yoksa prepareHandoff fail-closed döner.
export async function prepareBridgeHandoff(
  runtime: RuntimeServices,
  rawAlias: string,
  sessionId?: string,
): Promise<HandoffPrepareResult> {
  const alias = await resolveBridgeAlias(runtime, rawAlias, "");
  const stored = runtime.continuityStore.getByAlias(alias);
  const task = stored.currentRecord.task;
  return prepareHandoff(
    {
      config: { goal: runtime.config.goal },
      goalLlmFetch: fetch,
      opencodeAuthPath: defaultOpencodeAuthPath(),
    },
    {
      summary: task.brief ?? "",
      planSteps: (task.planSteps ?? []).map((step) => ({
        step: step.step,
        status: step.status,
        ...(step.details !== undefined ? { details: step.details } : {}),
      })),
      continuationToken: "",
      goal: task.goal,
      activity: [...(task.activity ?? [])],
      decisions: stored.currentRecord.decisions.map((decision) => decision.decision),
      nextStep: task.nextStep,
      ...(sessionId !== undefined && sessionId !== "" ? { sessionId: sessionId.slice(0, 128) } : {}),
    },
  );
}

export async function readBridgeStatusForAlias(
  runtime: RuntimeServices,
  rawAlias: string,
  rawChatId: string,
): Promise<BridgeStatus> {
  const base = await readBridgeStatus(runtime);
  // Sohbet bağı burada da geçerlidir: sayaçlar panelle aynı projeyi göstersin.
  const alias = await resolveBridgeAlias(runtime, rawAlias, rawChatId);
  if (alias === "") return base;
  const workers = await workerSummary(runtime, alias);
  return { ...base, workers: { enabled: runtime.config.workers.enabled, ...workers } };
}
