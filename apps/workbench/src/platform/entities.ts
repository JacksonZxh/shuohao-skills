import { isUuidV4 } from "../ids";
import type { EntityKind, EntityWrite, ImportPlan, Cell, ImportIssue } from "../contracts/import";
import { PlatformError } from "./errors";
import { insertRows } from "./sql";

export const ENTITY_SCHEMA: Record<EntityKind, { table: string; fields: readonly string[]; timestamps: boolean }> = {
  character: { table: "characters", fields: ["display_code", "name", "sort_order", "outline_tier", "cast_importance", "outline_arc", "cast_persona_json", "cast_image_json", "cast_voice_json", "one_liner", "raw_extensions_json"], timestamps: true },
  alias: { table: "character_aliases", fields: ["character_id", "alias"], timestamps: false },
  scene: { table: "scenes", fields: ["display_code", "name", "is_primary", "summary", "reuse_plan", "anchors_json", "lighting_json", "image_json", "variant_of_id", "changes", "raw_extensions_json", "sort_order"], timestamps: true },
  prop: { table: "props", fields: ["display_code", "name", "function_text", "scale", "summary", "anchors_json", "states_json", "image_json", "raw_extensions_json", "sort_order"], timestamps: true },
  carrier: { table: "prop_carriers", fields: ["prop_id", "character_id", "name_unresolved", "source_code"], timestamps: false },
  prop_scene: { table: "prop_scene_links", fields: ["prop_id", "scene_id"], timestamps: false },
  beat: { table: "beats", fields: ["display_code", "type", "weight", "episode_number", "setup", "payoff", "sort_order", "raw_extensions_json"], timestamps: true },
  episode: { table: "episodes", fields: ["ep_number", "synopsis", "hook", "suspense", "crowd_plan", "warnings_json", "sort_order"], timestamps: true },
  episode_link: { table: "episode_links", fields: ["episode_id", "entity_type", "entity_id", "sort_order"], timestamps: false },
};
export const ENTITY_ORDER: readonly EntityKind[] = ["character", "scene", "prop", "beat", "episode", "alias", "carrier", "prop_scene", "episode_link"];
export const REMOVABLE_KINDS = ["alias", "carrier", "prop_scene", "episode_link"] as const;
export const IDENTITY_KINDS = ["character", "scene", "prop", "beat", "episode"] as const;
// 给 D1 行元数据留出余量；这是应用保守阈值，不是官方上限。
export const MAX_ROW_ESTIMATE_BYTES = 1_800_000;
export const MAX_PLAN_WRITES = 120;

