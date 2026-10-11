import { isUuidV4 } from "./ids";

const SHA256_HEX = /^[a-f0-9]{64}$/;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
  bin: "application/octet-stream",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

export class ObjectKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectKeyError";
  }
}

export function assertSha256(value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new ObjectKeyError("内容哈希必须是 64 位小写十六进制 SHA-256。");
  }
}

export function assertUuidId(value: string, label: string): void {
  if (!isUuidV4(value)) {
    throw new ObjectKeyError(`${label} 必须是 UUID v4。`);
  }
}

/** 拒绝把本机路径写进对象键。 */
export function assertNotLocalPath(value: string, label: string): void {
  if (
    value.includes("\\") ||
    value.includes("..") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\0")
  ) {
    throw new ObjectKeyError(`${label} 不能是本机路径。`);
  }
}

export function contentTypeForExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  const contentType = EXTENSION_CONTENT_TYPES[normalized];
  if (!contentType) {
    throw new ObjectKeyError(`不接受未知的文件扩展名：${normalized || "空"}。`);
  }
  return contentType;
}

export function assertContentTypeMatchesExtension(
  extension: string,
  contentType: string,
): void {
  const expected = contentTypeForExtension(extension);
  if (contentType.trim().toLowerCase() !== expected) {
    throw new ObjectKeyError(
      `内容类型 ${contentType} 与扩展名 ${extension} 不一致，期望 ${expected}。`,
    );
  }
}

export function novelObjectKey(projectId: string, sha256: string): string {
  assertUuidId(projectId, "项目 ID");
  assertSha256(sha256);
  return `projects/${projectId}/novels/${sha256}.bin`;
}

export function documentObjectKey(
  projectId: string,
  skill: string,
  fingerprint: string,
): string {
  assertUuidId(projectId, "项目 ID");
  assertPathSegment(skill, "文稿种类");
  assertSha256(fingerprint);
  return `projects/${projectId}/docs/${skill}/${fingerprint}.json`;
}

export function mediaObjectKey(
  projectId: string,
  assetId: string,
  version: number,
  sha256: string,
  extension: string,
): string {
  assertUuidId(projectId, "项目 ID");
  assertUuidId(assetId, "素材 ID");
  if (!Number.isInteger(version) || version < 1) {
    throw new ObjectKeyError("媒体版本号必须是从 1 开始的整数。");
  }
  assertSha256(sha256);
  const normalized = extension.toLowerCase().replace(/^\./, "");
  contentTypeForExtension(normalized);
  return `projects/${projectId}/media/${assetId}/v${version}/${sha256}.${normalized}`;
}

export function stagedImportObjectKey(
  projectId: string,
  importRunId: string,
  sha256: string,
  extension: string,
): string {
  assertUuidId(projectId, "项目 ID");
  assertUuidId(importRunId, "导入运行 ID");
  assertSha256(sha256);
  const normalized = extension.toLowerCase().replace(/^\./, "");
  contentTypeForExtension(normalized);
  return `projects/${projectId}/imports/${importRunId}/staged/${sha256}.${normalized}`;
}

function assertPathSegment(value: string, label: string): void {
  assertNotLocalPath(value, label);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
    throw new ObjectKeyError(`${label} 只能使用小写字母、数字和连字符。`);
  }
}
