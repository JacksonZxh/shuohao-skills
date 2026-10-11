# 烁皓工作台（M1 / F1）

Workers 静态壳、健康检查、D1 初始迁移、R2 私有读取边界。这是路线图 [#5](https://github.com/JacksonZxh/shuohao-skills/issues/5) 里 M1（[#6](https://github.com/JacksonZxh/shuohao-skills/issues/6)）的基础平台。新增F1契约、操作者鉴权、项目接口、导入提交和原文恢复，详见[平台契约](docs/api.md)。

六个 skill 不在这个目录里，也不被这个应用 import。skill 仍然可以单独拷走。

## 尚未实现

这次没有做下面这些事，健康检查也会照实返回：

- 六类业务适配器与导出尚未接入；平台支持注入outline/cast/art规划器，实际Worker导入入口在接入前返回501
- AI Gateway 的真实调用。配置字段可以留空。填了也不代表已经连通，状态保持未验证
- 本机执行器。只有心跳鉴权占位：没有密钥或令牌不对会拒绝；令牌正确也只返回尚未实现，不写业务数据
- 远程部署、远程迁移、真实素材上传

账户侧的 preview / production 数据库和桶还没有创建。配置里的 `database_id` 是未开通占位，不是 Cloudflare 账号里的资源。

## 环境隔离

| 环境 | Worker | D1 名称 | R2 桶 | 开通状态 |
| --- | --- | --- | --- | --- |
| local（`wrangler dev` 的默认配置） | `shuohao-workbench-local` | `shuohao-workbench-local` | `shuohao-workbench-local` | 未开通，仅本地模拟 |
| preview | `shuohao-workbench-preview` | `shuohao-workbench-preview` | `shuohao-workbench-preview` | 未开通 |
| production | `shuohao-workbench-production` | `shuohao-workbench-production` | `shuohao-workbench-production` | 未开通 |

三套名称和 `database_id` 彼此不同。preview 不能换成 production 的库或桶。绑定显式写了 `"remote": false`，本地开发不会连到远程资源。

名称以 `config/resources.json` 为准，`wrangler.jsonc` 必须与它一致，由 `npm run check:config` 检查。

## 准备

从仓库根目录进入这个应用目录。需要 Node.js 22 或更高版本。

```bash
cd apps/workbench
npm ci
```

密钥不进版本库。需要本机执行器或网关令牌时，复制示例再填写：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 只在本机生效，不会在部署时自动上传。远程密钥以后使用 `wrangler secret put`，并且 preview 与 production 分开设置。示例文件里的值必须留空。

当前密钥名：

- `WORKBENCH_TOKEN`：平台单操作者令牌，至少32字符且不含空白；与执行器令牌分开。项目/原文/对账接口先鉴权再读写；健康检查不依赖它。

- `EXECUTOR_TOKEN`：本机执行器心跳。没有配置时，心跳接口直接拒绝
- `AI_GATEWAY_TOKEN`：以后的网关令牌。这次不会读取它去发请求

## 本地迁移

迁移目录包含0001初始结构和0002平台修订/约束。只针对本地模拟库：

```bash
npm run migrate:local
```

对应命令是 `wrangler d1 migrations apply DB --local`。不要加 `--remote`，也不要加 `--preview`。

在交互终端里，Wrangler 会先询问是否继续。非交互环境会跳过询问，直接应用到本地库。

重复执行是安全的。Wrangler 把已应用的文件记在 `d1_migrations`，第二次不会重放 SQL，也不会清掉已有行。验证命令：

```bash
npm run test:migrations
```

它会在临时目录里：空库迁移 → 写入哨兵项目 → 新进程再迁移 → 确认迁移记录与SQL文件列表一致、哨兵项目还在。

## 本地启动

先迁移，再启动。默认配置就是 local，不要加 `--env production`。

```bash
npm run migrate:local
npm run dev
```

然后打开终端里打印的本地地址（通常是 `http://127.0.0.1:8787`）。

- `GET /`：静态壳
- `GET /api/health`：数据库、私有桶、未部署、尚未实现的能力
- `GET /api/media/...` 与 `GET /api/objects/...`：403，不返回对象内容
- 平台项目创建/列表、快照、原文读取与对账：详见[HTTP契约](docs/api.md)，需要平台令牌
- `POST /api/projects/{id}/imports`：适配器未接入时501；注入后的平台函数已经有真实D1/R2测试
- `POST /api/import`、`POST /api/gateway/...`：旧占位入口501
- `POST /api/executor/heartbeat`：鉴权占位

健康检查不会列出桶内对象，也不会回显密钥。

## 测试

```bash
npm test                 # Workers 运行时测试
npm run typecheck        # 先生成绑定类型，再做类型检查。生成文件不进入版本库
npm run check:config     # preview / production 隔离，以及示例密钥留空
npm run test:migrations  # 本地空库迁移后再次迁移
npm run test:dev         # 启动 wrangler dev，请求健康检查和静态壳
npm run test:ci          # 上面几项一起跑
```

`npm test` 使用 Vitest 5 和 `@cloudflare/vitest-plugin`，在 Workers 运行时里应用同一份迁移。

持续集成工作流是仓库里的 `.github/workflows/workbench.yml`。它只跑本地检查，没有 Cloudflare 令牌，也不会部署。

## 部署

当前两条部署命令都会在调用 Wrangler 之前退出，并说明资源未开通：

```bash
npm run deploy:preview
npm run deploy:production
```

不要直接执行 `wrangler deploy`。Wrangler 有资源自动创建：直接部署可能在账号里新建 D1 或 R2。这次不创建、不迁移、不上传。

以后真的要开通时，先在账号里分别创建 preview 与 production 的库和私有桶，把真实 `database_id` 写进 `config/resources.json` 和 `wrangler.jsonc`，并把对应环境的 `remoteResources` 改成 `provisioned`。在此之前，预检会继续拒绝。不能把 production 的 id 填进 preview。

开通后的桶也必须保持私有，不要开公开 `r2.dev` 域名。业务接口目前没有媒体读取实现。

## 数据约定

初始迁移只建立可扩展的表，不包含导入器。

- 内部 ID 使用 UUID v4（`crypto.randomUUID()`）。显示码可空；非空时在同一项目、同一类实体内唯一。改显示码不改变内部 ID
- 时间使用 epoch 毫秒整数
- 原文稿 UTF-8 超过 256 KiB 时外置 R2。这是项目阈值。D1 单行上限仍是 2 MB，见 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- 角色的 outline tier 与 cast importance 分列，不自动互填
- 分镜认领写在 `storyboard_cut_beats` 有序链接里。`beat_from_id` / `beat_to_id` 只是兼容边界
- VO 不伪造人物行。外部姓名和原始编码单独保存
- 媒体的文件、过期、执行器等待分列。执行器离线不能把已经 ready 的文件改掉
- 对象键按内容哈希生成，不接纳本机路径。同一哈希得到同一键
- R2 与 D1 不是跨服务原子事务。表结构把对象状态留成 staged / ready / abandoned / unavailable，供以后的对账使用

## 参考

- [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
- [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)
- [Wrangler 环境](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Vitest 集成](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Workers 密钥](https://developers.cloudflare.com/workers/configuration/secrets/)
