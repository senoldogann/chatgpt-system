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

export interface JevChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface JevUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface JevSystemOneResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, JevChoiceAnswer>>;
  readonly usage: JevUsage;
}

export const JEV_BASE_URL = "https://api.typesafe.ai";

export class JevApiError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: string;

  constructor(message: string, statusCode: number | null, responseBody: string) {
    super(message);
    this.name = "JevApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// TypeSafe AI'nin Jev ("System One") modeline bağlanan ince bir HTTP istemcisi.
// https://docs.typesafe.ai
export class JevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async ask(request: JevSystemOneRequest, maxAttempts: number): Promise<JevSystemOneResponse> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.sendOnce(request);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Jev request failed for an unknown reason.");
  }

  private async sendOnce(request: JevSystemOneRequest): Promise<JevSystemOneResponse> {
    const response = await fetch(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new JevApiError(`Jev API returned ${response.status}.`, response.status, bodyText);
    }

    return JSON.parse(bodyText) as JevSystemOneResponse;
  }
}
