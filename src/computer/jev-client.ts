import { z } from "zod";

// Üçüncü taraf yanıtı asla doğrulanmadan kabul edilmez: eksik `confidence`
// alanı, `undefined < threshold` karşılaştırması false döndüğü için çözümleyicinin
// düşük-güven kapısını sessizce atlatırdı.
const jevChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
});

const jevUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

// Bilinmeyen üst-düzey alanlar tolere edilir (sağlayıcı alan ekleyebilir);
// kullandığımız alanlar zorunlu ve tiplidir.
const jevSystemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), jevChoiceAnswerSchema),
  usage: jevUsageSchema.optional(),
});

export interface JevChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface JevSystemOneRequest {
  readonly state: string;
  readonly model: string;
  readonly questions: Readonly<Record<string, JevChoiceQuestion>>;
}

export type JevChoiceAnswer = z.infer<typeof jevChoiceAnswerSchema>;
export type JevUsage = z.infer<typeof jevUsageSchema>;
export type JevSystemOneResponse = z.infer<typeof jevSystemOneResponseSchema>;

export const JEV_BASE_URL = "https://api.typesafe.ai";

/** Tek bir HTTP denemesinin üst sınırı. Toplam süre maxAttempts ile çarpılır. */
export const JEV_REQUEST_TIMEOUT_MS = 8_000;
export const JEV_RETRY_BASE_DELAY_MS = 200;

/** Hata gövdesi hata ayıklama için tutulur ama sınırlıdır; AX içeriği taşıyabilir. */
const MAX_RETAINED_BODY_CHARS = 512;

export class JevApiError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: string;
  readonly retryable: boolean;

  constructor(message: string, statusCode: number | null, responseBody: string, retryable: boolean) {
    super(message);
    this.name = "JevApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody.slice(0, MAX_RETAINED_BODY_CHARS);
    this.retryable = retryable;
  }
}

export class JevResponseError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "JevResponseError";
    this.reason = reason;
  }
}

export interface JevClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Yapılandırılmış alanlar; mesaj içine dinamik değer gömülmez. Gövde, talimat
// metni ve API anahtarı asla loglanmaz.
function warnRetry(fields: {
  attempt: number;
  maxAttempts: number;
  statusCode: number | null;
  reason: string;
}): void {
  console.error(JSON.stringify({ level: "warn", event: "jev.request_retry", ...fields }));
}

// TypeSafe AI'nin Jev ("System One") modeline bağlanan ince bir HTTP istemcisi.
// https://docs.typesafe.ai
export class JevClient {
  private readonly options: JevClientOptions;

  constructor(options: JevClientOptions) {
    this.options = options;
  }

  async ask(request: JevSystemOneRequest): Promise<JevSystemOneResponse> {
    let lastError: JevApiError | null = null;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await this.sendOnce(request);
      } catch (error) {
        // Yanıt gövdesi bozuksa yeniden denemek durumu düzeltmez; hemen yükselt.
        if (error instanceof JevResponseError) throw error;
        if (!(error instanceof JevApiError)) throw error;
        if (!error.retryable) throw error;

        lastError = error;
        if (attempt < this.options.maxAttempts) {
          warnRetry({
            attempt,
            maxAttempts: this.options.maxAttempts,
            statusCode: error.statusCode,
            reason: error.message,
          });
          await sleep(this.options.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    throw lastError ?? new JevApiError("Jev request failed for an unknown reason.", null, "", false);
  }

  private async sendOnce(request: JevSystemOneRequest): Promise<JevSystemOneResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      // Ağ arızası ve zaman aşımı geçici kabul edilir; 4xx gibi kalıcı değildir.
      const reason = error instanceof Error ? error.message : String(error);
      throw new JevApiError(`Jev request could not complete: ${reason}`, null, "", true);
    }

    const bodyText = await response.text();

    if (!response.ok) {
      throw new JevApiError(
        `Jev API returned ${response.status}.`,
        response.status,
        bodyText,
        isRetryableStatus(response.status),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new JevResponseError("Jev returned a body that is not valid JSON.", "invalid_json");
    }

    const result = jevSystemOneResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new JevResponseError(
        `Jev returned a response that does not match the expected schema: ${result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
          .join("; ")}`,
        "schema_mismatch",
      );
    }

    return result.data;
  }
}
