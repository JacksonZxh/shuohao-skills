-- 工作台初始结构。后续迁移在此之上追加，不要回头改这个文件。
-- 稳定 ID：TEXT，应用层使用 crypto.randomUUID() 的 UUID v4。显示码可空、可改，不参与内部 ID。
-- 时间：INTEGER，epoch 毫秒。非负，且必须是整数。
-- JSON 列：TEXT，存规范化 JSON。
-- 原文稿 UTF-8 超过 262144 字节（256 KiB）时外置 R2。这是项目阈值，不是 D1 行上限。
-- D1 单行上限仍是 2000000 字节，见 https://developers.cloudflare.com/d1/platform/limits/
-- 本文件不写入业务数据，也不含密钥。导入、网关调用、执行器都不在这次迁移里实现。

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT,
  lang TEXT,
  current_style_version_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

CREATE INDEX projects_current_style_version ON projects (current_style_version_id);

CREATE TABLE project_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects (id),
  settings_json TEXT NOT NULL DEFAULT '{}',
  novel_r2_key TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

CREATE TABLE style_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  version INTEGER NOT NULL CHECK (version >= 1 AND version = CAST(version AS INTEGER)),
  label TEXT,
  immutable_snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  UNIQUE (project_id, version)
);

-- current_style_version_id 是项目当前风格指针，不回写旧 media_versions。
-- 不在这里加外键，避免 projects 与 style_versions 循环引用。

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  display_code TEXT CHECK (display_code IS NULL OR length(display_code) > 0),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  outline_tier TEXT,
  cast_importance TEXT,
  outline_arc TEXT,
  cast_persona_json TEXT,
  cast_image_json TEXT,
  cast_voice_json TEXT,
  one_liner TEXT,
  raw_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

-- outline_tier 与 cast_importance 分开保存。缺失就保持缺失，不自动互填。
CREATE UNIQUE INDEX characters_project_display_code
  ON characters (project_id, display_code)
  WHERE display_code IS NOT NULL;

CREATE TABLE character_aliases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  character_id TEXT NOT NULL REFERENCES characters (id),
  alias TEXT NOT NULL CHECK (length(alias) > 0),
  UNIQUE (project_id, alias)
);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  display_code TEXT CHECK (display_code IS NULL OR length(display_code) > 0),
  name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  summary TEXT,
  reuse_plan TEXT,
  anchors_json TEXT,
  lighting_json TEXT,
  image_json TEXT,
  variant_of_id TEXT REFERENCES scenes (id),
  changes TEXT,
  raw_extensions_json TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

CREATE UNIQUE INDEX scenes_project_display_code
  ON scenes (project_id, display_code)
  WHERE display_code IS NOT NULL;

CREATE TABLE props (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  display_code TEXT CHECK (display_code IS NULL OR length(display_code) > 0),
  name TEXT NOT NULL,
  function_text TEXT,
  scale TEXT,
  summary TEXT,
  anchors_json TEXT,
  states_json TEXT,
  image_json TEXT,
  raw_extensions_json TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

CREATE UNIQUE INDEX props_project_display_code
  ON props (project_id, display_code)
  WHERE display_code IS NOT NULL;

CREATE TABLE prop_carriers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  prop_id TEXT NOT NULL REFERENCES props (id),
  character_id TEXT REFERENCES characters (id),
  name_unresolved TEXT,
  source_code TEXT,
  CHECK (
    (character_id IS NOT NULL AND name_unresolved IS NULL)
    OR (character_id IS NULL AND name_unresolved IS NOT NULL)
  )
);

CREATE TABLE prop_scene_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  prop_id TEXT NOT NULL REFERENCES props (id),
  scene_id TEXT NOT NULL REFERENCES scenes (id),
  UNIQUE (prop_id, scene_id)
);

CREATE TABLE outline_docs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1 AND revision = CAST(revision AS INTEGER)),
  params_json TEXT,
  adaptation_json TEXT,
  byte_sha256 TEXT,
  semantic_fingerprint TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR (byte_length >= 0 AND byte_length = CAST(byte_length AS INTEGER))),
  raw_json TEXT,
  r2_raw_key TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  UNIQUE (project_id, revision),
  CHECK (raw_json IS NOT NULL OR r2_raw_key IS NOT NULL)
);

