/** F1 v1：仅服务端适配器使用。HTTP 客户端不能提交 ImportPlan/SQL/R2 键。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Skill = "novel-outline" | "novel-characters" | "novel-art";
export type EntityKind = "character" | "alias" | "scene" | "prop" | "carrier" | "prop_scene" | "beat" | "episode" | "episode_link";
export type Cell = string | number | null;

/** 字段用现有 schema 的蛇形命名。平台逐项白名单校验，并绑定参数。 */
export interface EntityWrite {
  kind: EntityKind;
  id: string;
  values: Record<string, Cell>;
}
export interface RelationRemoval {
  kind: "alias" | "carrier" | "prop_scene" | "episode_link";
  id: string;
}
export interface SourceIdentity {
  skill: Skill;
  sourceKey: string;
  entityKind: "character" | "scene" | "prop" | "beat" | "episode";
  entityId: string;
}
export interface ImportIssue {
  code: string;
  skill?: Skill;
  path: string;
  message: string;
  candidateIds?: string[];
}
export interface ImportPlan {
  /** 平台读取的快照修订号，不是显示码或数组顺序。 */
  expectedRevision: number;
  writes: EntityWrite[];
  removals: RelationRemoval[];
  identities: SourceIdentity[];
  /** 非破坏性未解析引用可作为警告；身份/结构冲突必须返回 rejected。 */
  warnings: ImportIssue[];
}
export type PlanResult = { status: "planned"; plan: ImportPlan } | { status: "rejected"; issues: ImportIssue[] };
export interface InputDocument {
  skill: Skill;
  /** 原始 JSON 文本。不会重新 stringify 后伪装成原始字节。 */
  raw: string;
}
export interface PreparedDocument extends InputDocument {
  value: JsonObject;
  byteLength: number;
  byteSha256: string;
  semanticFingerprint: string;
}
export interface ProjectSnapshot {
  projectId: string;
  revision: number;
  entities: Record<EntityKind, Array<Record<string, Cell>>>;
  identities: SourceIdentity[];
  documents: Array<PreparedDocument & { id: string }>;
}
export interface PlannerInput {
  documents: PreparedDocument[];
  snapshot: ProjectSnapshot;
  /** 新实体才使用；已有源映射/唯一姓名/码必须复用快照内 UUID。 */
  allocateId(): string;
}
export type ImportPlanner = (input: PlannerInput) => PlanResult | Promise<PlanResult>;
export interface ImportResult {
  status: "committed" | "idempotent_hit";
  projectId: string;
  commitId: string;
  revision: number;
  documentIds: string[];
  warnings: ImportIssue[];
}

export const SKILLS: readonly Skill[] = ["novel-outline", "novel-characters", "novel-art"];
