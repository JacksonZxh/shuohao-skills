import type { ConfigSuccess } from "./config";
import { json, jsonError } from "./http";

const TOKEN_QUERY_KEYS = ["token", "secret", "executor_token", "authorization"];

export async function handleExecutor(
  request: Request,
  url: URL,
  env: { EXECUTOR_TOKEN?: string },
  config: ConfigSuccess,
): Promise<Response> {
  if (url.pathname !== "/api/executor/heartbeat") {
    return jsonError(501, "not_implemented", "本机执行器尚未实现。", {
      feature: "executor",
    });
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed", "执行器心跳只接受 POST。", {
      feature: "executor",
    });
  }
  for (const key of TOKEN_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      return jsonError(401, "unauthorized", "执行器鉴权不能放在网址里。");
    }
  }
  if (!config.executorConfigured || !env.EXECUTOR_TOKEN) {
    return jsonError(503, "config_missing", "执行器密钥尚未配置，已拒绝该请求。", {
      missing: ["EXECUTOR_TOKEN"],
      feature: "executor",
    });
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  const presented = match?.[1] ?? "";
  const authorized =
    presented.length > 0 && (await timingSafeEqualText(presented, env.EXECUTOR_TOKEN));
  if (!authorized) {
    return jsonError(401, "unauthorized", "执行器请求未通过鉴权。");
  }

  return json(501, {
    ok: false,
    error: {
      code: "not_implemented",
      message: "鉴权通过，但本机执行器尚未实现。没有写入业务数据。",
      feature: "executor",
    },
  });
}

async function timingSafeEqualText(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return diff === 0;
}
