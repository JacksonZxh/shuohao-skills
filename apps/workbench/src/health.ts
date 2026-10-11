import { R2_HEALTH_PROBE_KEY } from "./constants";
import type { ConfigSuccess } from "./config";
import { json } from "./http";

export async function handleHealth(env: Env, config: ConfigSuccess): Promise<Response> {
  const d1 = await checkD1(env.DB);
  const r2 = await checkR2(env.MEDIA);
  const ok = d1.ok && r2.ok;
  return json(ok ? 200 : 503, {
    ok,
    service: "shuohao-workbench",
    env: config.appEnv,
    time: Date.now(),
    checks: {
      d1,
      r2: {
        ok: r2.ok,
        binding: "present",
        public: false,
        read: "private",
        bucket: config.bucketName,
        ...(r2.detail ? { detail: r2.detail } : {}),
      },
      config: { ok: true },
    },
    resources: {
      databaseName: config.databaseName,
      databaseId: config.databaseId,
      bucketName: config.bucketName,
    },
    deployment: {
      remote: config.deploymentRemote,
      reason: config.deploymentReason,
    },
    features: {
      import: { status: "not_implemented" },
      ai_gateway: config.gateway,
      executor: {
        status: "not_implemented",
        authConfigured: config.executorConfigured,
      },
    },
  });
}

async function checkD1(db: D1Database): Promise<{ ok: boolean; schema: string | null; detail?: string }> {
  try {
    const row = await db
      .prepare("SELECT value FROM schema_meta WHERE key = ?")
      .bind("migration")
      .first<{ value: string }>();
    if (row?.value !== "0002_platform_imports") {
      return {
        ok: false,
        schema: null,
        detail: "数据库里没有初始迁移标记。请先在本地执行迁移。",
      };
    }
    return { ok: true, schema: "0002_platform_imports" };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "d1 health failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    return {
      ok: false,
      schema: null,
      detail: "数据库查询失败。请确认本地迁移已经应用。",
    };
  }
}

async function checkR2(media: R2Bucket): Promise<{ ok: boolean; detail?: string }> {
  try {
    await media.head(R2_HEALTH_PROBE_KEY);
    return { ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "r2 health failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    return { ok: false, detail: "媒体桶绑定不可用。" };
  }
}
