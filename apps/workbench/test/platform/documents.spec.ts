import { describe, expect, it } from "vitest";
import { prepareDocuments, rawNeedsR2 } from "../../src/platform/documents";

describe("原文字节与语义指纹", () => {
  it("格式差异语义幂等，原字节哈希仍不同", async () => {
    const first = (await prepareDocuments([{ skill: "novel-art", raw: '{"a":0,"b":[false,null,"中文"]}' }]))[0]!;
    const second = (await prepareDocuments([{ skill: "novel-art", raw: '{ "b": [false,null,"中文"], "a": 0 }' }]))[0]!;
    expect(first.semanticFingerprint).toBe(second.semanticFingerprint);
    expect(first.byteSha256).not.toBe(second.byteSha256);
    expect(first.raw).not.toBe(second.raw);
  });
  it("UTF-8阈值按原字节判断，恰好256KiB仍内置", async () => {
    for (const size of [262143, 262144, 262145]) {
      const prefix = '{"padding":"', suffix = '"}';
      const remaining = size - new TextEncoder().encode(prefix + suffix).length;
      const raw = prefix + "汉".repeat(Math.floor(remaining / 3)) + "x".repeat(remaining % 3) + suffix;
      const document = (await prepareDocuments([{ skill: "novel-characters", raw }]))[0]!;
      expect(document.byteLength).toBe(size);
      expect(rawNeedsR2(document)).toBe(size > 262144);
      expect(raw.length).toBeLessThan(size);
    }
  });
  it("拒绝无效JSON、重复种类、根数组、深度和大小攻击", async () => {
    await expect(prepareDocuments([{ skill: "novel-art", raw: "{}x" }])).rejects.toMatchObject({ code: "invalid_json" });
    await expect(prepareDocuments([{ skill: "novel-art", raw: "[]" }])).rejects.toMatchObject({ code: "invalid_json" });
    await expect(prepareDocuments([{ skill: "novel-art", raw: '{"n":1e999}' }])).rejects.toMatchObject({ code: "invalid_json" });
    await expect(prepareDocuments([{ skill: "novel-art", raw: '{"x":"\\ud800"}' }])).resolves.toHaveLength(1);
    await expect(prepareDocuments([{ skill: "novel-art", raw: '{"x":"' + '\ud800' + '"}' }])).rejects.toMatchObject({ code: "invalid_utf8" });
    await expect(prepareDocuments([{ skill: "novel-art", raw: "{}" }, { skill: "novel-art", raw: "{}" }])).rejects.toMatchObject({ code: "invalid_package" });
    await expect(prepareDocuments([{ skill: "novel-art", raw: '{"x":' + "[".repeat(110) + "0" + "]".repeat(110) + "}" }])).rejects.toMatchObject({ code: "invalid_json" });
    await expect(prepareDocuments([{ skill: "novel-art", raw: '"' + "x".repeat(2 * 1024 * 1024) + '"' }])).rejects.toMatchObject({ code: "package_too_large" });
  });
});
