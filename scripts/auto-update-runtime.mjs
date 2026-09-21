#!/usr/bin/env node
// Otomatik runtime güncelleyici: origin/main ilerleyince yeni release kurar,
// current symlink'ini atomik çevirir, daily-driver'ı yeniden başlatır,
// doğrulama geçemezse previous'a geri döner.

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendBoundedLog } from "./daily-driver-runner.mjs";

export const AUTO_UPDATE_LABEL = "com.senoldogann.chatgpt-system.auto-update";
export const EXPECTED_ORIGIN_PATTERNS = [
  "github.com/senoldogann/chatgpt-system",
  "github.com:senoldogann/chatgpt-system",
];
export const DEFAULT_INTERVAL_SEC = 3600;
export const DEFAULT_RETAIN = 3;
export const DEFAULT_VERIFY_MINUTES = 10;
export const BUILD_TIMEOUT_MS = 1_200_000;
export const GIT_TIMEOUT_MS = 120_000;
export const DIAGNOSE_TIMEOUT_MS = 600_000;
export const HEALTH_TIMEOUT_MS = 10_000;
export const MAX_LOG_BYTES = 1_048_576;

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

// Saf yardımcılar: doğrudan test edilir, yan etki yok.

export function isReleaseDirName(name) {
  return SHA_PATTERN.test(name);
}

export function sameCommit(first, second) {
  if (!SHA_PATTERN.test(first) || !SHA_PATTERN.test(second)) {
    throw new Error("Commit SHA karşılaştırması için iki geçerli SHA gerekir.");
  }
  return first === second || first.startsWith(second) || second.startsWith(first);
}

export function shouldDeploy(currentSha, originSha) {
  if (!SHA_PATTERN.test(originSha)) throw new Error("origin/main SHA okunamadı.");
  if (currentSha === null) return true;
  return !sameCommit(currentSha, originSha);
}

export function validateOriginUrl(url) {
  const normalized = String(url ?? "").trim().replace(/\.git$/, "");
  const allowed = EXPECTED_ORIGIN_PATTERNS.some((pattern) => normalized.endsWith(pattern));
  if (!allowed) throw new Error(`Beklenmeyen git origin: ${normalized}. Otomatik güncelleme durdu.`);
  return normalized;
}

export function currentShaFromLinkTarget(target) {
  if (!target) return null;
  const base = String(target).split(path.sep).filter(Boolean).pop() ?? "";
  return isReleaseDirName(base) ? base : null;
}

export function releaseDirFor(runtimeDir, sha) {
  if (!path.isAbsolute(runtimeDir)) throw new Error("runtimeDir mutlak yol olmalı.");
  if (!SHA_PATTERN.test(sha)) throw new Error("Geçerli bir release SHA gerekir.");
  return path.join(path.normalize(runtimeDir), "releases", sha);
}

export function stableRunnerPath(runtimeDir) {
  if (!path.isAbsolute(runtimeDir)) throw new Error("runtimeDir mutlak yol olmalı.");
  return path.join(path.normalize(runtimeDir), "chatgpt-system-main", "scripts", "daily-driver-runner.mjs");
}

export function stableDistPath(runtimeDir) {
  if (!path.isAbsolute(runtimeDir)) throw new Error("runtimeDir mutlak yol olmalı.");
  return path.join(path.normalize(runtimeDir), "chatgpt-system-main", "dist", "cli.js");
}

export function stateDirFor(runtimeDir) {
  return path.join(path.dirname(path.normalize(runtimeDir)), "auto-update");
}

export function withDefaultPythonEnv(environment) {
  const next = { ...environment };
  if (process.platform === "darwin" && !next.PYTHON) next.PYTHON = "/usr/bin/python3";
  return next;
}

export function ciGateAllows({ available, requireCi, conclusions }) {
  if (!available) {
    return requireCi
      ? { allow: false, reason: "gh yokken --require-ci ile dağıtım yasak." }
      : { allow: true, reason: "gh yok; yerel npm run check kapı olacak." };
  }
  const verdicts = Array.isArray(conclusions) ? conclusions : [];
  if (verdicts.length === 0) {
    return requireCi
      ? { allow: false, reason: "CI kaydı yokken --require-ci ile dağıtım yasak." }
      : { allow: true, reason: "CI kaydı yok; yerel npm run check kapı olacak." };
  }
  const failed = verdicts.filter((verdict) => verdict !== "success");
  if (failed.length > 0) return { allow: false, reason: `CI geçmemiş: ${failed.join(",")}.` };
  return { allow: true, reason: "CI success." };
}

