import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import outline from "../../../../docs/acceptance/pr2/baseline/outline.json";
import cast from "../../../../docs/acceptance/pr2/baseline/cast.json";
import art from "../../../../docs/acceptance/pr2/baseline/art.json";
import duplicate from "../../../../docs/acceptance/pr2/variants/cast-duplicate-code.json";
import importance from "../../../../docs/acceptance/pr2/variants/cast-invalid-importance.json";
import ambiguous from "../../../../docs/acceptance/pr2/variants/cast-ambiguous-alias.json";
import conflict from "../../../../docs/acceptance/pr2/variants/cast-name-conflict.json";
import dangling from "../../../../docs/acceptance/pr2/variants/outline-dangling-reference.json";
import variant from "../../../../docs/acceptance/pr2/variants/art-invalid-variant.json";
import partial from "../../../../docs/acceptance/pr2/variants/art-new-valid-then-invalid.json";
import edited from "../../../../docs/acceptance/pr2/variants/cast-edited.json";
import reordered from "../../../../docs/acceptance/pr2/variants/cast-reordered.json";
import noCodes from "../../../../docs/acceptance/pr2/variants/cast-without-codes.json";
import { handleProjectApi } from "../../src/platform/http";
import { ProjectRepository } from "../../src/platform/repository";
import { Operator } from "../../src/platform/auth";
import { planLibraryImport } from "../../src/library/plan";
import { exportLibraryDocument } from "../../src/library/export";
import type { InputDocument, Skill } from "../../src/contracts/import";
const token="acceptance-token-0000000000000000000000000000";
const document=(skill:Skill,value:unknown):InputDocument=>({skill,raw:JSON.stringify(value)});
const all=[document("novel-outline",outline),document("novel-characters",cast),document("novel-art",art)];
async function setup() {
  const operator=await Operator.authenticate(new Request("https://test/api/projects",{headers:{authorization:`Bearer ${token}`}}),token);
  const repo=new ProjectRepository(env.DB,env.MEDIA,operator);
  const project=await repo.createProject({name:"停钟档案验收"});
  return {repo,id:project.id};
}
describe("PR2 独立样例在实际 D1/R2 上验收",()=>{
  it("P2-01/02 完整导入、跨文稿 UUID、别名关联和幂等",async()=>{
    const {repo,id}=await setup();
    const committed=await repo.importDocuments(id,all,planLibraryImport);
    const snapshot=await repo.snapshot(id);
    expect(snapshot.entities.character).toHaveLength(2);
    expect(snapshot.entities.scene).toHaveLength(2);
    expect(snapshot.entities.prop).toHaveLength(1);
    expect(snapshot.entities.episode).toHaveLength(3);
    expect(snapshot.entities.carrier[0]).toMatchObject({character_id:snapshot.entities.character.find(c=>c.display_code==="C01")!.id,source_code:"小苏"});
    expect(snapshot.entities.character.find(c=>c.display_code==="C02")).toMatchObject({outline_tier:"lead",cast_importance:"major"});
    expect(await repo.importDocuments(id,all,planLibraryImport)).toEqual({...committed,status:"idempotent_hit"});
    expect(await repo.snapshot(id)).toEqual(snapshot);
  });
  for (const [caseId,skill,value] of [
    ["P2-05","novel-characters",duplicate],["P2-06","novel-characters",importance],
    ["P2-07","novel-outline",dangling],["P2-08","novel-art",variant],
    ["P2-09","novel-art",partial],["P2-10","novel-characters",conflict],
  ] as const) it(`${caseId} 冲突整包回滚`,async()=>{
    const {repo,id}=await setup();await repo.importDocuments(id,all,planLibraryImport);
    const before=await repo.snapshot(id);
    await expect(repo.importDocuments(id,[document(skill,value)],planLibraryImport,{mode:"update",expectedRevision:1})).rejects.toMatchObject({status:422});
    expect(await repo.snapshot(id)).toEqual(before);
  });
  it("P2-11 别名歧义不能激活任何文稿",async()=>{
    const {repo,id}=await setup();
    await expect(repo.importDocuments(id,[all[0]!,document("novel-characters",ambiguous),all[2]!],planLibraryImport)).rejects.toMatchObject({status:422});
    expect((await repo.snapshot(id)).revision).toBe(0);
  });
  for (const [label,value] of [["P2-12",cast],["P2-13",noCodes]] as const) it(`${label} 角色先导入再关联大纲`,async()=>{
    const {repo,id}=await setup();await repo.importDocuments(id,[document("novel-characters",value)],planLibraryImport);
    const before=await repo.snapshot(id);
    await repo.importDocuments(id,[all[0]!,all[2]!],planLibraryImport);
    const after=await repo.snapshot(id);
    expect(after.entities.character.map(c=>c.id).sort()).toEqual(before.entities.character.map(c=>c.id).sort());
    expect(after.entities.character).toHaveLength(2);
  });
  it("P2-03/04/16 更新及排序保持身份，历史原文不可变",async()=>{
    const {repo,id}=await setup();const first=await repo.importDocuments(id,all,planLibraryImport);
    const before=await repo.snapshot(id);
    await repo.importDocuments(id,[document("novel-characters",edited)],planLibraryImport,{mode:"update",expectedRevision:1});
    const updated=await repo.snapshot(id);
    expect(updated.entities.character.map(c=>c.id)).toEqual(before.entities.character.map(c=>c.id));
    expect(exportLibraryDocument(updated,"novel-characters").characters).toEqual(edited.characters);
    const original=before.documents.find(d=>d.skill==="novel-characters")!;
    expect(await repo.readRaw(id,original.id)).toBe(all[1]!.raw);
    await repo.importDocuments(id,[document("novel-characters",reordered)],planLibraryImport,{mode:"update",expectedRevision:2});
    expect((await repo.snapshot(id)).entities.character.map(c=>c.id)).toEqual(before.entities.character.map(c=>c.id));
    expect(first.revision).toBe(1);
  });
  it("P2-14 同显示码在不同项目独立，跨项目原文不可读",async()=>{
    const a=await setup(),b=await setup();await a.repo.importDocuments(a.id,all,planLibraryImport);await b.repo.importDocuments(b.id,all,planLibraryImport);
    const as=await a.repo.snapshot(a.id),bs=await b.repo.snapshot(b.id);
    expect(as.entities.character[0]!.id).not.toBe(bs.entities.character[0]!.id);
    await expect(a.repo.readRaw(a.id,bs.documents[0]!.id)).rejects.toMatchObject({status:404});
  });
  it("P2-15 导出保留扩展和原字符串，可导入新项目",async()=>{
    const a=await setup();await a.repo.importDocuments(a.id,all,planLibraryImport);
    const snapshot=await a.repo.snapshot(a.id);
    for (const input of all) expect(exportLibraryDocument(snapshot,input.skill)).toEqual(JSON.parse(input.raw));
    const b=await setup();await b.repo.importDocuments(b.id,all.map(input=>document(input.skill,exportLibraryDocument(snapshot,input.skill))),planLibraryImport);
    expect((await b.repo.snapshot(b.id)).entities.episode_link).toHaveLength(snapshot.entities.episode_link.length);
  });
});

