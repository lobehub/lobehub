# Project 主管 Agent 归属模型：现状梳理与方案设计

> Task T-14322 · 基线 `origin/canary` @ `fc62f7169d` · 分支 `docs/t-14322-project-coordinator-ownership`
>
> 本文所有 `文件:行号` 均以该基线为准。云端仓库 `lobehub-cloud` 中没有 `coordinatorAgentId` / `PROJECT_AGENT_LABEL` 的引用（`rg` 结果为空），本方案只涉及开源仓库。

## 0. 结论速览

- **双入口的根因**：从 2026-11-02（#22091 / `8374a8045a`）起，Project 创建时自动生成的主管 Agent 是一条**普通的、非 virtual 的** `agents` 行，只打了一个共享的 `Project` 标签（`packages/database/src/models/projectMainAgent.ts:16,59-105`）。因此它和用户自己的 Agent 一样，出现在侧边栏、`/agents` 列表、@ 提及和各类选择器里，并且只能在 `/agent/:aid/*` 下配置提示词、模型和 IM 渠道。Project 设置页（`/project/:projectId/settings/:section?`）只能**更换**主管，不能**配置**它。
- **历史上有三代主管 Agent**：
  1. 2026-08 ~ 2026-11-02 期间生成的 **virtual 主管**：`virtual = true`，已经在列表里隐藏。
  2. 2026-11-02 起生成的 **`Project` 标签普通 Agent**：在列表里可见，这就是双入口问题。
  3. **用户自选的已有 Agent，或回退到 LobeAI（inbox）**：`coordinator_agent_id` 为 NULL 时回退到 LobeAI。
- **方案**：
  - 在 `agents` 上新增可空列 `owner_project_id`（FK → `projects.id`，`ON DELETE SET NULL`）。
  - **只**给"项目自动生成，且只被这一个项目使用"的 Agent 标记归属。
  - 共享 Agent、LobeAI/inbox、用户自选的可复用 Agent **都保持关联、不标记、不自动复制**。复制为专属 Agent 只作为用户主动触发的操作。
  - 列表隐藏通过统一的 `owner_project_id IS NULL` 过滤实现，**不删除任何数据**。
  - 老数据由一次性、幂等、只打标记的 SQL 回填完成，并写审计/回滚日志表和配置快照。
  - Project 设置页新增"主管 Agent"分区，复用 Agent 设置组件。访问 `/agent/:aid/<设置子页>` 时，若该 Agent 属于某个 Project，则重定向到项目设置并给出提示。

---

## (a) `projects.coordinatorAgentId`：创建、读取、回退路径

### a.1 Schema 与演进

| 位置 | 内容 |
| --- | --- |
| `packages/database/src/schemas/project.ts:51-59` | `coordinatorAgentId: text('coordinator_agent_id').references(() => agents.id, { onDelete: 'set null' })`。注释原文："A reusable agent the user picked (LobeAI by default), so several projects may share one. Cleared when that agent is deleted; readers fall back to LobeAI." |
| `packages/database/src/schemas/project.ts:110` | `index('projects_coordinator_agent_id_idx').on(t.coordinatorAgentId)`，为普通索引，**不是唯一索引** |
| `packages/database/migrations/0139_projects_add_coordinator_agent.sql:1-4` | 最初版本（2026-08，#18054）：`NOT NULL` + `ON DELETE restrict` + **唯一索引**，即一个项目对应一个专属主管 |
| `packages/database/migrations/0182_project_coordinator_nullable.sql:1-5` | 2026-10-21（#20804）：去掉唯一索引、改为可空、`ON DELETE set null`，允许**多个项目共享一个主管** |
| `packages/database/src/schemas/project.ts:170-195` | `project_agents`（成员绑定）上有 `role`、`responsibility`，唯一键是 `(project_id, agent_id)`。主管也会作为成员被插入这里（见 a.2） |

### a.2 创建路径（何时自动生成 Agent）

调用链为 UI 或 CLI → tRPC `project.create` → `ProjectRepository.create`：

1. **客户端**：`src/features/Projects/createProjectForm.ts:139-152` 的 `buildCreateProjectRequest`。注释写明 "Leaving `coordinatorAgentId` out is what makes the server create an agent for the project… Every project the create dialogs make is led by such a dedicated agent."。它传入预留的 `dedicatedAgentId: ids.agentId`（`:149`）。预留 id 的格式是 `agt_<nanoid>`（`:129-132`）。
2. **tRPC**：`apps/server/src/routers/lambda/project.ts:179-229` `create`。
   - 输入中 `coordinatorAgentId` 可选（`:183`），`dedicatedAgentId` 也可选（`:189`）。
   - 如果传了 `coordinatorAgentId`，先做 `assertResourceUsable(ctx,'agent',…)`（`:208-210`）。
   - 然后调用 `ctx.projectRepo.create(input)`（`:216`），并用 `withMainAgent` 补上回退（`:214`）。
   - 最后调用 `createDefaultChannel({ agentId: project.coordinatorAgentId, projectId })`（`:218-224`）创建项目的 General 频道，并让主管加入。
3. **仓储**：`packages/database/src/repositories/project/index.ts:35-108`。
   - `:49-60`：**有 `coordinatorAgentId` 时**，`findAccessibleAgent` 绑定已有 Agent（用户自选，也可能是 LobeAI）；**没有时**调用 `createProjectMainAgent(...)` 自动生成。
   - `:63-69`：共享项目只能使用共享 Agent（`assertSharedResource`）。
   - `:71-76`：`projectModel.create({...coordinatorAgentId: mainAgent.id})`，再通过 `linkCoordinator` 写入 `project_agents`。
4. **自动生成**：`packages/database/src/models/projectMainAgent.ts:65-105` `createProjectMainAgent`。
   - `:76-85`：`AgentModel.create({...createProjectCoordinatorAgentConfig({avatar,name}), id, agencyConfig: { executionTarget: 'sandbox' }, visibility })`，生成的是**普通 Agent**（`virtual` 默认 false）。
   - `:89-96`：工作区内的共享 Agent 会写入默认访问级别。
   - `:98-102`：打上作用域内共享的 `Project` 标签（`PROJECT_AGENT_LABEL = 'Project'`，`:16`）。
   - 默认配置来自 `packages/builtin-agents/src/agents/project-coordinator/index.ts:19-31`：
     - `title`：`${name} Project Agent`
     - `description`：`Coordinates the ${name} project`
     - `systemRole`：三行固定文本，以 `'You are the coordinator agent of a project.'` 开头。项目上下文由 `<project_context>` 在每轮实时注入（`packages/prompts/src/prompts/project/index.ts:72-104`，其中 `:83` 判断 `isCoordinator`）。
