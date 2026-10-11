import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { isEpochMs } from "../src/time";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("健康检查", () => {
  it("返回本地 D1、私有 R2，以及尚未实现的能力", async () => {
    const response = await exports.default.fetch("http://example.com/api/health");
    expect(response.status).toBe(200);
    const body = await response.json<{
      ok: boolean;
      env: string;
      time: number;
      checks: {
        d1: { ok: boolean; schema: string };
        r2: { ok: boolean; public: boolean; read: string };
      };
      resources: { databaseName: string; bucketName: string; databaseId: string };
      deployment: { remote: string };
      features: {
        import: { status: string };
        ai_gateway: { status: string; calls: string; verifiedAt: null };
        executor: { status: string };
      };
    }>();

    expect(body.ok).toBe(true);
    expect(body.env).toBe("local");
    expect(isEpochMs(body.time)).toBe(true);
    expect(body.checks.d1).toMatchObject({ ok: true, schema: "0002_platform_imports" });
    expect(body.checks.r2).toMatchObject({ ok: true, public: false, read: "private" });
    expect(body.resources.databaseName).toBe("shuohao-workbench-local");
    expect(body.resources.bucketName).toBe("shuohao-workbench-local");
    expect(body.resources.databaseName).not.toBe("shuohao-workbench-production");
    expect(body.deployment.remote).toBe("not_deployed");
    expect(body.features.import.status).toBe("not_implemented");
    expect(body.features.ai_gateway.status).toBe("unverified");
    expect(body.features.ai_gateway.calls).toBe("not_implemented");
    expect(body.features.ai_gateway.verifiedAt).toBeNull();
    expect(body.features.executor.status).toBe("not_implemented");
    expect(JSON.stringify(body)).not.toContain("EXECUTOR_TOKEN");
    expect(JSON.stringify(body)).not.toContain("AI_GATEWAY_TOKEN");
  });

  it("静态壳可以读取，并说明尚未实现的部分", async () => {
    const response = await exports.default.fetch("http://example.com/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("烁皓工作台");
    expect(html).toContain("文稿导入");
    expect(html).toContain("AI Gateway");
    expect(html).toContain("本机执行器");
  });

  it("缺少绑定时返回明确的配置错误", async () => {
    const request = new IncomingRequest("http://example.com/api/health");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, { ...env, DB: undefined } as unknown as Env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(503);
    const body = await response.json<{
      ok: boolean;
      error: { code: string; message: string; missing: string[] };
    }>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("config_missing");
    expect(body.error.missing).toContain("DB");
    expect(body.error.message).toContain("配置不完整");
  });
});
