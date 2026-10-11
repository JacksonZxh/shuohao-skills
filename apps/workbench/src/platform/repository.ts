import { createId } from "../ids";
import { SKILLS, type Cell, type ImportPlanner, type InputDocument, type ImportResult, type ProjectSnapshot, type ImportPlan, type PreparedDocument, type SourceIdentity } from "../contracts/import";
import { Operator } from "./auth";
import { PlatformError } from "./errors";
import { prepareDocuments, packageFingerprint, sha256 } from "./documents";
import { assertProjectId, ENTITY_SCHEMA, ENTITY_ORDER, entityStatements, validatePlan, validateIssues, guardRowSize } from "./entities";
import { RawStore, type RawRecord, type StoredRaw } from "./raw-store";
import { insertRows } from "./sql";

interface CommitRecord {
  id: string; project_id: string; revision: number; document_ids_json: string; warnings_json: string;
}
export class ProjectRepository {
  private readonly raw: RawStore;
  constructor(private readonly db: D1Database, media: R2Bucket, private readonly operator: Operator,
    private readonly queryBudget: 50 | 1000 = 50) {
    operator.assert(); this.raw = new RawStore(db, media);
  }
  async createProject(input: { name: string; source?: string; lang?: string }): Promise<{ id: string; revision: number }> {
    this.operator.assert();
    if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 160 ||
      (input.source !== undefined && (typeof input.source !== "string" || input.source.length > 1024)) ||
      (input.lang !== undefined && !["zh", "en", "ja"].includes(input.lang))) {
      throw new PlatformError(422, "invalid_project", "项目名称或参数无效。");
    }
    const id = createId(), now = Date.now();
    await this.db.prepare("INSERT INTO projects(id,name,source,lang,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind(id, input.name.trim(), input.source ?? null, input.lang ?? null, now, now).run();
    return { id, revision: 0 };
  }
  async listProjects(cursor = ""): Promise<{ projects: Array<Record<string, Cell>>; cursor: string | null }> {
    this.operator.assert();
    const result = await this.db.prepare("SELECT id,name,lang,created_at,updated_at,import_revision AS revision FROM projects WHERE id>? ORDER BY id LIMIT 100").bind(cursor).all<Record<string, Cell>>();
    return { projects: result.results, cursor: result.results.length === 100 ? String(result.results[99]!.id) : null };
  }
  private async requireProject(projectId: string): Promise<void> {
    assertProjectId(projectId);
    if (!await this.db.prepare("SELECT id FROM projects WHERE id=?").bind(projectId).first()) {
      throw new PlatformError(404, "project_not_found", "项目不存在。");
    }
  }
  async snapshot(projectId: string): Promise<ProjectSnapshot> {
    this.operator.assert(); assertProjectId(projectId);
    // batch内全部读取同一快照；原文随后读取不可变版本，不再查询当前指针。
    const reads = [this.db.prepare("SELECT import_revision AS revision FROM projects WHERE id=?").bind(projectId),
      ...ENTITY_ORDER.map(kind => {
        const table = ENTITY_SCHEMA[kind].table;
        const clause = kind === "episode_link" ? "episode_id IN(SELECT id FROM episodes WHERE project_id=?)" : "project_id=?";
        return this.db.prepare(`SELECT * FROM ${table} WHERE ${clause} ORDER BY id`).bind(projectId);
      }),
      this.db.prepare("SELECT skill,source_key,entity_type,entity_id FROM source_identities WHERE project_id=? ORDER BY skill,entity_type,source_key").bind(projectId),
      this.db.prepare("SELECT b.* FROM current_documents c JOIN document_blobs b ON b.id=c.blob_id WHERE c.project_id=? ORDER BY c.skill").bind(projectId)];
    const result = await this.db.batch<Record<string, Cell>>(reads);
    const revision = result[0]?.results[0]?.revision;
    if (typeof revision !== "number") throw new PlatformError(404, "project_not_found", "项目不存在。");
    const entities: ProjectSnapshot["entities"] = { character: [], scene: [], prop: [], beat: [], episode: [], alias: [], carrier: [], prop_scene: [], episode_link: [] };
    ENTITY_ORDER.forEach((kind,index) => { entities[kind] = result[index + 1]!.results; });
    const identities: SourceIdentity[] = result[ENTITY_ORDER.length + 1]!.results.map(row => {
      // 这些枚举由数据库约束和平台写入校验；仍按读值验证，不盲目转型。
      const skill = SKILLS.find(item => item === row.skill);
      const entityKind = (["character", "scene", "prop", "beat", "episode"] as const).find(item => item === row.entity_type);
      if (!skill || !entityKind || typeof row.source_key !== "string" || typeof row.entity_id !== "string") {
        throw new PlatformError(503, "snapshot_invalid", "身份映射记录无效。");
      }
      return { skill, entityKind, sourceKey: row.source_key, entityId: row.entity_id };
    });
    const rawRows = result[ENTITY_ORDER.length + 2]!.results;
    const documents: ProjectSnapshot["documents"] = [];
    for (const row of rawRows) {
      const record = this.rawRecord(row, projectId);
      const raw = await this.raw.read(record);
      const prepared = (await prepareDocuments([{ skill: SKILLS.find(skill => skill === record.skill)!, raw }]))[0]!;
      if (prepared.semanticFingerprint !== record.semantic_fingerprint) throw new PlatformError(503, "snapshot_invalid", "原文语义指纹不一致。");
      documents.push({ ...prepared, id: record.id });
    }
    return { projectId, revision, entities, identities, documents };
  }
  private rawRecord(row: Record<string, Cell>, projectId: string): RawRecord {
    if (row.project_id !== projectId || typeof row.id !== "string" || typeof row.skill !== "string" ||
      !SKILLS.some(skill => skill === row.skill) || typeof row.byte_sha256 !== "string" || typeof row.semantic_fingerprint !== "string" ||
      typeof row.byte_length !== "number" || !(row.raw_json === null || typeof row.raw_json === "string") ||
      !(row.r2_key === null || typeof row.r2_key === "string")) throw new PlatformError(503, "snapshot_invalid", "文稿版本记录无效。");
    return { id: row.id, project_id: projectId, skill: row.skill, raw_json: row.raw_json, r2_key: row.r2_key,
      byte_length: row.byte_length, byte_sha256: row.byte_sha256, semantic_fingerprint: row.semantic_fingerprint };
  }
  async readRaw(projectId: string, blobId: string): Promise<string> {
    this.operator.assert(); await this.requireProject(projectId); assertProjectId(blobId);
    const row = await this.db.prepare("SELECT * FROM document_blobs WHERE project_id=? AND id=?").bind(projectId, blobId).first<Record<string, Cell>>();
    if (!row) throw new PlatformError(404, "document_not_found", "文稿版本不存在。");
    return this.raw.read(this.rawRecord(row, projectId));
  }
  async reconcile(projectId: string, cursor = "", olderThan?: number) {
    this.operator.assert(); await this.requireProject(projectId);
    return this.raw.reconcile(projectId, cursor, olderThan);
  }
  private async priorCommit(projectId: string, fingerprint: string): Promise<ImportResult | null> {
    const commit = await this.db.prepare("SELECT * FROM import_commits WHERE project_id=? AND fingerprint=?")
      .bind(projectId, fingerprint).first<CommitRecord>();
    if (!commit) return null;
    return { status: "idempotent_hit", projectId, commitId: commit.id, revision: commit.revision,
      documentIds: JSON.parse(commit.document_ids_json), warnings: JSON.parse(commit.warnings_json) };
  }
  private async ensurePriorRaw(projectId: string, result: ImportResult, documents: PreparedDocument[]): Promise<void> {
    for (const id of result.documentIds) {
      const row = await this.db.prepare("SELECT * FROM document_blobs WHERE project_id=? AND id=?").bind(projectId, id).first<Record<string, Cell>>();
      if (!row) throw new PlatformError(503, "raw_unavailable", "已提交文稿版本缺失。");
      const record = this.rawRecord(row, projectId);
      try { await this.raw.read(record); }
      catch (error) {
        if (!(error instanceof PlatformError) || error.code !== "raw_unavailable" || !record.r2_key) throw error;
        const original = documents.find(doc => doc.skill === record.skill && doc.byteSha256 === record.byte_sha256);
        if (!original) throw new PlatformError(503, "raw_unavailable", "恢复历史对象需要原始字节；相同语义的不同排版不能替代。");
        await this.raw.stage(projectId, original);
        await this.db.prepare("UPDATE object_uploads SET state='ready',d1_ref_type='document_blob',d1_ref_id=?,ready_at=COALESCE(ready_at,?) WHERE project_id=? AND r2_key=?")
          .bind(id, Date.now(), projectId, record.r2_key).run();
      }
    }
  }
  async importDocuments(projectId: string, inputs: InputDocument[], planner: ImportPlanner,
    options: { expectedRevision?: number; mode?: "create" | "update"; reservedQueries?: number } = {}): Promise<ImportResult> {
    this.operator.assert(); await this.requireProject(projectId);
    const documents = await prepareDocuments(inputs);
    if (options.mode === "update" && !Number.isSafeInteger(options.expectedRevision)) {
      throw new PlatformError(422, "revision_required", "显式更新需要 expectedRevision。");
    }
    const packageHash = await packageFingerprint(documents);
    // update请求在修订范围内幂等；显式回到旧文稿可使用新修订，不被历史幂等键吞掉。
    const fingerprint = options.mode === "update"
      ? await sha256(new TextEncoder().encode(`${packageHash}:update:${options.expectedRevision}`))
      : packageHash;
    const prior = await this.priorCommit(projectId, fingerprint);
    if (prior) { await this.ensurePriorRaw(projectId, prior, documents); return prior; }
    const snapshot = await this.snapshot(projectId);
    if (options.expectedRevision !== undefined && options.expectedRevision !== snapshot.revision) {
      throw new PlatformError(409, "revision_conflict", "项目已修改，请读取新快照后重试。");
    }
    const changed = documents.filter(doc => snapshot.documents.some(old => old.skill === doc.skill && old.semanticFingerprint !== doc.semanticFingerprint));
    if (changed.length && options.mode !== "update") throw new PlatformError(409, "document_conflict", "文稿已存在，更新必须显式选择 update 模式。");
    const planned = await planner({ documents, snapshot, allocateId: createId });
    if (planned.status === "rejected") {
      validateIssues(planned.issues);
      const id = createId(), now = Date.now();
      await this.db.prepare(`INSERT INTO import_runs(id,project_id,skill,started_at,finished_at,status,activation,conflict_report_json,executor)
        VALUES(?,?,?,?,?,'rejected','aborted',?,'worker')`).bind(id, projectId, documents.map(doc => doc.skill).join(","), now, now, JSON.stringify(planned.issues)).run();
      throw new PlatformError(422, "import_conflict", "适配器拒绝该导入，未修改业务数据。", planned.issues);
    }
    validatePlan(planned.plan);
    if (planned.plan.expectedRevision !== snapshot.revision) throw new PlatformError(409, "revision_conflict", "规划使用了过期修订号。");
    this.preflightOwnership(snapshot, planned.plan);
    const orderedWrites = this.orderWrites(planned.plan);
    const commitId = createId(), now = Date.now();
    const ids: string[] = [];
    const stored: StoredRaw[] = [];
    for (const doc of documents) {
      const existing = await this.db.prepare("SELECT id FROM document_blobs WHERE project_id=? AND skill=? AND semantic_fingerprint=?")
        .bind(projectId, doc.skill, doc.semanticFingerprint).first<{ id: string }>();
      ids.push(existing?.id ?? createId());
      // 相同语义但不同排版，继续保留第一次版本的原字节，不新建不可达R2对象。
      stored.push(existing ? { rawJson: null, r2Key: null } : this.raw.location(projectId, doc));
    }
    const plan = planned.plan;
    const statements: D1PreparedStatement[] = [this.db.prepare(`INSERT INTO import_commits
      (id,project_id,fingerprint,expected_revision,revision,document_ids_json,warnings_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(commitId, projectId, fingerprint, snapshot.revision, snapshot.revision + 1, JSON.stringify(ids), JSON.stringify(plan.warnings), now)];
    for (const removal of plan.removals) {
      const table = ENTITY_SCHEMA[removal.kind].table;
      const clause = removal.kind === "episode_link" ? "episode_id IN(SELECT id FROM episodes WHERE project_id=?)" : "project_id=?";
      statements.push(this.db.prepare(`DELETE FROM ${table} WHERE id=? AND ${clause}`).bind(removal.id, projectId));
    }
    statements.push(...entityStatements(this.db, projectId, orderedWrites, now, snapshot.entities));
    statements.push(...insertRows(this.db, "source_identities", ["id","project_id","skill","source_key","entity_type","entity_id","created_at"],
      plan.identities.map(identity => [createId(),projectId,identity.skill,identity.sourceKey,identity.entityKind,identity.entityId,now]),
      "ON CONFLICT(project_id,skill,entity_type,source_key) DO UPDATE SET entity_id=excluded.entity_id,revised_at=excluded.created_at"));
    for (let index = 0; index < documents.length; index++) {
      const doc = documents[index]!, location = stored[index]!, id = ids[index]!;
      if (location.rawJson !== null || location.r2Key !== null) {
        guardRowSize({ id, project_id: projectId, skill: doc.skill, raw_json: location.rawJson, r2_key: location.r2Key });
        statements.push(this.db.prepare(`INSERT INTO document_blobs(id,project_id,skill,byte_sha256,semantic_fingerprint,byte_length,raw_json,r2_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .bind(id, projectId, doc.skill, doc.byteSha256, doc.semanticFingerprint, doc.byteLength, location.rawJson, location.r2Key, now));
        if (location.r2Key) statements.push(this.db.prepare(`UPDATE object_uploads SET state='ready',d1_ref_type='document_blob',d1_ref_id=?,ready_at=? WHERE project_id=? AND r2_key=?`)
          .bind(id, now, projectId, location.r2Key));
      }
      statements.push(this.db.prepare("INSERT INTO current_documents(project_id,skill,blob_id) VALUES(?,?,?) ON CONFLICT(project_id,skill) DO UPDATE SET blob_id=excluded.blob_id").bind(projectId, doc.skill, id));
    }
    statements.push(this.db.prepare(`INSERT INTO import_runs(id,project_id,skill,started_at,finished_at,semantic_fingerprint,status,activation,conflict_report_json,executor)
      VALUES(?,?,?,?,?,?,'committed','activated',?,'worker')`).bind(commitId, projectId, documents.map(doc => doc.skill).join(","), now, now, fingerprint, JSON.stringify(plan.warnings)));
    statements.push(...insertRows(this.db, "import_entity_map", ["import_run_id","skill","source_key","entity_type","entity_id"],
      plan.identities.map(identity => [commitId,identity.skill,identity.sourceKey,identity.entityKind,identity.entityId])));
    const stageQueries = stored.filter(location => location.r2Key !== null).length;
    const estimatedQueries = (options.reservedQueries ?? 0) + 2 + ENTITY_ORDER.length + 3 + documents.length + stageQueries + statements.length + 2;
    if (estimatedQueries > this.queryBudget) throw new PlatformError(413, "query_budget", "规划超过当前单请求查询预算；没有写入实体或暂存对象。");
    // 所有规划/预算/行大小守卫通过后再上传原文；对象存在和字节核验在batch外。
    for (let index = 0; index < documents.length; index++) {
      if (stored[index]!.rawJson !== null || stored[index]!.r2Key !== null) await this.raw.stage(projectId, documents[index]!);
    }
    try { await this.db.batch(statements); } catch {
      // 两个并发相同包，胜者结果是有效幂等命中。其他情况绝不重放过期规划。
      const winner = await this.priorCommit(projectId, fingerprint);
      if (winner) return winner;
      const revision = await this.db.prepare("SELECT import_revision AS revision FROM projects WHERE id=?").bind(projectId).first<{ revision: number }>();
      if (revision?.revision !== snapshot.revision) throw new PlatformError(409, "revision_conflict", "项目已修改，未应用过期规划。");
      throw new PlatformError(409, "commit_rejected", "原子提交失败，业务数据未修改；暂存原文可以核对后重试。",
        [{ code: "commit_rejected", path: "plan", message: "数据库约束或提交服务拒绝该规划。" }]);
    }
    return { status: "committed", projectId, commitId, revision: snapshot.revision + 1, documentIds: ids, warnings: plan.warnings };
  }
  private preflightOwnership(snapshot: ProjectSnapshot, plan: ImportPlan): void {
    for (const removal of plan.removals) if (!snapshot.entities[removal.kind].some(row => row.id === removal.id)) {
      throw new PlatformError(422, "unknown_relation", "关系不属于当前项目。");
    }
    for (const write of plan.writes) {
      const existing = snapshot.entities[write.kind].find(row => row.id === write.id);
      if (existing) guardRowSize({ ...existing, ...write.values });
    }
    const owned = (kind: keyof ProjectSnapshot["entities"], value: Cell | undefined): boolean =>
      typeof value === "string" && (snapshot.entities[kind].some(row => row.id === value) || plan.writes.some(row => row.kind === kind && row.id === value));
    const requireRef = (kind: keyof ProjectSnapshot["entities"], value: Cell | undefined): void => {
      if (!owned(kind, value)) throw new PlatformError(422, "project_scope", "规划引用不属于当前项目或尚未规划的实体。");
    };
    for (const write of plan.writes) {
      const values = { ...snapshot.entities[write.kind].find(row => row.id === write.id), ...write.values };
      if (write.kind === "alias") requireRef("character", values.character_id);
      if (write.kind === "scene" && values.variant_of_id != null) requireRef("scene", values.variant_of_id);
      if (write.kind === "carrier" || write.kind === "prop_scene") requireRef("prop", values.prop_id);
      if (write.kind === "carrier" && values.character_id != null) requireRef("character", values.character_id);
      if (write.kind === "prop_scene") requireRef("scene", values.scene_id);
      if (write.kind === "episode_link") {
        requireRef("episode", values.episode_id);
        if (values.entity_type !== "character" && values.entity_type !== "scene" && values.entity_type !== "prop") {
          throw new PlatformError(422, "invalid_plan", "分集关联实体类型无效。");
        }
        requireRef(values.entity_type, values.entity_id);
      }
    }
    for (const identity of plan.identities) requireRef(identity.entityKind, identity.entityId);
  }
  private orderWrites(plan: ImportPlan) {
    const writes = ENTITY_ORDER.flatMap(kind => plan.writes.filter(write => write.kind === kind));
    const sceneWrites = writes.filter(write => write.kind === "scene");
    const sceneIds = new Map(sceneWrites.map(write => [write.id, write]));
    const ordered: typeof writes = [], visiting = new Set<string>(), done = new Set<string>();
    const visit = (write: typeof writes[number]): void => {
      if (done.has(write.id)) return;
      if (visiting.has(write.id)) throw new PlatformError(422, "scene_cycle", "场景变体不能形成循环。");
      visiting.add(write.id);
      const parent = write.values.variant_of_id;
      if (typeof parent === "string" && sceneIds.has(parent)) visit(sceneIds.get(parent)!);
      visiting.delete(write.id); done.add(write.id); ordered.push(write);
    };
    sceneWrites.forEach(visit);
    return ENTITY_ORDER.flatMap(kind => kind === "scene" ? ordered : writes.filter(write => write.kind === kind));
  }
}