5. **更换主管**：`apps/server/src/routers/lambda/project.ts:377-386` `replaceCoordinator` → `packages/database/src/repositories/projectCoordinator/index.ts:46-63`。
   - 其中调用 `ProjectModel.assignCoordinator`（`packages/database/src/models/project/index.ts:648-674`），并通过 `seatCoordinator` 把新主管设为成员（`packages/database/src/models/project/agents.ts:92-109`）。
   - 如果前任主管满足 `isDedicatedCoordinator`，则先把历史迁给新主管（`transferHistory`，`:69-139`），再**删除**前任。
6. **删除项目**：`packages/database/src/repositories/project/index.ts:115-130`。只删除满足 `isDedicatedCoordinator` 的前任主管。
7. **"专属主管"的现有判定**：`packages/database/src/models/project/index.ts:266-335` `isDedicatedCoordinator`。
   - `:287`：`if (!agent?.virtual || (agent.slug && BUILTIN_SLUGS.has(agent.slug))) return false;`，即**只认 virtual 的旧主管**。
   - 2026-11-02 之后生成的 `Project` 标签 Agent 判定为 false，所以它会**在项目删除或更换主管后继续存在**（这是 #22091 的有意设计："The agent outlives the project"）。

> **时间线**（`git log`）：
> - `f267232a19`（2026-08-09）：专属主管，virtual，一对一。
> - `a6936e30e3`（2026-10-21）：允许共享，可空，回退到 LobeAI。
> - `8374a8045a`（2026-11-02）：改为普通 Agent，加 `Project` 标签，创建对话框可选"新建专属 / 选已有"。
>
> 在 `8374a8045a^` 中，`packages/database/src/models/project.ts:156-169` 的写法是 `virtual: true`。

### a.3 读取路径

- 单个读取：`ProjectModel.findById` / `findByReference`（`packages/database/src/models/project/index.ts:357-400`）。
- 列表：`ProjectModel.list`（`:402-432`）用 `leftJoin(agents, eq(agents.id, projects.coordinatorAgentId))`（`:421`）带出主管的显示信息。注释说明 virtual 主管不在客户端 Agent 列表里，所以需要在这里一并返回（`:428-431`）。
- tRPC：`detail` 的定义在 `apps/server/src/routers/lambda/project.ts:243-279`，`find` 在 `:281-293`。`detail` 另外返回 `coordinatorRetiresOnReplace`（`:258-267`），用来决定更换主管时的确认文案。
- 服务端消费方：
  - 运行时工具发现：`apps/server/src/services/aiAgent/pipeline/toolDiscovery/projectScope.ts:42-45`
  - 任务指派：`apps/server/src/services/toolExecution/serverRuntimes/taskAssignees.ts:32-33`
  - 验收评审：`apps/server/src/services/acceptanceReview/submitReview.ts:55`、`apps/server/src/router-hono/acceptance-review/reviews.ts:298-301`
  - 验收修复：`apps/server/src/routers/lambda/_helpers/acceptanceFeedbackRepair.ts:267`
- 前端消费方：
  - 主管置顶：`src/features/AgentSidebar/Topic/useScopedTopics.ts:51-74`
  - 项目侧边栏：`src/features/Projects/Layout/Sidebar.tsx:118`
  - 项目仪表盘：`src/features/Projects/Workspace/ProjectDashboard.tsx:177-193`
  - 成员页：`src/features/Projects/Members/index.tsx:133-181`
  - 项目内对话选 Agent：`src/features/Projects/Workspace/ProjectComposer.tsx:145`
  - 列表头像：`src/features/Projects/List/index.tsx:159,172`

### a.4 回退（LobeAI 默认）路径

- `packages/database/src/models/project/index.ts:337-355` `resolveCoordinatorAgents`：如果 `coordinatorAgentId` 为 NULL，就用 `AgentModel.getBuiltinAgent(INBOX_SESSION_ID)` 的 id 补齐（`:347-353`）。
- 所有 tRPC 出口都经过 `withMainAgent`（`apps/server/src/routers/lambda/project.ts:63-70`），因此 API 契约始终返回非空 id。
- **只在读取时回退，从不写回**：数据库里仍然是 NULL。
- LobeAI 本身是 `virtual = true`、`slug = 'inbox'` 的内置 Agent（`packages/database/src/models/agent/create.ts:224`）。用户也可以在创建项目时**显式**选择 LobeAI，这时会写入 inbox 的 id。

---

## (b) Agent 配置现存位置与两个编辑入口

### b.1 配置存储（全部挂在 Agent 上，Project 自身不存提示词或模型）

