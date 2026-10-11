import resources from "../config/resources.json";

/** 原文稿 UTF-8 字节超过此值时外置 R2。这是项目设计阈值，不是 D1 官方行上限。 */
export const RAW_JSON_R2_THRESHOLD_BYTES = resources.rawJsonR2ThresholdBytes;

/** D1 单行上限。依据：https://developers.cloudflare.com/d1/platform/limits/ */
export const D1_MAX_ROW_BYTES = resources.d1MaxRowBytes;

export const R2_HEALTH_PROBE_KEY = "_system/health/probe-absent";

export const UNPROVISIONED_DATABASE_IDS = new Set<string>([
  resources.profiles.local.databaseId,
  resources.profiles.preview.databaseId,
  resources.profiles.production.databaseId,
]);

export const RESOURCE_PROFILES = resources.profiles;

export type AppEnvName = keyof typeof resources.profiles;

export const APP_ENV_NAMES = Object.keys(resources.profiles) as AppEnvName[];
