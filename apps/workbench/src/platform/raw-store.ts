import { documentObjectKey } from "../r2-keys";
import { createId } from "../ids";
import type { PreparedDocument } from "../contracts/import";
import { MAX_RAW_BYTES, sha256, rawNeedsR2 } from "./documents";
import { PlatformError } from "./errors";

export interface RawRecord {
  id: string;
  project_id: string;
  skill: string;
  raw_json: string | null;
  r2_key: string | null;
  byte_sha256: string;
  semantic_fingerprint: string;
  byte_length: number;
}
export interface StoredRaw { rawJson: string | null; r2Key: string | null; }

export class RawStore {
  constructor(private readonly db: D1Database, private readonly media: R2Bucket) {}
  location(projectId: string, doc: PreparedDocument): StoredRaw {
    return rawNeedsR2(doc) ? { rawJson: null, r2Key: documentObjectKey(projectId, doc.skill, doc.byteSha256) }
      : { rawJson: doc.raw, r2Key: null };
  }
  async stage(projectId: string, doc: PreparedDocument): Promise<StoredRaw> {
    if (!rawNeedsR2(doc)) return { rawJson: doc.raw, r2Key: null };
    const key = documentObjectKey(projectId, doc.skill, doc.byteSha256);
    const now = Date.now();
    // 账本先于对象。D1 finalize失败后这个记录仍可追踪；不覆盖ready引用。
    await this.db.prepare(`INSERT INTO object_uploads (id,project_id,r2_key,sha256,content_type,purpose,state,created_at)
      VALUES (?,?,?,?,?,'raw_document','staged',?) ON CONFLICT(r2_key) DO NOTHING`)
      .bind(createId(), projectId, key, doc.byteSha256, "application/json", now).run();
    await this.media.put(key, doc.raw, { onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { sha256: doc.byteSha256 } });
    await this.verifyObject(key, doc.byteSha256, doc.byteLength);
    return { rawJson: null, r2Key: key };
  }
  async read(record: RawRecord): Promise<string> {
    if (record.byte_length > MAX_RAW_BYTES || record.byte_length < 0) throw new PlatformError(503, "raw_unavailable", "原文大小记录无效。");
    let raw: string;
    if (record.r2_key !== null) {
      if (record.r2_key !== documentObjectKey(record.project_id, record.skill, record.byte_sha256)) {
        throw new PlatformError(503, "raw_unavailable", "原文对象引用无效。");
      }
      raw = await this.verifyObject(record.r2_key, record.byte_sha256, record.byte_length);
    } else if (record.raw_json !== null) raw = record.raw_json;
    else throw new PlatformError(503, "raw_unavailable", "原文内容不可用。");
    const bytes = new TextEncoder().encode(raw);
    if (bytes.byteLength !== record.byte_length || await sha256(bytes) !== record.byte_sha256) {
      throw new PlatformError(503, "raw_integrity", "原文字节校验失败。");
    }
    return raw;
  }
  private async verifyObject(key: string, hash: string, byteLength: number): Promise<string> {
    const object = await this.media.get(key);
    if (!object || object.size !== byteLength || object.size > MAX_RAW_BYTES) {
      throw new PlatformError(503, "raw_unavailable", "原文对象缺失或大小不符。");
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== hash) throw new PlatformError(503, "raw_integrity", "原文对象字节校验失败。");
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new PlatformError(503, "raw_integrity", "原文对象不是有效 UTF-8。"); }
  }
  /** 无自动删除字节。仅修复账本；每页20个，适配Free的单请求查询预算。 */
  async reconcile(projectId: string, cursor = "", olderThan = Date.now() - 24 * 3600 * 1000): Promise<{
    checked: number; ready: number; unavailable: number; abandoned: number; cursor: string | null;
  }> {
    const rows = await this.db.prepare(`SELECT * FROM object_uploads WHERE project_id=? AND purpose='raw_document' AND id>? ORDER BY id LIMIT 20`)
      .bind(projectId, cursor).all<{ id: string; r2_key: string; sha256: string; created_at: number }>();
    let ready = 0, unavailable = 0, abandoned = 0;
    for (const row of rows.results) {
      const reference = await this.db.prepare("SELECT * FROM document_blobs WHERE project_id=? AND r2_key=? LIMIT 1")
        .bind(projectId, row.r2_key).first<RawRecord>();
      const prefix = `projects/${projectId}/docs/`;
      if (!row.r2_key.startsWith(prefix)) throw new PlatformError(503, "raw_unavailable", "对象账本范围不符。");
      if (reference) {
        let present = true;
        try { await this.read(reference); } catch (error) {
          if (!(error instanceof PlatformError)) throw error;
          present = false;
        }
        await this.db.prepare(`UPDATE object_uploads SET state=?,d1_ref_type='document_blob',d1_ref_id=?,ready_at=CASE WHEN ?='ready' THEN COALESCE(ready_at,?) ELSE ready_at END WHERE id=? AND project_id=?`)
          .bind(present ? "ready" : "unavailable", reference.id, present ? "ready" : "unavailable", Date.now(), row.id, projectId).run();
        if (present) ready++; else unavailable++;
      } else if (row.created_at <= olderThan) {
        // NOT EXISTS 在更新语句内检查，防止对账与finalize竞争误废弃已引用对象。
        const result = await this.db.prepare(`UPDATE object_uploads SET state='abandoned' WHERE id=? AND project_id=?
          AND state!='abandoned' AND NOT EXISTS(SELECT 1 FROM document_blobs WHERE project_id=? AND r2_key=?)`)
          .bind(row.id, projectId, projectId, row.r2_key).run();
        abandoned += result.meta.changes;
      }
    }
    return { checked: rows.results.length, ready, unavailable, abandoned,
      cursor: rows.results.length === 20 ? rows.results[19]!.id : null };
  }
}
