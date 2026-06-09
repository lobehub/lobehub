# Tool Render 设计原则（中文草案）

这些原则用于判断一个 builtin tool 的 Inspector / Render / Placeholder / Streaming / Intervention / Portal 应该做什么，以及做到什么程度。

1. **先保证折叠态可读。** 每个 API 都必须有 Inspector；用户不展开也应该能看懂 “正在做什么 / 对什么做 / 当前结果是什么”。Inspector 不应该只展示函数名和原始参数。
2. **Inspector 是一句话，不是详情页。** 优先表达动作、关键对象、数量、状态，例如 “分析图片 3 张”“搜索 12 个结果”“读取 config.json”。长文本、列表和结构化结果放到 Render 或 Portal。
3. **Inspector 要覆盖执行生命周期。** `args` 还在 streaming、工具执行中、执行完成、执行失败时都应该有稳定展示；必要时同时读取 `args`、`partialArgs` 和 `pluginState`，避免出现空白、跳变或只显示半截参数。
4. **文案要随状态切换时态。** 同一个动作在 loading 与 completed 两个阶段必须用不同的措辞：执行中用现在进行时（“正在创建任务 / Creating task / 正在搜索”），执行完成后切到完成态（“已创建任务 / Task created / 已找到 N 条”）。Inspector chip 会一直留在聊天记录里 —— 如果一直挂着 “正在 xxx”，几小时后回看历史时会读起来像还在跑。约定的 i18n 形式是 `<api>.loading` / `<api>.completed` 一对键（见 `lobe-agent.apiName.callSubAgent.{loading,completed}` 与 `lobe-claude-code.task.{create,list,update,get}.{loading,completed}`），渲染时按 `isArgumentsStreaming || isLoading` 决定取哪一个。只读 / 查询类（“查看任务” 这种本来就是名词性的）可以共用一个键。
5. **只有结构化结果才需要 Render。** 如果工具结果只是自然语言总结，通常不需要 Render；如果结果包含列表、媒体、文件、表格、代码、diff、地图、时间线、权限请求等结构，就应该提供 Render。
6. **Render 要帮助用户检查结果，而不是复述参数。** Render 的主体应该围绕工具产物组织：可预览、可比较、可筛选、可定位。参数只作为上下文辅助出现，不要把 Render 做成一块更大的 args dump。
7. **参数和结果要一起参与渲染。** 好的 Tool UI 通常同时用 `args` 解释意图，用 `pluginState` 展示真实执行结果；但 `pluginState` 只放结果域数据，不要反向塞入可以从 `args` 推导出的内容。
8. **慢操作要有 Placeholder。** 如果工具通常需要等待网络、文件系统、模型或外部进程，Placeholder 应该先占住最终 Render 的版式，让用户知道即将看到什么，而不是只显示一个泛化 loading。
9. **Streaming 只用于连续产物。** 搜索列表、日志、长文本、文件分析、分阶段计划适合 Streaming；一次性小结果不需要强行做 Streaming。Streaming UI 要能渐进追加，并且完成后自然过渡到最终 Render。
10. **有风险的动作必须 Intervention。** 写文件、删除、发送、安装、执行命令、外部可见操作、权限敏感操作，都应该在执行前给出可理解的确认界面；确认文案要说明影响范围，而不是只问 “是否继续”。
11. **错误、空态和截断都是正式状态。** Render 不能在失败、无结果、超长结果时退化成空白。错误要说明发生在哪一步；空态要告诉用户没有产物；超长内容要明确 “展示前 N 项 / 还有 N 项”。
12. **信息密度要克制。** 默认展示最有判断价值的部分：标题、来源、状态、摘要、少量关键字段。大对象、长列表、原文、调试数据放进可展开区域或 Portal，避免把聊天流撑成后台管理页。
13. **视觉上融入聊天流。** Tool UI 应该使用 `@lobehub/ui` / base-ui、`Flexbox`、`createStaticStyles` 和 `cssVar.*`，遵循现有间距、圆角、颜色、字号；不要为单个工具发明一套独立视觉语言。具体的样式约定见 [shared-rules.md](shared-rules.md)。
14. **Devtools fixture 是验收入口。** 新增或修改 Tool UI 时，应在 `/devtools` 里准备覆盖典型态、loading/streaming、空态、错误态、长内容态的 fixture；一个 API 如果在真实聊天里会出现，就不应该在 devtools 中缺席。
15. **先做用户会看的 UI，再做调试 UI。** Raw JSON、trace、schema、内部 id 可以存在，但应默认收起或放到调试区；主界面先回答用户最关心的问题：工具做了什么，结果值不值得信任，下一步能做什么。