| 配置 | 表 / 列 | 位置 |
| --- | --- | --- |
| 提示词 | `agents.system_role` | `packages/database/src/schemas/agent.ts:90` |
| 模型 / 供应商 / 参数 | `agents.model`、`agents.provider`、`agents.params` | `agent.ts:87-89` |
| 插件 / 工具 | `agents.plugins` | `agent.ts:74` |
| 运行环境 / 执行目标 | `agents.agency_config` | `agent.ts:83`（自动生成时为 `{executionTarget:'sandbox'}`） |
| 对话配置 / TTS | `agents.chat_config`、`agents.tts` | `agent.ts:84,91` |
| 开场白 | `agents.opening_message`、`agents.opening_questions` | `agent.ts:96-97` |
| 身份 | `agents.title`、`agents.avatar`、`agents.description` | `agent.ts:44-54` |
| Agent 知识库 / 文件 | `agents_knowledge_bases`、`agents_files` | `agent.ts:145-184` |
| **IM 渠道（Telegram/Discord/飞书/Slack…）** | `agent_bot_providers`：`agent_id` → `agents.id` `ON DELETE CASCADE`；`platform`、`application_id`、加密 `credentials`、`settings`、`enabled` | `packages/database/src/schemas/agentBotProvider.ts:24-59`。**唯一键 `(platform, application_id)`** 在 `:57`，所以同一个 bot 只能挂在一个 Agent 上 |
| 应用内 Channel（频道 / 私聊） | `channels.agent_id`（私聊绑定的 Agent，`ON DELETE CASCADE`）、`channels.project_id`（项目频道，`set null`）、`channel_members.agent_id` | `packages/database/src/schemas/channel.ts:63-137`（`:81` project_id、`:84` agent_id、`:121-123` 私聊唯一键）、`:143-203` |
| 标签 | `agent_label_assignments` + `agent_labels(name='Project')` | `packages/database/src/models/projectMainAgent.ts:23-57,98-102` |
| 项目内的成员职责 | `project_agents.role`、`project_agents.responsibility` | `packages/database/src/schemas/project.ts:183-186`。主管这一行的 `role` 在 prompt 中被替换为 `coordinator`，`responsibility` 仍然注入（`packages/prompts/src/prompts/project/index.ts:95-98`） |
| 项目自身 | `projects.name`、`description`、`avatar`、`identifier`、`slug`、`visibility` | `packages/database/src/schemas/project.ts:41-74`。`description` 会实时注入 `<project_context>`（`prompts/project/index.ts:89-91`） |

**重叠与冲突项**：

1. `projects.name/avatar` 与主管的 `agents.title/avatar`：只在**创建时**由项目名和头像派生（`createProjectCoordinatorAgentConfig`），之后两边独立，项目改名**不会**同步到 Agent 标题。
2. `projects.description` 与 `agents.description`：语义不同，前者是项目描述（注入上下文），后者是 Agent 简介（`Coordinates the X project`）。
3. `project_agents(主管行).responsibility` 与 `agents.system_role`：两者都会进入主管的提示词，前者是项目上下文，后者是系统角色。
4. 知识库有两层：项目知识库 `project_knowledge_bases`（项目设置的 knowledge 分区）和 Agent 知识库 `agents_knowledge_bases`（Agent 的 knowledge 页）。

### b.2 入口一：Project 设置页

- 路由：`/project/:projectId/settings/:section?`，另有工作区前缀版本 `/:workspaceSlug/project/...`。
  - 声明在 `src/spa/router/projectWorkspaceRoutes.tsx:88`（`path: 'settings/:section?'`），父路由 `project/:projectId` 在 `:135`。
  - 挂到桌面端 `src/spa/router/desktopRouter.shared.tsx:502`，移动端 `src/spa/router/mobileWorkspaceRoutes.tsx:83,106`。
  - 页面入口：`src/routes/(main)/project/[projectId]/settings/index.tsx` → `src/features/Projects/WorkingDirectories/Page.tsx`。
  - 路径工具函数：`src/features/Projects/Layout/navigation.ts:34` `getProjectSettingsPath`。
- 分区（`Page.tsx:41-93`）：

  | 分区 | 行号 | 内容 |
  | --- | --- | --- |
  | `general` | `:43` | `GeneralSettings`：名称、头像、slug、描述，标识只读 |
  | `members` | `:48` | 成员与主管更换 |
  | `knowledge` | `:58` | 项目知识库 |
  | `environments` | `:63` | 运行环境 |
  | `directories` | `:74` | 工作目录 |
  | `sites` | `:79` | 站点 |
  | `advanced` | `:87` | 删除项目 |

- 主管相关只有"更换"：`src/features/Projects/Members/index.tsx`。
  - `:98-121`：`replaceCoordinator` 确认框，文案取决于 `coordinatorRetiresOnReplace`。
  - `:135-145`：`<AssigneeAgentSelector allowUnassigned={false} currentAgentId={detail.project.coordinatorAgentId}>`。
  - **没有**提示词、模型、IM 等配置项，也**没有**跳到 Agent 设置的链接。`getProjectAgentPath` 在 `navigation.ts:1` 定义，但没有任何引用。
- 创建时的主管预览：`src/features/Projects/MainAgentSection.tsx:41`（只是展示，不是选择器）。

### b.3 入口二：Agent 设置页

- 路由：`/agent/:aid/<tab>`。
  - 声明在 `src/spa/router/agentPageRoutes.tsx`：`instruction` `:101`、`engine` `:117`、`environment` `:125`、`tools` `:130`、`skills` `:138`、`knowledge` `:109`、`profile` `:93`、`channel` `:152`、`channel/:platform` `:161`、`automations` `:169`、`webhook` `:177`、`permission` `:283`。
  - 挂载点：桌面端 `src/spa/router/desktopRouter.shared.tsx:127-140`，移动端 `src/spa/router/mobileAgentRoutes.tsx:39,91,110-112`（移动端还有 `/agent/:aid/settings`）。
  - 标签页定义：`src/features/AgentProfileTabs/tabOptions.ts:3,31,62-137`。
- 组件：

  | 配置 | 组件 |
  | --- | --- |
  | 提示词 | `src/routes/(main)/agent/profile/features/InstructionEditor/index.tsx` |
  | 模型 | `.../EngineEditor/index.tsx`（`:37` 读取 `activeAgentId`，`:122` 调用 `updateAgentConfigById`） |
  | 运行环境 | `.../EnvironmentEditor/index.tsx` |
  | 工具 | `.../ToolsEditor` |
  | 技能 | `.../SkillsEditor` |
  | 知识库 | `.../KnowledgeEditor` |
  | 身份 | `.../ProfileEditor` |
  | 开场白 | `src/features/AgentSetting/AgentOpening/` |
  | IM 渠道 | `src/routes/(main)/agent/channel/index.tsx`（`PlatformGrid` 接收 `agentId` 参数，`src/features/AgentChannel/PlatformGrid.tsx:68-77`） |
  | 自动化 | `src/features/AgentAutomations/index.tsx` |

