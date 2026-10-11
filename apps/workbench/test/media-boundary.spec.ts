import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const SENTINEL = "PRIVATE_SENTINEL_BYTES_DO_NOT_LEAK";

describe("R2 私有读取边界", () => {
  it("匿名请求拿不到已写入的对象字节", async () => {
    await env.MEDIA.put("projects/demo/secret.bin", SENTINEL);
    const media = await exports.default.fetch(
      "http://example.com/api/media/projects/demo/secret.bin",
    );
    expect(media.status).toBe(403);
    const mediaText = await media.text();
    expect(mediaText).toContain("private_media");
    expect(mediaText).not.toContain(SENTINEL);

    const objects = await exports.default.fetch(
      "http://example.com/api/objects/projects/demo/secret.bin",
    );
    expect(objects.status).toBe(403);
    expect(await objects.text()).not.toContain(SENTINEL);

    const health = await exports.default.fetch("http://example.com/api/health");
    expect(health.status).toBe(200);
    expect(await health.text()).not.toContain(SENTINEL);
  });

  it("私有边界不会调用对象读取", async () => {
    let reads = 0;
    const media = {
      async get() {
        reads += 1;
        return {
          async text() {
            return SENTINEL;
          },
        };
      },
      async head() {
        reads += 1;
        return null;
      },
      async put() {
        reads += 1;
      },
    };
    const request = new IncomingRequest("http://example.com/api/media/any-key");
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      request,
      { ...env, MEDIA: media } as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(await response.text()).not.toContain(SENTINEL);
  });

  it("拒绝原始 SQL 和本机路径", async () => {
    const sql = await exports.default.fetch("http://example.com/api/health?sql=select+1");
    expect(sql.status).toBe(400);
    expect(await sql.json()).toMatchObject({ error: { code: "rejected" } });

    const raw = await exports.default.fetch("http://example.com/api/sql");
    expect(raw.status).toBe(400);

    const path = await exports.default.fetch(
      "http://example.com/api/media?path=/tmp/novel.txt",
    );
    expect(path.status).toBe(400);
    expect(await path.json()).toMatchObject({ error: { code: "path_rejected" } });
  });

  it("导入和网关接口明确尚未实现", async () => {
    const imported = await exports.default.fetch("http://example.com/api/import", {
      method: "POST",
    });
    expect(imported.status).toBe(501);
    expect(await imported.json()).toMatchObject({
      error: { code: "not_implemented", feature: "import" },
    });

    const gateway = await exports.default.fetch("http://example.com/api/gateway/tasks", {
      method: "POST",
    });
    expect(gateway.status).toBe(501);
    const gatewayBody = await gateway.json<{ error: { message: string; feature: string } }>();
    expect(gatewayBody.error.feature).toBe("ai_gateway");
    expect(gatewayBody.error.message).toContain("尚未实现");
  });
});
