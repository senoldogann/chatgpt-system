import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readSecurityPolicy(): Promise<string> {
  return readFile(new URL("../SECURITY.md", import.meta.url), "utf8");
}

describe("Jev semantic targeting egress documentation", () => {
  it("declares the third-party boundary in the trust model", async () => {
    const policy = await readSecurityPolicy();
    expect(policy).toMatch(/## .*Jev .*boundary/i);
    expect(policy).toContain("api.typesafe.ai");
    expect(policy).toMatch(/third[- ]party/i);
  });

  it("states exactly what leaves the Mac and what does not", async () => {
    const policy = await readSecurityPolicy();
    // Gönderilen: odaklı pencerenin AX ağacı ve kullanıcının talimatı.
    expect(policy).toMatch(/accessibility|AX/i);
    expect(policy).toMatch(/window title/i);
    expect(policy).toMatch(/instruction/i);
    // Gönderilmeyen: ekran görüntüsü, OCR metni, yazılan metin, dosya içeriği, lease.
    expect(policy).toMatch(/screenshot/i);
    expect(policy).toMatch(/lease/i);
  });

  it("states that the capability is off by default and fails closed", async () => {
    const policy = await readSecurityPolicy();
    expect(policy).toContain("--enable-jev-targeting");
    expect(policy).toContain("TYPESAFE_API_KEY");
    expect(policy).toMatch(/disabled by default|off by default/i);
    expect(policy).toMatch(/fails? closed|JEV_TARGETING_UNAVAILABLE/);
  });

  it("states that it is read-only and carries no authority", async () => {
    const policy = await readSecurityPolicy();
    expect(policy).toMatch(/read-only/i);
    expect(policy).toMatch(/never clicks|no authority|carries no authority/i);
  });
});
