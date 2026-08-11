# Agent Topic Projection 迁移规范

> 状态：设计定稿，待实施\
> 前置依赖：[Projection 客户端数据层规范](./projection-store.zh-CN.md)（fix/home-startup-cache）\
> 交付方式：stacked 分支叠在 fix/home-startup-cache 上，分期 PR

## 1. 背景

Home 第一阶段建立了以局部投影、fragment、索引为核心的 Projection 数据层。本规范将 agent
topic 相关数据面迁入同一数据层，并併入 Home 第一阶段遗留的投影清偿（§2.1）；此后的
Projection 域与基础设施工作收录于 §10 后续路线图。Projection 不表示完整 topic 实体，
只保存客户端已观测且被 View Contract 使用的 fragments。当前一个 topic 最多同时存在于 9 个位置：

### 1.1 内存中的可写 DTO 副本

| #   | 位置                                       | 说明                                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------------- |
| 1   | `chat.topicDataMap[container].items`       | sidebar 便宜查询 bucket，完整 `ChatTopic[]`                       |
| 2   | `chat.agentTopicsViewMap[container].items` | 管理页 bucket（withDetails），与 #1 是同一 topic 的并行副本       |
| 3   | `chat.searchTopics`                        | 搜索命中的第三份副本                                              |
| 4   | `home.recents`（`RecentItem[]`）           | 全局 Recents 抽屉的 topic 字段快照（规范 §10.4 遗留尾巴）         |
| 5   | SWR 内存 cache（`topic:*`）                | 按查询签名分 key，同一 container 多个 key 各存一份重叠的 topic 行 |

### 1.2 持久化副本

| #   | 位置                                   | 说明                                                     |
| --- | -------------------------------------- | -------------------------------------------------------- |
| 6   | IndexedDB SWR tier（`topic:` 前缀）    | #5 的每个 key 单独落盘，同一 topic 行随请求形态落盘 N 份 |
| 7   | localStorage（`recent:list` 等）       | recent topic 壳子                                        |
| 8   | projection repository `entity-records` | canonical 持久化（当前仅 Home 喂入的 fragments）         |

### 1.3 Canonical（覆盖不全）

| #   | 位置              | 说明                                                                      |
| --- | ----------------- | ------------------------------------------------------------------------- |
| 9   | `TopicProjection` | 仅由 Home ingestor 与 rename/status 兼容写入喂数据，chat fetch 结果未进入 |

### 1.4 现状症状

- 写路径分裂：rename 需手工同时 patch #1/#2（dispatch）+ #9（兼容 commit），#3/#4/#5/#6
  无人维护，搜索结果与 Recents 抽屉中的旧标题即来源于此。
- `#reconcileFetchedTopics` 与 `#pendingTopicStatusWrites` 存在的唯一原因是 #1/#2 与服务端
  响应之间缺少 observedAt 冲突规则，只能在应用层手工钉住乐观更新。
- `agentTopicsViewMap` 从 `topicDataMap` 分家的原因是两种查询形态共用 bucket 时
  "最后响应获胜"，属于列表身份缺少查询签名导致的结构性问题。

## 2. 目标与非目标

### 2.1 目标

- chat 三个数据面（sidebar 列表、管理页、搜索）的局部记录全部进入 canonical Projection Graph。
- 所有写入（fetch ingest 与 mutation）单写 graph commit，无双写；现有 rename/status 的
  两处双写被消除。
- `topic:` SWR key 退出 `CACHE_TIERS`；启动缓存改由 repository hydration 提供。
- 迁移期 `topicDataMap` / `agentTopicsViewMap` / `searchTopics` 降级为由 graph 单向再生成
  的只读投影，`topicSelectors` API 与状态形状不变。
