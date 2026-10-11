# 工作台补充交互规格与独立验收

2026-10-12，Codex 使用内置浏览器核查原网站。范围：项目设置、整机模型渠道、ComfyUI、队列与提示词、画风、素材关联、项目素材库及跨项目资产库。辅助页面包括存储、本机环境、内容更新、模型试运行。

本目录只交付规格和验收要求，不修改业务实现；PR2 的原创数据见 [独立验收数据](../pr2/README.md)。现有六个 skills 保持独立，验收脚本不是 skill 依赖。

## 如何阅读

- [settings-models.md](settings-models.md)：设置范围、初始化与回退规则、模型渠道表单、画风用途分层及云端适配。
- [queue.md](queue.md)：网站已观察行为、队列实现契约、快照、恢复与验收。
- [assets.md](assets.md)：单镜/整段引用、视图、音频、历史版本、两种素材库。
- [acceptance.md](acceptance.md)：可执行的页面和状态测试，分配到后续里程碑。
- `evidence/*.txt`：浏览器读取的公开演示页面可见文本。数字是临时无障碍节点编号，不是实体主键或实现选择器。

## 证据等级

**操作观察**：确实打开页面、切换表单类型、展开选择器或查看历史面板。**页面声明**：网站可见说明，但没有实际执行生成、保存、恢复。**实现约定**：为本仓库 Workers/D1/R2/AI Gateway 设计的行为，不是作者后台的接口或算法。文档逐项区分；没有取得写接口的方法、响应体、事务协议，不能把这里的建议冒充作者 API。

原网站演示明确只读，模型列表为空、生成 worker 没有运行。没有提交渠道、输入真实密钥、发起模型任务、更新内容包、上传或下载作者小说/媒体。因此真实任务取消、重试、恢复、保存成功和素材复制结果仍需在我们的实现中验收。

## 本次操作记录

| 路径（项目 P=`4cbd73adcc15`） | 实际操作 | 证据 |
| --- | --- | --- |
| `/v1/p/P/settings` | 阅读全部分区，展开角色派生模型，只有“同锚点模型” | `project-settings.txt`，settings-models 的字段表 |
| `/v1/settings/models` | 新增渠道弹窗；切换四种接入方式；OpenAI 兼容加请求头行；取消退出 | `model-channel-comfy.txt`，字段表记录其他三种 |
| `/v1/settings/generation` | 查看并发范围、依赖、转译说明 | `queue-settings.txt` |
| `/v1/settings/comfyui` | 输入 `not-an-address`，页面出现协议提示，保存仍禁用；没有点击测试连接 | `comfy-invalid-address.txt` |
| `/v1/p/P/storyboard/1/1` | 分别打开第1镜与本段视频素材选择器，切换场景/角色组，查看历史面板 | `cut-reference-picker.txt`、`segment-audio-picker.txt`、`image-history.txt` |
| `/v1/p/P/library` | 切换图片、提示词和视频分类 | `project-library-images.txt`；空状态见 assets |
| `/v1/asset-library?project=P` | 将目标改为“暂不选择项目”：去掉 query，打开项目链接消失 | `global-library-no-target.txt` |
| `/v1/settings/styles`、`/v1/styles/urban-comedy-live-action` | 打开默认目录及真人实拍详情 | `styles-default-scope.txt`、`style-detail-dispatch.txt` |
| `/v1/settings/storage`、`env`、`updates`、`diagnostics` | 读取字段与不可用状态；未保存/调用 | `storage.txt`、`environment.txt`、`content-updates.txt`、`diagnostics.txt` |

## 与 PR2 的关系

PR2 继续做 outline/cast/art 导入导出，不要求顺带实现这些完整页面。现在必须支持稳定实体身份、显示码与排序分离、项目范围和源映射、未知字段留存、原始字符串与解析关系分离、认证后写入。这些是后续引用和页面组合查询的基础。

后续实现需单独覆盖：模型/项目设置、媒体版本与风格、镜头和段级引用、持久化任务。不能把 PR1 的 schema 字段存在或 PR2 的原文往返，当成这些交互已经实现。
