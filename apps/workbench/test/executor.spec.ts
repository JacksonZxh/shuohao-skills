import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const TOKEN = "executor-test-token-not-a-real-secret";

async function post(
  url: string,
  runtime: Env,
  headers?: HeadersInit,
): Promise<Response> {
  const request = new IncomingRequest(url, { method: "POST", headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, runtime, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("执行器鉴权占位", () => {
  it("没有密钥时拒绝心跳", async () => {
    const response = await post(
      "http://example.com/api/executor/heartbeat",
      { ...env, EXECUTOR_TOKEN: "" },
    );
    expect(response.status).toBe(503);
    const body = await response.json<{ error: { code: string; missing?: string[] } }>();
    expect(body.error.code).toBe("config_missing");
    expect(body.error.missing).toContain("EXECUTOR_TOKEN");
  });

  it("错误令牌返回未授权，并且响应里没有令牌", async () => {
    const response = await post(
      "http://example.com/api/executor/heartbeat",
      { ...env, EXECUTOR_TOKEN: TOKEN },
      { authorization: "Bearer wrong-token" },
    );
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain("未通过鉴权");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("wrong-token");
  });

  it("网址里的令牌会被拒绝，即使请求头也带着正确令牌", async () => {
    const response = await post(
      `http://example.com/api/executor/heartbeat?token=${TOKEN}`,
      { ...env, EXECUTOR_TOKEN: TOKEN },
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain("不能放在网址里");
    expect(text).not.toContain(TOKEN);
  });

  it("鉴权通过后仍然没有执行器实现，也不写数据库", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects").first<{ n: number }>();
    const response = await post(
      "http://example.com/api/executor/heartbeat",
      { ...env, EXECUTOR_TOKEN: TOKEN },
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(response.status).toBe(501);
    const body = await response.json<{ error: { code: string; feature: string; message: string } }>();
    expect(body.error).toMatchObject({ code: "not_implemented", feature: "executor" });
    expect(body.error.message).toContain("尚未实现");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});
