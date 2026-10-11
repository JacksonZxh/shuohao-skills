import { inspectConfig, type RuntimeConfigInput } from "./config";
import { handleExecutor } from "./executor";
import { handleHealth } from "./health";
import { jsonError } from "./http";
import { handlePrivateMedia } from "./media";

const PATH_QUERY_KEYS = ["path", "file", "filepath", "dir", "localpath"];

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env);
    }
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return jsonError(503, "config_missing", "静态资源绑定缺失，页面无法读取。", {
        missing: ["ASSETS"],
      });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export async function handleApi(request: Request, url: URL, env: Env): Promise<Response> {
  console.log(
    JSON.stringify({
      message: "api request",
      method: request.method,
      path: url.pathname,
      appEnv: env.APP_ENV,
    }),
  );

  const rejected = rejectUnsafeApiRequest(url);
  if (rejected) return rejected;

  const config = inspectConfig(env as RuntimeConfigInput);
  if (!config.ok) {
    return jsonError(503, config.code, config.message, {
      missing: config.missing,
      invalid: config.invalid,
    });
  }

  if (url.pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError(405, "method_not_allowed", "健康检查只接受 GET。");
    }
    const response = await handleHealth(env, config);
    if (request.method === "HEAD") {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  }

  if (url.pathname === "/api/media" || url.pathname.startsWith("/api/media/")) {
    return handlePrivateMedia();
  }
  if (url.pathname === "/api/objects" || url.pathname.startsWith("/api/objects/")) {
    return handlePrivateMedia();
  }

  if (url.pathname === "/api/import" || url.pathname.startsWith("/api/import/")) {
    return jsonError(501, "not_implemented", "文稿导入尚未实现。", { feature: "import" });
  }
  if (url.pathname === "/api/gateway" || url.pathname.startsWith("/api/gateway/")) {
    return jsonError(501, "not_implemented", "AI Gateway 调用尚未实现。当前状态是未验证，不是已连通。", {
      feature: "ai_gateway",
    });
  }
  if (url.pathname === "/api/executor" || url.pathname.startsWith("/api/executor/")) {
    return handleExecutor(request, url, env, config);
  }

  return jsonError(404, "not_found", "没有这个接口。");
}

function rejectUnsafeApiRequest(url: URL): Response | null {
  if (url.searchParams.has("sql") || url.pathname === "/api/sql" || url.pathname === "/api/query") {
    return jsonError(400, "rejected", "不接受原始 SQL 或表名。");
  }
  if (url.pathname.includes("..") || url.pathname.includes("\\")) {
    return jsonError(400, "path_rejected", "不接受本机文件路径。");
  }
  for (const key of PATH_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    if (
      value.includes("..") ||
      value.includes("\\") ||
      value.startsWith("/") ||
      /^[A-Za-z]:/.test(value)
    ) {
      return jsonError(400, "path_rejected", "不接受本机文件路径。");
    }
  }
  return null;
}