- 写接口：
  - Agent 配置：`apps/server/src/routers/lambda/agent/config.ts:136` `updateAgentConfig`（服务调用在 `:208`）。
  - Bot：`apps/server/src/routers/lambda/agentBotProvider.ts`，包括 `create` `:200`、`update` `:641`、`delete` `:272`、`getByAgentId` `:321`、`connectBot` `:425`。
  - 项目：`apps/server/src/routers/lambda/project.ts` 的 `update` `:459`、`updateAgent` `:500`。
- 当前设置页取的是"当前激活的 Agent"：`/agent/:aid` 布局中的 `src/routes/(main)/agent/_layout/AgentIdSync.tsx` 把 `aid` 同步到 `useAgentStore.activeAgentId`，EngineEditor 等组件读取它。**要嵌入 Project 设置页，需要改为按参数传入 `agentId`**（见 g 清单）。

---

## (c) 独立 Agent 列表的数据来源

几乎所有 Agent 列表都来自同一个服务端查询 `home.getSidebarAgentList`，该查询已经排除了 virtual Agent。只有 Cmd+K 全局搜索不过滤 virtual。

| 场景 | 服务端查询（过滤位置） | 是否隐藏 virtual | 客户端消费方 |
| --- | --- | --- | --- |
| 侧边栏 | `apps/server/src/routers/lambda/home.ts:51-80` → `packages/database/src/repositories/home/index.ts:90` `getSidebarAgentList`，WHERE 在 `:117-126`，其中 `:125` 为 `not(eq(agents.virtual, true))` | 是 | `src/services/home/index.ts:17-19` → `src/store/home/slices/agentList/action.ts:116-126`；selectors 在 `selectors.ts:9-131`（`allAgents` `:85-96`、`sharedAgents` `:102-106`）；UI 在 `src/features/HomeSidebar/Body/Agent/List/useAgentList.tsx:54-59` |
| `/agents` 列表页（可按标签分组，`Project` 标签在这里成组） | 同一 home store | 是 | `src/features/AgentViewAll/AgentViewAllPage.tsx:220-250`，按标签分组在 `:417-430` |
| 标签管理里的使用计数 | `packages/database/src/models/agentLabel.ts:49,71-78` | 是 | `src/services/agentLabel/index.ts:7` |
| 侧边栏、抽屉、移动端搜索 | `home.ts:82-86` → `repositories/home/index.ts:544` `searchAgents`，`:552` 传 `filters:{excludeVirtual:true}`，`:588` 为 `not(eq(agents.virtual,true))`。实现：`ftsSearch/pgLike/candidates.ts:298`、`ftsSearch/elasticsearch/candidates.ts:291-292` | 是 | `src/store/home/slices/agentList/action.ts:195-200` |
| **Cmd+K 全局搜索** | `apps/server/src/routers/lambda/search.ts:88` → `packages/database/src/repositories/ftsSearch/index.ts:150-151`（`createRequest('agents', …)`，**不带 filters**）→ `ftsSearch/postgres/command-menu.ts:101`（只按 scope 过滤）、`ftsSearch/elasticsearch/hydration.ts:162-170` | **否**（现存缺口） | `src/features/CommandMenu/useCommandMenu.ts:74-89` |
| @ 提及（对话输入框） | home store | 是 | `src/features/ChatInput/InputEditor/useMentionCategories.tsx:62-67,156-187` |
| 向项目或群组添加成员 | home store | 是 | `src/features/AddAgentMemberModal/useAddableGroupMembers.ts:23-29`、`selectAddableAgents.ts:16-44` |
| 项目更换主管 | home store | 是 | `src/features/Projects/Members/index.tsx:136` `AssigneeAgentSelector` |
| 频道新建与邀请 | home store，并排除 inbox | 是 | `src/features/Channels/CreateChannel/useChannelAgentOptions.ts:50-60` |
| 创建群聊 | home store | 是 | `src/components/MemberSelectionModal/MemberSelectionModal.tsx:233-237` |
| `queryAgents` / `availableAgents` / CLI `lh agent list` | `packages/database/src/models/agent/list.ts:159-175` `buildQueryAgentsWhere`（`:170-171`）；同文件 `:46,95,134,366` 使用 `or(slug=inbox, virtual≠true)` | 是 | `apps/server/src/routers/lambda/agent/lifecycle.ts:191-204`、`src/store/agent/slices/agent/action.ts:228-236`、`apps/cli/src/commands/agent.ts:94` |
| 最近使用 | `packages/database/src/models/recent.ts:180` | 是 | — |

**结论**：只要在上表的**服务端过滤点**加上 `owner_project_id IS NULL`，所有前端列表就会一起隐藏归属 Agent，前端 selector 不需要改。Cmd+K 需要另外补上过滤。

---

## (d) 归属方案

### d.1 Schema 变更（新增，不删除任何数据）

```ts
// packages/database/src/schemas/agent.ts（agents 表）
/**
 * The project this agent was provisioned for and is configured through. Set only
 * for a project's own coordinator; such an agent is hidden from standalone agent
 * lists and edited in the project's settings. Cleared (agent becomes an ordinary,
 * visible agent) when the project is deleted or hands the agent back.
 */
ownerProjectId: text('owner_project_id'),
// 索引：index('agents_owner_project_id_idx').on(t.ownerProjectId).where(isNotNull(t.ownerProjectId))
```

```sql
-- packages/database/migrations/0220_agents_owner_project.sql
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "owner_project_id" text;--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_owner_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_project_id_projects_id_fk"
  FOREIGN KEY ("owner_project_id") REFERENCES "public"."projects"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_project_id_idx" ON "agents" ("owner_project_id") WHERE "owner_project_id" IS NOT NULL;
```

> `schemas/project.ts` 已经 import 了 `agents`，而 `agents` 反向引用 `projects` 会形成循环 import。实现时用 drizzle 的 `AnyPgColumn` 写法（`.references((): AnyPgColumn => projects.id)`），或者只在 SQL 里建外键、schema 中只声明列。外键用 `ON DELETE SET NULL`：项目被删除后，Agent 恢复为普通可见 Agent，历史保留，不级联删除。

不变式：

1. `owner_project_id = P` 时，必须有 `projects[P].coordinator_agent_id = agent.id`。由写路径保证，迁移校验。
2. 一个 Agent 最多归属一个项目（列本身就是单值）。
3. 内置 Agent（slug 属于 `BUILTIN_AGENT_SLUGS`，含 `inbox`）**永远不能**被标记。

