import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLogger } from "../src/audit.js";
import { ConflictError } from "../src/errors.js";
import { FileSystemService } from "../src/fs-service.js";
import { PathPolicy } from "../src/policy.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-fs-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const policy = new PathPolicy([root]);
  const audit = new AuditLogger(path.join(base, "audit.jsonl"));
  const service = new FileSystemService(policy, audit, {
    maxReadBytes: 1024 * 1024,
    maxWriteBytes: 1024 * 1024,
    maxDirectoryEntries: 100,
    maxCommandOutputBytes: 1024 * 1024,
    commandTimeoutMs: 5_000,
  });
  return { base, root, service };
}

describe("FileSystemService", () => {
  it("creates a file and returns a content hash", async () => {
    const { root, service } = await fixture();
    const result = await service.write("hello.txt", "hello");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(path.join(root, "hello.txt"), "utf8")).resolves.toBe("hello");
  });

  it("requires the previous hash before replacing an existing file", async () => {
    const { service } = await fixture();
    await service.write("hello.txt", "one");
    await expect(service.write("hello.txt", "two")).rejects.toBeInstanceOf(ConflictError);

    const read = await service.read("hello.txt");
    await expect(service.write("hello.txt", "two", "utf8", read.sha256 as string)).resolves.toMatchObject({ created: false });
  });

  it("rejects stale hashes", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "one");
    await service.write("hello.txt", "two", "utf8", first.sha256 as string);
    await expect(service.write("hello.txt", "three", "utf8", first.sha256 as string)).rejects.toBeInstanceOf(ConflictError);
  });

  it("applies a unified patch only to the expected revision", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "hello\n");
    const patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-hello\n+world\n";
    const result = await service.patch("hello.txt", patch, first.sha256 as string);
    expect(result.sha256).not.toBe(first.sha256);
    const read = await service.read("hello.txt");
    expect(read.content).toBe("world\n");
  });

  it("requires the current hash before removing a file", async () => {
    const { service } = await fixture();
    const created = await service.write("hello.txt", "hello");
    await expect(service.remove("hello.txt")).rejects.toBeInstanceOf(ConflictError);
    await expect(service.remove("hello.txt", created.sha256 as string)).resolves.toMatchObject({ removed: true });
  });
});