export function planRetention({ entries, currentSha, previousSha, retain }) {
  if (!Number.isInteger(retain) || retain < 2) throw new Error("retain en az 2 olmalı.");
  const pinned = new Set([currentSha, previousSha].filter((sha) => sha !== null));
  const candidates = entries
    .filter((entry) => isReleaseDirName(entry.name) && !pinned.has(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set(pinned);
  for (const candidate of candidates) {
    if (keep.size >= retain) break;
    keep.add(candidate.name);
  }
  return {
    keep: [...keep],
    remove: entries.map((entry) => entry.name).filter((name) => isReleaseDirName(name) && !keep.has(name)),
  };
}

export function migrateRunnerToStable(plistText, stableRunner) {
  const pattern = /\/\.chatgpt-system\/runtime\/releases\/[0-9a-f]{7,40}\/scripts\/daily-driver-runner\.mjs/;
  if (!pattern.test(plistText)) return { changed: false, plist: plistText };
  return { changed: true, plist: plistText.replace(pattern, stableRunner.replace(/^\//, "/")) };
}

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

export function buildAutoUpdateAgent(options) {
  const nodePath = requireAbsolute(options.nodePath, "Node yolu");
  const scriptPath = requireAbsolute(options.scriptPath, "Güncelleyici betik yolu");
  const runtimeDir = requireAbsolute(options.runtimeDir, "Runtime dizini");
  const logDir = requireAbsolute(options.logDir, "Log dizini");
  const intervalSec = options.intervalSec ?? DEFAULT_INTERVAL_SEC;
  if (!Number.isInteger(intervalSec) || intervalSec < 600) {
    throw new Error("intervalSec en az 600 saniye olmalı.");
  }
  const retain = options.retain ?? DEFAULT_RETAIN;
  if (!Number.isInteger(retain) || retain < 2) throw new Error("retain en az 2 olmalı.");
  const verifyMinutes = options.verifyMinutes ?? DEFAULT_VERIFY_MINUTES;
  if (!Number.isInteger(verifyMinutes) || verifyMinutes < 1 || verifyMinutes > 60) {
    throw new Error("verifyMinutes 1-60 arasında olmalı.");
  }
  const args = [
    nodePath,
    scriptPath,
    "run",
    "--runtime-dir", runtimeDir,
    "--retain", String(retain),
    "--verify-minutes", String(verifyMinutes),
  ];
  if (options.requireCi) args.push("--require-ci");
  const argumentXml = args.map((value) => `      <string>${xmlEscape(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${AUTO_UPDATE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${intervalSec}</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${xmlEscape(path.join(logDir, "launchd-stdout.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(path.join(logDir, "launchd-stderr.log"))}</string>
  </dict>
</plist>
`;
}

export function buildAutoUpdateCtlCommands({ uid, plistPath }) {
  if (!Number.isInteger(uid) || uid < 0) throw new Error("Geçerli kullanıcı uid gerekir.");
  const normalizedPlist = requireAbsolute(plistPath, "LaunchAgent plist yolu");
  const domain = `gui/${uid}`;
  return {
    bootout: ["bootout", domain, normalizedPlist],
    bootstrap: ["bootstrap", domain, normalizedPlist],
    status: ["print", `${domain}/${AUTO_UPDATE_LABEL}`],
  };
}

export function parseArgs(argv) {
  const command = argv[0] ?? "run";
  if (!["run", "check", "install", "uninstall", "status", "--help", "-h"].includes(command)) {
    throw new Error(`Bilinmeyen komut: ${command}. Geçerli: run|check|install|uninstall|status.`);
  }
  if (command === "--help" || command === "-h") return { command: "help" };
  const options = {
    command,
    runtimeDir: undefined,
    repoDir: undefined,
    intervalSec: DEFAULT_INTERVAL_SEC,
    retain: DEFAULT_RETAIN,
    verifyMinutes: DEFAULT_VERIFY_MINUTES,
    requireCi: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-ci") {
      options.requireCi = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} bir değer gerektirir.`);
    if (arg === "--runtime-dir") options.runtimeDir = value;
    else if (arg === "--repo-dir") options.repoDir = value;
    else if (arg === "--interval-sec") options.intervalSec = Number(value);
    else if (arg === "--retain") options.retain = Number(value);
    else if (arg === "--verify-minutes") options.verifyMinutes = Number(value);
    else throw new Error(`Bilinmeyen seçenek: ${arg}`);
    index += 1;
  }
  if (!Number.isInteger(options.intervalSec) || options.intervalSec < 600) {
    throw new Error("--interval-sec en az 600 olmalı.");
  }
  if (!Number.isInteger(options.retain) || options.retain < 2) throw new Error("--retain en az 2 olmalı.");
  if (!Number.isInteger(options.verifyMinutes) || options.verifyMinutes < 1 || options.verifyMinutes > 60) {
    throw new Error("--verify-minutes 1-60 arasında olmalı.");
  }
  return options;
}

function usage() {
  console.log(`Kullanım:
  node scripts/auto-update-runtime.mjs run [--runtime-dir <dir> --repo-dir <dir> --retain 3 --verify-minutes 10 --require-ci]
  node scripts/auto-update-runtime.mjs check [aynı seçenekler; değişiklik yapmaz]
  node scripts/auto-update-runtime.mjs install [--interval-sec 3600 ...]
  node scripts/auto-update-runtime.mjs uninstall
  node scripts/auto-update-runtime.mjs status

Saatlik LaunchAgent origin/main'i izler. Yeni commit CI + yerel check
geçerse releases/<sha> kurulur, current atomik çevrilir, daily-driver
yeniden başlatılır, doğrulama geçemezse previous'a dönülür.
ChatGPT tarafında yeni araçlar için manuel Refresh gerekir.`);
}

// Yan etkili akış: küçük, sıralı, hata-durdu mu geri al.

function runCommand(command, args, { cwd, timeoutMs, env } = {}) {
  return spawnSync(command, args, {
    shell: false,
    encoding: "utf8",
    cwd,
    timeout: timeoutMs,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertSpawnOk(result, label) {
  if (result.error) throw new Error(`${label} çalışmadı: ${result.error.message}.`);
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim().slice(0, 500);
    throw new Error(`${label} exit ${result.status}${detail ? `: ${detail}` : "."}`);
  }
  return String(result.stdout ?? "").trim();
}

async function pathExists(candidate) {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readLinkTarget(linkPath) {
  try {
    return await readlink(linkPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function replaceSymlink(linkPath, target) {
  const temporary = `${linkPath}.tmp-${process.pid}`;
  try {
    await unlink(temporary);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await symlink(target, temporary);
  await rename(temporary, linkPath);
}

async function writeStateAtomic(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, statePath);
}

async function acquireLock(lockDir) {
  try {
    await mkdir(lockDir, { mode: 0o700 });
    await writeFile(path.join(lockDir, "pid"), String(process.pid), { mode: 0o600 });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let stale = false;
    try {
      const pidText = (await readFile(path.join(lockDir, "pid"), "utf8")).trim();
      const pid = Number(pidText);
      if (!Number.isInteger(pid)) {
        stale = true;
      } else {
        try {
          process.kill(pid, 0);
        } catch {
          stale = true;
        }
      }
    } catch {
      stale = true;
    }
    if (!stale) return false;
    await rm(lockDir, { recursive: true, force: true });
    await mkdir(lockDir, { mode: 0o700 });
    await writeFile(path.join(lockDir, "pid"), String(process.pid), { mode: 0o600 });
    return true;
  }
}

async function releaseLock(lockDir) {
  await rm(lockDir, { recursive: true, force: true });
}

function gitRepo(repoDir, args, timeoutMs = GIT_TIMEOUT_MS) {
  return assertSpawnOk(runCommand("git", ["-C", repoDir, ...args], { timeoutMs }), `git ${args[0]}`);
}

function readCiConclusions(repoDir, sha) {
  const probe = runCommand("gh", ["--version"], { timeoutMs: 15_000 });
  if (probe.error || probe.status !== 0) return { available: false, conclusions: [] };
  const result = runCommand(
    "gh",
    ["api", `repos/senoldogann/chatgpt-system/commits/${sha}/check-runs`, "--jq", "[.check_runs[] | .conclusion] | unique | join(\",\")"],
    { timeoutMs: 30_000 },
  );
  if (result.error || result.status !== 0) return { available: false, conclusions: [] };
  const raw = String(result.stdout ?? "").trim();
  if (!raw) return { available: true, conclusions: [] };
  return { available: true, conclusions: raw.split(",").map((part) => part.trim()).filter(Boolean) };
}

async function verifyRelease({ runtimeDir, sha, verifyMinutes, log }) {
  const releaseDir = releaseDirFor(runtimeDir, sha);
  const stableDist = await realpath(stableDistPath(runtimeDir));
  const expectedDist = path.join(releaseDir, "dist", "cli.js");
  if (stableDist !== expectedDist) {
    throw new Error(`current yeni release'i göstermiyor: ${stableDist}.`);
  }
  await log(`doğrulama: current -> releases/${sha} çözümlendi.`);
  const health = await fetch("http://127.0.0.1:8080/healthz", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    .then(async (response) => ({ status: response.status, body: (await response.text()).trim() }))
    .catch((error) => { throw new Error(`healthz erişilemedi: ${error.message}.`); });
  if (health.status !== 200 || health.body !== "live") throw new Error(`healthz beklenmedik: ${health.status} ${health.body}.`);
  const ready = await fetch("http://127.0.0.1:8080/readyz", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    .then(async (response) => ({ status: response.status, body: (await response.text()).trim() }))
    .catch((error) => { throw new Error(`readyz erişilemedi: ${error.message}.`); });
  if (ready.status !== 200 || ready.body !== "ready") throw new Error(`readyz beklenmedik: ${ready.status} ${ready.body}.`);
  await log("doğrulama: healthz=live readyz=ready.");
  const diagnose = runCommand(
    process.execPath,
    [path.join(releaseDir, "scripts", "diagnose-chatgpt-connection.mjs"), "--minutes", String(verifyMinutes)],
    { cwd: releaseDir, timeoutMs: DIAGNOSE_TIMEOUT_MS },
  );
  if (diagnose.error || diagnose.status !== 0) {
    const detail = String(diagnose.stderr ?? diagnose.error?.message ?? "").trim().slice(0, 500);
    throw new Error(`diagnose geçemedi${detail ? `: ${detail}` : "."}`);
  }
  await log("doğrulama: diagnose temiz.");
}

function restartDailyDriver() {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Kullanıcı uid belirlenemedi.");
  const plistPath = path.join(homedir(), "Library", "LaunchAgents", "com.senoldogann.chatgpt-system.daily-driver.plist");
  const domain = `gui/${uid}`;
  assertSpawnOk(
    runCommand("/bin/launchctl", ["bootout", domain, plistPath], { timeoutMs: 30_000 }),
    "daily-driver bootout",
  );
  assertSpawnOk(
    runCommand("/bin/launchctl", ["bootstrap", domain, plistPath], { timeoutMs: 30_000 }),
    "daily-driver bootstrap",
  );
}

async function migrateDailyDriverRunner(runtimeDir, log) {
  const plistPath = path.join(homedir(), "Library", "LaunchAgents", "com.senoldogann.chatgpt-system.daily-driver.plist");
  let plist;
  try {
    plist = await readFile(plistPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      await log("daily-driver plist yok; runner taşıma atlandı.");
      return;
    }
    throw error;
  }
  const absoluteStable = stableRunnerPath(runtimeDir);
  const { changed, plist: next } = migrateRunnerToStable(plist, absoluteStable);
  if (!changed) {
    await log("daily-driver runner zaten stabil yolda.");
    return;
  }
  const backup = `${plistPath}.bak-autoupdate-${new Date().toISOString().slice(0, 10)}`;
  await writeFile(backup, plist, { encoding: "utf8", mode: 0o600 });
  const temporary = `${plistPath}.tmp-${process.pid}`;
  await writeFile(temporary, next, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, plistPath);
  assertSpawnOk(runCommand("/usr/bin/plutil", ["-lint", plistPath], { timeoutMs: 15_000 }), "plist lint");
  await log(`daily-driver runner stabil yola taşındı (${backup} yedeklendi).`);
}

async function pruneReleases({ runtimeDir, currentSha, previousSha, retain, repoDir, log }) {
  const releasesDir = path.join(runtimeDir, "releases");
  let names;
  try {
    names = await readdir(releasesDir);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const entries = [];
  for (const name of names) {
    if (!isReleaseDirName(name)) continue;
    try {
      entries.push({ name, mtimeMs: (await stat(path.join(releasesDir, name))).mtimeMs });
    } catch {
      // Yarım kalmış dizin bir sonraki turda ele alınır.
    }
  }
  const { remove } = planRetention({ entries, currentSha, previousSha, retain });
  for (const name of remove) {
    const target = path.join(releasesDir, name);
    const worktreeGone = runCommand("git", ["-C", repoDir, "worktree", "remove", "--force", target], { timeoutMs: GIT_TIMEOUT_MS });
    if (worktreeGone.error || worktreeGone.status !== 0) {
      await rm(target, { recursive: true, force: true });
    }
    await rm(path.join(releasesDir, `.built-${name}.json`), { force: true });
    await log(`eski release temizlendi: ${name}.`);
  }
  runCommand("git", ["-C", repoDir, "worktree", "prune"], { timeoutMs: GIT_TIMEOUT_MS });
}

async function ensureBuiltRelease({ runtimeDir, repoDir, sha, log }) {
  const releaseDir = releaseDirFor(runtimeDir, sha);
  const marker = path.join(runtimeDir, "releases", `.built-${sha}.json`);
  const exists = await pathExists(releaseDir);
  if (exists) {
    if (await pathExists(marker)) {
      const actual = runCommand("git", ["-C", releaseDir, "rev-parse", "HEAD"], { timeoutMs: GIT_TIMEOUT_MS });
      if (!actual.error && actual.status === 0 && sameCommit(String(actual.stdout).trim(), sha)) {
        await log(`releases/${sha} zaten doğrulanmış; yeniden derlenmedi.`);
        return releaseDir;
      }
    }
    await log(`releases/${sha} yarım kalmış; temizlenip yeniden kuruluyor.`);
    const gone = runCommand("git", ["-C", repoDir, "worktree", "remove", "--force", releaseDir], { timeoutMs: GIT_TIMEOUT_MS });
    if (gone.error || gone.status !== 0) await rm(releaseDir, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
  assertSpawnOk(
    runCommand("git", ["-C", repoDir, "worktree", "add", "--detach", releaseDir, sha], { timeoutMs: GIT_TIMEOUT_MS }),
    "worktree kurulumu",
  );
  await log(`worktree kuruldu: releases/${sha}.`);
  const buildEnv = withDefaultPythonEnv(process.env);
  assertSpawnOk(
    runCommand("/usr/bin/env", ["npm", "ci", "--no-audit", "--no-fund"], { cwd: releaseDir, timeoutMs: BUILD_TIMEOUT_MS, env: buildEnv }),
    "npm ci",
  );
  assertSpawnOk(
    runCommand("/usr/bin/env", ["npm", "run", "check"], { cwd: releaseDir, timeoutMs: BUILD_TIMEOUT_MS, env: buildEnv }),
    "npm run check",
  );
  await writeFile(marker, `${JSON.stringify({ sha, builtAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  await log(`releases/${sha} derlendi ve check geçti.`);
  return releaseDir;
}

async function flipCurrent({ runtimeDir, sha, log }) {
  const currentLink = path.join(runtimeDir, "current");
  const previousLink = path.join(runtimeDir, "previous");
  const oldTarget = await readLinkTarget(currentLink);
  const oldSha = currentShaFromLinkTarget(oldTarget ? path.resolve(runtimeDir, oldTarget) : null);
  const newTarget = path.relative(runtimeDir, releaseDirFor(runtimeDir, sha));
  await replaceSymlink(currentLink, newTarget);
  if (oldTarget && oldSha) {
    await replaceSymlink(previousLink, oldTarget);
  } else {
    await replaceSymlink(previousLink, newTarget);
  }
  await log(`current -> releases/${sha} çevrildi (previous: ${oldSha ?? "yok"}).`);
  return oldSha;
}

async function rollbackCurrent({ runtimeDir, previousSha, log }) {
  const currentLink = path.join(runtimeDir, "current");
  const previousLink = path.join(runtimeDir, "previous");
  const previousTarget = await readLinkTarget(previousLink);
  const resolved = previousTarget ? currentShaFromLinkTarget(path.resolve(runtimeDir, previousTarget)) : null;
  const target = resolved ?? previousSha;
  if (!target) throw new Error("Geri alınacak previous release bulunamadı.");
  await replaceSymlink(currentLink, path.relative(runtimeDir, releaseDirFor(runtimeDir, target)));
  await log(`geri alındı: current -> releases/${target}.`);
}

async function runOnce({ runtimeDir, repoDir, retain, verifyMinutes, requireCi, dryRun, log }) {
  if (process.platform !== "darwin") throw new Error("Otomatik güncelleme yalnızca macOS'te çalışır.");
  const normalizedRuntime = requireAbsolute(runtimeDir, "Runtime dizini");
  const normalizedRepo = requireAbsolute(repoDir, "Repo dizini");
  await mkdir(path.join(normalizedRuntime, "releases"), { recursive: true, mode: 0o755 });

  const originUrl = gitRepo(normalizedRepo, ["remote", "get-url", "origin"]);
  validateOriginUrl(originUrl);
  assertSpawnOk(
    runCommand("git", ["-C", normalizedRepo, "fetch", "origin", "main"], { timeoutMs: GIT_TIMEOUT_MS }),
    "origin/main fetch",
  );
  const originSha = gitRepo(normalizedRepo, ["rev-parse", "origin/main"]);
  if (!SHA_PATTERN.test(originSha)) throw new Error("origin/main SHA okunamadı.");
  gitRepo(normalizedRepo, ["cat-file", "-t", originSha]);

  const currentTarget = await readLinkTarget(path.join(normalizedRuntime, "current"));
  const currentSha = currentShaFromLinkTarget(currentTarget ? path.resolve(normalizedRuntime, currentTarget) : null);
  await log(`durum: current=${currentSha ?? "yok"} origin/main=${originSha}.`);
  if (!shouldDeploy(currentSha, originSha)) {
    return { deployed: false, currentSha, originSha };
  }

  const ci = readCiConclusions(normalizedRepo, originSha);
  const gate = ciGateAllows({ available: ci.available, requireCi, conclusions: ci.conclusions });
  await log(`CI kapısı: ${gate.reason}`);
  if (!gate.allow) return { deployed: false, currentSha, originSha, skipped: gate.reason };
  if (dryRun) return { deployed: false, currentSha, originSha, wouldDeploy: originSha };

  await ensureBuiltRelease({ runtimeDir: normalizedRuntime, repoDir: normalizedRepo, sha: originSha, log });
  const previousSha = await flipCurrent({ runtimeDir: normalizedRuntime, sha: originSha, log });
  await migrateDailyDriverRunner(normalizedRuntime, log);
  restartDailyDriver();
  await log("daily-driver yeniden başlatıldı.");
  try {
    await verifyRelease({ runtimeDir: normalizedRuntime, sha: originSha, verifyMinutes, log });
  } catch (error) {
    await log(`doğrulama geçemedi, geri alınıyor: ${error.message}.`);
    await rollbackCurrent({ runtimeDir: normalizedRuntime, previousSha, log });
    restartDailyDriver();
    throw error;
  }
  await pruneReleases({
    runtimeDir: normalizedRuntime,
    currentSha: originSha,
    previousSha,
    retain,
    repoDir: normalizedRepo,
    log,
  });
  return { deployed: true, currentSha: originSha, originSha, previousSha };
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    usage();
    return;
  }
  const runtimeDir = parsed.runtimeDir ?? path.join(homedir(), ".chatgpt-system", "runtime");
  const repoDir = parsed.repoDir ?? defaultRepoDir;
  const stateDir = stateDirFor(path.resolve(runtimeDir));
  const statePath = path.join(stateDir, "state.json");
  const logPath = path.join(stateDir, "auto-update.log");
  const lockDir = path.join(stateDir, "lock");
  const log = async (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    process.stdout.write(`[auto-update] ${line}`);
    await appendBoundedLog(logPath, line, MAX_LOG_BYTES).catch(() => {});
  };

  if (parsed.command === "install") {
    if (process.platform !== "darwin") throw new Error("LaunchAgent kurulumu yalnızca macOS'te desteklenir.");
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("Kullanıcı uid belirlenemedi.");
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const plistPath = path.join(homedir(), "Library", "LaunchAgents", `${AUTO_UPDATE_LABEL}.plist`);
    const plist = buildAutoUpdateAgent({
      nodePath: process.execPath,
      scriptPath: path.join(path.resolve(repoDir), "scripts", "auto-update-runtime.mjs"),
      runtimeDir: path.resolve(runtimeDir),
      logDir: stateDir,
      intervalSec: parsed.intervalSec,
      retain: parsed.retain,
      verifyMinutes: parsed.verifyMinutes,
      requireCi: parsed.requireCi,
    });
    const temporary = `${plistPath}.tmp-${process.pid}`;
    await writeFile(temporary, plist, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, plistPath);
    assertSpawnOk(runCommand("/usr/bin/plutil", ["-lint", plistPath], { timeoutMs: 15_000 }), "plist lint");
    const domain = `gui/${uid}`;
    runCommand("/bin/launchctl", ["bootout", domain, plistPath], { timeoutMs: 30_000 });
    assertSpawnOk(runCommand("/bin/launchctl", ["bootstrap", domain, plistPath], { timeoutMs: 30_000 }), "launchctl bootstrap");
    console.log(`Otomatik güncelleme kuruldu: ${AUTO_UPDATE_LABEL} (her ${parsed.intervalSec} sn).`);
    console.log("Not: yeni MCP araçları için ChatGPT tarafında manuel Refresh gerekir.");
    return;
  }

  if (parsed.command === "uninstall") {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("Kullanıcı uid belirlenemedi.");
    const plistPath = path.join(homedir(), "Library", "LaunchAgents", `${AUTO_UPDATE_LABEL}.plist`);
    runCommand("/bin/launchctl", ["bootout", `gui/${uid}`, plistPath], { timeoutMs: 30_000 });
    try {
      await unlink(plistPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    console.log(`Otomatik güncelleme kaldırıldı: ${AUTO_UPDATE_LABEL}.`);
    return;
  }

  if (parsed.command === "status") {
    let state = null;
    try {
      state = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const currentTarget = await readLinkTarget(path.join(path.resolve(runtimeDir), "current"));
    const previousTarget = await readLinkTarget(path.join(path.resolve(runtimeDir), "previous"));
    console.log(JSON.stringify({
      current: currentTarget,
      previous: previousTarget,
      state,
    }, null, 2));
    return;
  }

  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const locked = await acquireLock(lockDir);
  if (!locked) {
    await log("önceki tur hâlâ çalışıyor; bu tur atlandı.");
    return;
  }
  try {
    const dryRun = parsed.command === "check";
    const result = await runOnce({
      runtimeDir,
      repoDir,
      retain: parsed.retain,
      verifyMinutes: parsed.verifyMinutes,
      requireCi: parsed.requireCi,
      dryRun,
      log,
    });
    await writeStateAtomic(statePath, {
      lastCheckAt: new Date().toISOString(),
      currentSha: result.currentSha,
      originSha: result.originSha,
      lastDeployAt: result.deployed ? new Date().toISOString() : undefined,
      lastResult: result.deployed ? "deployed" : (result.skipped ? `skipped: ${result.skipped}` : (result.wouldDeploy ? `would-deploy: ${result.wouldDeploy}` : "up-to-date")),
    });
    if (result.deployed) {
      await log("BİTTİ: yeni release canlıda. ChatGPT tarafında manuel Refresh gerekir.");
    }
  } finally {
    await releaseLock(lockDir);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[auto-update] hata: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
