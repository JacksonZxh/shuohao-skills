import { json } from "../http";
import type { ImportIssue } from "../contracts/import";

export class PlatformError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
    public readonly issues?: ImportIssue[]) { super(message); this.name = "PlatformError"; }
}
export function platformErrorResponse(error: unknown): Response {
  if (error instanceof PlatformError) {
    return json(error.status, { ok: false, error: { code: error.code, message: error.message,
      ...(error.issues ? { issues: error.issues } : {}) } });
  }
  // 不输出 SQL、原文、凭据或供应商异常。详细诊断以后通过脱敏事件登记。
  console.error(JSON.stringify({ message: "platform request failed", code: "platform_unavailable" }));
  return json(503, { ok: false, error: { code: "platform_unavailable", message: "平台暂不可用，请稍后重试。" } });
}
