import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./jsonc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_VAR_NAMES = new Set([
  "EXECUTOR_TOKEN",
  "AI_GATEWAY_TOKEN",
  "API_KEY",
  "SECRET",
  "PASSWORD",
  "OPENAI_API_KEY",
]);

export function evaluateResourceConfig(resources, wrangler) {
  const errors = [];
  const blocks = {
    local: wrangler,
    preview: wrangler.env?.preview,
    production: wrangler.env?.production,
  };

  for (const name of ["local", "preview", "production"]) {
    const expected = resources.profiles[name];
    const block = blocks[name];
    if (!expected) {
      errors.push(`资源配置缺少 ${name}`);
      continue;
    }
    if (!block) {
      errors.push(`wrangler 配置缺少 ${name}`);
      continue;
    }
    if (block.name !== expected.workerName) {
      errors.push(`${name} 的 Worker 名称应为 ${expected.workerName}`);
    }
    const database = block.d1_databases?.[0];
    const bucket = block.r2_buckets?.[0];
    const vars = block.vars ?? {};
    if (database?.binding !== "DB") errors.push(`${name} 缺少 DB 绑定`);
    if (database?.database_name !== expected.databaseName) {
      errors.push(`${name} 的 database_name 与资源配置不一致`);
    }
    if (database?.database_id !== expected.databaseId) {
      errors.push(`${name} 的 database_id 与资源配置不一致`);
    }
    if (database?.migrations_dir !== "migrations") {
      errors.push(`${name} 的迁移目录必须是 migrations`);
    }
    if (database?.remote !== false) errors.push(`${name} 的 D1 绑定不能指向远程`);
    if (bucket?.binding !== "MEDIA") errors.push(`${name} 缺少 MEDIA 绑定`);
    if (bucket?.bucket_name !== expected.bucketName) {
      errors.push(`${name} 的 bucket_name 与资源配置不一致`);
    }
    if (bucket?.remote !== false) errors.push(`${name} 的 R2 绑定不能指向远程`);
    if (vars.APP_ENV !== expected.appEnv) errors.push(`${name} 的 APP_ENV 不正确`);
    if (vars.MEDIA_PUBLIC !== "false") errors.push(`${name} 的 MEDIA_PUBLIC 必须是 false`);
    if (vars.REMOTE_RESOURCES !== expected.remoteResources) {
      errors.push(`${name} 的开通状态与资源配置不一致`);
    }
    if (vars.D1_DATABASE_NAME !== expected.databaseName) {
      errors.push(`${name} 的 D1_DATABASE_NAME 与绑定不一致`);
    }
    if (vars.D1_DATABASE_ID !== expected.databaseId) {
      errors.push(`${name} 的 D1_DATABASE_ID 与绑定不一致`);
    }
    if (vars.R2_BUCKET_NAME !== expected.bucketName) {
      errors.push(`${name} 的 R2_BUCKET_NAME 与绑定不一致`);
    }
    if (expected.remoteResources !== "unprovisioned") {
      errors.push(`${name} 在资源真正开通之前必须保持 unprovisioned`);
    }
    for (const key of Object.keys(vars)) {
      if (SECRET_VAR_NAMES.has(key)) errors.push(`${name} 的 vars 含有密钥字段 ${key}`);
    }
    const assets = block.assets;
    if (!assets) {
      errors.push(`${name} 必须声明静态资源目录`);
    } else if (assets.binding !== "ASSETS" || assets.directory !== "./public") {
      errors.push(`${name} 的静态资源必须绑定 ASSETS，目录为 ./public`);
    } else if (!assets.run_worker_first?.includes("/api/*")) {
      errors.push(`${name} 的 API 必须先进入 Worker`);
    }
  }

  const profiles = ["local", "preview", "production"].map((name) => resources.profiles[name]);
  const names = profiles.map((profile) => profile.databaseName);
  const ids = profiles.map((profile) => profile.databaseId);
  const buckets = profiles.map((profile) => profile.bucketName);
  const workers = profiles.map((profile) => profile.workerName);
  for (const group of [names, ids, buckets, workers]) {
    if (new Set(group).size !== group.length) {
      errors.push(`环境资源标识有重复：${group.join(", ")}`);
    }
  }

  const previewText = JSON.stringify(wrangler.env?.preview ?? {});
  const production = resources.profiles.production;
  if (previewText.includes(production.databaseId) || previewText.includes(production.databaseName)) {
    errors.push("preview 配置写进了 production 的数据库");
  }
  if (previewText.includes(production.bucketName)) {
    errors.push("preview 配置写进了 production 的桶");
  }

  if (wrangler.observability?.enabled !== true) errors.push("需要开启 Workers Logs");
  if (wrangler.observability?.traces?.enabled !== true) errors.push("需要开启 Workers Traces");
  return errors;
}

export function assertExampleSecrets(text) {
  const errors = [];
  if (/sk-[A-Za-z0-9]/.test(text) || /eyJ[A-Za-z0-9_-]{8,}/.test(text)) {
    errors.push("示例文件里出现了看起来像密钥的字符串");
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (value !== "") errors.push(`示例密钥必须留空：${trimmed.slice(0, separator)}`);
  }
  return errors;
}

function loadRealConfig() {
  const resources = JSON.parse(readFileSync(path.join(root, "config/resources.json"), "utf8"));
  const wranglerText = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  const example = readFileSync(path.join(root, ".dev.vars.example"), "utf8");
  return {
    resources,
    wrangler: parseJsonc(wranglerText),
    wranglerText,
    example,
  };
}

function selfTest() {
  const { resources, wrangler } = loadRealConfig();
  const failures = [];
  const healthy = evaluateResourceConfig(resources, wrangler);
  if (healthy.length > 0) failures.push(`真实配置应该通过：${healthy.join("；")}`);

  const sharedName = structuredClone(wrangler);
  sharedName.env.preview.d1_databases[0].database_name =
    resources.profiles.production.databaseName;
  sharedName.env.preview.vars.D1_DATABASE_NAME = resources.profiles.production.databaseName;
  if (evaluateResourceConfig(resources, sharedName).length === 0) {
    failures.push("preview 写成 production 库名时应当失败");
  }

  const publicMedia = structuredClone(wrangler);
  publicMedia.vars.MEDIA_PUBLIC = "true";
  if (evaluateResourceConfig(resources, publicMedia).length === 0) {
    failures.push("MEDIA_PUBLIC=true 应当失败");
  }

  const sameId = structuredClone(wrangler);
  sameId.env.preview.d1_databases[0].database_id = resources.profiles.production.databaseId;
  sameId.env.preview.vars.D1_DATABASE_ID = resources.profiles.production.databaseId;
  if (evaluateResourceConfig(resources, sameId).length === 0) {
    failures.push("preview 与 production 的 database_id 相同时应当失败");
  }

  const secretExample = assertExampleSecrets("EXECUTOR_TOKEN=\nAI_GATEWAY_TOKEN=\n");
  if (secretExample.length > 0) failures.push(secretExample.join("；"));
  const leaked = assertExampleSecrets("EXECUTOR_TOKEN=super-secret\n");
  if (leaked.length === 0) failures.push("示例文件中的非空密钥应当失败");

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

function main() {
  selfTest();
  const { resources, wrangler, wranglerText, example } = loadRealConfig();
  const errors = [
    ...evaluateResourceConfig(resources, wrangler),
    ...assertExampleSecrets(example),
    ...assertExampleSecrets(wranglerText),
  ];
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("配置检查通过：preview 与 production 资源名彼此独立，远程资源仍是未开通占位。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