为什么不复用 `virtual`：`virtual` 已经被内置 inbox、群组成员、市场副本共用（`models/agent/create.ts:224,259`、`models/agent/find.ts:273-289`），而且 `isDedicatedCoordinator` 用它来判定"删除 / 迁移历史"（`models/project/index.ts:287`）。把归属也压进 `virtual` 会：

- 让"隐藏"和"删除"语义耦合；
- 让 `/agents` 标签计数、`assertAgentInScope` 等逻辑出现误伤；
- 无法回答"它属于哪个项目"，也就无法从 `/agent/:aid` 重定向。

### d.2 隐藏策略（不删除）

- 新增 `packages/database/src/utils/agentListable.ts`：`export const isStandaloneAgent = () => isNull(agents.ownerProjectId)`。
- 把它加到 (c) 表中的每个服务端过滤点：
  - `repositories/home/index.ts:125,588`
  - `ftsSearch` 的 `excludeVirtual` 旁边新增 `excludeProjectOwned`，覆盖 `pgLike/candidates.ts:298`、`elasticsearch/candidates.ts:291`；ES 文档需要增加 `ownerProjectId` 字段
  - `ftsSearch/postgres/command-menu.ts:101` 与 `elasticsearch/hydration.ts:162-170`（Cmd+K）
  - `models/agent/list.ts:170-171`
  - `models/agentLabel.ts:75`
  - `models/recent.ts:180`
- 读取单个 Agent（`getAgentConfigById`、对话运行时、项目成员列表 `ProjectModel.listAgents`）**不过滤**，保证项目内对话、IM 回调、任务指派照常工作。
- 新建项目时直接写入归属：`createProjectMainAgent` 在 `AgentModel.create` 的入参里加 `ownerProjectId: projectId`。项目 id 由表单预留（`createProjectForm.ts:129-132`）；CLI 没有预留时，先插入 project，再 `UPDATE agents`，二者在同一事务里（`repositories/project/index.ts:38`）。
- `createProjectMainAgent` 不再打 `Project` 标签：归属已经通过列表达，老标签保留不删。
- 项目删除：外键置空，Agent 回到列表，保留全部历史。`isDedicatedCoordinator` 的 virtual 分支保留，旧 virtual 主管的行为不变。
- 更换主管：如果前任 `owner_project_id = 本项目`，**只清空归属**（Agent 回到列表，成为普通成员或可复用 Agent），不删除也不迁移历史。和现有的"`Project` 标签 Agent 在更换后保留"行为一致。新选的主管按 d.3 的规则处理。

### d.3 三类边界情况的处理规则

判定"项目自动生成"的依据（满足任一即可，见 e.2 的 SQL）：

- G1：该 Agent 有名为 `Project` 的标签分配（`agent_label_assignments` ⋈ `agent_labels.name='Project'`）。这是 2026-11-02 之后由 `createProjectMainAgent` 生成的。
- G2：`virtual = true`、slug 不属于内置、不在任何 `chat_groups_agents` 中（2026-11-02 之前生成的旧专属主管，与 `isDedicatedCoordinator` 的判定一致）。

| 情况 | 判定 | 规则（明确结论） | 理由与取舍 |
| --- | --- | --- | --- |
| **自动生成且唯一归属**（主流程） | G1 或 G2；只被一个项目用作主管（`count(projects where coordinator_agent_id=a) = 1`）；且不是**其他**项目的 `project_agents` 成员 | **标记归属**：`owner_project_id = P`，在列表中隐藏，只在项目设置中配置 | 这正是双入口的来源。只打标记，不改任何配置字段，也不迁移历史，可以无损回滚 |
| **(i) 共享 Agent**（多个项目指向同一 Agent） | 被 ≥2 个项目用作主管，或是其他项目的成员。包括"新项目选了旧项目自动生成的 Agent" | **保持关联，不标记，不自动复制**。迁移日志记为 `shared`。每个项目的设置页都展示该 Agent 的完整配置分区，但顶部显示提示条"此主管同时用于 N 个项目，修改会影响全部项目"，附项目清单；另提供用户主动触发的操作「**转为本项目专属**」（复制，见 d.4） | **不自动复制**的原因：① `agent_bot_providers` 有唯一键 `(platform, application_id)`（`agentBotProvider.ts:57`），IM 连接无法复制，复制后只有一个副本能收到 IM 消息；② 话题、任务、作品、记忆按 `agent_id` 归属，复制后历史一分为二；③ 用户可能有意共享同一个"人设"。**不标记给其中某个项目**：否则其他项目会依赖一个"别人的、隐藏的" Agent，删掉那个项目又会让它突然出现。代价是共享主管仍然出现在独立列表里，这对可复用资源来说是合理的 |
| **(ii) LobeAI 默认 / inbox** | `coordinator_agent_id IS NULL`（读取时回退），或 `= inbox.id`（显式选择），或 slug 属于 `BUILTIN_AGENT_SLUGS` | **永不标记，永不自动复制**。迁移日志记为 `builtin`。项目设置的"主管 Agent"分区展示为"当前由 LobeAI（默认）主持"，配置只读，不提供编辑入口（LobeAI 是全局个人助理，改它会影响所有对话），并提供「**为本项目创建专属主管**」：调用 `createProjectMainAgent` 生成一个带 `owner_project_id` 的新 Agent，再走 `replaceCoordinator`。新 Agent 的提示词是默认模板，不复制 inbox 的提示词 | inbox 每个用户各有一个，被所有普通对话共用，跨所有项目，`virtual=true` 且已经隐藏。给它打 `owner_project_id` 会：① 使多个项目争夺同一个单值列；② 项目删除时可能把 LobeAI 弄得行为异常；③ 让 `/agent/inbox` 被重定向到某个项目。回退逻辑 `resolveCoordinatorAgents`（`models/project/index.ts:341-355`）保持不变 |
| **(iii) 用户手动挑选的已有可复用 Agent**（非自动生成：没有 `Project` 标签，`virtual=false`，非内置） | 不满足 G1/G2，不论被几个项目使用 | **保持关联，不标记，不复制**。迁移日志记为 `user_picked`。项目设置的"主管 Agent"分区展示并允许编辑配置，与 Agent 设置页写同一行数据。顶部提示"这是你的独立 Agent『X』，修改会同步到它的所有使用处"，并给出「在 Agent 设置中打开」链接；同时提供「转为本项目专属」（复制） | 这是用户自己的 Agent，可能有私聊、IM bot、定时任务、其他群组成员身份。悄悄隐藏它会让用户以为数据丢了，违背"不能丢失"的目标 |

