import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createId } from "../../src/ids";

async function project() {
  const id = createId();
  await env.DB.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)").bind(id, "数据库约束", 1700000000000, 1700000000000).run();
  return id;
}
describe("基础约束不能只依赖页面过滤", () => {
  it("直接SQL也拒绝别名跨项目与身份碰撞", async () => {
    const a = await project(), b = await project(), first = createId(), second = createId();
    await env.DB.prepare("INSERT INTO characters(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,0,?,?)").bind(first, a, "甲", 1, 1).run();
    await env.DB.prepare("INSERT INTO characters(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,0,?,?)").bind(second, b, "乙", 1, 1).run();
    await expect(env.DB.prepare("INSERT INTO character_aliases(id,project_id,character_id,alias) VALUES(?,?,?,?)").bind(createId(), a, second, "错项目").run()).rejects.toThrow("project_scope");
    const third = createId();
    await env.DB.prepare("INSERT INTO characters(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,1,?,?)").bind(third, a, "丙", 1, 1).run();
    await expect(env.DB.prepare("INSERT INTO character_aliases(id,project_id,character_id,alias) VALUES(?,?,?,?)").bind(createId(), a, first, "丙").run()).rejects.toThrow("identity_conflict");
    await expect(env.DB.prepare("UPDATE characters SET project_id=? WHERE id=?").bind(b, first).run()).rejects.toThrow("project_scope");
    await expect(env.DB.prepare("INSERT INTO characters(id,project_id,name,sort_order,created_at,updated_at) VALUES(NULL,?,?,0,?,?)").bind(a, "无ID", 1, 1).run()).rejects.toThrow("missing_id");
  });
  it("风格/媒体历史不可更新或删除，当前风格不能引用其他项目", async () => {
    const a = await project(), b = await project(), style = createId(), asset = createId(), media = createId();
    await env.DB.prepare("INSERT INTO style_versions(id,project_id,version,immutable_snapshot_json,created_at) VALUES(?,?,1,'{}',1)").bind(style, a).run();
    await env.DB.prepare("UPDATE projects SET current_style_version_id=? WHERE id=?").bind(style, a).run();
    await expect(env.DB.prepare("UPDATE projects SET current_style_version_id=? WHERE id=?").bind(style, b).run()).rejects.toThrow("project_scope");
    await expect(env.DB.prepare("UPDATE style_versions SET immutable_snapshot_json='[]' WHERE id=?").bind(style).run()).rejects.toThrow("immutable_version");
    await expect(env.DB.prepare("DELETE FROM style_versions WHERE id=?").bind(style).run()).rejects.toThrow("immutable_version");
    await env.DB.prepare("INSERT INTO media_assets(id,project_id,entity_type,entity_id,role,created_at,updated_at) VALUES(?,?,'character',?,'anchor',1,1)").bind(asset, a, createId()).run();
    await env.DB.prepare("INSERT INTO media_versions(id,asset_id,version,look_snapshot_json,style_version_id,created_at) VALUES(?,?,1,'{}',?,1)").bind(media, asset, style).run();
    await expect(env.DB.prepare("UPDATE media_versions SET look_snapshot_json='[]' WHERE id=?").bind(media).run()).rejects.toThrow("immutable_version");
    await expect(env.DB.prepare("DELETE FROM media_versions WHERE id=?").bind(media).run()).rejects.toThrow("immutable_version");
  });
});
