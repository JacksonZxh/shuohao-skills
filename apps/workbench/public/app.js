const summary = document.querySelector("#summary");
const status = document.querySelector("#status");
const refresh = document.querySelector("#refresh");

const labels = {
  env: "运行环境",
  d1: "数据库",
  r2: "媒体桶",
  deployment: "远程部署",
  import: "文稿导入",
  gateway: "AI Gateway",
  executor: "本机执行器",
};

refresh.addEventListener("click", () => {
  void loadHealth();
});

async function loadHealth() {
  summary.textContent = "正在读取健康检查。";
  status.replaceChildren();
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || body.ok !== true) {
      summary.textContent = body.error?.message || "健康检查没有通过。";
      addRow(labels.env, body.env || "未知");
      return;
    }
    summary.textContent = "本地进程可用。远程资源还没有部署。";
    addRow(labels.env, body.env);
    addRow(labels.d1, body.checks?.d1?.ok ? "已连接，初始迁移已应用" : "不可用");
    addRow(
      labels.r2,
      body.checks?.r2?.public === false && body.checks?.r2?.read === "private"
        ? "私有，不直接读取对象"
        : "读取边界异常",
    );
    addRow(
      labels.deployment,
      body.deployment?.remote === "not_deployed" ? "尚未部署" : body.deployment?.remote || "未知",
    );
    addRow(labels.import, "尚未实现");
    addRow(labels.gateway, body.features?.ai_gateway?.status === "unverified" ? "未验证，尚未调用" : "状态异常");
    addRow(labels.executor, "尚未实现");
  } catch (error) {
    summary.textContent = "健康检查请求失败。请确认本地 Worker 已启动，并且迁移已应用。";
  }
}

function addRow(label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  status.append(term, detail);
}

void loadHealth();
