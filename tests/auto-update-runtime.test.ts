import { describe, expect, it } from "vitest";
import {
  AUTO_UPDATE_LABEL,
  buildAutoUpdateAgent,
  buildAutoUpdateCtlCommands,
  ciGateAllows,
  currentShaFromLinkTarget,
  isReleaseDirName,
  migrateRunnerToStable,
  parseArgs,
  planRetention,
  releaseDirFor,
  sameCommit,
  shouldDeploy,
  stableRunnerPath,
  stateDirFor,
  validateOriginUrl,
  withDefaultPythonEnv,
} from "../scripts/auto-update-runtime.mjs";

describe("otomatik runtime güncelleyici", () => {
  it("release dizin adlarını ayırt eder", () => {
    expect(isReleaseDirName("c8e069b")).toBe(true);
    expect(isReleaseDirName("03b844a")).toBe(true);
    expect(isReleaseDirName("9f1ac4e2b7d34f5a6c8d90e1f2a3b4c5d6e7f80")).toBe(true);
    expect(isReleaseDirName("current")).toBe(false);
    expect(isReleaseDirName("chatgpt-system-main")).toBe(false);
    expect(isReleaseDirName("../../etc")).toBe(false);
    expect(isReleaseDirName("XYZ1234")).toBe(false);
  });

  it("kısa ve tam SHA aynı commiti gösterir", () => {
    expect(sameCommit("c8e069b", "c8e069b9f1ac4e2b7d34f5a6c8d90e1f2a3b4c5d")).toBe(true);
    expect(sameCommit("c8e069b", "c8e069b")).toBe(true);
    expect(sameCommit("c8e069b", "860bf89")).toBe(false);
    expect(() => sameCommit("current", "c8e069b")).toThrow(/SHA/);
  });

  it("aynı committe dağıtım istemez, yenisinde ister", () => {
    expect(shouldDeploy("c8e069b", "c8e069b9f1ac4e2b7d34f5a6c8d90e1f2a3b4c5d")).toBe(false);
    expect(shouldDeploy(null, "c8e069b9f1ac4e2b7d34f5a6c8d90e1f2a3b4c5d")).toBe(true);
    expect(shouldDeploy("860bf89", "c8e069b9f1ac4e2b7d34f5a6c8d90e1f2a3b4c5d")).toBe(true);
    expect(() => shouldDeploy("c8e069b", "bozuk")).toThrow(/SHA/);
  });

  it("yalnızca beklenen origin'e izin verir", () => {
    expect(validateOriginUrl("https://github.com/senoldogann/chatgpt-system.git")).toContain("senoldogann");
    expect(validateOriginUrl("git@github.com:senoldogann/chatgpt-system.git")).toContain("senoldogann");
    expect(() => validateOriginUrl("https://github.com/baska/repo.git")).toThrow(/Beklenmeyen/);
    expect(() => validateOriginUrl("https://evil.example.com/senoldogann/chatgpt-system.git")).toThrow(/Beklenmeyen/);
  });

  it("symlink hedefinden current SHA okur", () => {
    expect(currentShaFromLinkTarget("releases/c8e069b")).toBe("c8e069b");
    expect(currentShaFromLinkTarget("/Users/x/.chatgpt-system/runtime/releases/860bf89")).toBe("860bf89");
    expect(currentShaFromLinkTarget(null)).toBe(null);
    expect(currentShaFromLinkTarget("releases/current")).toBe(null);
  });

  it("yolları kurallı üretir", () => {
    expect(releaseDirFor("/r/runtime", "c8e069b")).toBe("/r/runtime/releases/c8e069b");
    expect(stableRunnerPath("/r/runtime")).toBe("/r/runtime/chatgpt-system-main/scripts/daily-driver-runner.mjs");
    expect(stateDirFor("/r/runtime")).toBe("/r/auto-update");
    expect(() => releaseDirFor("göreli/yol", "c8e069b")).toThrow(/mutlak/);
    expect(() => releaseDirFor("/r/runtime", "bozuk")).toThrow(/SHA/);
  });

  it("girdi ortamını değiştirmeden Python varsayılanı ekler", () => {
    const input = { PATH: "/usr/bin" };
    const next = withDefaultPythonEnv(input);
    expect(input.PYTHON).toBe(undefined);
    if (process.platform === "darwin") expect(next.PYTHON).toBe("/usr/bin/python3");
  });

  it("CI kapısı: başarıda geçirir, başarısızda durdurur", () => {
    expect(ciGateAllows({ available: true, requireCi: false, conclusions: ["success"] }).allow).toBe(true);
    expect(ciGateAllows({ available: true, requireCi: true, conclusions: ["success"] }).allow).toBe(true);
    expect(ciGateAllows({ available: true, requireCi: false, conclusions: ["success", "failure"] }).allow).toBe(false);
    expect(ciGateAllows({ available: false, requireCi: true, conclusions: [] }).allow).toBe(false);
    expect(ciGateAllows({ available: false, requireCi: false, conclusions: [] }).allow).toBe(true);
    expect(ciGateAllows({ available: true, requireCi: true, conclusions: [] }).allow).toBe(false);
  });

  it("retention current ve previous'i korur, eskileri budar", () => {
    const entries = [
      { name: "c8e069b", mtimeMs: 400 },
      { name: "860bf89", mtimeMs: 300 },
      { name: "140fd52", mtimeMs: 200 },
      { name: "2a0a2ec", mtimeMs: 100 },
      { name: "current", mtimeMs: 999 },
    ];
    const plan = planRetention({ entries, currentSha: "c8e069b", previousSha: "860bf89", retain: 3 });
    expect(plan.keep).toContain("c8e069b");
    expect(plan.keep).toContain("860bf89");
    expect(plan.keep).toContain("140fd52");
    expect(plan.remove).toContain("2a0a2ec");
    expect(plan.remove).not.toContain("current");
    expect(() => planRetention({ entries, currentSha: "c8e069b", previousSha: null, retain: 1 })).toThrow(/retain/);
  });

  it("daily-driver runner yolunu stabil yola taşır", () => {
    const pinned = `<string>/Users/dogan/.chatgpt-system/runtime/releases/c8e069b/scripts/daily-driver-runner.mjs</string>`;
    const stable = "/Users/dogan/.chatgpt-system/runtime/chatgpt-system-main/scripts/daily-driver-runner.mjs";
    const moved = migrateRunnerToStable(pinned, stable);
    expect(moved.changed).toBe(true);
    expect(moved.plist).toContain(stable);
    expect(moved.plist).not.toContain("releases/c8e069b");
    const already = migrateRunnerToStable(`<string>${stable}</string>`, stable);
    expect(already.changed).toBe(false);
  });

  it("periyodik LaunchAgent üretir: KeepAlive yok, StartInterval var", () => {
    const plist = buildAutoUpdateAgent({
      nodePath: "/opt/homebrew/bin/node",
      scriptPath: "/Users/test/chatgpt-system/scripts/auto-update-runtime.mjs",
      runtimeDir: "/Users/test/.chatgpt-system/runtime",
      logDir: "/Users/test/.chatgpt-system/auto-update",
      intervalSec: 3600,
      retain: 3,
      verifyMinutes: 10,
      requireCi: false,
    });
    expect(plist).toContain(`<string>${AUTO_UPDATE_LABEL}</string>`);
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>3600</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).not.toContain("<key>KeepAlive</key>");
    expect(plist).toContain("auto-update-runtime.mjs");
    expect(plist).toContain("launchd-stdout.log");
    expect(() => buildAutoUpdateAgent({
      nodePath: "/opt/homebrew/bin/node",
      scriptPath: "/s/auto-update-runtime.mjs",
      runtimeDir: "/Users/test/.chatgpt-system/runtime",
      logDir: "/Users/test/.chatgpt-system/auto-update",
      intervalSec: 60,
      retain: 3,
      verifyMinutes: 10,
    })).toThrow(/intervalSec/);
  });

  it("ctl komutları doğru domain ve etiketi kullanır", () => {
    const commands = buildAutoUpdateCtlCommands({ uid: 501, plistPath: "/Users/t/Library/LaunchAgents/x.plist" });
    expect(commands.bootstrap[0]).toBe("bootstrap");
    expect(commands.status[1]).toContain(`${AUTO_UPDATE_LABEL}`);
    expect(commands.status[0]).toBe("print");
  });

  it("argümanları doğrular", () => {
    const parsed = parseArgs(["run", "--retain", "5", "--require-ci"]);
    expect(parsed.command).toBe("run");
    expect(parsed.retain).toBe(5);
    expect(parsed.requireCi).toBe(true);
    expect(parseArgs(["check"]).command).toBe("check");
    expect(() => parseArgs(["run", "--retain", "1"])).toThrow(/retain/);
    expect(() => parseArgs(["kur"])).toThrow(/Bilinmeyen komut/);
  });
});
