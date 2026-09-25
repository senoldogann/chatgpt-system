import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLogger } from "../src/core/audit.js";
import { ConflictError } from "../src/core/errors.js";
import { FileSystemService } from "../src/fs/fs-service.js";
import { PathPolicy } from "../src/core/policy.js";

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
  it("classifies a missing path as NOT_FOUND instead of an internal error", async () => {
    const { service } = await fixture();
    await expect(service.stat("missing.txt")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns metadata and the SHA-256 for an existing file", async () => {
    const { service } = await fixture();
    const created = await service.write("present.txt", "present");
    await expect(service.stat("present.txt")).resolves.toMatchObject({
      type: "file",
      size: 7,
      sha256: created.sha256,
    });
  });

  it("preserves the policy denial for a path outside the allowed root", async () => {
    const { base, service } = await fixture();
    await expect(service.stat(path.join(base, "outside.txt"))).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

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

  it("rejects structurally malformed patch text with a typed error instead of a silent no-op", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "hello\n");
    const sha = first.sha256 as string;
    // Yedekli @@ satır sayıları artık normalize ediliyor, bu yüzden burada
    // yer almıyor; yapısal olarak bozuk girdi hâlâ fail-closed olmalı.
    const malformed = [
      "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-hello\n+world\n--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-a\n+b\n",
      "this is not a unified diff",
      "",
    ];
    for (const patchText of malformed) {
      await expect(service.patch("hello.txt", patchText, sha)).rejects.toMatchObject({ code: "PATCH_INVALID" });
    }

    const read = await service.read("hello.txt");
    expect(read.content).toBe("hello\n");
    expect(read.sha256).toBe(sha);
  });

  it("requires the current hash before removing a file", async () => {
    const { service } = await fixture();
    const created = await service.write("hello.txt", "hello");
    await expect(service.remove("hello.txt")).rejects.toBeInstanceOf(ConflictError);
    await expect(service.remove("hello.txt", created.sha256 as string)).resolves.toMatchObject({ removed: true });
  });
  it("applies a patch whose hunk header line counts are inaccurate and reports the normalization", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "alpha\nbeta\ngamma\n");
    // Model üretimi diff'lerde en sık hata: @@ başlığındaki satır sayıları
    // gövdeyle uyuşmuyor. Sayılar gövdeden türetilebilir yedekli meta veridir.
    const patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,9 +1,9 @@\n alpha\n-beta\n+BETA\n gamma\n";
    const result = await service.patch("hello.txt", patch, first.sha256 as string);
    expect(result.normalizedHunkHeaders).toBe(true);
    const read = await service.read("hello.txt");
    expect(read.content).toBe("alpha\nBETA\ngamma\n");
  });

  it("reports an unchanged patch as not normalized", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "alpha\nbeta\ngamma\n");
    const patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n";
    const result = await service.patch("hello.txt", patch, first.sha256 as string);
    expect(result.normalizedHunkHeaders).toBe(false);
  });

  it("rejects a malformed patch with an actionable typed error instead of an internal error", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "alpha\nbeta\ngamma\n");
    const patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,3 +1,3 @@\n alpha\n?beta\n gamma\n";
    await expect(service.patch("hello.txt", patch, first.sha256 as string)).rejects.toMatchObject({
      code: "PATCH_INVALID",
      details: { reason: "invalid_hunk_line" },
    });
  });

  it("rejects a multi-file patch with an actionable typed error", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "alpha\n");
    const patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n"
      + "--- a/other.txt\n+++ b/other.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n";
    await expect(service.patch("hello.txt", patch, first.sha256 as string)).rejects.toMatchObject({
      code: "PATCH_INVALID",
      details: { reason: "multiple_files" },
    });
  });

  it("keeps a context mismatch as a conflict with the recommended recovery", async () => {
    const { service } = await fixture();
    const first = await service.write("hello.txt", "alpha\nbeta\ngamma\n");
    const patch = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,3 +1,3 @@\n alpha\n-NOPE\n+BETA\n gamma\n";
    await expect(service.patch("hello.txt", patch, first.sha256 as string)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { recommendedOperations: ["fs_read", "fs_write"] },
    });
  });
});

