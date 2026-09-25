#!/usr/bin/env node
import { parseCliCommand } from "./cli-command.js";
import { loadConfig } from "./core/config.js";
import { closeRuntimeResources, type RuntimeShutdownPhase } from "./core/runtime-shutdown.js";
import { createRuntimeServices } from "./server.js";
import { startHttp, startStdio } from "./transport.js";

function printHelp(): void {
  console.log(`chatgpt-system - open local MCP bridge

Usage:
  chatgpt-system stdio [options]
  chatgpt-system http [options]

Serbest mod: yetki profili, lease onayı ve Admin kapısı yoktur. Tüm araçlar
doğrudan çalışır; project_* süreklilik araçları proje kimliği için
project_register/project_resume alias akışını kullanır.

Server options:
  --root <path>                    Allow a filesystem root (repeatable). Defaults to cwd.
  --audit-file <path>              JSONL audit log path.
  --tool-profile <full|dev>        Published tool catalog. full (default) lists every enabled capability;
                                   dev also hides browser_*, computer_*, shell_run and terminal_session_*.
                                   Tools of disabled capabilities are never listed.
  --enable-terminal                Enable terminal_run. Disabled by default.
  --enable-project-exec            Enable Docker-sandboxed Project execution. Disabled by default.
  --enable-owner-runtime           Enable unrestricted Owner Runtime shell capabilities. Disabled by default.
  --owner-shell-path <path>        Trusted login shell executable; requires --enable-owner-runtime. Default on macOS: /bin/zsh.
  --allow-command <name>           Terminal executable allowlist (repeatable).
  --enable-browser                 Enable the Playwright browser runtime. Disabled by default.
  --enable-computer-use            Enable the native Computer Runtime. Disabled by default.
  --enable-full-host-js            Enable full-host Node.js for Computer Runtime; requires --enable-computer-use. Disabled by default.
  --enable-jev-targeting           Enable Jev semantic target resolution; requires --enable-computer-use and TYPESAFE_API_KEY. Disabled by default.
  --browser-headless               Run the enabled browser headlessly. Headed is the default when browser is enabled.
  --browser-existing-chrome        Attach to the user's already-running Chrome session; requires --enable-browser.
  --browser-existing-chrome-user-data-dir <path>
                                   Override the Chrome user-data directory used for local debugging discovery.
  --browser-timeout-ms <ms>        Browser operation timeout in milliseconds. Default: 10000.
  --browser-user-data-dir <path>   Dedicated persistent browser profile. Default: ~/.chatgpt-system/browser-profile.
  --host <host>                    HTTP bind host. Default: 127.0.0.1.
  --allow-non-loopback-http        Acknowledge non-loopback HTTP behind an authenticated TLS reverse proxy.
  --port <number>                  HTTP port. Default: 4312.
  --token <secret>                 HTTP bearer token, minimum 16 characters.
  -h, --help                       Show this help.

Security:
  Filesystem tools are confined to bootstrap roots or the active Project lease roots and reject symlink escapes.
  Existing file writes/removals require the SHA-256 returned by fs_read/fs_stat.
  terminal_run uses shell=false with an executable allowlist; shell_run executes the trusted login shell as the current user and is NOT an OS sandbox.
  Project execution is a separate explicit opt-in Docker sandbox with network disabled and no host fallback.
  Browser automation is an explicit runtime opt-in with a semantic-only surface. Raw CSS/XPath/JavaScript selectors are not exposed.
  Computer Runtime is a separate explicit opt-in; health is categorical.
  Jev semantic targeting is a separate explicit opt-in, read-only (it never clicks), and fails closed without an API key.
  Browser input into password, OTP, and payment-credential-shaped fields is refused.
  Managed process tools expose opaque IDs only; callers cannot provide OS PIDs, signals, shell mode, or child environments.
`);
}

function installShutdown(close: () => Promise<void>): void {
  let closing = false;
  const handler = () => {
    if (closing) return;
    closing = true;
    void close()
      .catch((error) => {
        console.error(`[chatgpt-system] shutdown error: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}

function reportShutdownError(phase: RuntimeShutdownPhase, error: unknown): void {
  console.error(`[chatgpt-system] shutdown ${phase} error: ${error instanceof Error ? error.message : String(error)}`);
}

async function main(): Promise<void> {
  const command = parseCliCommand(process.argv.slice(2));

  if (command.help) {
    printHelp();
    return;
  }

  const overrides = command.overrides;
  if (overrides.token && overrides.token.length < 16) throw new Error("--token must be at least 16 characters.");
  if (overrides.port !== undefined && (!Number.isInteger(overrides.port) || overrides.port < 1 || overrides.port > 65535)) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }

  const config = await loadConfig(overrides);
  const runtime = createRuntimeServices(config);

  try {
    if (command.mode === "stdio") {
      const stdio = startStdio(runtime);
      installShutdown(() => closeRuntimeResources({
        runtime,
        closeTransport: () => stdio.close(),
        reportError: reportShutdownError,
      }));
      console.error(
        `[chatgpt-system] stdio ready; roots=${config.roots.join(",")}; tool-profile=${config.toolProfile ?? "full"}; terminal=${config.terminal.enabled ? "enabled" : "disabled"}; owner-runtime=${config.ownerRuntime.enabled ? "enabled" : "disabled"}; project-exec=${config.projectExec.enabled ? "enabled" : "disabled"}; browser=${config.browser.enabled ? (config.browser.headless ? "headless" : "headed") : "disabled"}; computer=${config.computerUse.enabled ? "enabled" : "disabled"}; jev-targeting=${config.jevTargeting.enabled ? "enabled" : "disabled"}`,
      );
      return;
    }

    const server = startHttp(runtime);
    server.once("listening", () => {
      console.error(`[chatgpt-system] HTTP MCP listening on http://${config.http.host}:${config.http.port}/mcp; owner-runtime=${config.ownerRuntime.enabled ? "enabled" : "disabled"}; project-exec=${config.projectExec.enabled ? "enabled" : "disabled"}; browser=${config.browser.enabled ? (config.browser.headless ? "headless" : "headed") : "disabled"}; computer=${config.computerUse.enabled ? "enabled" : "disabled"}; jev-targeting=${config.jevTargeting.enabled ? "enabled" : "disabled"}`);
    });
    installShutdown(() => closeRuntimeResources({
      runtime,
      closeTransport: () => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }),
      reportError: reportShutdownError,
    }));
  } catch (error) {
    await closeRuntimeResources({
      runtime,
      closeTransport: async () => {},
      reportError: reportShutdownError,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(`[chatgpt-system] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
