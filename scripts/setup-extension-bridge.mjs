#!/usr/bin/env node

// Uzantı köprüsü kurulumu: chatgpt-system http sunucusunu LaunchAgent olarak
// çalıştırır. Canlı kurulum stdio+tunnel ile konuşur; tarayıcı uzantısının
// soracağı /bridge/* uçları yalnızca bu HTTP sunucusunda vardır. Token bir
// kez üretilir, 0600 dosyada saklanır ve yalnızca eşleşme için gösterilir.

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const EXTENSION_BRIDGE_LABEL = "com.senoldogann.chatgpt-system.extension-bridge";
export const DEFAULT_BRIDGE_PORT = 4312;
const LAUNCHCTL = "/bin/launchctl";
const LAUNCH_AGENT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
export const TOKEN_FILENAME = "extension-bridge.token";

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requireAbsolute(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} mutlak yol olmalı.`);
  return path.normalize(value);
}

// Token keychain'e değil 0600 dosyaya yazılır: uzantı eşleşmesi için
// kullanıcının bir kez görüp popup'a yapıştırması gerekir.
export function generateBridgeToken(randomBytesImpl = randomBytes) {
  return randomBytesImpl(32).toString("base64url");
}

export function bridgePaths(homeDir) {
  return {
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${EXTENSION_BRIDGE_LABEL}.plist`),
    tokenPath: path.join(homeDir, ".chatgpt-system", TOKEN_FILENAME),
    logDir: path.join(homeDir, ".chatgpt-system", "extension-bridge"),
  };
}