### d.4 「转为本项目专属」（复制，用户主动触发；不在迁移中自动执行）

- 新增 `ProjectCoordinatorRepository.adoptCopy(projectId)`，在一个事务里完成：
  - 复制源 Agent 的 `system_role / model / provider / params / plugins / chat_config / agency_config / tts / opening_* / title / avatar / description` 以及 `agents_knowledge_bases` / `agents_files` 绑定，新行写入 `owner_project_id = P`；
  - `assignCoordinator(P, newId)`；
  - 源 Agent 降为普通成员（`seatCoordinator` 已经支持）。
- **不复制** IM 连接（唯一键限制）和历史话题。UI 明确提示："IM 渠道仍连接在原 Agent 上，需要在新主管中重新连接。"
- 共享情况下由用户在某个项目里执行，其余项目不受影响。

---

## (e) 老 Project 一次性归并迁移

### e.1 原则

1. **只打标记，不搬运配置**。主管配置本来就只存在 `agents` 这一行（见 b.1），迁移只写 `agents.owner_project_id`，**不改写** `system_role`、`model` 或 IM 绑定等任何字段，因此提示词等配置不会丢失。
2. **冲突准则**：
   - Agent 配置（提示词、模型、IM、工具、知识库、执行环境）**以 `agents` 行为唯一权威**。Project 设置页编辑的就是这一行，迁移后项目设置页展示的就是权威来源，不存在两份副本。
   - 项目侧字段（`projects.name/description/avatar`）与 Agent 侧的 `title/description/avatar` 语义不同，**不合并、不互相覆盖**。即使迁移时发现 `agents.title ≠ "${project.name} Project Agent"`（项目改过名），也保留 Agent 的 title。
   - `project_agents`（主管行）的 `role/responsibility` **保留原位**，继续注入 `<project_context>`；在项目设置的"提示词"分区里以"项目内职责（附加到上下文）"的形式和 `system_role` 一起展示，不合并进 `system_role`，以免重复注入。
3. **决策日志与配置快照**：每个项目一行，记录它被如何处理，以及迁移时主管配置的 JSON 快照，用于审计和极端情况下的手工恢复。
4. 新建项目从部署起就由代码直接写 `owner_project_id`，迁移只处理存量。

### e.2 迁移 SQL 草案（`packages/database/migrations/0221_backfill_project_coordinator_owner.sql`）

```sql
CREATE TABLE IF NOT EXISTS "project_coordinator_ownership_log" (
  "project_id" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
  "agent_id" text,                  -- 迁移时的 coordinator_agent_id（NULL = 回退 LobeAI）
  "decision" text NOT NULL,         -- owned | shared | builtin | user_picked | fallback_null
  "config_snapshot" jsonb,          -- 迁移时 agents 行的配置快照 + bot provider 概要（不含 credentials）
  "migrated_at" timestamptz NOT NULL DEFAULT now(),
  "reverted_at" timestamptz
);--> statement-breakpoint

WITH coord AS (
  SELECT p.id AS project_id, p.coordinator_agent_id AS agent_id
  FROM projects p
  WHERE NOT EXISTS (SELECT 1 FROM project_coordinator_ownership_log l WHERE l.project_id = p.id) -- 幂等
),
use_count AS (
  SELECT coordinator_agent_id AS agent_id, count(*) AS n
  FROM projects WHERE coordinator_agent_id IS NOT NULL GROUP BY 1
),
classified AS (
  SELECT c.project_id, c.agent_id,
    CASE
      WHEN c.agent_id IS NULL THEN 'fallback_null'
      WHEN a.slug IN (/* BUILTIN_AGENT_SLUGS 在编写时展开，含 'inbox' */) THEN 'builtin'
      WHEN NOT (
        EXISTS (SELECT 1 FROM agent_label_assignments ala JOIN agent_labels al ON al.id = ala.label_id
                WHERE ala.agent_id = a.id AND al.name = 'Project')                       -- G1
        OR (a.virtual = true AND NOT EXISTS (SELECT 1 FROM chat_groups_agents g WHERE g.agent_id = a.id)) -- G2
      ) THEN 'user_picked'
      WHEN u.n > 1
        OR EXISTS (SELECT 1 FROM project_agents pa WHERE pa.agent_id = a.id AND pa.project_id <> c.project_id)
        OR (a.owner_project_id IS NOT NULL AND a.owner_project_id <> c.project_id) THEN 'shared'
      ELSE 'owned'
    END AS decision,
    jsonb_build_object(
      'systemRole', a.system_role, 'model', a.model, 'provider', a.provider, 'params', a.params,
      'plugins', a.plugins, 'chatConfig', a.chat_config, 'agencyConfig', a.agency_config,
      'openingMessage', a.opening_message, 'openingQuestions', a.opening_questions,
      'title', a.title, 'avatar', a.avatar, 'description', a.description, 'virtual', a.virtual,
      'botProviders', (SELECT coalesce(jsonb_agg(jsonb_build_object('platform', b.platform,
                         'applicationId', b.application_id, 'enabled', b.enabled)), '[]'::jsonb)
                       FROM agent_bot_providers b WHERE b.agent_id = a.id)
    ) AS snapshot
  FROM coord c
  LEFT JOIN agents a ON a.id = c.agent_id
  LEFT JOIN use_count u ON u.agent_id = c.agent_id
)
INSERT INTO project_coordinator_ownership_log (project_id, agent_id, decision, config_snapshot)
SELECT project_id, agent_id, decision, CASE WHEN agent_id IS NULL THEN NULL ELSE snapshot END FROM classified
ON CONFLICT ("project_id") DO NOTHING;--> statement-breakpoint

UPDATE agents a
SET owner_project_id = l.project_id
FROM project_coordinator_ownership_log l
WHERE l.decision = 'owned' AND l.reverted_at IS NULL
  AND a.id = l.agent_id
  AND a.owner_project_id IS NULL;                -- 幂等：已标记的不再动
```