describe("FileSystemService IDE editing", () => {
  it("reads a 1-based line range while hashing the whole file", async () => {
    const { service } = await fixture();
    const written = await service.write("lines.txt", "one\ntwo\nthree\nfour\n");
    const range = await service.read("lines.txt", "utf8", { offset: 2, limit: 2 });
    expect(range).toMatchObject({
      content: "two\nthree",
      sha256: written.sha256,
      range: { startLine: 2, endLine: 3, totalLines: 4 },
    });
    await expect(service.read("lines.txt", "utf8", { offset: 4 })).resolves.toMatchObject({
      content: "four",
      range: { startLine: 4, endLine: 4, totalLines: 4 },
    });
    await expect(service.read("lines.txt", "utf8", { offset: 9 })).resolves.toMatchObject({
      content: "",
      range: { startLine: 9, endLine: 8, totalLines: 4 },
    });
    await expect(service.read("lines.txt", "base64", { offset: 1 })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    const whole = await service.read("lines.txt");
    expect(whole).not.toHaveProperty("range");
  });

  it("replaces one exact unique occurrence and returns the new hash", async () => {
    const { root, service } = await fixture();
    const written = await service.write("app.ts", "const a = 1;\nconst b = 2;\n");
    const edited = await service.edit("app.ts", "const b = 2;", "const b = 3;", { expectedSha256: written.sha256 as string });
    expect(edited).toMatchObject({ replacements: 1, previousSha256: written.sha256 });
    expect(await readFile(path.join(root, "app.ts"), "utf8")).toBe("const a = 1;\nconst b = 3;\n");
    expect(edited.sha256).not.toBe(written.sha256);
  });

  it("treats replacement text literally, including $ patterns", async () => {
    const { root, service } = await fixture();
    await service.write("price.txt", "price: X\n");
    await service.edit("price.txt", "X", "$& and $1");
    expect(await readFile(path.join(root, "price.txt"), "utf8")).toBe("price: $& and $1\n");
  });

  it("refuses ambiguous, missing and no-op edits without writing", async () => {
    const { root, service } = await fixture();
    await service.write("dup.txt", "x\nx\n");
    await expect(service.edit("dup.txt", "x", "y")).rejects.toMatchObject({ code: "CONFLICT", details: expect.objectContaining({ matches: 2 }) });
    await expect(service.edit("dup.txt", "zzz", "y")).rejects.toBeInstanceOf(ConflictError);
    await expect(service.edit("dup.txt", "x", "x")).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(service.edit("missing.txt", "x", "y")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await readFile(path.join(root, "dup.txt"), "utf8")).toBe("x\nx\n");

    const all = await service.edit("dup.txt", "x", "y", { replaceAll: true });
    expect(all).toMatchObject({ replacements: 2 });
    expect(await readFile(path.join(root, "dup.txt"), "utf8")).toBe("y\ny\n");
  });

  it("rejects a stale expectedSha256", async () => {
    const { service } = await fixture();
    await service.write("stale.txt", "before\n");
    await expect(service.edit("stale.txt", "before", "after", { expectedSha256: "0".repeat(64) }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it("matches LF oldString against CRLF files and keeps CRLF line endings", async () => {
    const { root, service } = await fixture();
    await service.write("crlf.txt", "first\r\nsecond\r\nthird\r\n");
    await service.edit("crlf.txt", "first\nsecond", "first\nchanged");
    expect(await readFile(path.join(root, "crlf.txt"), "utf8")).toBe("first\r\nchanged\r\nthird\r\n");
  });
});

describe("FileSystemService batch reads", () => {
  it("reads several files with per-file ranges and per-file errors", async () => {
    const { service } = await fixture();
    const a = await service.write("a.txt", "one\ntwo\nthree\n");
    await service.write("b.txt", "bee\n");
    await service.makeDirectory("dir");
    const result = await service.readMany([
      { path: "a.txt", offset: 2, limit: 1 },
      { path: "missing.txt" },
      { path: "b.txt" },
      { path: "dir" },
    ]);
    const files = result.files as Array<Record<string, unknown>>;
    expect(files[0]).toMatchObject({ path: "a.txt", content: "two", sha256: a.sha256, range: { totalLines: 3 } });
    expect(files[1]).toEqual({ path: "missing.txt", error: "NOT_FOUND", message: "File does not exist." });
    expect(files[2]).toMatchObject({ path: "b.txt", content: "bee\n" });
    expect(files[3]).toMatchObject({ path: "dir", error: "POLICY_DENIED" });
  });

  it("bounds the batch by file count and total returned bytes", async () => {
    const { base, root } = await fixture();
    const small = new FileSystemService(new PathPolicy([root]), new AuditLogger(path.join(base, "small-audit.jsonl")), {
      maxReadBytes: 10,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 5_000,
    });
    await small.write("x.txt", "123456");
    await small.write("y.txt", "abcdef");
    const result = await small.readMany([{ path: "x.txt" }, { path: "y.txt" }]);
    const files = result.files as Array<Record<string, unknown>>;
    expect(files[0]).toMatchObject({ content: "123456" });
    expect(files[1]).toMatchObject({ path: "y.txt", error: "LIMIT_EXCEEDED" });
    await expect(small.readMany([])).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(small.readMany(Array.from({ length: 21 }, () => ({ path: "x.txt" })))).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });
});