CREATE UNIQUE INDEX outline_docs_project_semantic_fingerprint
  ON outline_docs (project_id, semantic_fingerprint)
  WHERE semantic_fingerprint IS NOT NULL;

CREATE TABLE beats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  display_code TEXT CHECK (display_code IS NULL OR length(display_code) > 0),
  type TEXT NOT NULL,
  weight TEXT,
  episode_number INTEGER CHECK (episode_number IS NULL OR episode_number = CAST(episode_number AS INTEGER)),
  setup TEXT,
  payoff TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  raw_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

-- 同 type 不合并，所以 type 上没有唯一约束。
CREATE UNIQUE INDEX beats_project_display_code
  ON beats (project_id, display_code)
  WHERE display_code IS NOT NULL;

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  ep_number INTEGER NOT NULL CHECK (ep_number = CAST(ep_number AS INTEGER)),
  synopsis TEXT,
  hook TEXT,
  suspense TEXT,
  crowd_plan TEXT,
  warnings_json TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER)),
  UNIQUE (project_id, ep_number)
);

CREATE TABLE episode_links (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes (id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('scene', 'character', 'prop')),
  entity_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER))
);

CREATE TABLE script_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  params_json TEXT,
  byte_sha256 TEXT,
  semantic_fingerprint TEXT,
  raw_json TEXT,
  r2_raw_key TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR (byte_length >= 0 AND byte_length = CAST(byte_length AS INTEGER))),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  CHECK (raw_json IS NOT NULL OR r2_raw_key IS NOT NULL)
);

CREATE UNIQUE INDEX script_batches_project_semantic_fingerprint
  ON script_batches (project_id, semantic_fingerprint)
  WHERE semantic_fingerprint IS NOT NULL;

CREATE TABLE script_episodes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES script_batches (id),
  episode_id TEXT REFERENCES episodes (id),
  ep_number INTEGER CHECK (ep_number IS NULL OR ep_number = CAST(ep_number AS INTEGER)),
  target_seconds INTEGER CHECK (target_seconds IS NULL OR target_seconds = CAST(target_seconds AS INTEGER)),
  hook TEXT,
  cliff TEXT,
  beats_claimed_text TEXT,
  beats_claimed_unresolved INTEGER NOT NULL DEFAULT 0 CHECK (beats_claimed_unresolved IN (0, 1)),
  hook_beat_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  CHECK (episode_id IS NOT NULL OR ep_number IS NOT NULL)
);

-- beats_claimed_text 保留类型原文。无法唯一绑定时报 unresolved，不猜测。
-- 这是引用警告，不等于结构冲突。执行前是否阻断由后续质量门决定。

CREATE TABLE script_scenes (
  id TEXT PRIMARY KEY,
  script_episode_id TEXT NOT NULL REFERENCES script_episodes (id),
  scene_id TEXT REFERENCES scenes (id),
  lighting_state TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  scene_seconds_extension REAL,
  raw_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER))
);

-- scene_seconds_extension 只保全文稿里的 sceneSeconds 扩展。
-- 它是统计函数留下的字段，不是约定的单条时长。本次不修改统计算法。

CREATE TABLE script_beats (
  id TEXT PRIMARY KEY,
  script_scene_id TEXT NOT NULL REFERENCES script_scenes (id),
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  kind TEXT,
  action TEXT,
  speaker_kind TEXT NOT NULL DEFAULT 'none' CHECK (speaker_kind IN ('none', 'character', 'vo', 'unresolved')),
  speaker_character_id TEXT REFERENCES characters (id),
  speaker_external_name TEXT,
  speaker_source_code TEXT,
  line TEXT,
  delivery TEXT,
  flow_seconds REAL,
  raw_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  CHECK (
    (speaker_kind = 'character' AND speaker_character_id IS NOT NULL)
    OR (speaker_kind = 'vo' AND speaker_character_id IS NULL)
    OR (speaker_kind = 'none' AND speaker_character_id IS NULL)
    OR speaker_kind = 'unresolved'
  )
);