> 如果 drizzle 的 migrator 不适合承载这段 CTE（例如需要 `BUILTIN_AGENT_SLUGS` 的 TS 常量），可以改为 `packages/database/src/migrations/backfillProjectCoordinatorOwner.ts`：用同样的逻辑分批（每批 500 个项目）在事务里执行，由 `scripts/migrate-project-coordinator-owner.ts` 或部署钩子调用。语义不变。

### e.3 不丢失

- 迁移只写一列，配置字段零写入，`agent_bot_providers`、话题、消息、任务全部原样保留。
- `config_snapshot` 额外留存迁移时刻的配置（不含 `credentials`），可用于事后核对："迁移前后 `system_role` 一致"可以直接用 SQL 对比 `l.config_snapshot->>'systemRole' = a.system_role`，作为发布后的验收查询。
- 隐藏只发生在列表查询层，按 id 读取不受影响。项目内对话、IM 回调、`/agent/:aid` 直链（见 f.2）都能正常访问。

### e.4 幂等

- 日志表以 `project_id` 为主键，并且 CTE 跳过已在日志中的项目，所以重复执行不会重复分类。
- `UPDATE ... AND a.owner_project_id IS NULL`：重复执行不会覆盖已有标记。
- 迁移前后新建的项目由代码直接写归属，日志里没有它们的行也不影响正确性。之后若重复执行，它们会被分类为 `owned`，`UPDATE` 是无操作（值已相同）。

### e.5 可回滚

- **数据回滚**（保留列）：

  ```sql
  UPDATE agents a SET owner_project_id = NULL
  FROM project_coordinator_ownership_log l
  WHERE l.decision = 'owned' AND l.reverted_at IS NULL
    AND a.id = l.agent_id AND a.owner_project_id = l.project_id;
  UPDATE project_coordinator_ownership_log SET reverted_at = now() WHERE decision = 'owned' AND reverted_at IS NULL;
  ```

  执行后 Agent 立即重新出现在列表中，回到迁移前的状态；没有任何配置需要恢复。
- **代码回滚**：列可空，老代码完全忽略它，回退应用版本就等于取消隐藏，无需 DDL。
- **结构回滚**（彻底撤销）：`ALTER TABLE agents DROP COLUMN owner_project_id; DROP TABLE project_coordinator_ownership_log;`。
- 用户在迁移后主动执行的「转为本项目专属」会产生新 Agent，不属于迁移回滚范围。源 Agent 保留不动，所以同样无损。

---

## (f) UI 入口变更

### f.1 Project 设置页内置"主管 Agent"分区

- 路由：在 `Page.tsx` 的 tabs 中新增 `agent` 分区，位于 `general` 和 `members` 之间，二级路由为 `/project/:projectId/settings/agent/:agentSection?`。在 `projectWorkspaceRoutes.tsx:88` 附近新增 `settings/agent/:agentSection?`；移动端在 `mobileWorkspaceRoutes.tsx:106` 附近同步。
- 子分区与复用组件（全部改为接收 `agentId` 参数，不再依赖 `activeAgentId`）：

| 子分区 | 覆盖 (b) 中的配置 | 复用组件 |
| --- | --- | --- |
| 身份 `profile` | `title/avatar/description` | `routes/(main)/agent/profile/features/ProfileEditor` |
| 提示词 `instruction` | `system_role`，并只读展示主管行的 `project_agents.responsibility`（可跳转成员分区编辑） | `InstructionEditor` |
| 模型 `engine` | `model/provider/params` | `EngineEditor` |
| 工具与技能 `tools` | `plugins` 和技能 | `ToolsEditor` + `SkillsEditor` |
| Agent 知识 `knowledge` | `agents_knowledge_bases/agents_files`；与项目知识库分区并列，文案区分为"主管私有知识" | `KnowledgeEditor` |
| 运行环境 `environment` | `agency_config` | `EnvironmentEditor` |
| IM 渠道 `channel` | `agent_bot_providers` | `features/AgentChannel/PlatformGrid` + `PlatformDetail`（`PlatformGrid` 已接收 `agentId`） |
| 自动化 `automations` | 定时任务 | `features/AgentAutomations` |
| 开场白 `opening` | `opening_message/questions` | `features/AgentSetting/AgentOpening` |

- 分区顶部的"主管来源"条，按 d.3 规则展示：
  - **专属**（`owner_project_id = 本项目`）：没有提示条，可完整编辑。
  - **共享**：显示 "此主管同时用于 N 个项目：A、B…，修改会影响全部项目"，并提供【转为本项目专属】。
  - **用户自选**：显示 "这是你的独立 Agent『X』，修改会同步到它的所有使用处"，并提供【在 Agent 设置中打开】和【转为本项目专属】。
  - **LobeAI**：显示 "当前由 LobeAI（默认）主持本项目"，所有子分区只读，并提供【为本项目创建专属主管】。
  - "更换主管"选择器从成员分区（`Members/index.tsx:135-145`）移到本分区顶部；成员分区里保留一个指向本分区的入口。

### f.2 原 Agent 设置页访问归属 Agent 时的行为

- 在 `/agent/:aid` 布局（`src/routes/(main)/agent/_layout/index.tsx`，与 `AgentIdSync.tsx` 同级）加一个守卫 `ProjectOwnedAgentRedirect`。Agent 配置需要随 `getAgentConfigById` 返回 `ownerProjectId`。守卫行为：
  - **设置类子路由**（`profile`、`instruction`、`knowledge`、`engine`、`environment`、`tools`、`skills`、`channel`、`channel/:platform`、`automations`、`webhook`、`permission`、`share`，以及移动端 `settings`）：`navigate(\`/project/${slugOrId}/settings/agent/${映射后的子分区}\`, { replace: true })`。同时弹一次 toast："该 Agent 是项目「{project}」的主管，已为你打开项目设置。"（i18n key 为 `project:coordinator.redirectedFromAgentSettings`）。
  - **对话类路由**（`/agent/:aid`、`/agent/:aid/topics`、`task/*`）：**不重定向**，避免打断 IM、通知和历史链接。在页头显示一条信息条："这是项目「{project}」的主管 Agent，配置请前往项目设置"，并附【前往项目设置】按钮。
