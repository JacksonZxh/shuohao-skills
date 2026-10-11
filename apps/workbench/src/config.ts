import {
  APP_ENV_NAMES,
  RESOURCE_PROFILES,
  UNPROVISIONED_DATABASE_IDS,
  type AppEnvName,
} from "./constants";
import { describeGateway, type GatewayReport } from "./gateway";

export interface RuntimeConfigInput {
  DB?: unknown;
  MEDIA?: unknown;
  ASSETS?: unknown;
  APP_ENV?: unknown;
  MEDIA_PUBLIC?: unknown;
  REMOTE_RESOURCES?: unknown;
  D1_DATABASE_NAME?: unknown;
  D1_DATABASE_ID?: unknown;
  R2_BUCKET_NAME?: unknown;
  AI_GATEWAY_BASE_URL?: unknown;
  AI_GATEWAY_ACCOUNT_ID?: unknown;
  AI_GATEWAY_GATEWAY_ID?: unknown;
  EXECUTOR_TOKEN?: unknown;
}

export interface ConfigInvalidField {
  field: string;
  message: string;
}

export interface ConfigFailure {
  ok: false;
  code: "config_missing" | "config_invalid";
  message: string;
  missing: string[];
  invalid: ConfigInvalidField[];
}

export interface ConfigSuccess {
  ok: true;
  appEnv: AppEnvName;
  mediaPublic: false;
  remoteResources: "unprovisioned" | "provisioned";
  databaseName: string;
  databaseId: string;
  bucketName: string;
  deploymentRemote: "not_deployed" | "configured_not_verified";
  deploymentReason: string;
  gateway: GatewayReport;
  executorConfigured: boolean;
}

function isBinding(value: unknown, method: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    method in value &&
    typeof (value as Record<string, unknown>)[method] === "function"
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function inspectConfig(env: RuntimeConfigInput): ConfigSuccess | ConfigFailure {
  const missing: string[] = [];
  const invalid: ConfigInvalidField[] = [];

  if (!isBinding(env.DB, "prepare")) missing.push("DB");
  if (!isBinding(env.MEDIA, "head") || !isBinding(env.MEDIA, "get")) missing.push("MEDIA");
  if (!isBinding(env.ASSETS, "fetch")) missing.push("ASSETS");

  const appEnv = readString(env.APP_ENV);
  if (appEnv === undefined) missing.push("APP_ENV");
  else if (!APP_ENV_NAMES.includes(appEnv as AppEnvName)) {
    invalid.push({
      field: "APP_ENV",
      message: "APP_ENV 只能是 local、preview 或 production。",
    });
  }

  const mediaPublic = readString(env.MEDIA_PUBLIC);
  if (mediaPublic === undefined) missing.push("MEDIA_PUBLIC");
  else if (mediaPublic !== "false") {
    invalid.push({
      field: "MEDIA_PUBLIC",
      message: "媒体桶必须保持私有。MEDIA_PUBLIC 只能填写 false。",
    });
  }

  const remoteResources = readString(env.REMOTE_RESOURCES);
  if (remoteResources === undefined) missing.push("REMOTE_RESOURCES");
  else if (remoteResources !== "unprovisioned" && remoteResources !== "provisioned") {
    invalid.push({
      field: "REMOTE_RESOURCES",
      message: "REMOTE_RESOURCES 只能是 unprovisioned 或 provisioned。",
    });
  }

  const databaseName = readString(env.D1_DATABASE_NAME);
  const databaseId = readString(env.D1_DATABASE_ID);
  const bucketName = readString(env.R2_BUCKET_NAME);
  if (databaseName === undefined) missing.push("D1_DATABASE_NAME");
  if (databaseId === undefined) missing.push("D1_DATABASE_ID");
  if (bucketName === undefined) missing.push("R2_BUCKET_NAME");

  for (const field of [
    "AI_GATEWAY_BASE_URL",
    "AI_GATEWAY_ACCOUNT_ID",
    "AI_GATEWAY_GATEWAY_ID",
  ] as const) {
    if (readString(env[field]) === undefined) missing.push(field);
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: "config_missing",
      message: "工作台配置不完整，拒绝处理业务请求。",
      missing,
      invalid,
    };
  }

  if (
    appEnv &&
    APP_ENV_NAMES.includes(appEnv as AppEnvName) &&
    databaseName !== undefined &&
    databaseId !== undefined &&
    bucketName !== undefined &&
    remoteResources !== undefined
  ) {
    const profile = RESOURCE_PROFILES[appEnv as AppEnvName];
    if (databaseName !== profile.databaseName) {
      invalid.push({
        field: "D1_DATABASE_NAME",
        message: `${appEnv} 的数据库名必须是 ${profile.databaseName}，不能换成其他环境的库。`,
      });
    }
    if (databaseId !== profile.databaseId) {
      invalid.push({
        field: "D1_DATABASE_ID",
        message: `${appEnv} 的 database_id 与已登记的资源配置不一致。`,
      });
    }
    if (bucketName !== profile.bucketName) {
      invalid.push({
        field: "R2_BUCKET_NAME",
        message: `${appEnv} 的桶名必须是 ${profile.bucketName}，不能换成其他环境的桶。`,
      });
    }
    if (remoteResources !== profile.remoteResources) {
      invalid.push({
        field: "REMOTE_RESOURCES",
        message: `${appEnv} 的开通状态与已登记的资源配置不一致。`,
      });
    }
    const sentinel = UNPROVISIONED_DATABASE_IDS.has(databaseId);
    if (sentinel && remoteResources === "provisioned") {
      invalid.push({
        field: "REMOTE_RESOURCES",
        message: "database_id 仍是未开通占位，不能标记为已开通。",
      });
    }
    if (!sentinel && remoteResources === "unprovisioned") {
      invalid.push({
        field: "D1_DATABASE_ID",
        message: "database_id 已不是占位值，但开通状态仍是未开通。",
      });
    }
  }

  if (invalid.length > 0 || !appEnv || !databaseName || !databaseId || !bucketName || !remoteResources) {
    return {
      ok: false,
      code: "config_invalid",
      message: "工作台配置无效，拒绝处理业务请求。",
      missing,
      invalid,
    };
  }

  const typedEnv = appEnv as AppEnvName;
  const typedRemote = remoteResources as "unprovisioned" | "provisioned";
  const sentinel = UNPROVISIONED_DATABASE_IDS.has(databaseId);
  const notDeployed = typedRemote === "unprovisioned" || sentinel;

  return {
    ok: true,
    appEnv: typedEnv,
    mediaPublic: false,
    remoteResources: typedRemote,
    databaseName,
    databaseId,
    bucketName,
    deploymentRemote: notDeployed ? "not_deployed" : "configured_not_verified",
    deploymentReason: notDeployed
      ? "账户侧的 preview 与 production 资源还没有绑定。这个结果来自当前进程，不能当成远程部署。"
      : "资源配置不再是占位值，但这个进程没有执行部署，也不能证明账户侧已经开通。",
    gateway: describeGateway({
      baseUrl: env.AI_GATEWAY_BASE_URL as string,
      accountId: env.AI_GATEWAY_ACCOUNT_ID as string,
      gatewayId: env.AI_GATEWAY_GATEWAY_ID as string,
    }),
    executorConfigured:
      typeof env.EXECUTOR_TOKEN === "string" && env.EXECUTOR_TOKEN.length > 0,
  };
}
