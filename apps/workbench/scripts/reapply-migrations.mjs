import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "00000000-0000-4000-8000-00000000c0de";

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], {
      cwd: root,
      env: {
        ...process.env,
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`wrangler ${args.join(" ")} 退出码 ${code}\n${output}`));
    });
  });
}

function parseExecuteJson(output) {
  const start = output.indexOf("[");
  const objectStart = output.indexOf("{");
  const index = start === -1 ? objectStart : objectStart === -1 ? start : Math.min(start, objectStart);
  if (index === -1) throw new Error(`没有解析到 JSON：\n${output}`);
  return JSON.parse(output.slice(index));
}

async function execute(persistTo, sql) {
  const output = await runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    persistTo,
    "--json",
    "--command",
    sql,
  ]);
  return parseExecuteJson(output);
}

const persistTo = await mkdtemp(path.join(tmpdir(), "workbench-d1-"));
try {
  const first = await runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    persistTo,
  ]);
  if (!/0001_initial/.test(first) && !/applied/i.test(first)) {
    throw new Error(`第一次迁移输出无法确认已应用：\n${first}`);
  }

  await execute(
    persistTo,
    `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('${projectId}', 'migration-sentinel', 1700000000000, 1700000000000)`,
  );

  const second = await runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    persistTo,
  ]);

  const migrations = await execute(
    persistTo,
    "SELECT name FROM d1_migrations ORDER BY name",
  );
  const projects = await execute(
    persistTo,
    `SELECT name, created_at FROM projects WHERE id = '${projectId}'`,
  );
  const expectedMigrations = (await readdir(path.join(root, "migrations"))).filter(file => file.endsWith(".sql")).sort();
  const migrationRows = rowsOf(migrations);
  const projectRows = rowsOf(projects);
  if (JSON.stringify(migrationRows.map(row => row.name).sort()) !== JSON.stringify(expectedMigrations)) {
    throw new Error(`重复迁移后记录应为 ${expectedMigrations.join(", ")}，实际 ${migrationRows.length}\n第二次输出：\n${second}`);
  }
  if (projectRows.length !== 1 || projectRows[0].name !== "migration-sentinel") {
    throw new Error(`哨兵项目在第二次迁移后丢失：${JSON.stringify(projectRows)}\n${second}`);
  }
  if (Number(projectRows[0].created_at) !== 1700000000000) {
    throw new Error(`时间字段不是预期的 epoch 毫秒：${JSON.stringify(projectRows[0])}`);
  }
  console.log("空库迁移、进程重启后再迁移：通过。迁移记录与文件列表一致，哨兵项目仍在。");
  console.log(second.trim().split("\n").slice(-8).join("\n"));
} finally {
  await rm(persistTo, { recursive: true, force: true });
}

function rowsOf(payload) {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (first && Array.isArray(first.results)) return first.results;
    return payload;
  }
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}
