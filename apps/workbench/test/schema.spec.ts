import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createId } from "../src/ids";

const EXPECTED_TABLES = [
  "projects",
  "project_settings",
  "style_versions",
  "characters",
  "character_aliases",
  "scenes",
  "props",
  "prop_carriers",
  "prop_scene_links",
  "outline_docs",
  "beats",
  "episodes",
  "episode_links",
  "script_batches",
  "script_episodes",
  "script_scenes",
  "script_beats",
  "storyboard_docs",
  "storyboard_segments",
  "storyboard_cuts",
  "storyboard_cut_beats",
  "import_runs",
  "import_entity_map",
  "source_identities",
  "document_blobs",
  "media_assets",
  "media_versions",
  "object_uploads",
  "channel_capabilities",
  "task_snapshots",
  "schema_meta",
];

async function insertProject(name: string): Promise<string> {
  const id = createId();
  await env.DB.prepare(
    "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, name, 1_700_000_000_000, 1_700_000_000_000)
    .run();
  return id;
}

describe("初始迁移", () => {
  it("重复应用不会增加迁移记录，也不会清掉已有行", async () => {
    const testEnv = env as Env & {
      TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
    };
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{
      n: number;
    }>();
    const projectId = await insertProject("reapply");
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{
      n: number;
    }>();
    const row = await env.DB.prepare("SELECT name FROM projects WHERE id = ?")
      .bind(projectId)
      .first<{ name: string }>();
    expect(before?.n).toBe(1);
    expect(after?.n).toBe(1);
    expect(row?.name).toBe("reapply");
  });

  it("创建约定中的表，并且不预插渠道能力", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' AND name != '_cf_METADATA'",
    ).all<{ name: string }>();
    const names = tables.results.map((row) => row.name).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
    const channels = await env.DB.prepare("SELECT COUNT(*) AS n FROM channel_capabilities").first<{
      n: number;
    }>();
    expect(channels?.n).toBe(0);
    const meta = await env.DB.prepare(
      "SELECT value FROM schema_meta WHERE key = 'time_unit'",
    ).first<{ value: string }>();
    expect(meta?.value).toBe("epoch_ms");
  });

  it("显示码可空且非空时按项目唯一，内部 ID 不受影响", async () => {
    const projectId = await insertProject("codes");
    const first = createId();
    const second = createId();
    await env.DB.prepare(
      `INSERT INTO characters (
        id, project_id, display_code, name, sort_order, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    )
      .bind(first, projectId, "甲", 1, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.DB.prepare(
      `INSERT INTO characters (
        id, project_id, display_code, name, sort_order, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    )
      .bind(second, projectId, "乙", 2, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    const coded = createId();
    await env.DB.prepare(
      `INSERT INTO characters (
        id, project_id, display_code, name, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(coded, projectId, "C01", "丙", 3, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO characters (
          id, project_id, display_code, name, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(createId(), projectId, "C01", "丁", 4, 1_700_000_000_000, 1_700_000_000_000)
        .run(),
    ).rejects.toThrow();
    const renamed = await env.DB.prepare(
      "UPDATE characters SET display_code = ?, name = ? WHERE id = ? RETURNING id",
    )
      .bind("C02", "丙改名", coded)
      .first<{ id: string }>();
    expect(renamed?.id).toBe(coded);
  });

  it("拒绝非整数时间", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
        .bind(createId(), "fraction", 1.5, 1.5)
        .run(),
    ).rejects.toThrow();
  });

  it("VO 不挂人物，分镜认领使用有序链接", async () => {
    const projectId = await insertProject("vo");
    const batchId = createId();
    const scriptEpisodeId = createId();
    const scriptSceneId = createId();
    const beatA = createId();
    const beatC = createId();
    const voBeat = createId();
    const segmentId = createId();
    const cutId = createId();
    const now = 1_700_000_000_000;

    await env.DB.prepare(
      `INSERT INTO script_batches (id, project_id, raw_json, created_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(batchId, projectId, "{}", now)
      .run();
    await env.DB.prepare(
      `INSERT INTO script_episodes (id, batch_id, ep_number, beats_claimed_text, beats_claimed_unresolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(scriptEpisodeId, batchId, 1, "冲突", 1, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO script_scenes (id, script_episode_id, sort_order, scene_seconds_extension, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(scriptSceneId, scriptEpisodeId, 0, 12.5, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO script_beats (
        id, script_scene_id, sort_order, speaker_kind, speaker_external_name, speaker_source_code, flow_seconds, created_at
      ) VALUES (?, ?, ?, 'vo', ?, ?, ?, ?)`,
    )
      .bind(voBeat, scriptSceneId, 0, "旁白", "VO01", 1.25, now)
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO script_beats (
          id, script_scene_id, sort_order, speaker_kind, speaker_character_id, created_at
        ) VALUES (?, ?, ?, 'vo', ?, ?)`,
      )
        .bind(createId(), scriptSceneId, 1, createId(), now)
        .run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      `INSERT INTO script_beats (id, script_scene_id, sort_order, speaker_kind, created_at)
       VALUES (?, ?, ?, 'none', ?)`,
    )
      .bind(beatA, scriptSceneId, 2, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO script_beats (id, script_scene_id, sort_order, speaker_kind, created_at)
       VALUES (?, ?, ?, 'none', ?)`,
    )
      .bind(beatC, scriptSceneId, 4, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO storyboard_segments (id, project_id, sort_order, h3_prompt, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(segmentId, projectId, 0, "h3 原文", now)
      .run();
    await env.DB.prepare(
      `INSERT INTO storyboard_cuts (id, segment_id, sort_order, created_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(cutId, segmentId, 0, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO storyboard_cut_beats (cut_id, beat_id, sort_order) VALUES (?, ?, ?)",
    )
      .bind(cutId, beatA, 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO storyboard_cut_beats (cut_id, beat_id, sort_order) VALUES (?, ?, ?)",
    )
      .bind(cutId, beatC, 1)
      .run();
    const links = await env.DB.prepare(
      "SELECT beat_id FROM storyboard_cut_beats WHERE cut_id = ? ORDER BY sort_order",
    )
      .bind(cutId)
      .all<{ beat_id: string }>();
    expect(links.results.map((row) => row.beat_id)).toEqual([beatA, beatC]);
  });

  it("媒体状态分列保存，任务快照不能写成已排队", async () => {
    const projectId = await insertProject("media");
    const assetId = createId();
    const now = 1_700_000_000_000;
    await env.DB.prepare(
      `INSERT INTO media_assets (
        id, project_id, entity_type, entity_id, role, file_presence, generation_state, executor_wait, created_at, updated_at
      ) VALUES (?, ?, 'scene', ?, 'scene_plate', 'ready', 'none', 'waiting', ?, ?)`,
    )
      .bind(assetId, projectId, createId(), now, now)
      .run();
    const asset = await env.DB.prepare(
      "SELECT file_presence, executor_wait FROM media_assets WHERE id = ?",
    )
      .bind(assetId)
      .first<{ file_presence: string; executor_wait: string }>();
    expect(asset).toEqual({ file_presence: "ready", executor_wait: "waiting" });

    await expect(
      env.DB.prepare(
        `INSERT INTO task_snapshots (
          id, project_id, channel_id, capability, input_fingerprint, config_json, status, created_at
        ) VALUES (?, ?, 'none', 'image', 'fp', '{}', 'queued', ?)`,
      )
        .bind(createId(), projectId, now)
        .run(),
    ).rejects.toThrow();
    await env.DB.prepare(
      `INSERT INTO task_snapshots (
        id, project_id, channel_id, capability, input_fingerprint, config_json, status, created_at
      ) VALUES (?, ?, 'none', 'image', 'fp', '{}', 'contract_only', ?)`,
    )
      .bind(createId(), projectId, now)
      .run();
  });
});
