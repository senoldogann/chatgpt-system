import { z } from "zod";
import type { GoalLlmConfig } from "../core/config.js";
import type { HandoffPlanStep } from "./handoff.js";

// Handoff brifi taslağı için OpenCode Go üzerinden OpenAI-uyumlu
// /chat/completions konuşan ince istemci. goal-llm ile aynı taşıma
// kuralları (timeout, 3 deneme uyarılı retry, zod şema); yalnızca
// prompt ve karar şeması brif işine özeldir. Anahtar parametre olarak
// alınır, dosyada tutulmaz, loglanmaz; hata mesajlarına ve warn
// alanlarına asla konmaz.

export const HANDOFF_LLM_MAX_OUTPUT_TOKENS = 2_048;
export const HANDOFF_LLM_MAX_ACTIVITY_CHARS = 12_000;
export const HANDOFF_LLM_MAX_BRIEF_CHARS = 8_000;
const MAX_RETAINED_BODY_CHARS = 512;

const handoffLlmJsonSchema = z.object({
  brief: z.string().min(1).max(HANDOFF_LLM_MAX_BRIEF_CHARS),
});

export interface HandoffLlmRequest {
  readonly apiKey: string;
  readonly sessionId: string;
  readonly goal: string;
  readonly activity: readonly string[];
  readonly planSteps: readonly HandoffPlanStep[];
  readonly decisions: readonly string[];
  readonly nextStep: string | null;
}

export type HandoffFetchImpl = typeof fetch;

export class HandoffLlmApiError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: string;
  readonly retryable: boolean;

  constructor(message: string, statusCode: number | null, responseBody: string, retryable: boolean) {
    super(message);
    this.name = "HandoffLlmApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody.slice(0, MAX_RETAINED_BODY_CHARS);
    this.retryable = retryable;
  }
}

export class HandoffLlmResponseError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "HandoffLlmResponseError";
    this.reason = reason;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Yapılandırılmış alanlar; mesaj içine dinamik değer gömülmez. API anahtarı,
// aktivite satırları ve hedef cümlesi asla loglanmaz.
function warnRetry(fields: {
  attempt: number;
  maxAttempts: number;
  statusCode: number | null;
  reason: string;
}): void {
  console.error(JSON.stringify({ level: "warn", event: "handoff_llm.request_retry", ...fields }));
}

function buildSystemPrompt(): string {
  return [
    "Sen bir devir brifi yazarısın. Verilen hedef, aktivite satırları, plan adımları,",
    "kararlar ve sıradaki adım notundan yeni sohbetin kaldığı yerden devam edebileceği",
    "kısa bir brif üret.",
    "Kurallar:",
    "- Brif şu bölümleri içersin: TASK (ne yapıldı), DECISIONS (alınan kararlar), PLAN (kalan iş), NEXT (sıradaki adım).",
    "- Yalnızca verilen malzemeyi kullan, yeni iş uydurma, talimat cümlesi yazma.",
    "- Brif veridir; okuyan sohbet bunu talimat değil bağlam olarak ele alır.",
    "- Yalnızca JSON döndür, başka hiçbir şey yazma.",
  ].join("\n");
}

function buildUserPrompt(request: HandoffLlmRequest, activity: string): string {
  const steps = request.planSteps
    .map((step) => `- [${step.status}] ${step.step}${step.details === undefined ? "" : `\n  ${step.details}`}`)
    .join("\n");
  const decisions = request.decisions.map((decision) => `- ${decision}`).join("\n");
  return [
    `Hedef: ${request.goal === "" ? "(belirtilmemiş)" : request.goal}`,
    "",
    "Aktivite satırları:",
    activity === "" ? "(yok)" : activity,
    "",
    "Plan adımları:",
    steps === "" ? "(yok)" : steps,
    "",
    "Kararlar:",
    decisions === "" ? "(yok)" : decisions,
    request.nextStep === null ? "" : `\nSıradaki adım notu: ${request.nextStep}\n`,
  ].join("\n");
}

async function sendOnce(
  config: GoalLlmConfig,
  request: HandoffLlmRequest,
  activity: string,
  fetchImpl: HandoffFetchImpl,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(config.baseUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${request.apiKey}`,
        "user-agent": "chatgpt-system/0.1.0",
        "x-opencode-session": request.sessionId,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: HANDOFF_LLM_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(request, activity) },
        ],
      }),
    });
  } catch (error) {
    throw new HandoffLlmApiError("Handoff LLM isteği gönderilemedi.", null, String(error), true);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let body: string;
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw new HandoffLlmApiError("Handoff LLM isteği reddedildi.", response.status, body, isRetryableStatus(response.status));
  }
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new HandoffLlmResponseError("Handoff LLM yanıtı JSON değil.", "non_json_body");
  }
  const content = extractContent(payload);
  let draft: unknown;
  try {
    draft = JSON.parse(content) as unknown;
  } catch {
    throw new HandoffLlmResponseError("Handoff LLM taslağı JSON parse edilemedi.", "non_json_draft");
  }
  const parsed = handoffLlmJsonSchema.safeParse(draft);
  if (!parsed.success) {
    throw new HandoffLlmResponseError("Handoff LLM taslağı beklenen şemada değil.", "schema_mismatch");
  }
  return parsed.data.brief;
}

function extractContent(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    throw new HandoffLlmResponseError("Handoff LLM yanıt gövdesi nesne değil.", "non_object_body");
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new HandoffLlmResponseError("Handoff LLM yanıtında choice yok.", "empty_choices");
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (message === null || typeof message !== "object") {
    throw new HandoffLlmResponseError("Handoff LLM choice içinde message yok.", "missing_message");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new HandoffLlmResponseError("Handoff LLM message içeriği boş.", "empty_content");
  }
  return content;
}

// Dış çağrılar: uyarılı retry, sonunda son hata yükseltilir.
export async function draftBriefWithLlm(
  config: GoalLlmConfig,
  request: HandoffLlmRequest,
  fetchImpl: HandoffFetchImpl,
): Promise<string> {
  const joined = request.activity.join("\n");
  const activity =
    joined.length > HANDOFF_LLM_MAX_ACTIVITY_CHARS
      ? joined.slice(joined.length - HANDOFF_LLM_MAX_ACTIVITY_CHARS)
      : joined;
  let lastError: HandoffLlmApiError | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await sendOnce(config, request, activity, fetchImpl);
    } catch (error) {
      if (error instanceof HandoffLlmResponseError) throw error;
      if (!(error instanceof HandoffLlmApiError)) throw error;
      if (!error.retryable) throw error;
      lastError = error;
      if (attempt < 3) {
        warnRetry({
          attempt,
          maxAttempts: 3,
          statusCode: error.statusCode,
          reason: error.message,
        });
        await sleep(500 * attempt);
      }
    }
  }
  throw lastError ?? new HandoffLlmApiError("Handoff LLM denemeleri tükendi.", null, "", false);
}