- 最终形态：1 份内存 Projection + 1 份磁盘 Projection，列表与搜索只持 refs。
- 併入 Home 第一阶段遗留的投影清偿：
  - HomeStore agent-list projection 的剩余消费者（实测 25 个源文件、10 个 selector 成员，
    含 home 侧栏路由树）翻转到 projection view，删除 projection 字段与同步链路
    （Projection 规范 §15 的既定收尾）。
  - brief store 的 legacy `briefs` 数组消费者翻转，删除数组与 read/resolve 双写。
  - 全局 Recents 抽屉的 topic 行改为按 ID 订阅 canonical record，rename/status 变更即时
    同步。

### 2.2 非目标

- 不迁移全局 Recents 的 document/page 部分：`RecentItem` 列表本身与 `recent:*` 持久化
  保持现状，等 Document/Page Projection 建模（见 §10 后续路线图）。
- 不建模 `cost` / `tokenUsage`（服务端 mock，等 schema migration）与 `sessionId`（legacy）。
- 不改变服务端 topic 查询语义、分页协议或列排布。
- 不迁移 thread、message 等其他 Projection 域；完整清单见 §10。

## 3. 数据模型

### 3.1 Topic fragment 扩展

三个查询形态的字段覆盖：

- chat base（sidebar）：completedAt、createdAt、favorite、historySummary、id、metadata、
  model、provider、status、title、updatedAt、sortUpdatedAt、userId
- chat withDetails（管理页）：base + description、firstUserMessage、messageCount、trigger
- Home inbox（`topic.queryTopics`）：title、updatedAt、agentId、routePath、status、
  runStartedAt、lastAssistantMessage、trigger、userId

按 fragment 规则 1（至少一个来源能一次给全），现有 `preview` fragment 拆分为三个：

| Fragment      | 字段                 | 可整体覆盖的来源                     |
| ------------- | -------------------- | ------------------------------------ |
| `ownership`   | userId               | chat base / withDetails / Home inbox |
| `triggerInfo` | trigger              | withDetails / Home inbox             |
| `preview`     | lastAssistantMessage | 仅 Home inbox                        |

Home module 的 ingestor 与 `HomeInboxTopicView` contract 同步适配此拆分。

新增 fragments：

| Fragment     | 字段                                        | 来源           |
| ------------ | ------------------------------------------- | -------------- |
| `marking`    | favorite                                    | chat base      |
| `summary`    | historySummary                              | chat base      |
| `generation` | model、provider（topic 钉住的模型）         | chat base      |
| `analytics`  | metadata（usage roll-up，整列返回）         | chat base      |
| `completion` | completedAt                                 | chat base      |
| `ordering`   | sortUpdatedAt（服务端 topicActivityAt）     | chat base      |
| `details`    | description、firstUserMessage、messageCount | 仅 withDetails |

`routing { agentId }` 由 chat ingestor 从请求上下文合成：响应行不含 agentId，但 container
即查询参数，类型化 ingestor 显式写入。`navigation` / `runTiming` / `preview` 继续只由
Home 来源写入。

### 3.2 Index

沿用 "按 surface 命名" 模式，两个持久化 index 家族 + 一个 ephemeral 序列：

| Index                                 | 内容                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `chat.sidebarTopics:{containerKey}`   | 有序 refs、total、查询签名（isInbox/excludeStatuses/excludeTriggers/sortBy）、coverage（已覆盖条数、pageSize）、observedAt |
| `chat.agentViewTopics:{containerKey}` | 同上，签名固定含 withDetails                                                                                               |
| 搜索                                  | 不建持久化 index；命中实体入 graph，slice 保留 `searchTopicIds: string[]`                                                  |

- `containerKey` 沿用 `topicMapKey`（agent/group）。
- 查询签名不匹配即 coverage 无效，触发重取。两个 index 引用同一批 TopicProjection，字段
  只有一份；"最后响应获胜" 问题从结构上消除。

### 3.3 分页与 coverage

