import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8791;
const testToken = "local-smoke-test-token-0000000000000000000000";
const persistTo = await mkdtemp(path.join(tmpdir(), "workbench-dev-"));

const wranglerBin = path.join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js");

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin, ...args], {
      cwd: root,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", WORKBENCH_TOKEN: testToken },
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

await runWrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo]);

const child = spawn(
  process.execPath,
  [wranglerBin, "dev", "--port", String(port), "--persist-to", persistTo, "--ip", "127.0.0.1"],
  {
    cwd: root,
    detached: true,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", WORKBENCH_TOKEN: testToken },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let log = "";
child.stdout.on("data", (chunk) => {
  log += chunk;
});
child.stderr.on("data", (chunk) => {
  log += chunk;
});

function signalGroup(signal) {
  if (typeof child.pid !== "number") return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 进程已经退出。
    }
  }
}

try {
  const ready = await waitForReady(child);
  if (!ready) {
    throw new Error(`wrangler dev 没有在预期时间内就绪。\n${log}`);
  }
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  const healthText = await healthResponse.text();
  if (healthResponse.status !== 200) {
    throw new Error(`健康检查状态 ${healthResponse.status}\n${healthText}\n${log}`);
  }
  const health = JSON.parse(healthText);
  if (health.ok !== true || health.deployment?.remote !== "not_deployed") {
    throw new Error(`健康检查内容不符合预期：\n${healthText}`);
  }
  if (health.checks?.r2?.read !== "private" || health.checks?.r2?.public !== false) {
    throw new Error(`R2 边界没有在健康检查中声明为私有：\n${healthText}`);
  }
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (page.status !== 200 || !html.includes("烁皓工作台")) {
    throw new Error(`静态壳状态 ${page.status}\n${html.slice(0, 400)}`);
  }
  const media = await fetch(`http://127.0.0.1:${port}/api/media/not-readable`);
  if (media.status !== 403) {
    throw new Error(`私有媒体边界返回了 ${media.status}`);
  }
  const api = async (route, method="GET", body) => {
    const response=await fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{authorization:`Bearer ${testToken}`,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok) throw new Error(`接口 ${route} 返回 ${response.status}: ${JSON.stringify(result)}`);
    return result;
  };
  const fixtureRoot=path.resolve(root,"../../docs/acceptance/pr2");
  const project=await api("/projects","POST",{name:"停钟档案 CLI 闭环验收"});
  const documents=await Promise.all([["novel-outline","outline"],["novel-characters","cast"],["novel-art","art"]].map(async([skill,name])=>({skill,raw:await readFile(path.join(fixtureRoot,`baseline/${name}.json`),"utf8")})));
  await api(`/projects/${project.id}/imports`,"POST",{documents});
  const snapshot=(await api(`/projects/${project.id}/snapshot`)).snapshot;
  const character=snapshot.entities.character.find(row=>row.display_code==="C01");
  await api(`/projects/${project.id}/characters/${character.id}`,"PATCH",{oneLiner:"馆员改为先复核时间，再质疑签名。",expectedRevision:1});
  const exported=[];
  for(const [skill,name] of [["novel-outline","outline"],["novel-characters","cast"],["novel-art","art"]]) {
    const document=(await api(`/projects/${project.id}/exports?skill=${skill}`)).document;
    const destination=path.join(persistTo,`${name}.json`);
    await writeFile(destination,JSON.stringify(document));exported.push({skill,raw:JSON.stringify(document)});
    if(name==="cast" && document.characters.find(c=>c.id==="C01").oneLiner!=="馆员改为先复核时间，再质疑签名。") throw new Error("导出没有反映数据库编辑");
  }
  const repositoryRoot=path.resolve(root,"../..");
  for(const args of [
    ["skills/novel-outline/scripts/novel-outline.mjs","validate",path.join(persistTo,"outline.json")],
    ["skills/novel-characters/scripts/novel-characters.mjs","validate",path.join(persistTo,"cast.json"),path.join(fixtureRoot,"story.txt"),"--lang","zh"],
    ["skills/novel-art/scripts/novel-art.mjs","validate",path.join(persistTo,"art.json"),"--cast",path.join(persistTo,"cast.json")],
  ]) await new Promise((resolve,reject)=>{
    const validator=spawn(process.execPath,args,{cwd:repositoryRoot,stdio:["ignore","pipe","pipe"]});let output="";
    validator.stdout.on("data",chunk=>{output+=chunk;});validator.stderr.on("data",chunk=>{output+=chunk;});
    validator.on("error",reject);validator.on("exit",code=>code===0?resolve():reject(new Error(`导出 CLI 校验失败 ${args[0]}\n${output}`)));
  });
  const second=await api("/projects","POST",{name:"导出再导入"});
  await api(`/projects/${second.id}/imports`,"POST",{documents:exported});
  const imported=(await api(`/projects/${second.id}/snapshot`)).snapshot;
  if(imported.entities.character.length!==2 || imported.entities.episode.length!==3 || imported.entities.carrier[0].source_code!=="小苏") throw new Error("导出再导入关联不一致");
  console.log("PR2 闭环通过：真实 HTTP 导入 → D1 角色编辑 → 三类规范化导出 → 原 skill CLI 校验 → 新项目再导入。");
  console.log(`本地 wrangler dev 通过：/api/health ${healthResponse.status}，静态壳 ${page.status}，媒体读取 ${media.status}。`);
  console.log(healthText);
} finally {
  signalGroup("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 400));
  signalGroup("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await rm(persistTo, { recursive: true, force: true });
}

function waitForReady(proc) {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (log.includes("Ready on") || log.includes(`localhost:${port}`) || log.includes(`127.0.0.1:${port}`)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (proc.exitCode !== null || Date.now() - started > 45000) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}
