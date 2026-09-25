import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { createScopedRuntime } from "../src/core/scoped-runtime.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";

const cleanups: string[] = [];
const runtimes: RuntimeServices[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => {
    await runtime.ownerShellSupervisor.close();
    await runtime.processSupervisor.close();
    await runtime.computerJs.close();
    await runtime.computer.close();
    await runtime.browser.close();
  }));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("Owner shell audit redaction", () => {
  it("records only script metadata and lifecycle, never script/output/lease content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-shell-audit-"));
    cleanups.push(root);
    const auditFile = path.join(root, "audit.jsonl");
    const config = await loadConfig({
      roots: [root],
      auditFile,
      ownerRuntimeEnabled: true,
      ownerShellPath: "/bin/sh",
    });
    const runtime = createRuntimeServices(config);
    runtimes.push(runtime);
    // Serbest mod: project lease tam yetkilidir, ayrı Admin kapısı yoktur.
    const project = await runtime.authority.start({ profile: "project", projectRoots: [root] });
    await runtime.authority.flushAudit();

    const secretScriptMarker = "OWNER_SCRIPT_SECRET_934712";
    const stdoutMarker = "OWNER_STDOUT_SECRET_442901";
    const stderrMarker = "OWNER_STDERR_SECRET_558122";
    const scoped = createScopedRuntime(runtime, project);
    const result = await scoped.shell.run({
      cwd: root,
      script: `secret='${secretScriptMarker}'; printf '${stdoutMarker}'; printf '${stderrMarker}' >&2`,
    });
    expect(result.stdout).toContain(stdoutMarker);
    expect(result.stderr).toContain(stderrMarker);

    const auditText = await readFile(auditFile, "utf8");
    expect(auditText).toContain("shell.run");
    expect(auditText).toContain("scriptByteCount");
    expect(auditText).toContain("scriptSha256");
    expect(auditText).not.toContain(secretScriptMarker);
    expect(auditText).not.toContain(stdoutMarker);
    expect(auditText).not.toContain(stderrMarker);
    expect(auditText).not.toContain(project.leaseId);
  });
});
