# Page 编辑器增强与协同验收说明

本文档用于审查本分支对 LobeHub Page 编辑器的完整改动。它同时说明前端集成、Yjs
协同服务、链接元数据接口、Agent Gateway 接入、测试方式和部署边界。

> 当前协同服务是面向本地开发和功能验收的内存型实现。它不提供持久化、鉴权、跨实例
> 一致性或高可用能力，不能直接替代生产环境的协同基础设施。

> 本分支依赖 [lobe-editor PR #198](https://github.com/lobehub/lobe-editor/pull/198)。
> 在该 PR 合并并发布正式版本前，`package.json` 临时锁定到它的 `pkg.pr.new` 预览包；
> 合并本分支前必须改回包含这些 API 的正式 `@lobehub/editor` 版本。

## 1. 改动目标

本分支主要验证 `@lobehub/editor` 在 Page 场景中的以下能力：

- 同一 Page 文档的多人实时编辑、用户名光标和选区状态；
- 每篇文档使用独立协同房间，空房间按 TTL 回收；
- 折叠块、目录、Slash 菜单、链接卡片、内嵌视图和评论标注；
- Page Copilot 通过 Agent Gateway 读取并修改当前文档；
- 编辑器挂载、页面切换和刷新时不重复初始化或清空文档；
- URL 元数据由服务端读取，避免浏览器跨域并统一标题、描述和 favicon。

## 2. 总体架构

```text
┌────────────────────── LobeHub Page ──────────────────────┐
│ PageEditor                                                │
│  ├─ EditorCanvas                                          │
│  │   ├─ ReactYjsPlugin ───── WebSocket ───────────────┐   │
│  │   ├─ ReactLinkPlugin ──── /webapi/url-metadata     │   │
│  │   ├─ ReactTocPlugin                                │   │
│  │   ├─ ReactCollapsiblePlugin                        │   │
│  │   └─ Annotation / Slash / Link Card                │   │
│  └─ PageAgentProvider ────── Agent Gateway            │   │
└───────────────────────────────────────────────────────┼───┘
                                                        │
┌──────────── scripts/page-collaboration ───────────────▼───┐
│ /collaboration/:documentId                                 │
│  ├─ Map<documentId, Room>                                  │
│  ├─ Y.Doc + awareness                                      │
│  ├─ first-client bootstrap barrier                         │
│  ├─ update / connect / disconnect / eviction logs          │
│  └─ idle TTL cleanup                                       │
└────────────────────────────────────────────────────────────┘
```

Page 的 `documentId` 同时作为 Yjs `roomId`。因此不同文章不会共享 `Y.Doc`、awareness
或连接集合。

## 3. 主要代码边界

### 3.1 Page 编辑器集成

| 模块                                             | 作用                                                |
| ------------------------------------------------ | --------------------------------------------------- |
| `src/features/PageEditor/EditorCanvas/index.tsx` | 注册 Yjs、链接、折叠块、目录、评论和 Artifact 插件  |
| `collaborationUrl.ts`                            | 根据运行环境生成 WebSocket 地址，可通过环境变量覆盖 |
| `collaborationUser.ts`                           | 从当前账号生成稳定的协同用户 ID、显示名和颜色       |
| `PageRichLinkCard.tsx`                           | 展示链接标题、描述、目标站点 favicon 和加载状态     |
| `useSlashItems.tsx`                              | 使用新的分组 Slash 菜单，并补充折叠块等 Page 命令   |
| `PageTableOfContents.tsx`                        | 目录展开、收起、悬浮预览和当前标题定位              |

### 3.2 Agent 与文档生命周期

| 模块                               | 作用                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| `PageAgentProvider.tsx`            | 将当前 Page 文档能力注入 Copilot/Agent Gateway       |
| `PageEditorProvider.tsx`           | 维护 Page 编辑器实例与文档 ID 生命周期               |
| `DocumentIdMode.tsx`               | 文档 ID 变化时安全切换，不在编辑器未初始化时读取内容 |
| `InternalEditor.tsx`               | 区分 React 重渲染与 Lexical 根节点重新挂载           |
| `src/store/document/.../action.ts` | 保存和切换文档时保持编辑器状态一致                   |

### 3.3 URL 元数据

`GET /webapi/url-metadata?url=<target>` 在服务端读取目标 HTML：

1. 校验协议和目标地址；
2. 解析页面标题、描述以及 `<link rel="icon">`；
3. 将相对 favicon 地址转换为绝对地址；
4. 返回给链接卡片渲染器。

接口实现位于 `src/server/services/urlMetadata.ts`，App Router 文件只负责请求适配。

### 3.4 Lexical 补丁（必须在升级时重新验证）

`patches/lexical@0.42.0.patch` 是针对 Lexical 0.42.0 的临时补丁，不是通用 fork。补丁通过
`pnpm.patchedDependencies` 注册，具体改动如下：

- `parseEditorState(serializedEditorState, editor, updateFn)` 调用 `updateFn(editorState)`，让
  解析回调可以使用刚刚创建的 `EditorState`，而不是只能从外部 ref 猜测当前 state；
- `resetRandomKey(targetId?)` 在传入目标值时恢复到指定 key counter，未传值时保持原有的从 1
  开始的行为。

这两个改动共同修复 Page 编辑器在 “已有 editor 实例被保留、根节点因 Page 切换或只读 / 可编辑
边界重新挂载、随后再次从服务端快照初始化” 的生命周期问题。未修复时，解析回调可能观察到旧
state，或新旧根节点的随机 key counter 不连续，表现为首次挂载成功但切换 / 刷新后内容不出现、
节点 key 冲突，或者初始化回调重复触发。复现路径是：打开一个带 `documentId` 的 Page → 在
编辑器已初始化后切换到另一篇 Page 或切换只读边界 → 让 SWR 返回快照并再次触发 editor init。

只在业务层增加 “不要重复初始化” 判断不能修复这个问题：业务层无法改变 Lexical 内部解析回调
拿到的 state，也无法控制 Lexical 模块级 key counter；继续堆 ref/timeout 只会把问题变成竞态。
因此本分支同时保留 `DocumentIdMode` 的一次性 hydration 防护和这个明确锁定版本的补丁。

覆盖情况包括 `DocumentIdMode.test.tsx` 的重复 init、协同快照屏障和 autosave echo 回归，以及
`InternalEditor.readonly.test.tsx` 的 editor 生命周期行为；Lexical 解析 /key-counter 的直接
单元测试随上游 editor PR #198 维护。本仓库截至本文更新时没有为这两个改动提交独立的上游
Lexical issue/PR，依赖的 editor API 变更来自 [lobe-editor PR #198](https://github.com/lobehub/lobe-editor/pull/198)。

升级 Lexical 时必须：

1. 对比新版本 `parseEditorState` 和 `resetRandomKey` 的实现，确认两个行为是否已经由上游修复；
2. 若已修复，删除 `patches/lexical@0.42.0.patch` 以及 `pnpm.patchedDependencies` 条目，并运行
   Page editor 的相关测试和双页面人工切换验收；
3. 若未修复，不要把旧 patch 静默改名套到新版本，先生成针对新版本的最小 patch，并记录新的
   故障复现与验证结果。

## 4. 协同服务协议

启动命令：

```bash
pnpm dev:page-collaboration
```

默认监听：

```text
http://127.0.0.1:12345/health
http://127.0.0.1:12345/rooms
ws://127.0.0.1:12345/collaboration/:documentId
```

WebSocket 消息为 JSON：

| 类型        | 方向            | 说明                                          |
| ----------- | --------------- | --------------------------------------------- |
| `sync`      | 服务端 → 客户端 | 当前房间的 Yjs state update 与 awareness 快照 |
| `update`    | 双向            | Base64 编码的 Yjs update                      |
| `awareness` | 双向            | 用户名、选区、焦点和正在编辑的块              |

### 首次连接屏障

空房间只允许第一个客户端引导 Y.Doc。其他同时连接的客户端会等待第一个有效 update，
然后再收到同步快照。这可以防止多个浏览器把同一份数据库文档重复插入 Y.Doc。

### 房间回收

最后一个客户端离开后，房间进入 idle 状态。到达 TTL 后销毁 `Y.Doc` 并删除 awareness：

```text
active room --last client leaves--> idle room --TTL--> evicted
```

验收时可配置为 30 秒；默认值更保守，为 30 分钟。

## 5. 环境变量

| 变量                                       |      默认值 | 说明                                              |
| ------------------------------------------ | ----------: | ------------------------------------------------- |
| `PAGE_COLLABORATION_PORT`                  |     `12345` | 协同服务监听端口                                  |
| `PAGE_COLLABORATION_HOST`                  | `127.0.0.1` | 监听地址；仅验收时显式改为外部地址                |
| `PAGE_COLLABORATION_BOOTSTRAP_TIMEOUT_MS`  |     `10000` | 首次 bootstrap owner 超时后移交                   |
| `PAGE_COLLABORATION_ROOM_IDLE_TTL_MS`      |   `1800000` | 空房间保留时间；验收可设 `30000`                  |
| `PAGE_COLLABORATION_CLEANUP_INTERVAL_MS`   |     `60000` | 空房间扫描周期；验收可设 `5000`                   |
| `PAGE_COLLABORATION_HEARTBEAT_INTERVAL_MS` |     `30000` | WebSocket 心跳周期                                |
| `PAGE_COLLABORATION_MAX_IDLE_ROOMS`        |        `20` | 最多保留的空房间数量                              |
| `PAGE_COLLABORATION_MAX_MESSAGE_BYTES`     |   `2097152` | 单条 WebSocket 消息上限                           |
| `NEXT_PUBLIC_PAGE_COLLABORATION_URL`       |      未配置 | 显式启用协同的 WebSocket 基础地址；生产不再猜端口 |
| `NEXT_PUBLIC_PAGE_EDITOR_ACCEPTANCE_EMBED` |      未启用 | 设为 `true` 或 `1` 才启用验收 iframe 规则         |

30 秒回收的验收启动示例：

```bash
PAGE_COLLABORATION_ROOM_IDLE_TTL_MS=30000 \
  PAGE_COLLABORATION_CLEANUP_INTERVAL_MS=5000 \
  PAGE_COLLABORATION_HOST=127.0.0.1 \
  pnpm dev:page-collaboration
```

生产或共享网络环境必须显式设置 `PAGE_COLLABORATION_HOST` 和
`NEXT_PUBLIC_PAGE_COLLABORATION_URL`，并由反向代理补充鉴权。服务默认只绑定 loopback；它是
内存验收服务，没有文档权限校验，`clientId` 来自 URL 查询参数、客户端可以伪造，不能作为
身份认证，也不应直接暴露到生产网络。

验收 iframe fixture 位于 `.agents/acceptance/fixtures/lobe-editor-acceptance-embed.html`，不在
生产 `public/` 路径中。需要验收时由专用验收启动流程提供该 fixture，并设置
`NEXT_PUBLIC_PAGE_EDITOR_ACCEPTANCE_EMBED=true`；规则还会校验 iframe URL 与当前页面 origin
一致，未设置 flag 时不会注册。

## 6. 日志与排障

服务使用单行结构化日志，前缀为 `[page-collaboration]`，关键事件包括：

- `room.created`、`room.evicted`；
- `client.connected`、`client.disconnected`；
- `bootstrap.owner-assigned`、`bootstrap.completed`；
- `bootstrap.owner-promoted`、`bootstrap.timeout`；
- `sync.sent`、`sync.deferred`；
- `update.applied`、`update.rejected`；
- `awareness.updated`。

排查内容重复时，先确认同一房间是否只出现一次 `bootstrap.completed`；排查房间未回收时，
检查 `/rooms` 中的 `clientCount`、`lastEmptyAt` 和服务端 TTL 配置。

## 7. 本地验证

安装依赖：

```bash
pnpm install
```

运行协同服务单元测试：

```bash
pnpm vitest run scripts/page-collaboration/server.test.ts
```

运行本分支相关检查：

```bash
bun run check \
  src/features/PageEditor \
  src/features/EditorCanvas \
  src/server/services/urlMetadata.ts \
  scripts/page-collaboration
```

人工协同验收：

1. 启动 LobeHub 与协同服务；
2. 使用两个账号或两个独立浏览器会话打开同一个 Page URL；
3. 确认双方光标显示用户名，输入内容实时同步；
4. 让一个用户把光标放入折叠块，确认另一个用户不能折叠该块；
5. 打开另一篇 Page，确认内容和 awareness 不串房间；
6. 关闭同一文档的全部页面，检查 `/rooms` 进入 idle；
7. 等待 TTL，确认出现 `room.evicted`；bootstrap owner 不发首个 update 时应先看到 timeout 和
   单 owner 移交，不能看到多个客户端同时收到空 bootstrap；
8. 重新打开文档，确认数据库内容只引导一次且没有整篇重复。

链接验收：

1. 粘贴普通 HTTPS URL；
2. 在链接、标题卡片、块级卡片和支持的内嵌视图之间来回转换；
3. 确认卡片宽度随内容和容器变化，不出现固定 320px 截断；
4. 确认 favicon 来自目标 HTML 的 icon link；
5. 刷新页面，确认转换结果被持久化且 Toolbar 仍可操作。

## 8. 部署建议

验收环境可以独立运行该服务，并由反向代理将 `/collaboration/*` 转发到 WebSocket 端口。默认
监听 `127.0.0.1`；只有在明确的验收网络边界内才通过 `PAGE_COLLABORATION_HOST` 改监听地址。
建议为进程设置内存上限与自动重启，但不要把内存型服务横向扩容到多个实例。

生产化前需要补齐：

- 用户身份与文档访问权限校验；
- Yjs update 持久化、压缩和恢复；
- 多实例房间路由或共享 pub/sub；
- 限流、指标、追踪和告警；
- 协议版本与客户端兼容策略；
- 优雅关闭时的房间快照。

## 9. 回滚

1. 移除 Page 中的 `ReactYjsPlugin` 注册或清空协同 URL；
2. 停止 `page-collaboration` 服务；
3. URL 卡片出现问题时可独立回滚 `ReactLinkPlugin` 自定义规则和 metadata route；
4. 编辑器挂载问题回滚时，必须同时撤销对应 Lexical patch，避免代码与补丁版本错配；
5. 回滚前保留数据库文档快照。当前协同房间是内存数据，服务停止后无法恢复未保存 update。

## 10. 已知边界

- 该服务不保存 Yjs update，房间回收后只依赖 Page 原有数据库内容重新引导；
- `clientId` 是客户端自报值，可伪造；当前服务无鉴权，仅限本地 / 隔离验收环境；
- 链接内嵌视图必须由目标站点允许 iframe；
- 目标站点可能阻止抓取 favicon 或返回非 HTML 内容；
- 双账号是最可靠的协同验收方式，无痕窗口只能模拟不同会话，不能覆盖账号权限差异；
- 本分支依赖包含相应 Yjs、链接和 Diff 能力的 `@lobehub/editor` 版本。
