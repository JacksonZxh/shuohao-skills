import { exportLibraryDocument } from "../library/export";
import { json } from "../http";
import { SKILLS, type ImportPlanner, type InputDocument } from "../contracts/import";
import { Operator } from "./auth";
import { PlatformError, platformErrorResponse } from "./errors";
import { MAX_PACKAGE_BYTES } from "./documents";
import { ProjectRepository } from "./repository";

type PlatformEnv = Pick<Env, "DB" | "MEDIA" | "WORKBENCH_TOKEN" | "D1_QUERY_BUDGET">;

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new PlatformError(415, "content_type", "请求需要 application/json。");
  const reader = request.body?.getReader();
  if (!reader) throw new PlatformError(422, "invalid_json", "请求正文为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_PACKAGE_BYTES) { await reader.cancel(); throw new PlatformError(413, "package_too_large", "请求超过大小限制。"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new PlatformError(422, "invalid_json", "请求正文不是有效 JSON。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PlatformError(422, "invalid_json", "请求根节点需要对象。");
  return parsed as Record<string, unknown>;
}
function allowFields(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new PlatformError(422, "unknown_field", "请求包含未允许的字段。");
}
/** 无可用适配器时明确501，不能用原JSON落库冒充完整导入。 */
export async function handleProjectApi(request: Request, env: PlatformEnv, planner?: ImportPlanner): Promise<Response> {
  try {
    // 先鉴权再消费body、查询D1或写R2。不能把EXECUTOR_TOKEN当平台操作者凭据。
    const operator = await Operator.authenticate(request, env.WORKBENCH_TOKEN);
    const queryBudget = Number(env.D1_QUERY_BUDGET);
    if (queryBudget !== 50 && queryBudget !== 1000) throw new PlatformError(503, "config_invalid", "D1查询预算需要明确配置为50或1000。");
    const repository = new ProjectRepository(env.DB, env.MEDIA, operator, queryBudget);
    const url = new URL(request.url);
    if (url.pathname === "/api/projects") {
      if (request.method === "GET") return json(200, { ok: true, ...await repository.listProjects(url.searchParams.get("cursor") ?? "") });
      if (request.method !== "POST") throw new PlatformError(405, "method_not_allowed", "此接口接受 GET 或 POST。");
      const body = await bodyObject(request);
      allowFields(body, ["name", "source", "lang"]);
      if (typeof body.name !== "string" || (body.source !== undefined && typeof body.source !== "string") || (body.lang !== undefined && typeof body.lang !== "string")) {
        throw new PlatformError(422, "invalid_project", "项目参数无效。");
      }
      return json(201, { ok: true, ...await repository.createProject({ name: body.name, source: body.source, lang: body.lang }) });
    }
    const route = /^\/api\/projects\/([^/]+)\/(snapshot|exports|imports|reconcile|documents\/([^/]+)\/raw|characters\/([^/]+))$/.exec(url.pathname);
    if (!route) throw new PlatformError(404, "not_found", "没有这个平台接口。");
    const projectId = route[1]!;
    if (route[2]?.startsWith("characters/") && request.method === "PATCH") {
      if (!planner) throw new PlatformError(501,"adapter_unavailable","业务适配器尚未接入。");
      const body=await bodyObject(request);allowFields(body,["oneLiner","expectedRevision"]);
      if (typeof body.oneLiner !== "string" || !body.oneLiner.trim() || body.oneLiner.length>2000 ||
          typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision)) throw new PlatformError(422,"invalid_edit","需要非空 oneLiner 和 expectedRevision。");
      const snapshot=await repository.snapshot(projectId);
      if (snapshot.revision !== body.expectedRevision) throw new PlatformError(409,"revision_conflict","项目已更新，请重新读取。");
      const row=snapshot.entities.character.find(r=>r.id===route[4]);
      if (!row) throw new PlatformError(404,"character_not_found","当前项目没有该角色。");
      const document=exportLibraryDocument(snapshot,"novel-characters");
      const character=Array.isArray(document.characters) ? document.characters.find(v=>v && typeof v==="object"&&!Array.isArray(v)&&v.name===row.name):undefined;
      if (!character || typeof character!=="object" || Array.isArray(character)) throw new PlatformError(404,"character_not_found","角色卡尚未建立。");
      character.oneLiner=body.oneLiner;
      return json(200,{ok:true,...await repository.importDocuments(projectId,[{skill:"novel-characters",raw:JSON.stringify(document)}],planner,{mode:"update",expectedRevision:body.expectedRevision,reservedQueries:12})});
    }
    if (route[2] === "exports" && request.method === "GET") {
      const skill = SKILLS.find(s => s === url.searchParams.get("skill"));
      if (!skill) throw new PlatformError(422,"invalid_skill","导出需要有效 skill 参数。");
      return json(200, { ok:true, document:exportLibraryDocument(await repository.snapshot(projectId),skill) });
    }
    if (route[2] === "snapshot" && request.method === "GET") return json(200, { ok: true, snapshot: await repository.snapshot(projectId) });
    if (route[2]?.startsWith("documents/") && request.method === "GET") {
      return new Response(await repository.readRaw(projectId, route[3]!), { headers: {
        "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    if (route[2] === "reconcile" && request.method === "POST") {
      const body = await bodyObject(request); allowFields(body, ["cursor"]);
      if (body.cursor !== undefined && typeof body.cursor !== "string") throw new PlatformError(422, "invalid_cursor", "游标需要字符串。");
      return json(200, { ok: true, ...await repository.reconcile(projectId, body.cursor) });
    }
    if (route[2] === "imports" && request.method === "POST") {
      if (!planner) throw new PlatformError(501, "adapter_unavailable", "业务适配器尚未接入；没有读取正文或写入数据。");
      const body = await bodyObject(request); allowFields(body, ["documents", "expectedRevision", "mode"]);
      if (!Array.isArray(body.documents) || body.documents.length < 1 || body.documents.length > 3 ||
        (body.expectedRevision !== undefined && (typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) ||
        (body.mode !== undefined && body.mode !== "create" && body.mode !== "update")) throw new PlatformError(422, "invalid_package", "导入参数无效。");
      const documents: InputDocument[] = body.documents.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError(422, "invalid_package", "文稿参数无效。");
        const record: Record<string, unknown> = value; allowFields(record, ["skill", "raw"]);
        const skill = SKILLS.find(skill => skill === record.skill);
        if (!skill || typeof record.raw !== "string") throw new PlatformError(422, "invalid_package", "文稿种类或原文无效。");
        return { skill, raw: record.raw };
      });
      return json(200, { ok: true, ...await repository.importDocuments(projectId, documents, planner,
        { expectedRevision: body.expectedRevision, mode: body.mode }) });
    }
    throw new PlatformError(405, "method_not_allowed", "接口不支持该请求方法。");
  } catch (error) { return platformErrorResponse(error); }
}
