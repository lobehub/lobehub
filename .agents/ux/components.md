<!-- lobe-design-init: version=5.4.2 fingerprint=ae4aaf7a1e72 -->

# 组件盘点（lobe-design・Round 2）

> 由 lobe-design 05-init 生成。只写「哪个场景用哪个 + 注意点」，不写实现和 props。重跑 init 时整份更新。
> 范围：`src/components`（跨业务的通用件）与 `src/features` 中被多处复用的件。原子层一律从 `@lobehub/ui` / `@lobehub/ui/base-ui` 取（C-01）；弹窗写法见 `modal` skill，组件选择与样式见 `react` skill。

## 1. 薄包装：带项目默认值，用包装件

几乎只是透传 lobe-ui，但统一了本项目的默认值。需要同类能力时用包装件；包装件不够时直接用对应的 lobe-ui 件，不要再包一层。

| 包装件              | 对应 lobe-ui                            | 注意点                                                                   |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `Menu`              | `List`（base-ui）                       | 菜单类列表的默认内边距和文字色；可选中列表传 `selectable`                |
| `InfoTooltip`       | `Tooltip` + `Icon`                      | 标题或字段旁的「?」说明；说明是必要信息时不要只放在这里（mobile 无悬停） |
| `InlineTable`       | `Table`（base-ui）                      | 卡片 / 抽屉内的轻量表格，去掉了外框和表头底色；完整列表页不要用它        |
| `BubblesLoading`    | `LoadingDots`（chat）                   | 对话内「正在输入」                                                       |
| `FileIcon`          | `FileTypeIcon` / `MaterialFileTypeIcon` | 按文件名或类型取图标                                                     |
| `StreamingMarkdown` | `Markdown` + `ScrollArea`               | 非对话场景里的流式 markdown；对话消息走 Conversation                     |
| `EmojiPicker`       | `EmojiPicker`                           | 懒加载入口，带骨架；不要直接引上游件                                     |

## 2. 包装但改了行为：必须用项目件

| 项目件                                                  | 改了什么                                   | 何时用                                               |
| ------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `Avatar`                                                | 图片失效时按名称生成稳定的首字母兜底       | 所有用户 / Agent / 成员头像；不要直接用上游 `Avatar` |
| `TextArea`                                              | 失焦或回车时才提交，正确处理中文输入法组字 | 需要「编辑完再保存」的多行输入                       |
| `InstantSwitch`                                         | 乐观切换 + 异步保存时 loading              | 切换后立即落库的开关                                 |
| `FormInput`（含 `FormPassword`、`FormSliderWithInput`） | 表单内的受控输入、密码、滑杆 + 数值输入    | 设置表单                                             |

## 3. 与 lobe-ui 重复：新代码改用上游

已有引用先不动；新代码和顺手修改的地方改用右列。

| 项目件            | 改用                                         | 说明                               |
| ----------------- | -------------------------------------------- | ---------------------------------- |
| `DotsLoading`     | `LoadingDots`（`@lobehub/ui/chat`）或 `Spin` | 自绘点阵加载                       |
| `Descriptions`    | `Descriptions`（base-ui）                    | 键值对展示；上游件已覆盖           |
| `TablePagination` | `Pagination`                                 | 只有现有列表在用；新表格用上游分页 |
| `DragUpload`      | `DragUploadZone`                             | 目前没有引用，新代码不要再用       |

## 4. 业务组件：场景 + 注意点

### 页面骨架与导航

| 组件                                  | 什么时候用                                   | 注意点                                                         |
| ------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `features/NavHeader`、`NavPanel`      | 主界面左侧栏和页头                           | 新页面先挂进已有导航，不自造页头                               |
| `features/PageShell`                  | 不在主导航里的独立页面（被链接打开的页）     | 顶部写产品和集合名，不放左侧栏                                 |
| `features/RightPanel`                 | 主区右侧的可开关面板                         | 与 `Portal` 二选一：常驻上下文用 RightPanel，临时详情用 Portal |
| `features/Portal`                     | 对话旁打开的临时详情（文件、产物、工具结果） | 关闭后回到对话，不改路由层级                                   |
| `features/WideScreenContainer`        | 对话流与阅读区的居中限宽                     | 不要再加一层手写 maxWidth                                      |
| `components/Skeleton`、`ListSkeleton` | 路由级骨架和列表占位                         | 骨架形状要贴近真实布局；路由骨架登记方式见 `spa-routes` skill  |
| `features/CommandMenu`                | 全局命令面板                                 | 新的全局动作登记进来，不另做搜索弹窗                           |