- `loadMore` 第 N 页：refs 去重追加 + coverage 扩展，与 record upsert 同一 commit 落库。
- 首页 revalidate 合并（替代 `isRefreshingExpandedList`）：新首页 refs + 保留尾部 refs
  去重，截断到 `min(当前可见数, total)`；由 ingestor 基于（新响应，现有 index）显式计算。
- 持久化截断：落盘时 refs 截到首屏 pageSize；hydration 后 coverage 按实际持久化条数
  计算，滚动自然触发续拉。

### 3.4 View Contract

| View Contract           | 必需 fragments                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ChatTopicListItemView` | `display`、`activity`、`ordering`、`marking`、`status`、`completion`、`generation`、`analytics`、`summary`、`ownership` |
| `ChatTopicDetailView`   | `ChatTopicListItemView` + `details`、`triggerInfo`                                                                      |

必需 fragment 缺失按 Projection 规范 §16 语义视为本地数据损坏：不伪造对象，触发重新验证。

## 4. 写路径

### 4.1 Fetch

三个 fetcher（sidebar / 管理页 / 搜索）统一为 marker 模式：

1. 请求发出前记录 `observedAt`。
2. 响应经 chat ingestor 拆 fragments + index。
3. 原子 commit（内存 graph + repository batch）。
4. SWR 只缓存轻量 request marker，不保留 DTO。

### 4.2 Mutation

全部 `internal_dispatchTopic` 调用点（约 13 处：create/rename/favorite/delete/batchMove
等）与 fetch onData 直接 set 点（约 8 处）在同一 PR 内转为 graph commit，遵循 Projection
规范 §14：

1. 乐观 commit（observedAt = 发起时刻）。
2. 服务端 mutation。
3. 成功提交 authoritative commit，失败以 inverse commit 回滚或触发 revalidation。

- 删除与批量删除提交 tombstone；慢返回的列表响应不得复活已删 topic。
- 乐观创建（createTopic）的 commit 必须一次写全 `ChatTopicListItemView` 的必需 fragments，
  否则 Projection 的 coverage 检查会把新行判为损坏并触发多余重取。
- `#reconcileFetchedTopics` 与 `#pendingTopicStatusWrites` 整体删除，由
  `mutation > realtime > network` + observedAt 冲突规则替代。
- 投影化不可渐进：残留任何直接写路径都会被下一次投影再生成覆盖，因此写路径转换必须在
  一个 PR 内原子完成。

### 4.3 流式标题

summarize 流式期间逐 token 更新写 slice 的 UI overlay，不进 graph；完成时一次 commit
最终 `display` fragment，符合 fragment 整体替换语义。

### 4.4 保留在 slice 的状态

`activeTopicId`、`creatingTopic`、`topicRenamingId`、`topicLoadingIds`、
`currentPage` / `isLoadingMore` / `loadMoreError` / `isExpandingPageSize` 等请求与交互状态
不是 Projection 数据，留在 chat slice，与 `items` / `total` 结构解耦。`hasMore` 改由 index 的
`total > coveredCount` 派生。

## 5. 投影桥（Phase 1 兼容层）

- projection store 的非 React subscription（复刻 agentList projection 模式）：commit 触及
  Topic record 或 `chat.*` index 时，只再生成受影响 container 的 `TopicData`，`isEqual`
  守卫防止无效更新。
- 组装走 §3.4 的 View Contract；投影为只读、单向，chat slice 不得反向写回 graph。
- scope 切换时投影在浏览器绘制前清空（同 agentList projection 行为）。
- 对全部现有消费者而言 `topicSelectors` API 与状态形状不变，Phase 1 行为兼容。

## 6. 持久化与启动

- repository 沿用 `entity-records` / `entity-indexes` collection，仅扩展 registry
  validator，无底层存储布局变更。
- `topic:` 前缀从 `CACHE_TIERS.idb` 移除；provider 既有的退役 key 清理机制清除历史落盘行。
- 启动顺序併入现有流程：scope ready → hydrate records + chat indexes → 投影再生成 →
  sidebar 首帧直接可画 → SWR 后台 revalidate。
