import type { AppConfig } from "./config.js";

// Araç kataloğu yayın politikası: kapalı bir yeteneğin araçları ChatGPT'ye hiç
// listelenmez. "dev" profili ayrıca masaüstü/tarayıcı/tam-host kabuk araçlarını
// gizler; yalnızca proje geliştirme yüzeyi kalır. Çalışma anı kapıları aynen
// korunur; bu katman yalnızca neyin yayınlandığını daraltır.

export const TOOL_PROFILES = ["full", "dev"] as const;
export type ToolProfile = (typeof TOOL_PROFILES)[number];

type Capability = "browser" | "computer" | "computerJs" | "ownerRuntime" | "terminal" | "projectExec";

const DEV_HIDDEN: ReadonlySet<Capability> = new Set(["browser", "computer", "computerJs", "ownerRuntime"]);

export type ToolExposureConfig = Pick<AppConfig, "terminal" | "projectExec"> & {
  toolProfile?: ToolProfile;
  browser?: { enabled: boolean };
  computerUse?: { enabled: boolean; fullHostJsEnabled?: boolean };
  ownerRuntime?: { enabled: boolean };
};

function capabilityOf(toolName: string): Capability | null {
  if (toolName.startsWith("browser_")) return "browser";
  if (toolName === "computer_run_js") return "computerJs";
  if (toolName.startsWith("computer_")) return "computer";
  if (toolName === "shell_run" || toolName.startsWith("terminal_session_")) return "ownerRuntime";
  if (toolName === "terminal_run" || toolName.startsWith("process_")) return "terminal";
  if (toolName === "project_exec") return "projectExec";
  return null;
}

function capabilityEnabled(capability: Capability, config: ToolExposureConfig): boolean {
  switch (capability) {
    case "browser": return config.browser?.enabled === true;
    case "computer": return config.computerUse?.enabled === true;
    case "computerJs": return config.computerUse?.enabled === true && config.computerUse.fullHostJsEnabled === true;
    case "ownerRuntime": return config.ownerRuntime?.enabled === true;
    case "terminal": return config.terminal.enabled;
    case "projectExec": return config.projectExec.enabled;
  }
}

export function isToolExposed(toolName: string, config: ToolExposureConfig): boolean {
  const capability = capabilityOf(toolName);
  if (capability === null) return true;
  if ((config.toolProfile ?? "full") === "dev" && DEV_HIDDEN.has(capability)) return false;
  return capabilityEnabled(capability, config);
}

interface ToolRegisteringServer {
  registerTool: (...args: Array<never>) => unknown;
}

// Yayınlanmayan araçlar kayda hiç ulaşmaz; trackToolSurface'ten sonra
// uygulanmalıdır ki katalog kaydı yalnızca yayınlanan araçları içersin.
export function applyToolExposure(server: ToolRegisteringServer, config: ToolExposureConfig): void {
  const original = server.registerTool.bind(server);
  server.registerTool = (...args: Array<never>): unknown => {
    const toolName = args[0] as unknown;
    if (typeof toolName === "string" && !isToolExposed(toolName, config)) return undefined;
    return (original as (...callArgs: Array<never>) => unknown)(...args);
  };
}
