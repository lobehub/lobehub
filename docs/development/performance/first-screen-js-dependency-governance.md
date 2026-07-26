# 首屏 JavaScript 依赖边界治理规范

状态：已实施\
日期：2026-07-26\
适用范围：Vite SPA 的桌面主入口与首页路由

## 背景

当前工作树的生产构建中，从 `index.html` 与首页主布局递归计算静态 ESM 依赖，得到以下基线：

| 阶段         | JS chunks | Minified |    Gzip |
| ------------ | --------: | -------: | ------: |
| Bootstrap    |        65 | 13.64 MB | 3.55 MB |
| 首页路由新增 |       189 | 10.21 MB | 2.74 MB |
| 首屏合计     |       254 | 23.85 MB | 6.29 MB |

首页输入框已经采用 textarea fallback，并在提交后动态导入真实 Editor；但 Editor 依赖仍通过其他静态路径进入首页闭包，导致 `EditorInput` 的动态增量只有约 0.65 KB gzip。已确认的路径包括：

1. `Conversation/ChatItem/ErrorContent` 通过 Conversation 总 barrel 获取 store，总 barrel 同时导出 Composer。
2. `NavPanel` 静态导入所有路由 Sidebar，Agent Sidebar 的菜单进一步静态导入 ShareModal 与 Conversation 消息树。
3. `UnreadTopicList` 静态导入只在回复交互后才渲染的 `RunReplyEditor`。
4. `HomeInbox` 无条件挂载已经没有首页触发入口的 `TopicChatDrawer`，使完整 Conversation 与应用 ChatInput 留在首页闭包。
5. `DocumentPreviewModal` 虽然关闭时不渲染内容，仍静态导入 PageEditor；条件渲染没有形成模块加载边界。

构建产物的 chunk 名称只代表 Rolldown 选择的一个模块名，不代表该 chunk 的唯一所有者。例如 `ErrorContent` chunk 当前包含数百个源码模块。因此诊断与验收必须基于 manifest 的递归依赖和 sourcemap 的模块集合，不能根据文件名推断源码关系。

## 目标

1. 首页首次提交前的静态依赖闭包不包含应用 ChatInput、`RunReplyEditor` 或 ShareModal 实现。
2. `NavPanel` Host 不静态依赖任何路由 Sidebar 实现。
3. 路由切换继续保留现有 Sidebar 行为，不产生旧 Home Sidebar 覆盖当前路由 Sidebar 的竞态。
4. 首页 textarea fallback 与真实 Editor 的值迁移、IME 处理和布局预留保持不变。
5. 可选交互使用真实 `import()` 边界；条件渲染本身不视为加载边界。

## 非目标

1. 本次不重写各 Sidebar 的业务实现。
2. 本次不迁移全部 `src/routes` 旧代码到 `src/features`。
3. 本次不以手工 `manualChunks` 掩盖源码依赖边界问题。
4. 本次不将 idle route preload 计入冷启动首屏静态闭包；idle preload 在首次提交后独立执行。

## 架构约束

### Conversation 子入口

Conversation 内部模块不得通过 `@/features/Conversation` 总 barrel 获取运行时依赖。调用方应按职责使用稳定子入口：

- `@/features/Conversation/store`
- `@/features/Conversation/ConversationProvider`
- `@/features/Conversation/Messages`

Composer 继续由 `Conversation/ChatInput` 与 `features/ChatInput` 所有。读取 store、渲染消息或错误态不得隐式加载 Composer。

### 交互加载边界

`RunReplyEditor` 只在用户点击回复后导入。回复按钮可以在 `pointerenter` 或 `focus` 时预取同一个模块；模块尚未就绪时使用固定最小高度的 fallback，避免布局位移。

`openShareModal` 的公共入口必须是轻量 facade。Modal 实现只在调用 `openShareModal` 时导入；Modal 内各内容 Tab 在首次激活时导入。调用方不得通过预加载整个 Modal 树来消除偶发加载态。

### NavPanel 所有权

NavPanel 拆为四个职责：

| 模块                 | 职责                                              | 禁止事项                            |
| -------------------- | ------------------------------------------------- | ----------------------------------- |
| `registry.ts`        | 按 `navKey` 保存已注册 ReactNode，并提供订阅      | 不得 import 路由或 UI               |
| `routeKey.ts`        | 根据 pathname 与 workspace slug 解析当前 `navKey` | 不得 import Sidebar                 |
| `NavPanelPortal.tsx` | 以 owner token 注册、更新与注销内容               | 不得决定当前路由                    |
| `index.tsx`          | Host 订阅 registry、选择当前 key、渲染容器        | 不得 import `src/routes/**/Sidebar` |

Registry 使用 `Map<navKey, entry>`，而不是单一全局快照。这样 Home layout 在 React Activity 中常驻时，可以保留 `home` 注册项，但 Host 只选择当前 pathname 对应的 key，不会出现 “最后一次 effect 获胜” 的覆盖问题。