-- VO 不伪造人物记录。外部姓名和原始编码留在 speaker_external_name / speaker_source_code。
-- flow_seconds 保全 flow[i].seconds，不把它写成时长语义修复。

CREATE TABLE storyboard_docs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  prompt_lang TEXT,
  params_json TEXT,
  byte_sha256 TEXT,
  semantic_fingerprint TEXT,
  raw_json TEXT,
  r2_raw_key TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR (byte_length >= 0 AND byte_length = CAST(byte_length AS INTEGER))),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  CHECK (raw_json IS NOT NULL OR r2_raw_key IS NOT NULL)
);

CREATE UNIQUE INDEX storyboard_docs_project_semantic_fingerprint
  ON storyboard_docs (project_id, semantic_fingerprint)
  WHERE semantic_fingerprint IS NOT NULL;

CREATE TABLE storyboard_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  episode_id TEXT REFERENCES episodes (id),
  display_code TEXT CHECK (display_code IS NULL OR length(display_code) > 0),
  script_scene_id TEXT REFERENCES script_scenes (id),
  scene_index_export INTEGER CHECK (scene_index_export IS NULL OR scene_index_export = CAST(scene_index_export AS INTEGER)),
  blocking TEXT,
  soundscape TEXT,
  music TEXT,
  h3_prompt TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  raw_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER))
);

-- 只保存 h3_prompt 原文。不伪造 Seedance 或 Wan 协议版本。
CREATE UNIQUE INDEX storyboard_segments_project_display_code
  ON storyboard_segments (project_id, display_code)
  WHERE display_code IS NOT NULL;

CREATE TABLE storyboard_cuts (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES storyboard_segments (id),
  beat_from_id TEXT REFERENCES script_beats (id),
  beat_to_id TEXT REFERENCES script_beats (id),
  seconds REAL,
  size TEXT,
  camera TEXT,
  frame TEXT,
  shot TEXT,
  composition_json TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  raw_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER))
);

-- beat_from_id / beat_to_id 只是兼容边界，不是认领集合本身。
-- 认领以 storyboard_cut_beats 的有序链接为准。
-- 不连续集合不能导出成伪造的连续区间。导出冲突检查还没有实现。

CREATE TABLE storyboard_cut_beats (
  cut_id TEXT NOT NULL REFERENCES storyboard_cuts (id),
  beat_id TEXT NOT NULL REFERENCES script_beats (id),
  sort_order INTEGER NOT NULL CHECK (sort_order = CAST(sort_order AS INTEGER)),
  PRIMARY KEY (cut_id, beat_id),
  UNIQUE (cut_id, sort_order)
);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  skill TEXT NOT NULL,
  started_at INTEGER NOT NULL CHECK (started_at >= 0 AND started_at = CAST(started_at AS INTEGER)),
  finished_at INTEGER CHECK (finished_at IS NULL OR (finished_at >= 0 AND finished_at = CAST(finished_at AS INTEGER))),
  byte_sha256 TEXT,
  semantic_fingerprint TEXT,
  status TEXT NOT NULL,
  activation TEXT NOT NULL DEFAULT 'staged' CHECK (activation IN ('staged', 'activated', 'aborted')),
  conflict_report_json TEXT,
  executor TEXT CHECK (executor IS NULL OR executor IN ('worker', 'local'))
);

-- 预检可以留下运行记录和冲突报告。失败不能留下部分可见的业务记录。
-- 未激活数据的 activation 为 staged。查询侧还没有实现，不能把 staged 当成已导入。

CREATE TABLE import_entity_map (
  import_run_id TEXT NOT NULL REFERENCES import_runs (id),
  skill TEXT NOT NULL,
  source_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (import_run_id, skill, entity_type, source_key)
);

-- 单次导入的源键映射。不能只靠新 import_run 制造重复实体。
CREATE TABLE source_identities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  skill TEXT NOT NULL,
  source_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  revised_at INTEGER CHECK (revised_at IS NULL OR (revised_at >= 0 AND revised_at = CAST(revised_at AS INTEGER))),
  UNIQUE (project_id, skill, entity_type, source_key)
);

