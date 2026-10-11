# F1 平台契约 v1

关联 #6/#9。这里描述本仓库接口，不是Reelbench作者的后台协议。Codex维护基础实现，Grok维护library/adapt纯业务适配与页面。只支持outline/cast/art，其他skill按后续PR追加契约。

## 鉴权与范围

`Authorization: Bearer <WORKBENCH_TOKEN>`。令牌至少32字符，不能含空白；只作为服务端secret注入，不进入D1、前端产物、URL或日志。当前是单操作者平台授权：合法操作者可管理本实例的全部项目，**不是多租户账户ACL**。`EXECUTOR_TOKEN`不能替代平台令牌。

健康检查、静态壳保持公开。平台项目/原文/对账接口全部鉴权，先鉴权再消费body或查询/写入D1/R2。缺平台配置503，无/错凭据401，URL携带凭据401。现有媒体匿名读取仍403。

本地在`.dev.vars`自行设置WORKBENCH_TOKEN；示例保持空，测试经env注入明显标注的测试令牌。没有远程密钥设置、资源开通或部署。

## HTTP

成功JSON含`ok:true`。错误含`ok:false,error:{code,message,issues?}`。`issues`可有code、skill、path、message、candidateIds。错误不返回SQL/内部异常/密钥。POST请求使用application/json，流式读取大小守卫为8MiB，不依赖Content-Length。

| 路径 | 方法与输入 | 结果/状态 |
| --- | --- | --- |
| `/api/projects` | GET，cursor可选 | 200，projects列表，每页100及下一cursor |
| `/api/projects` | POST `{name,source?,lang?}` | 201，`{ok,id,revision:0}`；lang为zh/en/ja，name非空最多160字符 |
| `/api/projects/{UUID}/snapshot` | GET | 200，snapshot；不存在404 |
| `/api/projects/{UUID}/documents/{blobUUID}/raw` | GET | application/json原始字节文本，非包装JSON；不属于此项目404，缺失/损坏503 |
| `/api/projects/{UUID}/reconcile` | POST `{cursor?}` | 200，checked/ready/unavailable/abandoned/cursor；每页20，只修账本，不删除对象 |
| `/api/projects/{UUID}/imports` | POST `{documents:[{skill,raw}],expectedRevision?,mode?}` | **适配器接入后**200，ImportResult；未接入501，且不读取body、不写数据 |

`mode`默认create，不静默覆盖已存在且语义不同的同类文稿；更新必须mode=update并带expectedRevision。HTTP客户端不提交ImportPlan、SQL、对象键、文件路径或任意列；未知请求字段422。大包/过大行/规划/查询预算413，结构或规划无效422，文稿已存在/修订竞争/提交约束冲突409。

Worker入口目前没有Grok适配器，真实HTTP导入明确501。平台提供`handleProjectApi(request,env,planner)`，Grok业务PR提供函数，Codex将其注册到入口。测试使用注入的技术规划器证明平台提交闭环，不能标成六个skills已接入。

## TypeScript 接口

导出类型在`src/contracts/import.ts`，执行接口为`src/platform/repository.ts`的`ProjectRepository`。

```ts
const operator = await Operator.authenticate(request, env.WORKBENCH_TOKEN);
const repository = new ProjectRepository(env.DB, env.MEDIA, operator);
const result = await repository.importDocuments(projectId, inputs, planImport, {
  mode: 'create', expectedRevision: 0,
});
```

Grok的`planImport: ImportPlanner`读取：

- `documents`：平台核验后的raw、解析value、byteLength、byteSha256、semanticFingerprint。原文UTF-8字节与规范化语义指纹分开，不要复算成另一套指纹。
- `snapshot`：项目revision、九种实体行、已有源身份映射、当前不可变文稿原文。记录是当前规范化字段，不能仅用raw回显冒充编辑后的导出。
- `allocateId()`：只有新实体才调用。已有源映射/码/唯一姓名或别名的匹配与业务冲突由适配器负责，不能随机分配后覆盖旧身份。