export function assertProjectId(id: string): void {
  if (!isUuidV4(id)) throw new PlatformError(422, "invalid_project_id", "项目 ID 必须是 UUID v4。");
}
export function guardRowSize(row: Record<string, Cell>): void {
  if (new TextEncoder().encode(JSON.stringify(row)).byteLength > MAX_ROW_ESTIMATE_BYTES) {
    throw new PlatformError(413, "row_too_large", "规范化记录超过当前单行大小限制。");
  }
}
export function validateIssues(issues: ImportIssue[]): void {
  if (!Array.isArray(issues) || issues.length > 100 || issues.some(issue => !issue ||
    typeof issue.code !== "string" || issue.code.length > 100 ||
    typeof issue.path !== "string" || issue.path.length > 1024 ||
    typeof issue.message !== "string" || issue.message.length > 2000 ||
    (issue.candidateIds !== undefined && (!Array.isArray(issue.candidateIds) || issue.candidateIds.length > 32 || issue.candidateIds.some(id => !isUuidV4(id)))))) {
    throw new PlatformError(422, "invalid_plan", "冲突或警告报告无效或超限。");
  }
}
export function validatePlan(plan: ImportPlan): void {
  if (!Number.isSafeInteger(plan.expectedRevision) || plan.expectedRevision < 0 ||
    !Array.isArray(plan.writes) || !Array.isArray(plan.removals) || !Array.isArray(plan.identities) || !Array.isArray(plan.warnings)) {
    throw new PlatformError(422, "invalid_plan", "适配器返回了无效规划。");
  }
  if (plan.writes.length + plan.removals.length + plan.identities.length > MAX_PLAN_WRITES) {
    throw new PlatformError(413, "plan_too_large", "规划超过当前原子提交上限，未提交任何实体。");
  }
  validateIssues(plan.warnings);
  const seen = new Set<string>();
  for (const write of plan.writes) {
    const schema = Object.hasOwn(ENTITY_SCHEMA, write.kind) ? ENTITY_SCHEMA[write.kind] : undefined;
    if (!schema || !isUuidV4(write.id) || !write.values || typeof write.values !== "object" || Array.isArray(write.values) || Object.keys(write.values).length === 0) {
      throw new PlatformError(422, "invalid_plan", "实体类型、ID 或字段无效。");
    }
    const key = `${write.kind}:${write.id}`;
    if (seen.has(key)) throw new PlatformError(422, "invalid_plan", "同一实体不能在一包中重复写入。");
    seen.add(key);
    for (const [field, value] of Object.entries(write.values)) {
      if (!schema.fields.includes(field) || !(value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))) {
        throw new PlatformError(422, "invalid_plan", "规划包含未允许的字段或值。");
      }
      if (field.endsWith("_json") && value !== null) {
        if (typeof value !== "string") throw new PlatformError(422, "invalid_plan", "JSON 字段需要 JSON 文本。");
        try { JSON.parse(value); } catch { throw new PlatformError(422, "invalid_plan", "JSON 字段无效。"); }
      }
      if (field.endsWith("_id") && value !== null && (typeof value !== "string" || !isUuidV4(value))) {
        throw new PlatformError(422, "invalid_plan", "关系 ID 必须是 UUID v4。");
      }
    }
    guardRowSize(write.values);
  }
  for (const removal of plan.removals) {
    if (!REMOVABLE_KINDS.includes(removal.kind) || !isUuidV4(removal.id) || seen.has(`${removal.kind}:${removal.id}`)) {
      throw new PlatformError(422, "invalid_plan", "只允许移除本项目关系，不能同时写入和移除同一关系。");
    }
    const key = `${removal.kind}:${removal.id}`;
    if (seen.has(key)) throw new PlatformError(422, "invalid_plan", "关系移除重复。");
    seen.add(key);
  }
  const sources = new Set<string>();
  for (const identity of plan.identities) {
    if (!IDENTITY_KINDS.includes(identity.entityKind) || !isUuidV4(identity.entityId) ||
      typeof identity.sourceKey !== "string" || !identity.sourceKey || identity.sourceKey.length > 512 ||
      !["novel-outline", "novel-characters", "novel-art"].includes(identity.skill)) {
      throw new PlatformError(422, "invalid_plan", "源身份映射无效。");
    }
    const key = `${identity.skill}:${identity.entityKind}:${identity.sourceKey}`;
    if (sources.has(key)) throw new PlatformError(422, "invalid_plan", "源身份映射重复。");
    sources.add(key);
  }
}

function entityCandidate(projectId: string, write: EntityWrite, now: number, existing?: Record<string, Cell>) {
  const schema = ENTITY_SCHEMA[write.kind];
  // SQLite先检查INSERT的NOT NULL，再执行UPSERT分支。现有记录必须补齐INSERT候选行，
  // UPDATE仍然只修改适配器明确提供的字段，不能用null抹掉其他文稿字段。
  const previous = Object.fromEntries(schema.fields.filter(key => existing && key in existing).map(key => [key, existing![key]!]));
  const candidate = { ...previous, ...write.values };
  const fields = Object.keys(candidate).sort();
  const scoped = write.kind !== "episode_link";
  const insert = ["id", ...(scoped ? ["project_id"] : []), ...fields, ...(schema.timestamps ? ["created_at", "updated_at"] : [])];
  const values: Cell[] = [write.id, ...(scoped ? [projectId] : []), ...fields.map(key => candidate[key]!), ...(schema.timestamps ? [existing?.created_at ?? now, now] : [])];
  // 部分字段 patch：cast 更新不能把 outline_tier 等独立字段清空。
  const update = [...(scoped ? ["project_id"] : []), ...Object.keys(write.values).sort(), ...(schema.timestamps ? ["updated_at"] : [])];
  return { table: schema.table, insert, values, suffix: `ON CONFLICT(id) DO UPDATE SET ${update.map(key => `${key}=excluded.${key}`).join(",")}` };
}
export function entityStatements(db: D1Database, projectId: string, writes: EntityWrite[], now: number,
  entities: Record<EntityKind, Array<Record<string, Cell>>>): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  let group: ReturnType<typeof entityCandidate> | undefined;
  let rows: Cell[][] = [];
  const flush = (): void => {
    if (group) statements.push(...insertRows(db, group.table, group.insert, rows, group.suffix));
    rows = [];
  };
  for (const write of writes) {
    const candidate = entityCandidate(projectId, write, now, entities[write.kind].find(row => row.id === write.id));
    if (group && (group.table !== candidate.table || group.suffix !== candidate.suffix || group.insert.join(",") !== candidate.insert.join(","))) flush();
    group = candidate; rows.push(candidate.values);
  }
  flush(); return statements;
}