- 空 index 表示已初始化且为空（真空态）；index 缺失表示从未取得 coverage（首载状态）。

## 7. 分期

| PR  | 内容                                                                                                                                   | 性质                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| A   | fragment 扩展 + `preview` 三拆（含 Home module 适配）、chat module（ingestor/validator/selector/viewHooks）、registry 接线、纯逻辑测试 | 纯增量，无行为变化        |
| B   | 写路径原子翻转：fetcher ingest + marker、全部写入点转 commit、投影桥、`CACHE_TIERS` 移除、删 reconcile/pin 逻辑、流式 overlay          | 核心 PR，行为对等         |
| C+  | 按 surface 翻消费者：sidebar → 管理页 → 搜索 → 长尾；最后删投影、旧 map、`topicReducer`                                                | 每步独立可回滚            |
| D   | Home 投影清偿：agent-list projection 消费者翻转 + projection 删除、brief legacy 数组与双写删除                                         | 不依赖 A/B/C，可并行      |
| E   | 全局 Recents 抽屉 topic 行按 ID 订阅 record（列表成员关系仍来自 `recent:list`）                                                        | 依赖 B（record 全量覆盖） |

Phase C 的消费者翻转遵循 Projection 规范 §4.2 订阅边界：列表容器订阅 index，行组件按
ID 订阅自身 record，不通过 props 下发聚合 read model。

### 7.2 PR A 终审移交给 PR B 的事项

- `ordering` fallback：`chatTopicRecord` 对缺失 `sortUpdatedAt` 回退 `updatedAt` 时间戳，
  分页查询恒有真值、仅搜索路径（`queryByKeyword` 全行 select 无计算列）会触发伪造，
  会以更新的 observedAt 覆盖真实活动时间导致列表跳动。接线搜索前二选一：给搜索查询
  补 `topicActivityAt` 列（首选，搜索记录可满足 `ChatTopicListItemView`），或 `ordering`
  改为条件写入。
- `ProjectionObservation` 与 `fragment` helper 从 `modules/home` 抽到 core/types（消除
  module→module 依赖）；`normalizeChatTopicsSignature` 需从 `src/projection/index.ts`
  导出供 fetcher 做签名比较。
- Golden parity 已知有意分歧：旧逻辑在 `currentPage > 0` 且旧列表缩水到不足一页时仍
  截断新首页；新 Rule 1 整页替换（更正确）。§8.1 golden 对照测试中按预期分歧记录。
- 旧持久化三字段 `preview` fragment 的一次性缓存降级（hydration 通过、selector 判不
  完整触发重取）写入 PR 描述，避免 reviewer 重新发现。

### 7.1 冗余收敛结果

| 阶段         | 结果                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase B 后   | #5/#6 消失；#1/#2/#3 降级为只读投影；canonical 全量覆盖（#8/#9）                                                                                    |
| Phase C 后   | #1/#2/#3 物理删除                                                                                                                                   |
| Phase D/E 后 | Home agent/brief 投影删除；#4 的 topic 行订阅 canonical record。剩 1 内存 + 1 磁盘；#4/#7 的 document/page 快照留待 Document/Page Projection（§10） |

## 8. 测试要求

### 8.1 纯逻辑

- 三种查询形态 → 预期 fragments；错误 DTO 在 ingestor 边界被拒。
- 查询签名不匹配使 coverage 失效；较小 coverage 不满足较大请求。
- 慢请求不覆盖更晚 mutation；tombstone 阻止旧响应复活实体。
- 首页 revalidate 合并逻辑与现有 `isRefreshingExpandedList` 场景 golden 对照。
- View Contract 缺 fragment 时不返回伪完整对象。

### 8.2 投影 parity

