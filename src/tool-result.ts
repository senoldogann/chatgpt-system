import { errorPayload } from "./errors.js";

// MCP araç sonuçları için ortak biçim: metin içerik her zaman JSON, başarılı
// yanıtlar aynı değeri structuredContent olarak da taşır. Hata yükünün biçimi
// araç ailesine göre değişebildiği için dışarıdan verilir.

export type ErrorPayloadFn = (error: unknown) => Record<string, unknown>;

export function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function successResult<T extends object>(value: T) {
  return {
    ...textResult(value),
    structuredContent: value as Record<string, unknown>,
  };
}

export function createSafeCall(toPayload: ErrorPayloadFn) {
  return async function safeCall<T extends object>(fn: () => Promise<T>) {
    try {
      return successResult(await fn());
    } catch (error) {
      return { ...textResult(toPayload(error)), isError: true };
    }
  };
}

export const safeCall = createSafeCall(errorPayload);
