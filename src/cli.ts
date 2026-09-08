#!/usr/bin/env node
import { runAuthorizeCommand } from "./authorize-cli.js";
import { parseCliCommand } from "./cli-command.js";
import { loadConfig, resolveControlSocketPath } from "./config.js";
import { startControlServer, type ControlServerHandle } from "./control-server.js";
import { closeRuntimeResources, type RuntimeShutdownPhase } from "./runtime-shutdown.js";
import { createRuntimeServices } from "./server.js";
import { startHttp, startStdio } from "./transport.js";

function printHelp(): void {
  console.log(`chatgpt-system - secure local MCP bridge

Usage:
  chatgpt-system stdio [options]
  chatgpt-system http [options]
  chatgpt-system authorize user [--ttl <seconds>] [--print-lease]
  chatgpt-system authorize admin [--ttl <seconds>] [--print-lease]

Server options:
  --root <path>             Allow a filesystem root (repeatable). Defaults to cwd.
  --audit-file <path>       JSONL audit log path.
  --enable-terminal         Enable bootstrap terminal_run. Disabled by default.
  --personal-admin          Allow this MCP client to mint short-lived Admin leases directly. Disabled by default.
  --allow-command <name>    Terminal executable allowlist (repeatable).
  --enable-control          Start the private local authority Unix socket.
  --control-socket <path>   Override the private Unix socket path; requires --enable-control.
  --host <host>             HTTP bind host. Default: 127.0.0.1.
  --port <number>           HTTP port. Default: 4312.
  --token <secret>          HTTP bearer token, minimum 16 characters.
  -h, --help                Show this help.

Authorize options:
  --ttl <seconds>           Request a shorter User/Admin lease lifetime.
  --print-lease             Print the raw lease instead of copying it to the clipboard.

Security:
  Filesystem tools are confined to active authority lease roots and reject symlink escapes.
  Existing file writes/removals require the SHA-256 returned by fs_read/fs_stat.
  Project and User authority have no terminal capability. Admin alone can use the bounded terminal/process allowlist.
  Personal Admin is an explicit private-workstation opt-in and does not bypass the runtime terminal gate.
  Managed process tools expose opaque IDs only; callers cannot provide OS PIDs, signals, shell mode, or child environments.
  User/Admin authority is approved locally through the protected macOS broker; credentials and biometric material never enter MCP.
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

async function closeControl(control: ControlServerHandle | undefined): Promise<void> {
  if (control) await control.close();
}

async function main(): Promise<void> {
  const command = parseCliCommand(process.argv.slice(2));

  if (command.kind === "authorize") {
    const socketPath = resolveControlSocketPath(process.env.CHATGPT_SYSTEM_CONTROL_SOCKET);
    await runAuthorizeCommand(command.args, { socketPath });
    return;
  }

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
  let control: ControlServerHandle | undefined;

  try {
    if (config.control.enabled) {
      control = await startControlServer({
        socketPath: config.control.socketPath,
        runtime,
      });
    }

    if (command.mode === "stdio") {
      const stdio = startStdio(runtime);
      installShutdown(() => closeRuntimeResources({
        runtime,
        ...(control ? { control } : {}),
        closeTransport: () => stdio.close(),
        reportError: reportShutdownError,
      }));
      console.error(
        `[chatgpt-system] stdio ready; roots=${config.roots.join(",")}; terminal=${config.terminal.enabled ? "enabled" : "disabled"}; control=${config.control.enabled ? config.control.socketPath : "disabled"}`,
      );
      return;
    }

    const server = startHttp(runtime);
    server.once("listening", () => {
      console.error(`[chatgpt-system] HTTP MCP listening on http://${config.http.host}:${config.http.port}/mcp; control=${config.control.enabled ? config.control.socketPath : "disabled"}`);
    });
    installShutdown(() => closeRuntimeResources({
      runtime,
      ...(control ? { control } : {}),
      closeTransport: () => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }),
      reportError: reportShutdownError,
    }));
  } catch (error) {
    try {
      await runtime.processSupervisor.close();
    } catch {
      // Startup failure still continues local cleanup below.
    }
    await closeControl(control);
    throw error;
  }
}

main().catch((error) => {
  console.error(`[chatgpt-system] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