返回`{status:'rejected',issues}`或`{status:'planned',plan}`。plan含expectedRevision、writes、removals、identities、warnings。writes用实体kind+稳定UUID+现有schema蛇形字段；字段白名单见`src/platform/entities.ts`，平台保留id/project_id/created_at/updated_at控制权。

字段patch只更新明确给出的值。省略保持旧字段，null表示明确清空可空字段。outline_tier与cast_importance不得互填；raw_extensions_json里的分文稿归属由业务适配器保全，原文包也完整留存。JSON列提供JSON文本。仅允许移除alias/carrier/prop_scene/episode_link关系；实体硬删除和源映射删除不在F1契约内。

identities是项目+skill+entityKind+sourceKey映射，必须指向本项目已存在或同包规划实体；同一个源键不能换内部UUID。不同skill的同一显示码统一身份由适配器决策，平台不会根据类型文字模糊合并。

关系写入在平台按实体依赖排序，场景变体拓扑排序；跨项目引用在预检和数据库触发器双重拒绝。适配器必须保持纯函数，不直接访问bindings、SQL、R2键或凭据。不会要求Grok废弃已有library/types；跨层类型从此契约桥接。

## 原子性、幂等与历史

平台读取同一个D1 batch快照，创建规划后在一次D1 batch内提交：修订比较、实体/关系、源映射、不可变文稿、当前指针、成功审计和对象ready记录。修订不匹配或任一约束失败整批回滚，不自动重放过期规划。

创建导入包以排序后的文稿种类+语义指纹幂等；重复导入返回原commit/revision，不重新应用历史包。**该revision是当次提交修订，不保证仍是项目最新修订**。需要显式重新激活历史文稿，使用update模式及当前expectedRevision；update请求在该修订范围幂等，重试原expectedRevision返回同次结果。

相同语义但不同空白/键顺序保留第一次版本的原始字节，不把后来的排版覆写历史。历史document_blobs、style_versions、media_versions及import_commits只追加；快照与当前版本指针是可变关系。错误规划可增加失败审计，未鉴权请求连审计都不写。

## R2与恢复

原文超过262144字节外置R2，恰好阈值仍内置；每份文稿最多2MiB。对象按原字节SHA-256寻址，条件put不覆盖已有对象；不信任metadata哈希，读取实际字节核验后才提交D1。R2检查在batch之外，**没有跨服务原子事务**。

账本先于上传。上传成功但D1失败保留staged，重复输入核验/复用同一对象；重试只有一个业务版本。已提交对象丢失后，对账标unavailable；携带完全相同原字节重复导入可恢复缺失对象而不重新规划/增加实体。不同排版不能替代旧字节；同键损坏对象不自动覆写，需要显式修复。对账可以重新确认ready；旧未引用暂存24小时后标abandoned，F1不自动删除字节。

对账每页最多20，返回游标。当前ready版本丢失不会删除历史记录；不能把missing/unavailable当成执行器离线或画风过期。调用对账的任务调度尚未自动启用，操作者/后续执行器通过接口触发。

## 请求预算与扩展边界

按[D1官方限制](https://developers.cloudflare.com/d1/platform/limits/)限制每条语句最多100绑定参数，批量合并同类行；`D1_QUERY_BUDGET`默认50，仅已确认Workers Paid的环境可以显式改1000。平台在暂存前计算本次提交查询预算，超限拒绝；不会偷偷拆批导致部分可见。

规划writes/removals/identities总计最多120；规范化行估算上限1,800,000字节，给官方2,000,000字节上限留余量。超过当前范围需要后续staging/activation扩展，F1不会宣称任意大包支持。

脚本/分镜/character-refs、批次编辑与撤销、真实网关调用、执行器租约、持久队列、远程部署与多租户ACL留给后续阶段。本接口仅支撑PR2底座，不关闭M1。

## 验证

`npm run test:ci`包含真实Workers运行时的D1/R2集成测试。技术规划器不是业务适配器；Grok接入后仍须运行[19项独立验收](../../../docs/acceptance/pr2/cases.json)，特别是语义身份匹配与修改后导出。F1测试验证平台鉴权、修订、部分patch、回滚、并发、UTF-8阈值、对象恢复、白名单和预算，测试结果与缺口在PR中记录。

依据：[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[R2条件写入](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。
