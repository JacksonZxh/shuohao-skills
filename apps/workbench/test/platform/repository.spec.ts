import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createId } from "../../src/ids";
import type { ImportPlanner, InputDocument, EntityWrite } from "../../src/contracts/import";
import { Operator } from "../../src/platform/auth";
import { ProjectRepository } from "../../src/platform/repository";

export const TOKEN = "fixture-platform-token-000000000000000000000000";
const input: InputDocument[] = [{ skill: "novel-characters", raw: '{"characters":[],"extension":{"zero":0,"flag":false,"empty":null}}' }];
async function repository(db: D1Database = env.DB) {
  const operator = await Operator.authenticate(new Request("https://test/api/projects", { headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN);
  return new ProjectRepository(db, env.MEDIA, operator);
}
const single: ImportPlanner = ({ snapshot, allocateId }) => {
  const id = snapshot.identities.find(item => item.sourceKey === "C01")?.entityId ?? allocateId();
  return { status: "planned", plan: { expectedRevision: snapshot.revision,
    writes: [{ kind: "character", id, values: { display_code: "C01", name: "测试人物", sort_order: 0, cast_importance: "protagonist" } }],
    removals: [], identities: [{ skill: "novel-characters", sourceKey: "C01", entityKind: "character", entityId: id }], warnings: [] } };
};
async function count(table: "characters" | "document_blobs" | "import_commits" | "import_runs", projectId: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=?`).bind(projectId).first<{ n: number }>())!.n;
}

describe("平台原子导入", () => {
  it("重复导入复用稳定ID、原文和修订", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "幂等" });
    const first = await repo.importDocuments(project.id, input, single);
    const before = await repo.snapshot(project.id);
    const second = await repo.importDocuments(project.id, input, () => { throw new Error("duplicate must not plan"); });
    expect(second).toEqual({ ...first, status: "idempotent_hit" });
    expect(await repo.snapshot(project.id)).toEqual(before);
    expect(await count("characters", project.id)).toBe(1);
    expect(await count("document_blobs", project.id)).toBe(1);
    expect(await repo.readRaw(project.id, first.documentIds[0]!)).toBe(input[0]!.raw);
  });
  it("显式更新、双轨字段与原文历史，支持再次激活旧内容", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "历史" });
    const first = await repo.importDocuments(project.id, input, single);
    const next: InputDocument[] = [{ skill: "novel-characters", raw: '{"changed":true}' }];
    await expect(repo.importDocuments(project.id, next, single)).rejects.toMatchObject({ code: "document_conflict" });
    await expect(repo.importDocuments(project.id, next, single, { mode: "update" })).rejects.toMatchObject({ code: "revision_required" });
    const patch: ImportPlanner = ctx => {
      const base = single(ctx);
      if (base instanceof Promise || base.status !== "planned") throw new Error("unexpected");
      base.plan.writes[0]!.values = { outline_tier: "lead", one_liner: "修改后" };
      return base;
    };
    const updated = await repo.importDocuments(project.id, next, patch, { mode: "update", expectedRevision: 1 });
    expect(updated.revision).toBe(2);
    expect((await repo.snapshot(project.id)).entities.character[0]).toMatchObject({ cast_importance: "protagonist", outline_tier: "lead", one_liner: "修改后" });
    expect(await repo.readRaw(project.id, first.documentIds[0]!)).toBe(input[0]!.raw);
    expect(await repo.importDocuments(project.id, next, patch, { mode: "update", expectedRevision: 1 })).toMatchObject({ status: "idempotent_hit", revision: 2 });
    const reverted = await repo.importDocuments(project.id, input, single, { mode: "update", expectedRevision: 2 });
    expect(reverted.revision).toBe(3);
    expect(reverted.documentIds).toEqual(first.documentIds);
    expect((await repo.snapshot(project.id)).entities.character).toHaveLength(1);
    expect(await count("document_blobs", project.id)).toBe(2);
    await expect(env.DB.prepare("UPDATE document_blobs SET raw_json='{}' WHERE id=?").bind(first.documentIds[0]).run()).rejects.toThrow("immutable_version");
  });
  it("约束失败整包回滚，R2成功D1失败后幂等恢复", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "恢复" });
    const large: InputDocument[] = [{ skill: "novel-characters", raw: JSON.stringify({ padding: "汉".repeat(100000) }) }];
    let repair = false;
    const planner: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: {
      expectedRevision: snapshot.revision, writes: [
        { kind: "character", id: allocateId(), values: { display_code: "C01", name: "人物甲", sort_order: 0 } },
        { kind: "character", id: allocateId(), values: { display_code: repair ? "C02" : "C01", name: "人物乙", sort_order: 1 } },
      ], removals: [], identities: [], warnings: [] } });
    await expect(repo.importDocuments(project.id, large, planner)).rejects.toMatchObject({ code: "commit_rejected" });
    expect(await count("characters", project.id)).toBe(0);
    expect(await count("document_blobs", project.id)).toBe(0);
    expect(await count("import_commits", project.id)).toBe(0);
    expect((await repo.snapshot(project.id)).revision).toBe(0);
    const staged = await env.DB.prepare("SELECT state,r2_key FROM object_uploads WHERE project_id=?").bind(project.id).first<{ state: string; r2_key: string }>();
    expect(staged?.state).toBe("staged");
    expect((await env.MEDIA.list({ prefix: `projects/${project.id}/` })).objects).toHaveLength(1);
    repair = true;
    const result = await repo.importDocuments(project.id, large, planner);
    expect(result.revision).toBe(1);
    expect(await count("characters", project.id)).toBe(2);
    expect((await env.MEDIA.list({ prefix: `projects/${project.id}/` })).objects).toHaveLength(1);
    expect(await repo.readRaw(project.id, result.documentIds[0]!)).toBe(large[0]!.raw);
    expect(await env.DB.prepare("SELECT state FROM object_uploads WHERE project_id=?").bind(project.id).first()).toMatchObject({ state: "ready" });
  });
  it("规划拒绝只留下失败审计，无业务写入", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "拒绝" });
    await expect(repo.importDocuments(project.id, input, () => ({ status: "rejected", issues: [{ code: "duplicate_alias", path: "characters[1].aliases", message: "别名冲突" }] })))
      .rejects.toMatchObject({ code: "import_conflict" });
    expect(await count("import_runs", project.id)).toBe(1);
    expect(await count("characters", project.id)).toBe(0);
    expect((await env.MEDIA.list({ prefix: `projects/${project.id}/` })).objects).toHaveLength(0);
  });
  it("并发相同包只提交一次，不同包过期规划不提交", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "并发" });
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const planner: ImportPlanner = async ctx => { if (++arrived === 2) release(); await barrier; return single(ctx); };
    const results = await Promise.all([repo.importDocuments(project.id, input, planner), repo.importDocuments(project.id, input, planner)]);
    expect(results.map(result => result.status).sort()).toEqual(["committed", "idempotent_hit"]);
    expect(results[0]!.commitId).toBe(results[1]!.commitId);
    expect(await count("characters", project.id)).toBe(1);
    const other = await repo.createProject({ name: "竞争" });
    arrived = 0;
    let releaseNext!: () => void;
    const nextBarrier = new Promise<void>(resolve => { releaseNext = resolve; });
    const competing: ImportPlanner = async ctx => { if (++arrived === 2) releaseNext(); await nextBarrier; return single(ctx); };
    const attempts = await Promise.allSettled([
      repo.importDocuments(other.id, [{ skill: "novel-characters", raw: '{"v":1}' }], competing),
      repo.importDocuments(other.id, [{ skill: "novel-characters", raw: '{"v":2}' }], competing),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failed = attempts.find(result => result.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toMatchObject({ code: "revision_conflict" });
    expect((await repo.snapshot(other.id)).revision).toBe(1);
  });
  it("跨项目引用和源身份重绑被拒绝，快照/原文按项目读取", async () => {
    const repo = await repository(), a = await repo.createProject({ name: "A" }), b = await repo.createProject({ name: "B" });
    const imported = await repo.importDocuments(b.id, input, single);
    const foreignId = (await repo.snapshot(b.id)).entities.character[0]!.id;
    const alias: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: { expectedRevision: snapshot.revision,
      writes: [{ kind: "alias", id: allocateId(), values: { character_id: foreignId!, alias: "跨项目" } }], removals: [], identities: [], warnings: [] } });
    await expect(repo.importDocuments(a.id, input, alias)).rejects.toMatchObject({ code: "project_scope" });
    await expect(repo.readRaw(a.id, imported.documentIds[0]!)).rejects.toMatchObject({ code: "document_not_found" });
    const changed: ImportPlanner = ({ snapshot, allocateId }) => {
      const id = allocateId();
      return { status: "planned", plan: { expectedRevision: snapshot.revision,
        writes: [{ kind: "character", id, values: { name: "替换人物", sort_order: 1 } }], removals: [],
        identities: [{ skill: "novel-characters", sourceKey: "C01", entityKind: "character", entityId: id }], warnings: [] } };
    };
    await expect(repo.importDocuments(b.id, [{ skill: "novel-characters", raw: '{"v":2}' }], changed, { mode: "update", expectedRevision: 1 })).rejects.toMatchObject({ code: "commit_rejected" });
    expect((await repo.snapshot(b.id)).entities.character).toHaveLength(1);
  });
  it("对象缺失/损坏标记不可用，恢复原字节后可以修复账本", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "对象恢复" });
    const large: InputDocument[] = [{ skill: "novel-characters", raw: JSON.stringify({ x: "汉".repeat(100000) }) }];
    const result = await repo.importDocuments(project.id, large, single);
    const row = await env.DB.prepare("SELECT r2_key FROM object_uploads WHERE project_id=?").bind(project.id).first<{ r2_key: string }>();
    const key = row!.r2_key;
    await env.MEDIA.delete(key);
    expect(await repo.reconcile(project.id)).toMatchObject({ unavailable: 1 });
    expect(await env.DB.prepare("SELECT state FROM object_uploads WHERE project_id=?").bind(project.id).first()).toMatchObject({ state: "unavailable" });
    await expect(repo.readRaw(project.id, result.documentIds[0]!)).rejects.toMatchObject({ code: "raw_unavailable" });
    const retry = await repo.importDocuments(project.id, large, () => { throw new Error("must recover without replanning"); });
    expect(retry).toMatchObject({ status: "idempotent_hit", revision: 1 });
    expect(await repo.reconcile(project.id)).toMatchObject({ ready: 1, unavailable: 0 });
    expect(await repo.readRaw(project.id, result.documentIds[0]!)).toBe(large[0]!.raw);
    await env.MEDIA.put(key, large[0]!.raw.replace('"x"', '"y"'));
    await expect(repo.snapshot(project.id)).rejects.toMatchObject({ code: "raw_integrity" });
  });
  it("原子提交失败可以废弃未引用对象，但不删除字节", async () => {
    let batches = 0;
    const failingDb = new Proxy(env.DB, { get(target, key) {
      if (key === "batch") return async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
        if (++batches === 2) throw new Error("injected outage");
        return target.batch<T>(statements);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const repo = await repository(failingDb), project = await repo.createProject({ name: "暂存" });
    await expect(repo.importDocuments(project.id, [{ skill: "novel-characters", raw: JSON.stringify({ x: "汉".repeat(100000) }) }], single))
      .rejects.toMatchObject({ code: "commit_rejected" });
    expect(await repo.reconcile(project.id, "", Date.now() + 1)).toMatchObject({ abandoned: 1 });
    expect(await repo.reconcile(project.id, "", Date.now() + 1)).toMatchObject({ abandoned: 0 });
    expect((await env.MEDIA.list({ prefix: `projects/${project.id}/` })).objects).toHaveLength(1);
    expect(await count("characters", project.id)).toBe(0);
  });
  it("不允许适配器发SQL字段，拒绝过大规划，变体顺序由平台处理", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "白名单" });
    const malicious: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: { expectedRevision: snapshot.revision,
      writes: [{ kind: "character", id: allocateId(), values: { "name); DROP TABLE projects;--": "bad" } }], removals: [], identities: [], warnings: [] } });
    await expect(repo.importDocuments(project.id, input, malicious)).rejects.toMatchObject({ code: "invalid_plan" });
    const tooLarge: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: { expectedRevision: snapshot.revision,
      writes: Array.from({ length: 121 }, (_, index) => ({ kind: "character", id: allocateId(), values: { name: `过量${index}`, sort_order: index } })),
      removals: [], identities: [], warnings: [] } });
    await expect(repo.importDocuments(project.id, input, tooLarge)).rejects.toMatchObject({ code: "plan_too_large" });
    const parent = createId(), child = createId();
    const scenes: ImportPlanner = ({ snapshot }) => ({ status: "planned", plan: { expectedRevision: snapshot.revision,
      writes: [{ kind: "scene", id: child, values: { name: "派生", sort_order: 1, variant_of_id: parent } },
        { kind: "scene", id: parent, values: { name: "原场景", sort_order: 0, variant_of_id: null } }], removals: [], identities: [], warnings: [] } });
    await repo.importDocuments(project.id, input, scenes);
    expect((await repo.snapshot(project.id)).entities.scene).toHaveLength(2);
  });
  it("同类记录批量绑定，约束100参数并在Free预算内提交", async () => {
    let queries = 0, maxParams = 0;
    const measured = new Proxy(env.DB, { get(target, key) {
      if (key === "batch") return target.batch.bind(target);
      if (key === "prepare") return (sql: string) => {
        queries++;
        maxParams = Math.max(maxParams, (sql.match(/\?/g) ?? []).length);
        return target.prepare(sql);
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const repo = await repository(measured), project = await repo.createProject({ name: "批量" });
    const planner: ImportPlanner = ({ snapshot, allocateId }) => {
      const ids = Array.from({ length: 40 }, allocateId);
      return { status: "planned", plan: { expectedRevision: snapshot.revision,
        writes: ids.map((id,index) => ({ kind: "character", id, values: { name: `批量人物${index}`, sort_order: index } })),
        removals: [], identities: ids.map((entityId,index) => ({ skill: "novel-characters", entityKind: "character", entityId, sourceKey: `C${index}` })), warnings: [] } };
    };
    await repo.importDocuments(project.id, input, planner);
    expect(queries).toBeLessThan(40); expect(maxParams).toBeLessThanOrEqual(100);
    expect(await count("characters", project.id)).toBe(40);
  });
  it("请求预算拒绝在暂存前发生，不能绕过规范化行大小守卫", async () => {
    const repo = await repository(), project = await repo.createProject({ name: "预算" });
    const large: InputDocument[] = [{ skill: "novel-characters", raw: JSON.stringify({ x: "汉".repeat(100000) }) }];
    const fragmented: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: { expectedRevision: snapshot.revision,
      writes: Array.from({ length: 60 }, (_, index): EntityWrite => ({ kind: "character", id: allocateId(), values: index % 2 === 0
        ? { name: `碎片${index}`, sort_order: index, one_liner: "说明" } : { name: `碎片${index}`, sort_order: index, outline_tier: "lead" } })),
      removals: [], identities: [], warnings: [] } });
    await expect(repo.importDocuments(project.id, large, fragmented)).rejects.toMatchObject({ code: "query_budget" });
    expect((await env.MEDIA.list({ prefix: `projects/${project.id}/` })).objects).toHaveLength(0);
    expect(await count("characters", project.id)).toBe(0);
    const giant: ImportPlanner = ({ snapshot, allocateId }) => ({ status: "planned", plan: { expectedRevision: snapshot.revision,
      writes: [{ kind: "character", id: allocateId(), values: { name: "超限", sort_order: 0, one_liner: "汉".repeat(610000) } }], removals: [], identities: [], warnings: [] } });
    await expect(repo.importDocuments(project.id, input, giant)).rejects.toMatchObject({ code: "row_too_large" });
  });
});