- 头像弹窗和频道成员面板中的"打开 Agent 资料"（`src/features/AgentProfileCard/AgentProfilePopup.tsx:142`、`src/features/Channels/AgentProfilePanel.tsx:95`）：如果是归属 Agent，直接链接到项目设置，避免先跳 `/agent` 再重定向。
- 项目删除后，外键把归属置空，守卫自然失效，Agent 恢复普通访问。

---

## (g) 后续实现需改动的文件清单

**数据库**

- `packages/database/src/schemas/agent.ts`：新增 `ownerProjectId` 列与部分索引。
- `packages/database/migrations/0220_agents_owner_project.sql`：新增，DDL。
- `packages/database/migrations/0221_backfill_project_coordinator_owner.sql`：新增，日志表与回填。
- `packages/database/migrations/meta/_journal.json`、`packages/database/migrations/meta/0220_snapshot.json`、`packages/database/migrations/meta/0221_snapshot.json`：drizzle 生成。
- `docs/development/database-schema.dbml`：同步。
- `packages/database/src/utils/agentListable.ts`：新增 `isStandaloneAgent()`。
- `packages/database/src/models/projectMainAgent.ts`：写 `ownerProjectId`，不再打 `Project` 标签。
- `packages/database/src/repositories/project/index.ts`：`create` 传入项目 id 并写归属；`delete` 不变，依赖外键置空。
- `packages/database/src/repositories/projectCoordinator/index.ts`：更换主管时清空前任归属；新增 `adoptCopy`。
- `packages/database/src/models/project/index.ts`：`assignCoordinator` 和 `isDedicatedCoordinator` 补充归属分支。
- `packages/database/src/models/agent/create.ts`：允许传入 `ownerProjectId`。
- `packages/database/src/models/agent/update.ts`：把 `ownerProjectId` 加进受保护字段，不允许经 `updateAgentConfig` 改写。

**列表过滤**

- `packages/database/src/repositories/home/index.ts`（`:125`、`:588`）
- `packages/database/src/repositories/ftsSearch/types.ts`（`:236`，新增 `excludeProjectOwned`）
- `packages/database/src/repositories/ftsSearch/pgLike/candidates.ts`（`:298`）
- `packages/database/src/repositories/ftsSearch/elasticsearch/candidates.ts`（`:291`）及 ES 索引映射
- `packages/database/src/repositories/ftsSearch/index.ts`（`:151`）
- `packages/database/src/repositories/ftsSearch/postgres/command-menu.ts`（`:101`）
- `packages/database/src/repositories/ftsSearch/elasticsearch/hydration.ts`（`:162-170`）
- `packages/database/src/models/agent/list.ts`（`:170-171`）
- `packages/database/src/models/agentLabel.ts`（`:75`）
- `packages/database/src/models/recent.ts`（`:180`）

**服务端**

- `apps/server/src/routers/lambda/project.ts`：`detail` 返回主管来源（`owned/shared/user_picked/builtin`）和共享项目列表；新增 `adoptCoordinatorCopy`、`createDedicatedCoordinator`。
- `apps/server/src/routers/lambda/agent/config.ts`：返回 `ownerProjectId`。

**前端**

- 路由：
  - `src/spa/router/projectWorkspaceRoutes.tsx`：新增 `settings/agent/:agentSection?`
  - `src/spa/router/mobileWorkspaceRoutes.tsx`：同步
- 项目设置：
  - `src/features/Projects/WorkingDirectories/Page.tsx`：新增 `agent` 分区
  - `src/features/Projects/CoordinatorSettings/index.tsx`：新增，子分区容器、来源提示条、更换选择器
  - `src/features/Projects/Members/index.tsx`：更换主管入口移到新分区
  - `src/features/Projects/Layout/navigation.ts`：新增 `getProjectCoordinatorSettingsPath`
- Agent 设置组件改为接收 `agentId` 参数：
  - `src/routes/(main)/agent/profile/features/InstructionEditor/index.tsx`
  - `src/routes/(main)/agent/profile/features/EngineEditor/index.tsx`
  - `src/routes/(main)/agent/profile/features/EnvironmentEditor/index.tsx`
  - `src/routes/(main)/agent/profile/features/ToolsEditor/index.tsx`
  - `src/routes/(main)/agent/profile/features/SkillsEditor/index.tsx`
  - `src/routes/(main)/agent/profile/features/KnowledgeEditor/index.tsx`
  - `src/routes/(main)/agent/profile/features/ProfileEditor/index.tsx`
  - `src/features/AgentAutomations/index.tsx`
- 重定向与提示：
  - `src/routes/(main)/agent/_layout/index.tsx`：挂载守卫
  - `src/routes/(main)/agent/_layout/ProjectOwnedAgentRedirect.tsx`：新增
  - `src/features/AgentProfileCard/AgentProfilePopup.tsx`
  - `src/features/Channels/AgentProfilePanel.tsx`
- 国际化：
  - `packages/locales/src/default/project.ts`
  - `locales/zh-CN/project.json`
  - `locales/en-US/project.json`

**测试**

- `packages/database/src/models/__tests__/project.mainAgent.test.ts`
- `packages/database/src/repositories/projectCoordinator/__tests__/index.test.ts`
- `packages/database/src/repositories/home/__tests__/`：新增隐藏用例
- 迁移幂等与回滚用例：在 `packages/database/src/repositories/project/__tests__/` 下新增

## 附：实现顺序建议

1. Schema 与写路径：新建项目直接写归属。
2. 列表过滤，包括 Cmd+K。
3. 存量回填迁移与日志。
4. Project 设置"主管 Agent"分区与组件参数化。
5. `/agent` 守卫与提示。
6. 「转为专属」与「为本项目创建专属主管」。

第 1 至第 3 步可以单独上线：隐藏生效，配置暂时仍可经 `/agent` 修改。第 4、第 5 步上线后，单入口才完整闭环。
