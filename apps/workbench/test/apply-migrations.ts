import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

type Migrations = Parameters<typeof applyD1Migrations>[1];

const testEnv = env as Env & { TEST_MIGRATIONS: Migrations };

// 测试准备脚本可能多次执行。applyD1Migrations 只会应用尚未记录的迁移。
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
