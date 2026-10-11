import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleProjectApi } from "../../src/platform/http";
import { Operator } from "../../src/platform/auth";
import type { ImportPlanner } from "../../src/contracts/import";
import worker from "../../src/index";

const TOKEN = "fixture-platform-http-token-0000000000000000000";
const runtime = () => ({ ...env, WORKBENCH_TOKEN: TOKEN });
function request(path: string, body?: unknown, token: string | null = TOKEN) {
  return new Request(`https://test${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    ...(token === null ? {} : { authorization: `Bearer ${token}` }), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("平台HTTP鉴权与边界", () => {
  it("真实Worker入口注册平台路由并先鉴权", async () => {
    const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
    const denied = new IncomingRequest("https://test/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"不能创建"}' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(denied, runtime(), ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401); expect(denied.bodyUsed).toBe(false);
    const allowed = new IncomingRequest("https://test/api/projects", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: '{"name":"入口验证"}' });
    const next = createExecutionContext();
    const created = await worker.fetch(allowed, runtime(), next);
    await waitOnExecutionContext(next);
    expect(created.status).toBe(201);
  });
  it("无/错令牌不消费正文、不写数据库或R2；URL和执行器令牌不能绕过", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects").first<{ n: number }>();
    for (const token of [null, "wrong", "executor-test-token"]) {
      const input = request("/api/projects", { name: "不应写入" }, token);
      const response = await handleProjectApi(input, runtime());
      expect(response.status).toBe(401);
      expect(input.bodyUsed).toBe(false);
      expect(await response.text()).not.toContain(TOKEN);
    }
    const url = request(`/api/projects?Token=${TOKEN}`, { name: "不应写入" });
    expect((await handleProjectApi(url, runtime())).status).toBe(401);
    expect(url.bodyUsed).toBe(false);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM projects").first())?.n).toBe(before?.n);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM import_runs").first())?.n).toBe(0);
    expect((await env.MEDIA.list()).objects).toHaveLength(0);
  });
  it("缺/过短配置拒绝，正确令牌可创建与读取项目", async () => {
    await expect(Operator.authenticate(request("/api/projects"), "")).rejects.toMatchObject({ code: "auth_unconfigured" });
    await expect(Operator.authenticate(request("/api/projects"), "short")).rejects.toMatchObject({ code: "auth_unconfigured" });
    const created = await handleProjectApi(request("/api/projects", { name: "平台项目", lang: "zh" }), runtime());
    expect(created.status).toBe(201);
    const project = await created.json<{ id: string; revision: number }>();
    expect(project.revision).toBe(0);
    const listed = await handleProjectApi(request("/api/projects"), runtime());
    expect(listed.status).toBe(200);
    const list = await listed.json<{ projects: Array<{ id: string; name: string }> }>();
    expect(list.projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, name: "平台项目" })]));
    const snapshot = await handleProjectApi(request(`/api/projects/${project.id}/snapshot`), runtime());
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ snapshot: { revision: 0, documents: [] } });
    const missing = await handleProjectApi(request("/api/projects/00000000-0000-4000-8000-00000000abcd/snapshot"), runtime());
    expect(missing.status).toBe(404);
  });
  it("默认入口适配器未接入就501，注入服务端规划后真实提交", async () => {
    const project = await (await handleProjectApi(request("/api/projects", { name: "接入" }), runtime())).json<{ id: string }>();
    const body = { documents: [{ skill: "novel-characters", raw: '{"test":true}' }], expectedRevision: 0 };
    const pending = request(`/api/projects/${project.id}/imports`, body);
    expect((await handleProjectApi(pending, runtime())).status).toBe(501);
    expect(pending.bodyUsed).toBe(false);
    const planner: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: {
      expectedRevision: snapshot.revision, writes: [{ kind: "character", id: allocateId(), values: { name: "接入人物", sort_order: 0 } }],
      removals: [], identities: [], warnings: [] } });
    const result = await handleProjectApi(request(`/api/projects/${project.id}/imports`, body), runtime(), planner);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ status: "committed", revision: 1 });
    const arbitrary = await handleProjectApi(request(`/api/projects/${project.id}/imports`, { ...body, plan: "DROP TABLE" }), runtime(), planner);
    expect(arbitrary.status).toBe(422);
  });
  it("不接受非法字段/方法/内容类型，数据库异常不泄漏SQL", async () => {
    expect((await handleProjectApi(request("/api/projects", { name: "合法", path: "/tmp/private" }), runtime())).status).toBe(422);
    expect((await handleProjectApi(new Request("https://test/api/projects", { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }), runtime())).status).toBe(405);
    expect((await handleProjectApi(new Request("https://test/api/projects", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" }), runtime())).status).toBe(415);
    const failingDb = new Proxy(env.DB, { get(target, key) { if (key === "prepare") throw new Error("private SQL and credentials"); return Reflect.get(target, key, target); } });
    const failure = await handleProjectApi(request("/api/projects"), { ...runtime(), DB: failingDb });
    expect(failure.status).toBe(503);
    const text = await failure.text();
    expect(text).not.toContain("private SQL"); expect(text).not.toContain(TOKEN);
  });
});
