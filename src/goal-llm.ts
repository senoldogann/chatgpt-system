import { z } from "zod";
import type { GoalLlmConfig } from "./config.js";
import type { GoalAdvice, GoalPlanStep } from "./goal-service.js";

// OpenCode Go üzerinden OpenAI-uyumlu /chat/completions konuşan ince istemci.
// Anahtar parametre olarak alınır, dosyada tutulmaz, loglanmaz; hata
// mesajlarına ve warn alanlarına asla konmaz.

// Go gateway tarafında prompt cache çalışması için her sohbete stabil
// oturum kimliği gönderilir; yoksa gateway her isteği soğuk karşılar.
export const OPENCODE_GO_CHAT_COMPLETIONS_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export const GOAL_LLM_DEFAULT_MODEL = "glm-5.3-flash";
export const GOAL_LLM_TIMEOUT_MS = 60_000;
export const GOAL_LLM_MAX_ATTEMPTS = 3;
export const GOAL_LLM_RETRY_BASE_DELAY_MS = 500;
export const GOAL_LLM_MAX_OUTPUT_TOKENS = 512;

// Maliyet tavanı: LLM'e giden transkript ayrıca kırpılır; tool çağrısındaki
// maxTranscriptChars üst sınır, bu alt sınırdır.
export const GOAL_LLM_MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_RETAINED_BODY_CHARS = 512;

const goalLlmJsonSchema = z.object({
  action: z.enum(["stop", "continue"]),
  reply: z.string().max(4_096),
});

export interface GoalLlmRequest {
  readonly apiKey: string;
  readonly sessionId: string;
  readonly objective: string;
  readonly transcriptTail: string;
  readonly planSteps: readonly GoalPlanStep[];
  readonly successCriteria: readonly string[];
  readonly nextStep: string | null;
}

export type FetchImpl = typeof fetch;

export class GoalLlmApiError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: string;
  readonly retryable: boolean;

  constructor(message: string, statusCode: number | null, responseBody: string, retryable: boolean) {
    super(message);
    this.name = "GoalLlmApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody.slice(0, MAX_RETAINED_BODY_CHARS);
    this.retryable = retryable;
  }
}

export class GoalLlmResponseError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "GoalLlmResponseError";
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
// transkript ve hedef cümlesi asla loglanmaz.
function warnRetry(fields: {
  attempt: number;
  maxAttempts: number;
  statusCode: number | null;
  reason: string;
}): void {
  console.error(JSON.stringify({ level: "warn", event: "goal_llm.request_retry", ...fields }));
}

function buildSystemPrompt(): string {
  return [
    "Sen bir iş tamamlama hakemisin. Verilen hedef, plan adımları, başarı kriterleri ve",
    "transkript kuyruğuna bakarak bütün işin bitip bitmediğine karar ver.",
    "Kurallar:",
    "- Tüm plan adımları bitmiş ve tüm kriterler transkriptte kanıtlanmışsa action=stop, reply boş string.",
    "- Aksi halde action=continue ve reply içinde en büyük tutarlı kalan iş bloğunu tek talimat olarak yaz.",
    "- Küçük düzeltmeleri ayrı tur yapma, işin içine göm.",
    "- Yalnızca JSON döndür, başka hiçbir şey yazma.",
  ].join("\n");
}

function buildUserPrompt(request: GoalLlmRequest, transcript: string): string {
  const steps = request.planSteps
    .map((step) => `- [${step.status}] ${step.step}${step.details === undefined ? "" : `\n  ${step.details}`}`)
    .join("\n");
  const criteria = request.successCriteria.map((criterion) => `- ${criterion}`).join("\n");
  return [
    `Hedef: ${request.objective === "" ? "(belirtilmemiş)" : request.objective}`,
    "",
    "Plan adımları:",
    steps === "" ? "(yok)" : steps,
    "",
    "Başarı kriterleri:",
    criteria === "" ? "(yok)" : criteria,
    request.nextStep === null ? "" : `\nSıradaki adım notu: ${request.nextStep}\n`,
    "Transkript kuyruğu:",
    transcript === "" ? "(boş)" : transcript,
  ].join("\n");
}

async function sendOnce(
  config: GoalLlmConfig,
  request: GoalLlmRequest,
  transcript: string,
  fetchImpl: FetchImpl,
): Promise<GoalAdvice> {
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
        max_tokens: GOAL_LLM_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(request, transcript) },
        ],
      }),
    });
  } catch (error) {
    throw new GoalLlmApiError("Goal LLM isteği gönderilemedi.", null, String(error), true);
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
    throw new GoalLlmApiError("Goal LLM isteği reddedildi.", response.status, body, isRetryableStatus(response.status));
  }
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new GoalLlmResponseError("Goal LLM yanıtı JSON değil.", "non_json_body");
  }
  const content = extractContent(payload);
  let decision: unknown;
  try {
    decision = JSON.parse(content) as unknown;
  } catch {
    throw new GoalLlmResponseError("Goal LLM kararı JSON parse edilemedi.", "non_json_decision");
  }
  const parsed = goalLlmJsonSchema.safeParse(decision);
  if (!parsed.success) {
    throw new GoalLlmResponseError("Goal LLM kararı beklenen şemada değil.", "schema_mismatch");
  }
  return {
    action: parsed.data.action,
    reply: parsed.data.reply,
    reason: `LLM kararı (${config.model}).`,
  };
}

function extractContent(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    throw new GoalLlmResponseError("Goal LLM yanıt gövdesi nesne değil.", "non_object_body");
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new GoalLlmResponseError("Goal LLM yanıtında choice yok.", "empty_choices");
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (message === null || typeof message !== "object") {
    throw new GoalLlmResponseError("Goal LLM choice içinde message yok.", "missing_message");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new GoalLlmResponseError("Goal LLM message içeriği boş.", "empty_content");
  }
  return content;
}

// Dış çağrılar: uyarılı retry, sonunda son hata yükseltilir.
export async function adviseWithLlm(
  config: GoalLlmConfig,
  request: GoalLlmRequest,
  fetchImpl: FetchImpl,
): Promise<GoalAdvice> {
  const transcript =
    request.transcriptTail.length > GOAL_LLM_MAX_TRANSCRIPT_CHARS
      ? request.transcriptTail.slice(request.transcriptTail.length - GOAL_LLM_MAX_TRANSCRIPT_CHARS)
      : request.transcriptTail;
  let lastError: GoalLlmApiError | null = null;
  for (let attempt = 1; attempt <= GOAL_LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await sendOnce(config, request, transcript, fetchImpl);
    } catch (error) {
      if (error instanceof GoalLlmResponseError) throw error;
      if (!(error instanceof GoalLlmApiError)) throw error;
      if (!error.retryable) throw error;
      lastError = error;
      if (attempt < GOAL_LLM_MAX_ATTEMPTS) {
        warnRetry({
          attempt,
          maxAttempts: GOAL_LLM_MAX_ATTEMPTS,
          statusCode: error.statusCode,
          reason: error.message,
        });
        await sleep(GOAL_LLM_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastError ?? new GoalLlmApiError("Goal LLM denemeleri tükendi.", null, "", false);
}
