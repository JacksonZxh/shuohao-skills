import { describe, expect, it } from "vitest";
import { RAW_JSON_R2_THRESHOLD_BYTES, D1_MAX_ROW_BYTES } from "../src/constants";
import { inspectConfig, type RuntimeConfigInput } from "../src/config";
import { describeGateway } from "../src/gateway";
import { createId, isUuidV4 } from "../src/ids";
import { isEpochMs, nowEpochMs } from "../src/time";

function baseEnv(overrides: Partial<RuntimeConfigInput> = {}): RuntimeConfigInput {
  return {
    DB: { prepare() {} },
    MEDIA: {
      async head() {
        return null;
      },
      async get() {
        return null;
      },
    },
    ASSETS: {
      async fetch() {
        return new Response("ok");
      },
    },
    APP_ENV: "local",
    MEDIA_PUBLIC: "false",
    REMOTE_RESOURCES: "unprovisioned",
    D1_DATABASE_NAME: "shuohao-workbench-local",
    D1_DATABASE_ID: "00000000-0000-4000-8000-0000000000a1",
    R2_BUCKET_NAME: "shuohao-workbench-local",
    AI_GATEWAY_BASE_URL: "",
    AI_GATEWAY_ACCOUNT_ID: "",
    AI_GATEWAY_GATEWAY_ID: "",
    ...overrides,
  };
}

describe("环境配置", () => {
  it("本地占位配置可以启动，并声明尚未部署", () => {
    const report = inspectConfig(baseEnv());
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.deploymentRemote).toBe("not_deployed");
    expect(report.mediaPublic).toBe(false);
    expect(report.gateway.status).toBe("unverified");
    expect(report.gateway.calls).toBe("not_implemented");
  });

  it("把本地库名换成 production 时失败", () => {
    const report = inspectConfig(
      baseEnv({
        D1_DATABASE_NAME: "shuohao-workbench-production",
        D1_DATABASE_ID: "00000000-0000-4000-8000-0000000000a3",
        R2_BUCKET_NAME: "shuohao-workbench-production",
      }),
    );
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.code).toBe("config_invalid");
    expect(report.invalid.map((item) => item.field)).toContain("D1_DATABASE_NAME");
  });

  it("公开媒体开关会被拒绝", () => {
    const report = inspectConfig(baseEnv({ MEDIA_PUBLIC: "true" }));
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.invalid.some((item) => item.field === "MEDIA_PUBLIC")).toBe(true);
    expect(report.message).toContain("拒绝");
  });

  it("缺少媒体桶时列出缺失项", () => {
    const report = inspectConfig(baseEnv({ MEDIA: undefined }));
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.code).toBe("config_missing");
    expect(report.missing).toContain("MEDIA");
  });

  it("填写了网关字段仍然是未验证，并且不会发起请求", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("should-not-be-called");
    }) as typeof fetch;
    try {
      const report = describeGateway({
        baseUrl: "https://gateway.example.invalid",
        accountId: "account",
        gatewayId: "gateway",
      });
      expect(report).toMatchObject({
        status: "unverified",
        calls: "not_implemented",
        configured: true,
        verifiedAt: null,
      });
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("使用 UUID v4 和 epoch 毫秒", () => {
    const first = createId();
    const second = createId();
    expect(isUuidV4(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(isEpochMs(nowEpochMs())).toBe(true);
    expect(RAW_JSON_R2_THRESHOLD_BYTES).toBe(256 * 1024);
    expect(D1_MAX_ROW_BYTES).toBe(2_000_000);
    expect(RAW_JSON_R2_THRESHOLD_BYTES).toBeLessThan(D1_MAX_ROW_BYTES);
  });
});
