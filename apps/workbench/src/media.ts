import { jsonError } from "./http";

/** 匿名请求一律拒绝。不读取、不列出、不返回对象字节。 */
export function handlePrivateMedia(): Response {
  return jsonError(
    403,
    "private_media",
    "媒体对象只允许经业务接口在授权后读取。当前没有开放读取，也不会返回对象内容。",
    { feature: "media" },
  );
}
