import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateResourceConfig } from "./check-config.mjs";
import { parseJsonc } from "./jsonc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

if (target !== "preview" && target !== "production") {
  console.error("命令：node scripts/preflight-deploy.mjs preview|production");
  process.exit(2);
}

const resources = JSON.parse(readFileSync(path.join(root, "config/resources.json"), "utf8"));
const wrangler = parseJsonc(readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
const errors = evaluateResourceConfig(resources, wrangler);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const profile = resources.profiles[target];
console.error(
  [
    `拒绝部署 ${target}。`,
    `D1「${profile.databaseName}」和 R2「${profile.bucketName}」仍是未开通占位（database_id=${profile.databaseId}）。`,
    "账户侧资源还没有绑定。本次不会创建库、不会迁移远程数据库、不会上传素材，也不会换成另一个环境来顶替。",
  ].join(""),
);
process.exit(1);