路由与 key 的契约如下：

| 路由段                                              | navKey               |
| --------------------------------------------------- | -------------------- |
| 首页、`tasks`、`task/:id` 与无专用 Sidebar 的主路由 | `home`               |
| `agent`                                             | `agent`              |
| `group`                                             | `group`              |
| 个人设置                                            | `settings`           |
| Workspace 设置                                      | `workspace-settings` |
| `community`                                         | `discover`           |
| `resource`                                          | `resource`           |
| `resource/library`                                  | `resourceLibrary`    |
| `memory`                                            | `memory`             |
| `eval`                                              | `eval`               |
| `eval/bench/:id`                                    | `evalBench`          |
| `page`                                              | `page`               |
| `image`                                             | `image`              |
| `video`                                             | `video`              |

Home Sidebar 始终注册 `home` 内容，由 Host 决定何时展示。深链进入任务路由时仍能得到现有 Home Sidebar；深链进入具有专用 Sidebar 的路由时，Host 在对应 Portal 注册前展示固定宽度 skeleton，而不会回退到错误的 Home 内容。

### 加载与布局稳定性

1. NavPanel 的外部宽度继续由 `NavPanelDraggable` 和持久化状态控制。
2. 当前 key 尚未注册时，Host 使用 Sidebar skeleton；不得改变面板宽度。
3. `RunReplyEditor` fallback 预留与紧凑编辑器一致的最小高度。
4. ShareModal Tab fallback 复用 Modal 内容区尺寸，不关闭或重建 Modal Host。

## 实施步骤

### 阶段 A：切断已知 Editor 静态路径

1. 将 Conversation 内部 self-barrel import 改为直接子入口。
2. 将 ShareImage 消息渲染依赖改为 Provider、Messages 与 store 子入口。
3. 将 `openShareModal` 改为动态 facade，并动态加载各 Tab。
4. 将 `RunReplyEditor` 改为回复交互触发的动态导入。
5. 删除 HomeInbox 中没有对应首页打开动作的 `TopicChatDrawer` 挂载，并将 Drawer 内 Conversation 依赖改为职责子入口。
6. 将 `DocumentPreviewModal` 的实现改为文档打开后动态导入，并在文档卡片 hover/focus 时预取同一模块。

### 阶段 B：NavPanel Host/Registry/Portal

1. 新增 registry、route-key resolver 与独立 Portal。
2. Host 删除所有 Sidebar 静态 import 与 route fallback JSX。
3. 所有 route layout 改为直接 import `NavPanelPortal` 子入口，避免通过 Host barrel。
4. Home Sidebar 保持注册；任务布局不再通过 `resetNavPanel` 操作全局快照。
5. 将 Host 所需常量移出路由文件，消除 NavPanel 到 Home route 的反向依赖。

### 阶段 C：验证与防回归

1. 为 route-key resolver 添加纯函数测试。
2. 更新现有 NavPanel 行为测试，验证多 key 注册、当前 key 选择与缺失内容 fallback。
3. 更新现有任务布局测试，验证布局不再依赖全局 reset 副作用。
4. 在 ESLint 中建立性能导入边界，阻止 Conversation self-barrel、NavPanel/route Sidebar 反向所有权、首页静态 Editor、HomeInbox 重型交互面与 ShareModal 实现绕过。
5. 使用 ESLint 编程 API 添加行为测试，同时验证违规静态导入失败、合法子入口与 `import()` 通过、既有 UI 导入限制仍然有效。
6. 运行 `bun run check` 的相关文件定向检查。`eslint.config.test.mts` 与配置文件同名，使配置变更自动关联规则测试。
7. 重新生产构建，计算 Bootstrap、首页增量和 Editor 动态增量。

## 实施结果

使用独立输出目录执行启用 manifest 与 sourcemap 的生产构建，并按静态 `imports` 递归计算文件集合。结果如下：

| 阶段         | 改造前 chunks | 当前 chunks | 改造前 Minified | 当前 Minified | 改造前 Gzip | 当前 Gzip |
| ------------ | ------------: | ----------: | --------------: | ------------: | ----------: | --------: |
| Bootstrap    |            65 |          65 |        13.64 MB |      13.63 MB |     3.55 MB |   3.55 MB |
| 首页路由新增 |           189 |         119 |        10.21 MB |       5.28 MB |     2.74 MB |   1.32 MB |
| 首屏合计     |           254 |         184 |        23.85 MB |      18.91 MB |     6.29 MB |   4.87 MB |

首屏合计减少 70 个静态 chunk、4.94 MB minified 与 1.42 MB gzip。交互边界的集合增量为：

| 动态边界       | 新增 chunks | Minified |    Gzip |
| -------------- | ----------: | -------: | ------: |
| 首页 Editor    |          48 |  2.26 MB |  663 KB |
| DocumentModal  |          99 |  4.72 MB | 1.38 MB |
| ShareModal 壳  |           2 |  9.56 KB | 4.28 KB |
| RunReplyEditor |           1 |  1.63 KB | 0.95 KB |

