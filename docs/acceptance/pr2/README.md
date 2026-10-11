# PR2 独立验收数据

这套数据先确定独立原创故事《停钟档案》（story.txt），再编写大纲、角色和美术 JSON。没有分镜、图片、真实小说或模型调用，不借用技能自带故事。它属于工作台集成验收，不是安装到任何单个技能的样例，因此每个技能保持自包含。

## 文件与目的

- `baseline/outline.json`：三集、两角色、两场景、一件道具；完整质量门通过。
- `baseline/cast.json`：两角色分别 protagonist/major，与大纲的 lead/lead 并存；姓名别名、证据和未知字段完整。
- `baseline/art.json`：两个空景与一件白底道具；carriedBy 故意使用 C01 的别名“小苏”，验证项目内唯一解析及原值保留。
- `variants/*.json`：完整文档变体。包含编辑、重排、无角色码，以及故意构造的无效结构和身份歧义。
- `cases.json`：19 个机器可读取的操作场景及断言；action 是验收意图，不是已经存在的 API 路径或运行器。
- `checksums.json`：基线与变体文件原字节 SHA-256。用于历史原文完整性；不能替代适配器的语义指纹。

## 基线校验

从仓库根目录执行，2026-10-12 独立运行均 exit 0：

```bash
node skills/novel-outline/scripts/novel-outline.mjs validate docs/acceptance/pr2/baseline/outline.json
node skills/novel-characters/scripts/novel-characters.mjs validate docs/acceptance/pr2/baseline/cast.json docs/acceptance/pr2/story.txt --lang zh
node skills/novel-art/scripts/novel-art.mjs validate docs/acceptance/pr2/baseline/art.json --cast docs/acceptance/pr2/baseline/cast.json
```

实际输出分别是“通过校验（stage=full）”“2 个角色全部通过校验（lang=zh）”“2 个场景 + 1 件道具全部通过校验”。完整上下文包含故事原文和角色表，不使用跳过引文或角色名检查的简化调用。导出验收应使用同样上下文替换三个 JSON 路径。

## 工作台验收要求

每次测试使用独立数据库命名空间或项目，保存导入前后的业务行与关系快照。失败审计/import_runs 可以增加，业务实体、关系、当前激活版本必须整单不变。不要把“实体数量没增加”当成充分条件：还需比较 UUID、内容与关系端点。

变更导入的更新入口目前由实现决定：若默认冲突，先断言零写入，再通过明确的更新或版本激活路径继续。不得默认覆盖旧内容。跨项目测试必须由 API/数据库层执行，不只是观察 UI。

未知字段使用嵌套对象、数组、false、0、null 和中文，校验深层语义等价，而非仅校验顶层 key。历史 raw 校验原字节，当前导出校验修改字段，两种断言必须同时成立。

别名歧义案例 P2-11 属于两个不同角色共享身份称谓，必须整包拒绝；禁止以 unresolved 标记绕过身份冲突。只有不制造身份碰撞的外部或缺失名字，才可按明确契约保留非破坏性未解析关联。旧技能 CLI 不保证检查别名/跨文档身份冲突，工作台需要自己的校验层。

## 验证边界

当前技能 CLI 通过只证明输入符合现有技能质量门，不证明导入器、数据库事务、稳定映射、跨项目隔离、HTTP 权限或导出重建已实现。cases.json 是独立验收契约；Grok 应将这些断言接到实际 PR2 测试入口，并附运行结果。未执行远程部署或付费调用。

## 可重复的夹具检查

```bash
node docs/acceptance/pr2/validate-fixtures.mjs
```

2026-10-12 实测：13 个 CLI 预期、13 个原字节校验和、0 个失败。这个脚本只验证夹具与技能校验器边界，不调用工作台 API。

| 变体 | 当前技能 CLI 预期 | 工作台预期 |
| --- | --- | --- |
| cast-edited / cast-reordered / cast-without-codes | 通过 | 稳定身份映射，不按指纹或位置复制角色 |
| cast-duplicate-code / cast-name-conflict | 通过（技能未检查身份碰撞） | 拒绝身份冲突，整单业务回滚 |
| cast-ambiguous-alias | 通过（技能未检查别名歧义） | 身份冲突整包拒绝，禁止猜测关联 |
| cast-invalid-importance | 拒绝 | 拒绝无效枚举，整单回滚 |
| outline-dangling-reference | 拒绝，包含 C99 引用及三角色拆解缺失 | 拒绝，整单回滚 |
| art-invalid-variant / art-new-valid-then-invalid | 拒绝 | 拒绝，整单回滚，合法 S03 也不能留存 |

故意保留 outline-dangling-reference 的两个独立违规，避免测试依赖只返回单条错误的实现。验收至少要求包含悬空引用诊断，不绑定错误列表顺序。

## 接口层扩展案例

P2-17 检查无凭据及错误凭据的写入拒绝，要求 D1/R2 均零写入。P2-18 使用有效 JSON 的未知字段填充生成 262143、262144、262145 个 UTF-8 原始字节，不提交大文件；使用汉字并以 ASCII 补齐余数，禁止按字符串长度判断。超过 256KiB 的 raw 文档必须进入 R2，较小文档可以采用更保守的 R2 策略。

P2-19 注入 R2 成功后的 D1 最终提交失败，检查未激活、幂等重试及暂存清理。所有 P2-01 至 P2-19 都是待接入的工作台接口预期；本次实际执行仅包括技能 CLI 和校验和检查，不能标记工作台事务或远程部署验收通过。
