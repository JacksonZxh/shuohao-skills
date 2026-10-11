import { RAW_JSON_R2_THRESHOLD_BYTES } from "../constants";
import { SKILLS, type InputDocument, type PreparedDocument, type JsonValue, type JsonObject } from "../contracts/import";
import { PlatformError } from "./errors";

export const MAX_RAW_BYTES = 2 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

export async function sha256(bytes: Uint8Array): Promise<string> {
  // Uint8Array.from 固定为 ArrayBuffer，兼容 Worker WebCrypto 的 BufferSource。
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function canonicalJson(value: JsonValue, depth = 0): string {
  if (depth > 100) throw new PlatformError(422, "json_depth", "JSON 嵌套层级过深。");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!, depth + 1)}`).join(",")}}`;
}
function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 100) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isJson(item, depth + 1));
  return typeof value === "object" && Object.values(value).every(item => isJson(item, depth + 1));
}
export async function prepareDocuments(inputs: InputDocument[]): Promise<PreparedDocument[]> {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > SKILLS.length) {
    throw new PlatformError(422, "invalid_package", "每包需要一到三种文稿。");
  }
  const seen = new Set<string>();
  let total = 0;
  const result: PreparedDocument[] = [];
  for (const input of inputs) {
    if (!input || !SKILLS.includes(input.skill) || typeof input.raw !== "string" || seen.has(input.skill)) {
      throw new PlatformError(422, "invalid_package", "文稿种类无效或重复。");
    }
    seen.add(input.skill);
    const bytes = new TextEncoder().encode(input.raw);
    // TextEncoder 会替换孤立代理字符，必须拒绝以保证 raw 的字节和读回文本一致。
    if (new TextDecoder().decode(bytes) !== input.raw) throw new PlatformError(422, "invalid_utf8", "原文包含无效 Unicode 字符。");
    total += bytes.byteLength;
    if (bytes.byteLength > MAX_RAW_BYTES || total > MAX_PACKAGE_BYTES) {
      throw new PlatformError(413, "package_too_large", "文稿超过当前导入大小限制。");
    }
    let value: unknown;
    try { value = JSON.parse(input.raw); } catch { throw new PlatformError(422, "invalid_json", "原文不是有效 JSON。"); }
    if (!isJson(value) || value === null || Array.isArray(value) || typeof value !== "object") {
      throw new PlatformError(422, "invalid_json", "文稿根节点必须是有限深度 JSON 对象。");
    }
    const object: JsonObject = value;
    result.push({ ...input, value: object, byteLength: bytes.byteLength, byteSha256: await sha256(bytes),
      semanticFingerprint: await sha256(new TextEncoder().encode(canonicalJson(object))) });
  }
  return result;
}
export function rawNeedsR2(document: PreparedDocument): boolean { return document.byteLength > RAW_JSON_R2_THRESHOLD_BYTES; }
export async function packageFingerprint(documents: PreparedDocument[]): Promise<string> {
  const parts = documents.map(doc => [doc.skill, doc.semanticFingerprint]).sort((a,b) => a[0]!.localeCompare(b[0]!));
  return sha256(new TextEncoder().encode(JSON.stringify(parts)));
}
