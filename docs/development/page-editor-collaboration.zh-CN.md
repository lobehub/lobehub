# Page 编辑器增强与协同验收说明

本文档用于审查本分支对 LobeHub Page 编辑器的完整改动。它同时说明前端集成、Yjs
协同服务、链接元数据接口、Agent Gateway 接入、测试方式和部署边界。

> 当前 relay 保留每实例短期 Y.Doc replica；生产组合通过 Redis room backend 共享 owner
> lease、revision、update/awareness pub/sub、bounded replay 和 immutable snapshot，不能
> 让多个裸 `server.cjs` 实例各自运行。开发环境如需无 Redis，必须显式设置
> `PAGE_COLLABORATION_BACKEND=memory`；生产没有可用 `REDIS_URL` 会 fail-closed。

> 本分支依赖 [lobe-editor PR #198](https://github.com/lobehub/lobe-editor/pull/198)。
> 在该 PR 合并并发布正式版本前，`package.json` 临时锁定到它的 `pkg.pr.new` 预览包；
> 合并本分支前必须改回包含这些 API 的正式 `@lobehub/editor` 版本。

> 状态：本地 Phase 6 已通过；生产 Redis HA/TLS/ 反向代理演练仍待外部部署验收。

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
│  ├─ lobe-yjs-v1 hello/auth/sync/update                      │
│  ├─ browser / Agent ticket + ACL verifier                   │
│  ├─ first-client bootstrap barrier                         │
│  ├─ debounce snapshot → database CAS/history               │
│  ├─ Redis owner lease + revision + pub/sub (production)     │
│  ├─ shared replay + immutable room snapshot                 │
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
http://127.0.0.1:12345/metrics
ws://127.0.0.1:12345/collaboration/:documentId
```

`/health` 会在 Redis backend 任一 command/pub-sub 连接不可用时返回 `503`，供编排系统摘除
故障实例；`/metrics` 只返回 room/client/persistence 数量与 backend mode/health 的聚合 JSON，
不包含 room、document、user 或 ticket 标识。

`/rooms` 仅在隔离调试实例显式设置 `exposeRoomDiagnostics: true` 时可用；正式 `start.ts`
组合默认返回 `404`，避免泄露房间和租户标识。

v1 WebSocket 消息为 JSON，并带 `protocol: lobe-yjs-v1` 与 `version: 1`：

| 类型                         | 方向 | 说明                                                          |
| ---------------------------- | ---- | ------------------------------------------------------------- |
| `hello` / `auth` / `auth-ok` | 握手 | nonce、短期 room ticket、client kind 和服务端 client identity |
| `sync` / `sync-request`      | 双向 | 当前房间的 Yjs state update、state vector 与 awareness 快照   |
| `update` / `update-ack`      | 双向 | 带 messageId 的 Base64 Yjs update；服务端负责 sender 与幂等   |
| `awareness`                  | 双向 | 标准 UserState 的用户名、选区、焦点和 Agent 状态              |

旧 legacy JSON 协议仅由直接运行 `server.cjs` 的本地 demo 使用；`start.ts` 生产 / 验收组合
会显式关闭 legacy，并在未配置 ticket verifier 时让 v1 fail-closed。

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

| 变量                                           |      默认值 | 说明                                                                                |
| ---------------------------------------------- | ----------: | ----------------------------------------------------------------------------------- |
| `PAGE_COLLABORATION_PORT`                      |     `12345` | 协同服务监听端口                                                                    |
| `PAGE_COLLABORATION_HOST`                      | `127.0.0.1` | 监听地址；仅验收时显式改为外部地址                                                  |
| `PAGE_COLLABORATION_BOOTSTRAP_TIMEOUT_MS`      |     `10000` | 首次 bootstrap owner 超时后移交                                                     |
| `PAGE_COLLABORATION_ROOM_IDLE_TTL_MS`          |   `1800000` | 空房间保留时间；验收可设 `30000`                                                    |
| `PAGE_COLLABORATION_CLEANUP_INTERVAL_MS`       |     `60000` | 空房间扫描周期；验收可设 `5000`                                                     |
| `PAGE_COLLABORATION_HEARTBEAT_INTERVAL_MS`     |     `30000` | WebSocket 心跳周期                                                                  |
| `PAGE_COLLABORATION_MAX_IDLE_ROOMS`            |        `20` | 最多保留的空房间数量                                                                |
| `PAGE_COLLABORATION_MAX_BROWSER_CLIENTS`       |         `1` | 每个 v1 room 最多一个 browser client                                                |
| `PAGE_COLLABORATION_MAX_AGENT_CLIENTS`         |         `5` | 每个 v1 room 最多五个独立 Agent client                                              |
| `PAGE_COLLABORATION_MAX_MESSAGE_BYTES`         |   `2097152` | 单条 WebSocket 消息上限                                                             |
| `PAGE_COLLABORATION_BACKEND`                   |       Redis | `redis` 为生产默认；仅开发 / 测试可显式设 `memory`                                  |
| `REDIS_URL`                                    |      未配置 | Redis owner/pub-sub/replay/snapshot 连接地址                                        |
| `REDIS_PREFIX`                                 |  `lobechat` | Redis key 前缀；多环境必须使用不同前缀                                              |
| `DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET` |      未配置 | 浏览器 room ticket 签名密钥；启动组合时必填                                         |
| `DOCUMENT_REWRITE_TICKET_SECRET`               |      未配置 | Agent room ticket 签名密钥；也可由 `AUTH_SECRET` 提供                               |
| `PAGE_AGENT_TARGETED_REWRITE_ENABLED`          |      `true` | targeted rewrite 创建开关；设为 `0`/`false` 可停发新 request                        |
| `DOCUMENT_REWRITE_MOCK_REPLACEMENT_TEXT`       |      未设置 | 仅 `NODE_ENV=development/test` 且显式设置时启用 deterministic replacement；生产禁用 |
| `NEXT_PUBLIC_PAGE_COLLABORATION_URL`           |      未配置 | 显式启用协同的 WebSocket 基础地址；生产不再猜端口                                   |
| `NEXT_PUBLIC_PAGE_EDITOR_ACCEPTANCE_EMBED`     |      未启用 | 设为 `true` 或 `1` 才启用验收 iframe 规则                                           |

启动 `start.ts` 前，先在 `.env.local` 或受控环境变量中配置两个 ticket secret（这里只能
使用部署自己的随机值，文档不保存或打印密钥），并准备可用数据库。30 秒回收的验收启动
示例：

```bash
PAGE_COLLABORATION_ROOM_IDLE_TTL_MS=30000 \
  PAGE_COLLABORATION_CLEANUP_INTERVAL_MS=5000 \
  PAGE_COLLABORATION_BACKEND=memory \
  PAGE_COLLABORATION_HOST=127.0.0.1 \
  pnpm dev:page-collaboration
```

生产或共享网络环境必须显式设置 `PAGE_COLLABORATION_HOST`、
`NEXT_PUBLIC_PAGE_COLLABORATION_URL`、可用的 `REDIS_URL` 和两个 ticket secret；生产不要
设置 `PAGE_COLLABORATION_BACKEND=memory`。浏览器 / Agent 的 document ACL 由 ticket verifier
在握手时重新检查；不要把反向代理鉴权当作 document ACL 的替代。relay 默认只绑定 loopback，
diagnostics `/rooms` 在 `start.ts` 组合中默认关闭；Redis backend 负责跨实例 owner、pub/sub
和 replay，Redis 故障时新连接与写操作 fail-closed。

本地没有可用 model/provider 时，可在启动 LobeHub server 的同一进程环境中显式注入 deterministic
replacement，以便验收真实 worker/Yjs/direct persistence 链路：

```bash
NODE_ENV=development \
  DOCUMENT_REWRITE_MOCK_REPLACEMENT_TEXT='Deterministic direct text' \
  pnpm dev
```

该变量只在 `NODE_ENV=development` 或 `NODE_ENV=test` 读取；生产环境必须禁用，不会读取或采纳
该值，生产仍只能使用正式 Page Agent model/provider。mock 只替代生成文本，不替代 selection
resolve、Yjs direct command、persistence proof 或 provenance。

### 长任务与中断的责任边界

Document rewrite worker 的默认 lease 为 60 秒，并约每 20 秒续租；lease 只用于故障回收和
防止两个 worker 同时持有同一 request，不代表 AI 任务的总时长。WebSocket room ticket 到期时，
Node provider 必须使用 refresh callback 获取新 ticket，等待同一个 Y.Doc/request/chunk ID
集合完成 fresh sync 后继续；不能复用旧 sync barrier、创建第二个 Y.Doc，或把同一 chunk 自动再写一次。

四个阶段的成功条件彼此独立：模型完成只表示生成流结束，sync ACK 只表示 Yjs update 已被 relay
确认，持久化 content/editorData/snapshot proof 才表示数据库投影已落盘；三者不能互相替代。Headless
snapshot 转换是 server-only 的纯入口，只返回不可变 `stateVector`/`update` 字节，不向 worker
或业务层暴露可写 Y.Doc、binding 或 service symbol。

任意 ticket refresh 失败、terminal auth、fresh sync 超时、用户取消、主动断开或持久化 proof
失败，都必须 fail-closed：保留已确认的 partial 文本但不能标记 `applied`，不能在恢复后自动重复
写入，也不能用残缺正文覆盖原文。恢复后的新请求必须重新通过 selection、chunk identity 和
projection proof 检查。

### Targeted rewrite 回滚开关

将 `PAGE_AGENT_TARGETED_REWRITE_ENABLED=0`（或 `false`）注入服务端后，新的 targeted rewrite
request 会在持久化前被拒绝并返回 `PRECONDITION_FAILED`。该开关只保护 request 创建边界，
不会删除已有 request、Diff、历史或 room persistence；旧 Diff 仍由兼容路径处理，新 request
不会创建审核 Diff。
若需要停止后台生成，再单独停止或摘除 rewrite worker，并继续保留协同服务以 flush 活跃房间。

验收 iframe fixture 位于 `.agents/acceptance/fixtures/lobe-editor-acceptance-embed.html`，不在
生产 `public/` 路径中。需要验收时由专用验收启动流程提供该 fixture，并设置
`NEXT_PUBLIC_PAGE_EDITOR_ACCEPTANCE_EMBED=true`；规则还会校验 iframe URL 与当前页面 origin
一致，未设置 flag 时不会注册。

## 6. 日志与排障

服务使用单行结构化日志，前缀为 `[page-collaboration]`，关键事件包括：

- `room.created`、`room.evicted`；
- `client.connected`、`client.authenticated`、`client.disconnected`；
- auth 失败、sync 延迟、rate-limit 和 sender 校验失败；
- `bootstrap.owner-assigned`、`bootstrap.completed`；
- `bootstrap.owner-promoted`、`bootstrap.timeout`；
- `sync.sent`、`sync.deferred`；
- `update.applied`、`update.rejected`；
- `awareness.updated`；
- `persistence.conflict`、`persistence.failed`、`persistence.flush-failed`。

排查内容重复时，先确认同一房间是否只出现一次 `bootstrap.completed`；排查房间未回收时，
在直接构造 `createCollaborationServer({ exposeRoomDiagnostics: true })` 的隔离测试实例上
检查 diagnostics 中的 `clientCount`、`lastEmptyAt` 和 TTL。生产组合默认不暴露 `/rooms`，
不要为了排障把它公开到公网。

## 7. 本地验证

安装依赖：

```bash
pnpm install
```

运行协同服务和持久化单元测试：

```bash
pnpm vitest run scripts/page-collaboration/server.test.ts
pnpm vitest run scripts/page-collaboration/roomBackend.test.ts
pnpm vitest run \
  apps/server/src/services/documentCollaboration \
  apps/server/src/services/documentRewrite
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
6. 关闭同一文档的全部页面；在隔离测试实例中检查房间进入 idle（正式 `start.ts` 默认不暴露 `/rooms`）；
7. 等待 TTL，确认出现 `room.evicted`；bootstrap owner 不发首个 update 时应先看到 timeout 和
   单 owner 移交，不能看到多个客户端同时收到空 bootstrap；
8. 重新打开文档，确认数据库内容只引导一次且没有整篇重复。

### 本地 Phase 6 真实 UI 结果（2026-08-30）

在 exact route `/page/Bp6pBXenfUif7vp5` 登录成功，并完成以下回归：

- cold ticket lifecycle 建立 browser client，relay metrics 的 client count 为 `1`；
- Cmd/Ctrl+A 跨段选区保持文档逻辑顺序；
- development mock 经真实 worker/Yjs provider/direct command gateway 直接写入；
- Agent Edits 在 request-linked history 持久化证明后显示 `applied`，history 带 `requestId` 与
  `source`，最终 `editorData` 不产生 targeted Diff；
- hard refresh 后状态恢复，relay 重启后 browser provider 自动 reconnect。

现场修复记录：服务端 `targetNodeIds` 不再对 selection JSON 排序（并发 claim/key 只排序派生
副本）；WebSocket client close 使用合法 close code；Page 在 ticket/provider 未就绪前
fail-closed mount，只读可显示但不可编辑。

链接验收：

1. 粘贴普通 HTTPS URL；
2. 在链接、标题卡片、块级卡片和支持的内嵌视图之间来回转换；
3. 确认卡片宽度随内容和容器变化，不出现固定 320px 截断；
4. 确认 favicon 来自目标 HTML 的 icon link；
5. 刷新页面，确认转换结果被持久化且 Toolbar 仍可操作。

## 8. 部署建议

验收环境可以独立运行该服务，并由反向代理将 `/collaboration/*` 转发到 WebSocket 端口。默认
监听 `127.0.0.1`；只有在明确的验收网络边界内才通过 `PAGE_COLLABORATION_HOST` 改监听地址。
启动组合会加载数据库、browser/Agent ticket verifier、Redis room backend、CAS persistence
worker 和优雅关闭 flush。建议为进程设置内存上限与自动重启；生产扩容前要先验证 Redis HA、
跨实例 owner failover、pub/sub 延迟、replay 原子性和连接迁移。

仍需平台侧准备或验收：

- Redis HA / 故障切换、TLS/ACL、独立 prefix 和备份恢复；
- persistence lag/CAS/reconnect 指标、追踪和告警；
- 协议版本兼容与迁移策略、反向代理 WebSocket idle timeout；
- 真实 Redis 两实例 browser/Agent 集成测试可通过 `REDIS_TEST_URL=<redis-url> pnpm vitest run
scripts/page-collaboration/roomBackend.redis.integration.test.ts` 显式运行；部署 HA/TLS/ACL
  和代理连接迁移仍需环境验收。

## 9. 回滚

1. 移除 Page 中的 `ReactYjsPlugin` 注册或清空协同 URL；
2. 停止 `page-collaboration` 服务；
3. URL 卡片出现问题时可独立回滚 `ReactLinkPlugin` 自定义规则和 metadata route；
4. 编辑器挂载问题回滚时，必须同时撤销对应 Lexical patch，避免代码与补丁版本错配；
5. 回滚前保留数据库文档历史、persistence ledger 和 Redis immutable room snapshot；当前
   backend 保存最新快照而非完整 Yjs update log，flush 与 Redis 同时失败时未发布的内存 update
   不可恢复。

## 10. 已知边界

- relay/backend 保存最新 immutable room snapshot；快照缺失或过期时，房间回收 / 重启后依赖
  ACL 校验后的数据库 editorData/content 生成 bootstrap update，由 Redis owner 继续 revision/CAS；
  不能把 Agent 私有旧快照当作 bootstrap 来源；
- v1 clientId 的 relay sender identity 由服务端分配，URL 中的 Yjs clientId 只用于客户端
  本地文档状态，不能作为认证身份；
- 裸 `server.cjs` 仍是无 backend 的本地协议 relay；正式 `start.ts` 必须使用 Redis backend，
  其 replay store 跨实例共享且 Redis 故障 fail-closed，不可把显式 memory backend 宣称为生产 HA；
- 链接内嵌视图必须由目标站点允许 iframe；
- 目标站点可能阻止抓取 favicon 或返回非 HTML 内容；
- 双账号是最可靠的协同验收方式，无痕窗口只能模拟不同会话，不能覆盖账号权限差异；
- 本分支依赖包含相应 Yjs、链接和 Diff 能力的 `@lobehub/editor` 版本。