现有 `action.test.ts` 断言在 Phase B 后应原样通过（状态形状不变），作为回归网。新增
投影再生成的定向测试：单 commit 只再生成受影响 container。

### 8.3 集成

- warm reload 首帧从 hydration 投影直接渲染。
- 管理页 rename 后 sidebar 与搜索结果同一 commit 内同步。
- scope 切换不显示前一 scope 的 topic。
- 删除 topic 后慢速列表响应返回，不复活该行。

## 9. 验收标准

1. chat 三个数据面的局部记录均从 Projection Graph 读取（Phase B 经兼容投影，Phase C 直读）。
2. `topic:` SWR key 不进入持久化 tier，SWR cache 不保存 topic DTO。
3. 同一 scope 下每个 topic 只有一个 canonical record；sidebar 与管理页 index 引用同一批
   record。
4. rename /status/favorite/ 删除在任一入口发起后，所有消费视图在同一 commit 后一致。
5. `#reconcileFetchedTopics`、`#pendingTopicStatusWrites` 及 rename/status 双写被删除。
6. warm reload、空结果、刷新失败、scope 切换的行为测试通过。
7. Phase C 完成后 `topicDataMap` / `agentTopicsViewMap` / `searchTopics` / `topicReducer`
   被删除。
8. Phase D 完成后 HomeStore agent-list projection、brief store legacy `briefs` 数组及其
   双写被删除。
9. Phase E 完成后全局 Recents 抽屉的 topic 行标题 / 状态随 canonical commit 即时同步。

## 10. 后续路线图（本轮范围外）

### 10.1 实体域迁移（按 `CACHE_TIERS` 剩余条目，从重到轻）

| 数据域                                                                               | 现状                   | 备注                                                                  |
| ------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------- |
| Messages（`message:`）                                                               | SWR 按 key 落 IDB      | 体量与复杂度最大（流式、乐观更新、工具调用链），单独立项压轴          |
| Agent 完整配置（`agent:config` / `available` / `search`）                            | SWR + agent store      | AgentProjection 现仅 Home 的 5 个轻 fragments                         |
| Task 列表 / 详情（`task:`）                                                          | SWR + task store       | TaskProjection 已有 5 fragments，模式成熟，适合下一个迁               |
| ChatGroup（`group:detail` / `group:list`）                                           | SWR + agentGroup store | ChatGroupProjection 已有 identity/access                              |
| Document / Page / Notebook（`document:` / `page:` / `notebook:` / `agent:document`） | SWR + 各自 store       | 实体全新建模；完成后解锁全局 Recents 全量迁移与 `recent:*` 持久化退役 |
| Workspace member profile                                                             | 独立 hook              | 规划为 UserProjection + membership index（Projection 规范 §10.4）     |
| thread / topicComment                                                                | 各自 store             | chat 域剩余实体                                                       |
| `taskTemplate:` / `modelConfig:` / recommendations                                   | localStorage 壳子      | 建模为 snapshot 即可，低优先                                          |

明确不迁（by design）：auth/user session、用户设置、credentials（Projection 规范
§10.4 / §17）。

### 10.2 基础设施

- GC：tombstone 与无引用 Projection 按 scope 清理（Projection 规范 §17 首版故意不做）；记录量
  随迁移增长，宜在两三个 Projection 域迁移后排入。
- Workspace 切换两阶段协议：`prepare(target) → commit active workspace`（§13），消除目标
  scope 未就绪时的局部 loading 窗口。
- Realtime 事件直接进 ingestor：现多数实时更新靠 revalidate 兜底，逐步改为事件直接
  commit。
- Home 侧栏行级订阅化：PR D 后侧栏路由树仍是 buckets 聚合订阅，按 Projection 规范
  §4.2 改为列表订阅 index、行订阅 record。
- 服务端 revision/version 替代 `observedAt` 兼容策略（§7），需服务端配合。
- `cost` / `tokenUsage` schema migration 落地后，回补 topic `details` fragment。