Sourcemap 负面断言确认首页静态集合不包含以下源码：

- `src/features/ChatInput/index.ts`、`Desktop/**` 与 `InputEditor/**`
- `src/features/Conversation/ChatItem/components/ErrorContent.tsx`
- `src/features/AgentTasks/AgentTaskDetail/RunReplyEditor.tsx`
- `src/features/ShareModal/Modal.tsx`
- `src/features/DocumentModal/index.tsx`

首页集合中仍存在 `ChatInput/draftStorage.ts` 与 `utils/contextSelections.ts` 两个无 UI 工具模块；它们由全局 chat/tool store 使用，不包含 Editor。Bootstrap 仍通过全局 `EditorProvider` 的 `@lobehub/editor/react` barrel 保留部分上游 ChatInput primitive。该上游导出粒度问题不再使应用 ChatInput 静态加载，且 Editor 已形成 663 KB gzip 的真实动态增量，后续应作为独立的 vendor export 边界治理。

启用 `LOBE_VITE_DEVTOOLS=true` 后，Rolldown DevTools 可以完成模块转换并生成 session/RPC dump，但在为该仓库序列化静态 DevTools 页面时触发 `RangeError: Invalid string length`。因此最终数字以同次 Vite manifest、sourcemap 与静态 import 图交叉验证为准；不能将 DevTools 静态页面是否成功生成作为构建验收条件。

## 验收标准

### 功能

- 首页、Agent、Group、Settings、Workspace Settings、Resource、Memory、Community、Eval、Page、Image、Video Sidebar 正常显示。
- 从首页进入 Agent 时，idle route preload 命中后不出现主 Route loading skeleton。
- 首页 textarea 的 value 与 IME composition 状态可以迁移到真实 Editor。
- 首页未读任务点击回复后才加载 Editor，并可正常发送和取消。
- ShareModal 可以从 Topic 菜单与 Page Editor 打开，各 Tab 正常切换。

### 构建

- 首页静态闭包不再包含 `RunReplyEditor` 和 ShareModal 实现。
- `src/features/NavPanel/index.tsx` 不包含任何 `src/routes/**/Sidebar` 静态 import。
- `src/features/Conversation/**` 不包含对 `@/features/Conversation` 的运行时 self-barrel import。
- `EditorInput` 的递归静态依赖不再与首页静态闭包完全重叠；其动态增量应反映真实 Editor 代码。
- 首页 gzip 总量不得高于改造前 6.29 MB，并记录实际变化；共享 chunk 变化按集合差计算，不将单个 chunk 文件名当作收益。

### 自动化防线

以下约束由根 ESLint 配置直接执行，因此适用于本地 `bun run check`、`lint:ts` 与调用同一配置的 CI lint：

| 作用域                         | 自动拒绝                                                                 | 允许方式                                                                          |
| ------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/features/Conversation/**` | `@/features/Conversation` 根 barrel                                      | `store`、`ConversationProvider`、`Messages` 等稳定子入口                          |
| `src/features/NavPanel/**`     | 任意 route Sidebar 实现                                                  | route layout 通过 `NavPanelPortal` 注册内容                                       |
| route Sidebar 文件             | `@/features/NavPanel` Host barrel                                        | `@/features/NavPanel/NavPanelPortal` 专用入口                                     |
| `src/features/HomeInbox/**`    | 静态导入 `RunReplyEditor`、`TopicChatDrawer`、DocumentModal 实现         | 交互触发 `import()` 或轻量 Preview/loader                                         |
| Home 冷路径                    | 静态导入 `ChatInput` UI、Conversation 根 barrel 或直接导入 `EditorInput` | 隔离的动态 Editor 入口；已确认无 UI 的 `initialState` 与 `contextSelections` 工具 |
| 全部 `src/**`                  | 直接导入 `ShareModal/Modal`                                              | `@/features/ShareModal` 懒加载 facade                                             |

`eslint.config.test.mts` 对上述拒绝与允许路径执行真实 ESLint，不对配置常量做快照。该测试还验证 `@lobehub/ui` 的既有 `no-restricted-imports` 规则在局部性能 override 后仍然生效。

## 风险与回退

| 风险                               | 缓解措施                                                       |
| ---------------------------------- | -------------------------------------------------------------- |
| Portal effect 顺序导致错误 Sidebar | Registry 按 key 保存，Host 按 pathname 选择，不使用最后写入者  |
| Portal 卸载误删同 key 的新 owner   | 每个 Portal 使用稳定 owner token，注销时校验 owner             |
| 动态 Modal API 返回值变化          | facade 显式返回 `Promise<ModalInstance>`，调用方不依赖同步句柄 |
| 回复点击出现短暂空白               | hover/focus 预取并使用固定高度 fallback                        |
| chunk 重命名导致验收误判           | 使用 manifest 递归闭包和 sourcemap sources，而非文件名字符串   |
