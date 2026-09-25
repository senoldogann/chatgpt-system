import path from "node:path";
import { AuditLogger } from "../core/audit.js";

// Araç çağrısı başına içerik taşımayan performans kaydı: yalnızca araç adı,
// süre, sonuç ve yanıt boyutu. Argümanlar, dosya içerikleri ve hata mesajları
// yazılmaz. Audit kaydından ayrıdır; `npm run stats` bu dosyayı özetler.

export const TOOL_METRICS_FILENAME = "tool-metrics.jsonl";
export const TOOL_METRICS_MAX_FILE_BYTES = 4 * 1024 * 1024;

export function toolMetricsPath(auditFile: string): string {
  return path.join(path.dirname(auditFile), TOOL_METRICS_FILENAME);
}

export function createToolMetricsLogger(auditFile: string): AuditLogger {
  return new AuditLogger(toolMetricsPath(auditFile), { maxFileBytes: TOOL_METRICS_MAX_FILE_BYTES });
}

interface ToolRegisteringServer {
  registerTool: (...args: Array<never>) => unknown;
}

function resultBytes(result: unknown): number {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, item) => total + (typeof item.text === "string" ? Buffer.byteLength(item.text, "utf8") : 0), 0);
}

export function applyToolMetrics(server: ToolRegisteringServer, logger: AuditLogger): void {
  const original = server.registerTool.bind(server);
  server.registerTool = (...args: Array<never>): unknown => {
    const toolName = args[0] as unknown;
    const handler = args[2] as unknown;
    if (typeof toolName !== "string" || typeof handler !== "function") return original(...args);
    const measured = async (...handlerArgs: unknown[]) => {
      const started = performance.now();
      // Audit ile aynı sözleşme: kayıt yanıt dönmeden tamamlanır (tek küçük
      // append), böylece çağrı bittikten sonra diske geç yazma olmaz. Yazma
      // hatası aracı etkilemez.
      const record = async (outcome: "ok" | "error", bytes: number) => {
        await logger.record({
          action: "mcp.tool",
          target: toolName,
          outcome,
          durationMs: performance.now() - started,
          metadata: { resultBytes: bytes },
        }).catch(() => undefined);
      };
      let result: unknown;
      try {
        result = await (handler as (...callArgs: unknown[]) => unknown)(...handlerArgs);
      } catch (error) {
        await record("error", 0);
        throw error;
      }
      await record((result as { isError?: unknown } | undefined)?.isError === true ? "error" : "ok", resultBytes(result));
      return result;
    };
    const rewritten = [...args] as unknown[];
    rewritten[2] = measured;
    return original(...(rewritten as Array<never>));
  };
}
