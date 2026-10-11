import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expectRefusal(target) {
  const result = spawnSync(process.execPath, ["scripts/preflight-deploy.mjs", target], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 1) {
    console.error(`${target} 预检应该拒绝部署，实际退出码是 ${result.status}`);
    console.error(output);
    process.exit(1);
  }
  if (!output.includes("拒绝部署") || !output.includes("未开通")) {
    console.error(`${target} 的拒绝说明不完整：\n${output}`);
    process.exit(1);
  }
  console.log(`${target}：部署已被拒绝（账户资源未开通）。`);
}

expectRefusal("preview");
expectRefusal("production");
