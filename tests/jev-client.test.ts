import { describe, expect, it, vi, afterEach } from "vitest";
import { JevApiError, JevClient, JevResponseError, JEV_BASE_URL } from "../src/jev-client.js";
import type { JevSystemOneRequest } from "../src/jev-client.js";

const request: JevSystemOneRequest = {
  state: "Window: Fixture",
  model: "jev-latest",
  questions: {
    target: { type: "choice", instructions: "Which element?", criteria: { "0": "AXButton — \"Send\"", none: "No match." } },
  },
};

function client(): JevClient {
  return new JevClient({
    apiKey: "test-key",
    baseUrl: JEV_BASE_URL,
    timeoutMs: 5_000,
    maxAttempts: 3,
    retryBaseDelayMs: 1,
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const validAnswer = {
  model: "jev-latest",
  answers: { target: { type: "choice", choice: "0", confidence: 0.9, probabilities: { "0": 0.9 } } },
  usage: { input_tokens: 10, output_tokens: 2 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JevClient response validation", () => {
  it("rejects a response body that is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })));
    await expect(client().ask(request)).rejects.toBeInstanceOf(JevResponseError);
  });

  it("rejects an answer that omits confidence instead of skipping the threshold gate", async () => {
    const body = { ...validAnswer, answers: { target: { type: "choice", choice: "0", probabilities: {} } } };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body, 200)));
    await expect(client().ask(request)).rejects.toBeInstanceOf(JevResponseError);
  });

  it("rejects a confidence outside the 0..1 range", async () => {
    const body = { ...validAnswer, answers: { target: { type: "choice", choice: "0", confidence: 7, probabilities: {} } } };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body, 200)));
    await expect(client().ask(request)).rejects.toBeInstanceOf(JevResponseError);
  });

  it("accepts a valid response and tolerates unknown extra fields", async () => {
    const body = { ...validAnswer, unexpectedNewField: true };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body, 200)));
    const response = await client().ask(request);
    expect(response.answers.target?.confidence).toBe(0.9);
  });
});

describe("JevClient retry policy", () => {
  it("does not retry a non-retryable 401", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().ask(request)).rejects.toBeInstanceOf(JevApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable 400", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "bad request" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().ask(request)).rejects.toBeInstanceOf(JevApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 up to maxAttempts and then raises the last error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().ask(request)).rejects.toMatchObject({ statusCode: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 429 and succeeds on a later attempt", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? jsonResponse({ error: "slow down" }, 429) : jsonResponse(validAnswer, 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await client().ask(request);
    expect(response.answers.target?.choice).toBe("0");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a network failure and raises the last error when every attempt fails", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("network down"); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().ask(request)).rejects.toBeInstanceOf(JevApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("JevClient request bounds", () => {
  it("passes an abort signal so a hung endpoint cannot outlive the timeout", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(validAnswer, 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    await client().ask(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the API key anywhere except the Authorization header", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).not.toContain("test-key");
      expect(String(init?.body ?? "")).not.toContain("test-key");
      return jsonResponse(validAnswer, 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    await client().ask(request);
  });
});
