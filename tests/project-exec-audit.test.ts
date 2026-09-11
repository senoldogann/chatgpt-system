import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { PathPolicy } from "../src/policy.js";
import { ProjectExecService } from "../src/project-exec-service.js";
import type { ProjectExecBackend } from "../src/project-exec-types.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("project execution audit", () => {
  it("records categorical execution metadata without command arguments or output payloads", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-project-exec-audit-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    const auditFile = path.join(base, "audit.jsonl");
    await mkdir(root);

    const argumentCanary = "ARGUMENT_SECRET_CANARY";
    const outputCanary = "OUTPUT_SECRET_CANARY";
    const backend: ProjectExecBackend = {
      async run(request) {
        return {
          command: request.command,
          args: [...request.args],
          cwd: request.cwd,
          exitCode: 0,
          signal: null,
          stdout: `${outputCanary}\n`,
          stderr: "",
          timedOut: false,
          sandbox: { backend: "docker", network: "none", hostFallback: false },
        };
      },
    };

    const service = new ProjectExecService(
      new PathPolicy([root]),
      new AuditLogger(auditFile),
      backend,
      true,
      "project",
      ["node"],
      { commandTimeoutMs: 5_000 },
    );

    const result = await service.run("node", ["-e", argumentCanary], root, 1_000);
    expect(result.stdout).toContain(outputCanary);

    const audit = await readFile(auditFile, "utf8");
    expect(audit).toContain('"action":"project.exec"');
    expect(audit).toContain('"command":"node"');
    expect(audit).toContain('"argCount":2');
    expect(audit).toContain('"backend":"docker"');
    expect(audit).not.toContain(argumentCanary);
    expect(audit).not.toContain(outputCanary);
  });
});