describe("PR2 编辑与对象恢复",()=>{
  it("P2-15 角色编辑 API 实际持久化，旧修订拒绝",async()=>{
    const {repo,id}=await setup();await repo.importDocuments(id,all,planLibraryImport);
    const before=await repo.snapshot(id),character=before.entities.character.find(c=>c.display_code==="C01")!;
    const call=(revision:number)=>handleProjectApi(new Request(`https://test/api/projects/${id}/characters/${character.id}`,{method:"PATCH",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({oneLiner:"馆员改为先复核时间，再质疑签名。",expectedRevision:revision})}),{...env,WORKBENCH_TOKEN:token},planLibraryImport);
    const response=await call(1);expect(await response.json()).toMatchObject({ok:true,revision:2});
    const current=await repo.snapshot(id);
    expect(current.entities.character.find(c=>c.id===character.id)?.one_liner).toBe("馆员改为先复核时间，再质疑签名。");
    expect((await call(1)).status).toBe(409);
    expect(await repo.readRaw(id,before.documents.find(d=>d.skill==="novel-characters")!.id)).toBe(all[1]!.raw);
  });
  it("P2-17 未鉴权导入没有审计或对象写入",async()=>{
    const {repo,id}=await setup();
    for(const auth of [undefined,"invalid-test-token"]) {
      const headers:Record<string,string>={"content-type":"application/json"};if(auth) headers.authorization=`Bearer ${auth}`;
      const response=await handleProjectApi(new Request(`https://test/api/projects/${id}/imports`,{method:"POST",headers,body:JSON.stringify({documents:all})}),{...env,WORKBENCH_TOKEN:token},planLibraryImport);
      expect(response.status).toBe(401);
    }
    expect((await repo.snapshot(id)).revision).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM import_runs WHERE project_id=?").bind(id).first()).toEqual({n:0});
    expect((await env.MEDIA.list({prefix:`projects/${id}/`})).objects).toHaveLength(0);
  });
  for(const target of [262143,262144,262145]) it(`P2-18 UTF-8 ${target} 字节保全`,async()=>{
    const {repo,id}=await setup();const value={...cast,padding:""};
    const remaining=target-new TextEncoder().encode(JSON.stringify(value)).byteLength;
    value.padding="汉".repeat(Math.floor(remaining/3))+"x".repeat(remaining%3);
    const input=document("novel-characters",value);expect(new TextEncoder().encode(input.raw).byteLength).toBe(target);
    const result=await repo.importDocuments(id,[input],planLibraryImport);
    expect(await repo.readRaw(id,result.documentIds[0]!)).toBe(input.raw);
    expect(exportLibraryDocument(await repo.snapshot(id),"novel-characters").padding).toBe(value.padding);
    const blob=await env.DB.prepare("SELECT raw_json,r2_key FROM document_blobs WHERE id=?").bind(result.documentIds[0]).first();
    expect(blob?.r2_key===null).toBe(target<=262144);
  });
  it("P2-19 真实规划器 R2 成功/D1 失败后复用对象",async()=>{
    let batches=0;
    const db=new Proxy(env.DB,{get(target,key){if(key==="batch")return async <T>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]>=>{if(++batches===2)throw new Error("injected finalize failure");return target.batch<T>(statements);};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
    const operator=await Operator.authenticate(new Request("https://test",{headers:{authorization:`Bearer ${token}`}}),token);
    const repo=new ProjectRepository(db,env.MEDIA,operator),project=await repo.createProject({name:"恢复验收"});
    const input=document("novel-characters",{...cast,padding:"汉".repeat(100000)});
    await expect(repo.importDocuments(project.id,[input],planLibraryImport)).rejects.toMatchObject({code:"commit_rejected"});
    expect((await repo.snapshot(project.id)).revision).toBe(0);
    expect((await env.MEDIA.list({prefix:`projects/${project.id}/`})).objects).toHaveLength(1);
    const result=await repo.importDocuments(project.id,[input],planLibraryImport);
    expect(result.revision).toBe(1);expect((await repo.snapshot(project.id)).entities.character).toHaveLength(2);
    expect((await env.MEDIA.list({prefix:`projects/${project.id}/`})).objects).toHaveLength(1);
    expect(await repo.reconcile(project.id)).toMatchObject({ready:1,unavailable:0});
  });
});