CREATE TABLE document_blobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  skill TEXT NOT NULL,
  byte_sha256 TEXT,
  semantic_fingerprint TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR (byte_length >= 0 AND byte_length = CAST(byte_length AS INTEGER))),
  raw_json TEXT,
  r2_key TEXT,
  unknown_extensions_json TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  CHECK (raw_json IS NOT NULL OR r2_key IS NOT NULL)
);

-- byte_sha256 是原始字节哈希。semantic_fingerprint 是规范化语义指纹。两者分开。
CREATE UNIQUE INDEX document_blobs_project_skill_semantic_fingerprint
  ON document_blobs (project_id, skill, semantic_fingerprint)
  WHERE semantic_fingerprint IS NOT NULL;

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL,
  file_presence TEXT NOT NULL DEFAULT 'absent' CHECK (file_presence IN ('absent', 'staged', 'ready', 'missing')),
  generation_state TEXT NOT NULL DEFAULT 'none' CHECK (generation_state IN ('none', 'pending_generation', 'failed')),
  executor_wait TEXT NOT NULL DEFAULT 'idle' CHECK (executor_wait IN ('idle', 'waiting')),
  expires_at INTEGER CHECK (expires_at IS NULL OR (expires_at >= 0 AND expires_at = CAST(expires_at AS INTEGER))),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0 AND updated_at = CAST(updated_at AS INTEGER))
);

-- 有没有文件、是否过期、是否等待执行器是三列，不能混成一个状态。
-- 执行器离线只改 executor_wait，不能把已经 ready 的文件改掉。

CREATE TABLE media_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets (id),
  version INTEGER NOT NULL CHECK (version >= 1 AND version = CAST(version AS INTEGER)),
  r2_key TEXT,
  sha256 TEXT,
  content_type TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR (byte_length >= 0 AND byte_length = CAST(byte_length AS INTEGER))),
  prompt TEXT,
  negative TEXT,
  model TEXT,
  seed TEXT,
  look_snapshot_json TEXT,
  style_version_id TEXT REFERENCES style_versions (id),
  layers_hash TEXT,
  look_hash TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  immutable INTEGER NOT NULL DEFAULT 1 CHECK (immutable = 1),
  UNIQUE (asset_id, version)
);

-- 版本不可变。项目风格改变后不更新这里的 look_snapshot_json。

CREATE TABLE object_uploads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  content_type TEXT,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('staged', 'ready', 'abandoned', 'unavailable')),
  d1_ref_type TEXT,
  d1_ref_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER)),
  ready_at INTEGER CHECK (ready_at IS NULL OR (ready_at >= 0 AND ready_at = CAST(ready_at AS INTEGER)))
);

-- R2 与 D1 没有跨服务原子事务。对象是否存在必须在 batch 之外验证。
-- batch 只能提交数据库写入。ready 之后发现对象丢失时，以独立修复事务把 state 标成 unavailable。

CREATE TABLE channel_capabilities (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  support_status TEXT NOT NULL DEFAULT 'unverified' CHECK (support_status IN ('unverified', 'unavailable', 'supported')),
  verified_at INTEGER CHECK (verified_at IS NULL OR (verified_at >= 0 AND verified_at = CAST(verified_at AS INTEGER))),
  notes_json TEXT,
  UNIQUE (channel_id, protocol)
);

-- 不预插渠道。未实测的能力保持缺席，不能写成 supported。

CREATE TABLE task_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  channel_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  config_json TEXT NOT NULL,
  asset_version_ids_json TEXT,
  style_version_id TEXT REFERENCES style_versions (id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'contract_only')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0 AND created_at = CAST(created_at AS INTEGER))
);

-- 只允许契约状态。没有排队、调用或重试状态。

CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta (key, value) VALUES
  ('migration', '0001_initial'),
  ('id_format', 'uuid_v4'),
  ('time_unit', 'epoch_ms'),
  ('raw_json_r2_threshold_bytes', '262144'),
  ('d1_max_row_bytes', '2000000'),
  ('media_read', 'private');