### 对话与 Agent

| 组件                                    | 什么时候用                       | 注意点                                                                                     |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `features/Conversation`                 | 消息流、工具调用卡片、流式回复   | 所有消息渲染从这里走（C-04）                                                               |
| `features/ChatInput`                    | 对话输入框                       | 不另写输入框；附件、模型选择等都挂在它的工具栏上                                           |
| `features/ModelSwitchPanel`             | 对话中切换模型                   | 对话场景用它                                                                               |
| `features/ModelSelect`                  | 设置 / 表单里选模型              | 表单场景用它；条目渲染复用 `components/ModelSelect` 的 `ModelItemRender` / `ModelInfoTags` |
| `features/ExecutionTargetPicker`        | 选择 Agent 在哪里执行            | 不要在别处重复列执行目标                                                                   |
| `components/ExecutionStatus`            | 执行状态到图标与颜色的映射       | 状态图标和颜色从这里取，不另配                                                             |
| `components/StopLoading`、`RingLoading` | 运行中的环形图标、可停止的运行态 | 只表示「正在运行」，不当普通加载用                                                         |

### 反馈、错误与弹窗

| 组件                                                            | 什么时候用                     | 注意点                                                   |
| --------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `AsyncBoundary`、`AsyncError`                                   | 异步区块的加载与失败           | 失败态要给重试，不留空白（K-05）                         |
| `ErrorBoundary`、`Error`、`BootErrorBoundary`                   | 渲染异常兜底                   | `BootErrorBoundary` 只用于启动阶段                       |
| `ImperativeModal`、`GuideModal`、`RenameModal`、`FeedbackModal` | 命令式弹窗、引导、重命名、反馈 | 新弹窗按 `modal` skill 用 `createModal`                  |
| `InlineRename`                                                  | 列表项就地重命名               | 与上游 `EditableText` 的区别：它在气泡里编辑，不挤占原位 |
| `TipGuide`                                                      | 新功能引导气泡                 | 只做引导，不承载必要说明                                 |
| `UnreadDot`、`Notification`                                     | 未读标记、站内通知             | 新的未读提示复用 `UnreadDot`                             |

### 输入、上传与数据展示

| 组件                                                   | 什么时候用                                       | 注意点                                             |
| ------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------- |
| `DragUploadZone`                                       | 拖拽上传区                                       | 唯一的拖拽上传件                                   |
| `AvatarUpload`                                         | 头像上传                                         | 配合 `Avatar`                                      |
| `KeyValueEditor`、`JSONSchemaConfig`                   | 环境变量 / 请求头，按 JSON Schema 生成的配置表单 | 插件与 MCP 配置用它们，不手写表单                  |
| `MemberSelectionModal`                                 | 选择成员 / Agent                                 | 多选带搜索                                         |
| `CopyableLabel`、`CommandLine`                         | 可复制的 ID / 命令                               | 需要复制的值都用它们，不自己拼复制按钮             |
| `StatisticCard`、`Statistic`                           | 用量卡片、行内「数值 + 标签」                    | `Statistic` 是行内小字，卡片指标用 `StatisticCard` |
| `LiteTable`                                            | 窄屏会切换为列表的轻量表格                       | 需要在 mobile 可读的表格用它                       |
| `PublishedTime`                                        | 发布 / 更新时间                                  | 列表和详情里的发布时间用它                         |
| `LobeIcons`、`LibIcon`、`SkillAvatar`、`KnowledgeIcon` | 模型厂商、库、技能、知识库图标                   | 厂商徽标走 `@lobehub/icons`（E-03）                |
| `Branding`、`BrandWatermark`、`Loading`                | 品牌标识、水印、启动加载                         | 品牌元素只用这些，不直接放 logo 图片               |
| `features/ShareModal`、`SharePopover`                  | 分享 Agent / 话题 / 页面                         | 分享入口统一                                       |
| `features/Electron`、`Desktop*Bridge`                  | 仅 desktop 的窗口与系统集成                      | 只在 desktop 渲染；web 与 mobile 不得依赖          |
