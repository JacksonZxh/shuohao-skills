import { describe, expect, it } from "vitest";
import { createId } from "../src/ids";
import {
  assertContentTypeMatchesExtension,
  documentObjectKey,
  mediaObjectKey,
  novelObjectKey,
  ObjectKeyError,
  stagedImportObjectKey,
} from "../src/r2-keys";

const SHA = "a".repeat(64);

describe("R2 对象键", () => {
  it("按内容哈希生成键，并且不接纳本机路径", () => {
    const projectId = createId();
    const key = novelObjectKey(projectId, SHA);
    expect(key).toBe(`projects/${projectId}/novels/${SHA}.bin`);
    expect(novelObjectKey(projectId, SHA)).toBe(key);
    expect(key).not.toContain("\\");
    expect(key).not.toContain("/Users");

    expect(() => novelObjectKey("/Users/demo/novel.txt", SHA)).toThrow(ObjectKeyError);
    expect(() => documentObjectKey(projectId, "../novel-outline", SHA)).toThrow(ObjectKeyError);
    expect(() => mediaObjectKey(projectId, createId(), 1, SHA, "exe")).toThrow(ObjectKeyError);
    expect(() => assertContentTypeMatchesExtension("png", "text/plain")).toThrow(ObjectKeyError);
  });

  it("暂存键使用导入运行 ID，而不是本机源路径", () => {
    const projectId = createId();
    const importRunId = createId();
    const key = stagedImportObjectKey(projectId, importRunId, SHA, "png");
    expect(key).toBe(
      `projects/${projectId}/imports/${importRunId}/staged/${SHA}.png`,
    );
    expect(key.includes("C:")).toBe(false);
  });
});