export function parseExtensionBridgeArgs(argv) {
  const command = argv[0];
  if (!["install", "status", "verify", "uninstall"].includes(command)) {
    throw new Error(
      "Kullanim: setup-extension-bridge.mjs install --root <yol> [--port <n>] | verify [--port <n>] [--alias <alias>] | status [--port <n>] | uninstall",
    );
  }
  let root;
  let alias;
  let port = DEFAULT_BRIDGE_PORT;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      root = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--port") {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--alias") {
      if (command !== "verify") throw new Error("--alias yalnizca verify ile kullanilir.");
      alias = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Bilinmeyen arguman: ${argv[i]}`);
    }
  }
  if (command === "install" && !root) throw new Error("install icin --root zorunludur.");
  if (command !== "uninstall" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("--port 1-65535 araliginda olmali.");
  }
  return { command, ...(root ? { root } : {}), ...(alias ? { alias } : {}), port };
}

export function buildExtensionBridgePlist({ nodePath, cliPath, root, port }) {
  const executable = requireAbsolute(nodePath, "Node yolu");
  const cli = requireAbsolute(cliPath, "CLI yolu");
  const workRoot = requireAbsolute(root, "Kok dizin");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port 1-65535 araliginda olmali.");
  const args = [executable, cli, "http", "--root", workRoot, "--port", String(port)];
  const argumentXml = args.map((value) => `      <string>${xmlEscape(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${EXTENSION_BRIDGE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${LAUNCH_AGENT_PATH}</string>
      <key>CHATGPT_SYSTEM_HTTP_TOKEN</key>
      <string>__EXTENSION_BRIDGE_TOKEN__</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
  </dict>
</plist>
`;
}

export function statusSummary({ plistExists, agentLoaded, helloOk, version }) {
  if (!plistExists) return { state: "yok", detail: "Kopru ajani kurulu degil. install ile kur." };
  if (!agentLoaded) return { state: "durmus", detail: "Plist var ama ajan yuklu degil. install yeniden calistir." };
  if (!helloOk) return { state: "erisimsiz", detail: "Ajan yuklu ama /bridge/hello yanit vermiyor." };
  return { state: "calisiyor", detail: `Kopru ayakta${version ? ` (${version})` : ""}.` };
}

// Uzanti yolunu uctan uca dogrular: hello, token, uzanti Origin'li status ve
// (alias verilirse) handoff. Eski sunucunun Origin kapisi uzanti istegini
// JSON olmayan 403 ile reddeder; bu sonda tam o regresyonu yakalar.
export async function probeExtensionBridge({ port, token, alias, origin, fetchImpl = fetch }) {
  const checks = [];
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };
  const base = `http://127.0.0.1:${port}`;
  const authHeaders = { origin, authorization: `Bearer ${token}` };
  try {
    const response = await fetchImpl(`${base}/bridge/hello`, { signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => null);
    const ok = response.status === 200 && data !== null && data.app === "chatgpt-system";
    add("hello", ok, ok ? `sunucu ${typeof data.version === "string" ? data.version : "?"}` : `HTTP ${response.status}`);
  } catch (error) {
    add("hello", false, error instanceof Error ? error.message : "erisilemedi");
  }
  if (token === "") {
    add("token", false, "token dosyasi yok — once install calistir");
  } else {
    const query = alias ? `?alias=${encodeURIComponent(alias)}` : "";
    try {
      const response = await fetchImpl(`${base}/bridge/status${query}`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.text().catch(() => "");
      if (response.status === 403) add("status", false, "HTTP 403 — eski sunucu Origin kapisi; yeniden kur");
      else if (response.status === 401) add("status", false, "HTTP 401 — token eslesmiyor");
      else add("status", response.status === 200, `HTTP ${response.status}${body === "" ? "" : ` — ${body.slice(0, 80)}`}`);
    } catch (error) {
      add("status", false, error instanceof Error ? error.message : "erisilemedi");
    }
    if (alias) {
      try {
        const response = await fetchImpl(`${base}/bridge/handoff/prepare`, {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify({ alias }),
          signal: AbortSignal.timeout(30000),
        });
        const body = await response.text().catch(() => "");
        if (response.status === 200) add("handoff", true, `brif yolu acik (${body.length} bayt yanit)`);
        else if (response.status === 422) add("handoff", true, "yol calisiyor; kayitli brif yok, checkpoint gerekli");
        else add("handoff", false, `HTTP ${response.status} — ${body.slice(0, 80)}`);
      } catch (error) {
        add("handoff", false, error instanceof Error ? error.message : "erisilemedi");
      }
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

function runCommand(command, args) {
  return spawnSync(command, args, { shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function writeFileAtomic(target, content, mode) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, target);
}

async function ensureToken(tokenPath) {
  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();
    if (existing.length >= 16) return { token: existing, created: false };
  } catch {
    // Yoksa üretilir.
  }
  const token = generateBridgeToken();
  await writeFileAtomic(tokenPath, `${token}\n`, 0o600);
  await chmod(tokenPath, 0o600);
  return { token, created: true };
}

async function probeHello(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/bridge/hello`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false };
    const data = await response.json().catch(() => null);
    if (!data || data.app !== "chatgpt-system") return { ok: false };
    return { ok: true, version: typeof data.version === "string" ? data.version : null };
  } catch {
    return { ok: false };
  }
}

async function install(root, port, context) {
  if (process.platform !== "darwin") throw new Error("Kopru ajani yalnizca macOS destekler.");
  const cliPath = path.join(context.repoDir, "dist", "cli.js");
  await access(cliPath, fsConstants.R_OK).catch(() => {
    throw new Error("dist/cli.js bulunamadi. Once npm run build calistir.");
  });
  const { plistPath, tokenPath, logDir } = bridgePaths(context.homeDir);
  const { token } = await ensureToken(tokenPath);
  const plist = buildExtensionBridgePlist({
    nodePath: process.execPath,
    cliPath,
    root: path.resolve(root),
    port,
  }).replace("__EXTENSION_BRIDGE_TOKEN__", xmlEscape(token));
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(plistPath, plist, 0o600);
  runCommand(LAUNCHCTL, ["bootout", `gui/${context.uid}/${EXTENSION_BRIDGE_LABEL}`]);
  // bootout teardown'i asenkron tamamlar; hemen bootstrap etmek
  // yarisir ve "Ajan yuklenemedi" verir. Bu yuzden kisa araliklarla
  // yeniden denenir.
  let loaded = { error: undefined, status: null, stderr: "" };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    loaded = runCommand(LAUNCHCTL, ["bootstrap", `gui/${context.uid}`, plistPath]);
    if (!loaded.error && loaded.status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (loaded.error || loaded.status !== 0) {
    const detail = typeof loaded.stderr === "string" && loaded.stderr.trim() !== "" ? loaded.stderr.trim() : "launchctl bootstrap basarisiz";
    throw new Error(`Ajan yuklenemedi: ${detail}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const hello = await probeHello(port);
  console.log(`Uzanti koprusu kuruldu: ${EXTENSION_BRIDGE_LABEL}`);
  console.log(`Hello: ${hello.ok ? `ulasiliyor${hello.version ? ` (${hello.version})` : ""}` : "henuz yanit yok, birkac saniye bekle"}`);
  console.log("Uzanti popup Eşleşme bölümüne gir:");
  console.log(`  Port: ${port}`);
  console.log(`  Token: ${token}`);
  console.log("  Uyari: bu token koprudeki /mcp ucu icin de gecerlidir (tam MCP erisimi); parola gibi sakla.");
  console.log("  Alias: project_list ile seçtiğin kayıt");
}

async function status(port, context) {
  const { plistPath } = bridgePaths(context.homeDir);
  let plistExists = true;
  try {
    await access(plistPath, fsConstants.R_OK);
  } catch {
    plistExists = false;
  }
  const printed = runCommand(LAUNCHCTL, ["print", `gui/${context.uid}/${EXTENSION_BRIDGE_LABEL}`]);
  const agentLoaded = !printed.error && printed.status === 0;
  const hello = agentLoaded ? await probeHello(port) : { ok: false };
  const summary = statusSummary({ plistExists, agentLoaded, helloOk: hello.ok, version: hello.version ?? undefined });
  console.log(`Durum: ${summary.state} — ${summary.detail}`);
}

async function verify(port, alias, context) {
  const { plistPath, tokenPath } = bridgePaths(context.homeDir);
  let plistExists = true;
  try {
    await access(plistPath, fsConstants.R_OK);
  } catch {
    plistExists = false;
  }
  const printed = runCommand(LAUNCHCTL, ["print", `gui/${context.uid}/${EXTENSION_BRIDGE_LABEL}`]);
  const agentLoaded = !printed.error && printed.status === 0;
  let token = "";
  try {
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch {
    // Yoksa sonda token adiminda FAIL olarak gorunur.
  }
  console.log(`Ajan: ${plistExists ? (agentLoaded ? "yuklu ve calisiyor" : "plist var ama yuklu degil") : "kurulu degil"}`);
  const probe = await probeExtensionBridge({
    port,
    token,
    alias: alias ?? "",
    origin: "chrome-extension://extension-bridge-verify",
  });
  for (const check of probe.checks) {
    console.log(`${check.ok ? "[OK]" : "[FAIL]"} ${check.name}: ${check.detail}`);
  }
  const passed = agentLoaded && probe.ok;
  console.log(passed
    ? "SONUC: gecti — uzanti kopru yolu saglikli."
    : "SONUC: kaldi — yukaridaki [FAIL] satirlarini duzelt, sonra tekrar calistir.");
  if (!passed) process.exitCode = 1;
}

async function uninstall(context) {
  const { plistPath } = bridgePaths(context.homeDir);
  runCommand(LAUNCHCTL, ["bootout", `gui/${context.uid}/${EXTENSION_BRIDGE_LABEL}`]);
  try {
    await unlink(plistPath);
  } catch {
    // Zaten yoksa sorun değil.
  }
  console.log("Uzanti koprusu kaldirildi. Token dosyasi durur, tekrar install ile kullanilir.");
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) {
  const homeDir = homedir();
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;
  const repoDir = path.resolve(path.dirname(scriptPath), "..");
  try {
    const args = parseExtensionBridgeArgs(process.argv.slice(2));
    if (args.command === "install") await install(args.root, args.port, { homeDir, uid, repoDir });
    else if (args.command === "verify") await verify(args.port, args.alias, { homeDir, uid });
    else if (args.command === "status") await status(args.port, { homeDir, uid });
    else await uninstall({ homeDir, uid });
  } catch (error) {
    console.error(`[setup-extension-bridge] hata: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
