import { PlatformError } from "./errors";

/** 当前单操作者平台令牌，不是多租户账户权限。与 EXECUTOR_TOKEN 分开。 */
export class Operator {
  private constructor() {}
  static async authenticate(request: Request, token: string | undefined): Promise<Operator> {
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
      if (/token|secret|authorization|api.?key/i.test(key)) {
        throw new PlatformError(401, "unauthorized", "平台凭据只能通过 Authorization 请求头发送。");
      }
    }
    if (!token || token.trim().length < 32 || /\s/.test(token)) {
      throw new PlatformError(503, "auth_unconfigured", "平台令牌尚未正确配置。");
    }
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match || match[1]!.length > 4096) throw new PlatformError(401, "unauthorized", "平台请求未通过鉴权。");
    const encode = new TextEncoder();
    const [left, right] = await Promise.all([
      crypto.subtle.digest("SHA-256", encode.encode(match[1]!)),
      crypto.subtle.digest("SHA-256", encode.encode(token)),
    ]);
    if (!crypto.subtle.timingSafeEqual(left, right)) throw new PlatformError(401, "unauthorized", "平台请求未通过鉴权。");
    return new Operator();
  }
  assert(): void {
    if (!(this instanceof Operator)) throw new PlatformError(401, "unauthorized", "需要已鉴权的平台上下文。");
  }
}
