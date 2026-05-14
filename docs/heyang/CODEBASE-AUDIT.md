# LobeHub 代码库摸底报告

任务编号：T00
日期：2026-05-14
范围：当前 fork 的 LobeHub 主分支，只读摸底；除本文档与 `docs/heyang/CHANGELOG-heyang.md` 外，不涉及功能代码修改。

## 0. 聊天主流程简化链路图

```text
用户输入
  |
  v
前端入口
  src/features/Conversation/store/slices/message/action/sendMessage.ts
  src/routes/(main)/agent/features/Conversation/MainChatInput/MessageFromUrl.tsx
  |
  v
本地聊天生命周期
  src/store/chat/slices/aiChat/actions/conversationLifecycle.ts
  sendMessage()
  |
  +--> 创建 user/assistant 消息占位
  |    src/services/aiChat.ts
  |    sendMessageInServer()
  |      -> src/server/routers/lambda/aiChat.ts
  |         sendMessageInServer
  |
  v
构造 Agent 运行态和工具
  src/store/chat/slices/aiChat/actions/streamingExecutor.ts
  internal_createAgentState()
  |
  v
执行器
  src/store/chat/agents/createAgentExecutors.ts
  createAgentExecutors()
  |
  v
聊天服务 / SSE
  src/services/chat/index.ts
  createAssistantMessageStream() -> getChatCompletion()
  |
  v
Next API 路由
  src/app/(backend)/webapi/chat/[provider]/route.ts
  POST()
  |
  v
模型 Runtime
  src/server/modules/ModelRuntime/index.ts
  initModelRuntimeFromDB()
  |
  v
Provider 分发
  packages/model-runtime/src/runtimeMap.ts
  providerRuntimeMap.newapi
  |
  v
NewAPI provider
  packages/model-runtime/src/providers/newapi/index.ts
  LobeNewAPIAI
  |
  v
OpenAI-compatible 底层调用
  packages/model-runtime/src/core/openaiCompatibleFactory/index.ts
  client.chat.completions.create()
  |
  v
公司 NewAPI /v1/chat/completions -> kimi-k2.6
```

## 1. 顶层结构

构建形态：这是一个 Next.js 主应用 + pnpm workspace monorepo。工作区配置在 `pnpm-workspace.yaml`，根 `package.json` 的 `workspaces` 包含 `packages/*`、`packages/business/*`、`e2e`、`apps/desktop/src/main`。当前仓库未发现 `turbo.json`，所以没有 Turbo 配置文件。根构建脚本在 `package.json`，开发脚本包括 `dev`、`dev:next`、`dev:docker`，数据库脚本包括 `db:generate`、`db:migrate`。

顶层目录：

| 路径                  | 职责                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `src`                 | 主 Web 应用、Next App Router、store、services、server routers、页面路由，是上游核心主体。 |
| `packages`            | 可复用运行时、工具、数据库、类型、模型、内置 Agent/Skill，是上游核心主体。                |
| `packages/business`   | 商业 / 品牌 / 业务覆盖层，目前有 `config`、`const`、`model-runtime`，更像可替换外壳。     |
| `apps/desktop`        | 桌面端 Electron 应用。                                                                    |
| `apps/cli`            | CLI 应用。                                                                                |
| `apps/device-gateway` | 设备网关服务。                                                                            |
| `e2e`                 | Cucumber + Playwright 端到端测试。                                                        |
| `docs`                | 文档与开发说明。                                                                          |
| `locales`             | i18n JSON 文案。                                                                          |
| `public`              | favicon、PWA icon、头像、截图等静态资源。                                                 |
| `docker-compose`      | 本地开发依赖编排，如 Postgres、Redis、S3 兼容对象存储等。                                 |
| `.github/workflows`   | CI、发布、E2E、Docker、Desktop 构建流水线。                                               |

主要 packages /apps 按职责族划分：

| 路径                                                                                                                                      | 职责                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/model-runtime`、`packages/model-bank`                                                                                           | 模型 runtime、provider 分发、模型元数据。                                |
| `packages/agent-runtime`、`agent-manager-runtime`、`agent-gateway-client`、`agent-signal`、`agent-tracing`、`agent-templates`             | Agent 执行、管理、网关客户端、信号、轨迹与模板。                         |
| `packages/builtin-agents`、`builtin-skills`、`builtin-tools`、`builtin-tool-*`                                                            | 内置 Agent、Skill、工具总注册表与各工具实现。                            |
| `packages/context-engine`、`conversation-flow`、`prompts`                                                                                 | 上下文工程、会话转换与 prompt 模板。                                     |
| `packages/database`、`types`、`const`、`config`、`utils`                                                                                  | 数据库、类型、默认常量、共享配置与通用工具。                             |
| `packages/file-loaders`、`fetch-sse`、`tool-runtime`、`shared-tool-ui`、`python-interpreter`、`web-crawler`、`ssrf-safe-fetch`、`openapi` | 文件解析、SSE、工具运行、工具 UI、Python、网页抓取、SSRF 防护、OpenAPI。 |
| `packages/chat-adapter-feishu`、`chat-adapter-line`、`chat-adapter-qq`、`chat-adapter-wechat`                                             | 外部 IM 平台适配器。                                                     |
| `packages/desktop-bridge`、`device-gateway-client`、`electron-client-ipc`、`electron-server-ipc`                                          | 桌面端、设备网关与 IPC。                                                 |
| `packages/business/config`、`packages/business/const`、`packages/business/model-runtime`                                                  | 企业 / 商业覆盖层，适合放低侵入配置、品牌、模型覆盖。                    |
| `apps/desktop`、`apps/cli`、`apps/device-gateway`                                                                                         | 桌面应用、CLI、设备网关服务。                                            |

上游核心主要是 `src`、`packages/model-runtime`、`packages/agent-runtime`、`packages/context-engine`、`packages/database`、`packages/builtin-*`。相对可替换外壳主要是 `packages/business/*`、`public/*`、`locales/*`、部分 `apps/*`。

## 2. 请求链路（聊天主流程）

调用栈：

1. 前端触发：`src/features/Conversation/store/slices/message/action/sendMessage.ts` / `sendMessage`。
2. 入口变体：`src/routes/(main)/agent/features/Conversation/MainChatInput/MessageFromUrl.tsx`、`src/routes/(main)/agent/features/Conversation/AgentWelcome/OpeningQuestions.tsx`。
3. 生命周期：`src/store/chat/slices/aiChat/actions/conversationLifecycle.ts` / `sendMessage`，解析 tools/skills、文件、agent 配置、操作状态。
4. 服务端建消息：`src/services/aiChat.ts` / `sendMessageInServer` -> `src/server/routers/lambda/aiChat.ts` / `sendMessageInServer`，写 user message 与 assistant placeholder。
5. 构造运行态：`src/store/chat/slices/aiChat/actions/streamingExecutor.ts` / `internal_createAgentState`，调用 `resolveAgentConfig` 与 `createAgentToolsEngine`。
6. 执行器：`src/store/chat/agents/createAgentExecutors.ts` / `createAgentExecutors`，调用 `chatService.createAssistantMessageStream`。
7. 聊天服务：`src/services/chat/index.ts` / `createAssistantMessageStream` -> `getChatCompletion` -> `fetchSSE`。
8. API 路由：`src/app/(backend)/webapi/chat/[provider]/route.ts` / `POST`，经 `checkAuth` 后调用 `modelRuntime.chat`。
9. Runtime 初始化：`src/server/modules/ModelRuntime/index.ts` / `initModelRuntimeFromDB`。
10. Provider 分发：`packages/model-runtime/src/runtimeMap.ts` / `providerRuntimeMap.newapi`。
11. NewAPI provider：`packages/model-runtime/src/providers/newapi/index.ts` / `LobeNewAPIAI`。
12. 底层调用：`packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` / `this.client.chat.completions.create`。

可挂审计日志的位置：

| 层级              | 文件 / 函数                                                                                | 适合记录                                                            |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 前端发送前        | `src/features/Conversation/store/slices/message/action/sendMessage.ts` / `sendMessage`     | 用户侧输入、附件选择、UI 状态。只能作为辅助审计，不能作为可信来源。 |
| 消息入库          | `src/server/routers/lambda/aiChat.ts` / `sendMessageInServer`                              | 用户消息、topic、agent、thread、assistant placeholder ID。          |
| API 边界          | `src/app/(backend)/webapi/chat/[provider]/route.ts` / `POST`                               | 认证用户、provider、模型请求、服务端错误、trace headers。           |
| Runtime 边界      | `src/server/modules/ModelRuntime/index.ts` / `initModelRuntimeFromDB`、`ModelRuntime.chat` | provider 配置来源、用户 provider 开关、runtime 选择。               |
| Provider 最后一跳 | `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`                         | 发给公司 NewAPI 的最终 payload keys、模型、工具数量、错误响应。     |
| 流完成回填        | `src/store/chat/agents/createAgentExecutors.ts`                                            | assistant 内容、tool_calls、usage、reasoning、finish type。         |

## 3. 工具调用 / Function Calling 链路

tool_calls 解析和展示：

| 环节                          | 文件 / 函数                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具 manifest 生成            | `src/helpers/toolEngineering/index.ts` / `createAgentToolsEngine`、`createToolsEngine`                                                      |
| LLM 流中接收 tool_calls       | `src/store/chat/agents/StreamingHandler.ts` / `handleChunk`、`throttledUpdateToolCalls`                                                     |
| tool_calls 转内部工具 payload | `src/store/chat/slices/plugin/actions/internals.ts` / `internal_transformToolCalls`，内部使用 `ToolNameResolver` 和 `ToolArgumentsRepairer` |
| Agent runtime 捕获 tool_calls | `packages/agent-runtime/src/core/runtime.ts` / `executeLLM` 相关逻辑，读取 `chunk.tool_calls`                                               |
| 通用 Agent 状态机判断         | `packages/agent-runtime/src/agents/GeneralChatAgent.ts`，注释中明确 `llm_result -> check for tool_calls`                                    |

工具结果回填：

| 环节                 | 文件 / 函数                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| 前端工具执行器       | `src/store/chat/agents/createAgentExecutors.ts`，`call_tool` 分支会创建 `role: 'tool'` 消息并继续运行        |
| 人工审批入口         | `src/features/Conversation/store/slices/tool/action.ts` / `approveToolCall`                                  |
| 会话控制审批         | `src/store/chat/slices/aiChat/actions/conversationControl.ts` / `approveToolCalling`                         |
| Agent runtime 审批   | `packages/agent-runtime/src/core/runtime.ts` / `approveToolCall`，生成 `role: 'tool'`、`tool_call_id` 的消息 |
| 服务端 Agent runtime | `src/server/modules/AgentRuntime/RuntimeExecutors.ts`，包含服务端 tool_calls 与 `role: 'tool'` 处理          |

内置工具注册机制：

| 文件                                                        | 作用                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/builtin-tools/src/index.ts`                       | 导出 `defaultToolIds`、`alwaysOnToolIds`、`builtinTools`、`defaultUninstalledBuiltinTools`。 |
| `packages/builtin-tool-*/src/manifest.ts`                   | 每个内置工具的 manifest。                                                                    |
| `packages/builtin-tool-*/src/executor`                      | 客户端 / 共享 executor，部分工具有。                                                         |
| `src/server/modules/Mecha/AgentToolsEngine/index.ts`        | 服务端版 `createServerAgentToolsEngine`，和前端工具生成逻辑对齐。                            |
| `src/server/services/toolExecution/builtin.ts`              | `BuiltinToolsExecutor` 根据 source 路由到 LobeHub Skill、Klavis 或 server runtime。          |
| `src/server/services/toolExecution/serverRuntimes/index.ts` | 服务端内置工具 runtime 注册表。                                                              |

自定义工具扩展点：

| 类型          | 文件 / 入口                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| MCP / 插件    | `src/store/tool/selectors`、`src/server/routers/tools/mcp.ts`、`src/server/services/mcp/*`                                         |
| LobeHub Skill | `src/server/routers/lambda/agentSkills.ts`、`src/server/services/skill/importer.ts`、`packages/database/src/schemas/agentSkill.ts` |
| 内置工具      | 新增 `packages/builtin-tool-*`，再在 `packages/builtin-tools/src/index.ts` 注册。                                                  |
| 工具执行      | `src/server/services/toolExecution/index.ts` / `ToolExecutionService.executeTool`                                                  |

## 4. 文件上传下载链路

上传入口：

| 场景             | 文件                                                     |
| ---------------- | -------------------------------------------------------- |
| 聊天输入上传按钮 | `src/features/ChatInput/ActionBar/Upload/index.tsx`      |
| 拖拽上传区       | `src/components/DragUploadZone/useUploadFiles.ts`        |
| Skill 上传       | `src/features/SkillStore/SkillList/UploadSkillModal.tsx` |

上传链路：

上传链路：`src/features/ChatInput/ActionBar/Upload/index.tsx` -> `src/store/file/slices/chat/action.ts` / `uploadChatFiles` -> `src/store/file/slices/upload/action.ts` / `uploadWithProgress` -> `src/services/upload.ts` / `uploadFileToS3`、`getSignedUploadUrl` -> `src/server/routers/lambda/upload.ts` / `createS3PreSignedUrl` -> `src/server/modules/S3/index.ts` / `FileS3`。上传后由 `src/store/file/slices/upload/action.ts` 调 `fileService.createFile`，最终 `src/server/routers/lambda/file.ts` / `createFile` 写元数据并返回 `/f/:id`。

对象存储抽象层：

| 文件                                      | 作用                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `src/server/modules/S3/index.ts`          | `S3` 和 `FileS3`，基于 AWS S3 SDK，适配 S3/MinIO/RustFS 等兼容对象存储。 |
| `src/server/services/file/index.ts`       | `FileService` 统一文件服务门面。                                         |
| `src/server/services/file/impls/index.ts` | `createFileServiceModule` 当前返回 `S3StaticFileImpl`。                  |
| `src/server/services/file/impls/s3.ts`    | `S3StaticFileImpl`，包装 `FileS3` 的预签名、下载、上传、删除。           |

下载链路：

| 文件                                   | 作用                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `src/app/(backend)/f/[id]/route.ts`    | `/f/:id` 文件代理入口，根据 file id 取 DB 记录，生成 GET 预签名 URL 后 302 跳转。 |
| `packages/database/src/models/file.ts` | `FileModel.getFileById`、`findById`、`checkHash` 等文件查询。                     |
| `src/server/services/file/index.ts`    | `getFullFileUrl`、`createPreSignedUrlForPreview` 等下载相关方法。                 |

元数据表：

| 表                     | schema 文件                             | 说明                                                                              |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `files`                | `packages/database/src/schemas/file.ts` | 用户级文件记录，包含 `name`、`fileType`、`fileHash`、`url`、`size`、`userId` 等。 |
| `global_files`         | `packages/database/src/schemas/file.ts` | 基于 hash 的全局文件去重记录。                                                    |
| `documents`            | `packages/database/src/schemas/file.ts` | 文档 / 网页 / API/topic/agent 等内容记录。                                        |
| `knowledge_base_files` | `packages/database/src/schemas/file.ts` | 知识库和文件关联表。                                                              |

可挂加解密 hook 的位置：

| 方向                | 文件 / 函数                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| 上传前本地读 bytes  | `src/store/file/slices/upload/action.ts` / `uploadWithProgress`                          |
| 获取预签名和 PUT 前 | `src/services/upload.ts` / `uploadFileToS3`、`getSignedUploadUrl`                        |
| 服务端对象存储写入  | `src/server/modules/S3/index.ts` / `uploadBuffer`、`uploadContent`、`createPreSignedUrl` |
| 下载预签名前        | `src/server/services/file/impls/s3.ts` / `createPreSignedUrlForPreview`                  |
| `/f/:id` 代理下载   | `src/app/(backend)/f/[id]/route.ts` / `GET`                                              |

## 5. 数据库层

ORM：Drizzle ORM。依赖在 `package.json` 中为 `drizzle-orm`、`drizzle-kit`、`drizzle-zod`。配置文件是 `drizzle.config.ts`，schema 目录是 `packages/database/src/schemas`，迁移输出目录是 `packages/database/migrations`。

迁移机制：

| 文件 / 命令                             | 作用                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `package.json` / `db:generate`          | `drizzle-kit generate && npm run workflow:dbml`，生成 SQL 迁移和 DBML。               |
| `package.json` / `db:migrate`           | `cross-env MIGRATION_DB=1 tsx ./scripts/migrateServerDB/index.ts`。                   |
| `scripts/migrateServerDB/index.ts`      | 根据连接方式调用 `drizzle-orm/node-postgres/migrator` 或 `neon-serverless/migrator`。 |
| `packages/database/migrations`          | SQL 迁移文件，当前已到 `0102_add_agent_operations_table.sql`。                        |
| `docs/development/database-schema.dbml` | 由 workflow 生成的数据库结构文档。                                                    |

核心 schema /model 清单：

| 领域                 | schema                                             | model                                                                                                 |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 用户                 | `packages/database/src/schemas/user.ts`            | `packages/database/src/models/user.ts`                                                                |
| Better Auth          | `packages/database/src/schemas/betterAuth.ts`      | 通过 `src/libs/better-auth/define-config.ts` 的 Drizzle adapter 使用                                  |
| 旧 NextAuth          | `packages/database/src/schemas/nextauth.ts`        | 兼容历史迁移                                                                                          |
| 会话 / 分组          | `packages/database/src/schemas/session.ts`         | `packages/database/src/models/session.ts`、`packages/database/src/models/sessionGroup.ts`             |
| 话题                 | `packages/database/src/schemas/topic.ts`           | `packages/database/src/models/topic.ts`、`topicShare.ts`、`topicDocument.ts`                          |
| 消息                 | `packages/database/src/schemas/message.ts`         | `packages/database/src/models/message.ts`                                                             |
| Agent                | `packages/database/src/schemas/agent.ts`           | `packages/database/src/models/agent.ts`                                                               |
| Agent 操作           | `packages/database/src/schemas/agentOperations.ts` | `packages/database/src/models/agentOperation.ts`                                                      |
| Agent Skill          | `packages/database/src/schemas/agentSkill.ts`      | `packages/database/src/models/agentSkill.ts`                                                          |
| Agent 文档           | `packages/database/src/schemas/agentDocuments.ts`  | `packages/database/src/models/agentDocuments/*`                                                       |
| 文件 / 文档 / 知识库 | `packages/database/src/schemas/file.ts`、`rag.ts`  | `packages/database/src/models/file.ts`、`document.ts`、`chunk.ts`、`knowledgeBase.ts`、`embedding.ts` |
| Provider / 模型      | `packages/database/src/schemas/aiInfra.ts`         | `packages/database/src/models/aiProvider.ts`、`aiModel.ts`                                            |
| API Key              | `packages/database/src/schemas/apiKey.ts`          | `packages/database/src/models/apiKey.ts`                                                              |
| 任务                 | `packages/database/src/schemas/task.ts`            | `packages/database/src/models/task.ts`、`taskTopic.ts`                                                |
| 群聊                 | `packages/database/src/schemas/chatGroup.ts`       | `packages/database/src/models/chatGroup.ts`                                                           |
| 权限                 | `packages/database/src/schemas/rbac.ts`            | `packages/database/src/models/rbac.ts`                                                                |
| OIDC                 | `packages/database/src/schemas/oidc.ts`            | `src/server/services/oidc/*`                                                                          |
| 通知                 | `packages/database/src/schemas/notification.ts`    | `packages/database/src/models/notification.ts`                                                        |

加新表标准流程：在 `packages/database/src/schemas` 新增 / 修改 schema，并从 `packages/database/src/schemas/index.ts` 导出；如需数据访问，新增 `packages/database/src/models/*.ts`；执行 `pnpm db:generate` 生成 `packages/database/migrations/*.sql` 和 DBML；本地 / 部署执行 `pnpm db:migrate`。

## 6. 认证与权限

认证方案：当前主认证是 Better Auth，不是 NextAuth 主链路。入口文件：

| 文件                                           | 作用                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/auth.ts`                                  | 调用 `defineConfig({ plugins: [] })` 导出 `auth`。                                                                |
| `src/libs/better-auth/define-config.ts`        | Better Auth 核心配置，使用 Drizzle adapter、email/password、email OTP、passkey、admin、magic link、genericOAuth。 |
| `src/app/(backend)/api/auth/[...all]/route.ts` | Better Auth Next.js handler，暴露 GET/POST。                                                                      |
| `packages/database/src/schemas/betterAuth.ts`  | Better Auth 相关表结构。                                                                                          |
| `src/envs/auth.ts`                             | `AUTH_SECRET`、`AUTH_SSO_PROVIDERS`、各 SSO provider env。                                                        |

session 传递：

| 链路         | 文件                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Web API 鉴权 | `src/app/(backend)/middleware/auth/index.ts` 的 `checkAuth` 调 `auth.api.getSession({ headers: req.headers })`。            |
| tRPC 鉴权    | `src/libs/trpc/middleware/userAuth.ts`、`src/libs/trpc/lambda/middleware/*`。                                               |
| CLI/OIDC     | `src/app/(backend)/middleware/auth/index.ts` 支持 `LOBE_CHAT_OIDC_AUTH_HEADER`，并用 `src/libs/oidc-provider/jwt.ts` 校验。 |

角色 / 权限：

| 文件                                    | 说明                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/database/src/schemas/rbac.ts` | 定义 `rbac_roles`、`rbac_permissions`、`rbac_role_permissions`、`rbac_user_roles`。         |
| `packages/database/src/models/rbac.ts`  | `RbacModel` 提供 `getUserPermissions`、`hasPermission`、`getUserRoles`、`updateUserRoles`。 |
| `src/utils/rbac.ts`                     | 前端 / 工具侧权限辅助。                                                                     |

SSO 切入点：

| 文件                                        | 说明                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/libs/better-auth/sso/index.ts`         | 根据 `AUTH_SSO_PROVIDERS` 初始化 social/generic OAuth provider。                 |
| `src/libs/better-auth/sso/providers/*`      | Apple、Google、GitHub、Microsoft、Keycloak、Generic OIDC、飞书等 provider 定义。 |
| `src/envs/auth.ts`                          | SSO provider 环境变量定义。                                                      |
| `src/app/[variants]/(auth)/signin/page.tsx` | 登录页 UI。                                                                      |
| `src/app/(backend)/oidc/[...oidc]/route.ts` | LobeHub 自身作为 OIDC provider 的入口。                                          |

## 7. 模型 runtime 层

核心文件：

| 文件                                                               | 作用                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` | OpenAI-compatible provider 工厂，包含 chat、embedding、模型列表、结构化输出、tool calling 等通用逻辑。 |
| `packages/model-runtime/src/runtimeMap.ts`                         | provider id 到 runtime class 的映射，`newapi` 映射到 `LobeNewAPIAI`。                                  |
| `packages/model-runtime/src/providers/newapi/index.ts`             | NewAPI provider，拉取 `/v1/models`、`/api/pricing`，并通过 router runtime 兼容多 provider。            |
| `src/server/modules/ModelRuntime/index.ts`                         | 从 DB/env 初始化 `ModelRuntime`。                                                                      |
| `src/app/(backend)/webapi/models/[provider]/route.ts`              | 模型列表 Web API。                                                                                     |
| `src/app/(backend)/webapi/chat/[provider]/route.ts`                | 聊天 Web API。                                                                                         |

我们已经改过的 Kimi thinking 兼容位置：

| 文件                                                               | 当前改动                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` | 当 `this.id === 'newapi'` 且 `model` 以 `kimi-` 开头时，从最终请求中删除 `thinking` 字段，避免公司 NewAPI/Kimi 返回参数错误；同时增加 `DEBUG_NEWAPI_SAFE_PAYLOAD=1` 的安全 payload 日志。 |

runtime 被 provider 调用方式：`src/app/(backend)/webapi/chat/[provider]/route.ts` 调 `initModelRuntimeFromDB`，后者在 `src/server/modules/ModelRuntime/index.ts` 创建 `ModelRuntime`；`ModelRuntime.chat` 根据 provider 到 `packages/model-runtime/src/runtimeMap.ts` 找具体 runtime；NewAPI 的 runtime 来自 `packages/model-runtime/src/providers/newapi/index.ts`，最终复用 `openaiCompatibleFactory`。

新增 provider 标准链路：参考 `packages/model-runtime/src/providers/newapi/index.ts` 实现 runtime，在 `packages/model-runtime/src/runtimeMap.ts` 注册 provider id；模型 /provider 元数据关注 `packages/model-bank`、`packages/const` 与相关 settings/store 配置；如需环境变量，补 `src/envs/*` 与 `.env.example`。

## 8. Agent / 助手体系

Agent 配置存储：

| 文件                                     | 说明                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/database/src/schemas/agent.ts` | `agents` 相关 schema，含 `systemRole`、model/provider、plugins、chatConfig、sessionGroupId 等字段。 |
| `packages/database/src/models/agent.ts`  | `AgentModel`，负责 agent 查询、创建、复制、内置 agent 初始化等。                                    |
| `packages/const/src/settings/agent.ts`   | `DEFAULT_AGENT_CONFIG` 等默认配置。                                                                 |
| `src/store/agent/*`                      | 前端 Agent 状态与 selectors。                                                                       |
| `src/server/services/agent/index.ts`     | 服务端 Agent 服务。                                                                                 |

系统 prompt 注入：

| 文件                                             | 说明                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/chat/mecha/agentConfigResolver.ts` | `resolveAgentConfig` 合并 DB 配置、内置 Agent runtime config、locale instruction、page/task/group supervisor 特殊 systemRole。 |
| `src/services/chat/index.ts`                     | `createAssistantMessageStream` 做 context engineering，把 resolved agent config 传给请求。                                     |
| `packages/prompts`                               | prompt 模板来源。                                                                                                              |
| `packages/context-engine/src/providers/*`        | Context injectors，例如 AgentBuilder、GroupAgentBuilder、LocalSystem、Onboarding 等。                                          |

Agent Builder / Group Supervisor：

| 文件                                                                                  | 说明                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/builtin-agents/src/agents/agent-builder/index.ts`                           | Agent Builder 内置 Agent runtime 配置。                              |
| `packages/builtin-agents/src/agents/group-supervisor/index.ts`                        | Group Supervisor 内置 Agent runtime 配置。                           |
| `packages/builtin-agents/src/index.ts`                                                | `BUILTIN_AGENTS`、`getAgentPersistConfig`、`getAgentRuntimeConfig`。 |
| `src/routes/(main)/agent/profile/index.tsx`                                           | Agent profile 页面，渲染 `AgentBuilder`。                            |
| `packages/builtin-tool-agent-builder`                                                 | Agent Builder 相关工具。                                             |
| `packages/builtin-tool-group-agent-builder`、`packages/builtin-tool-group-management` | 群组 Agent 构建 / 管理工具。                                         |

内置 Agent 模板：

| 文件 / 目录                                    | 说明                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/builtin-agents/src/agents`           | inbox、task-agent、page-agent、agent-builder、group-supervisor 等内置 Agent。 |
| `packages/agent-templates`                     | Agent 模板包。                                                                |
| `src/routes/(main)/community/(detail)/agent/*` | 社区 Agent 详情和导入相关页面。                                               |

## 9. 插件 / Skill 体系

目录结构：

| 路径                                          | 说明                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/builtin-skills/src`                 | 内置 Skill，例如 `artifacts`、`task`、`lobehub`、`agent-browser`、`find-skills`。     |
| `packages/builtin-tool-skills/src`            | “Skills” 工具，支持 `activateSkill`、`readReference`、`execScript`、`exportFile` 等。 |
| `packages/builtin-tool-skill-store/src`       | Skill Store 工具，支持搜索 / 导入 Skill。                                             |
| `src/server/routers/lambda/agentSkills.ts`    | 用户 Skill CRUD、GitHub/URL/ZIP/Market 导入、资源读取。                               |
| `src/server/services/skill/importer.ts`       | `SkillImporter`，处理用户 Skill 创建和导入。                                          |
| `src/server/services/skill/resource.ts`       | `SkillResourceService`，读取 Skill resources。                                        |
| `packages/database/src/schemas/agentSkill.ts` | Agent Skill 表结构。                                                                  |
| `packages/database/src/models/agentSkill.ts`  | Agent Skill 数据访问，含 `listBySource`。                                             |

marketplace 数据来源：

| 文件                                                                                            | 说明                                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/server/services/market/index.ts`                                                           | `MarketService`，默认 `MARKET_BASE_URL` 为 `https://market.lobehub.com`，可由 env 覆盖。 |
| `src/server/services/market/index.ts` / `getSkillList`、`getSkillDetail`、`getSkillDownloadUrl` | 远程 LobeHub Market 的 Skill 数据来源。                                                  |
| `src/server/routers/lambda/agentSkills.ts` / `importFromMarket`                                 | 从 Market 获取下载 URL，再经 `SkillImporter.importFromUrl` 导入。                        |
| `src/server/services/discover/index.ts`                                                         | 社区 agent/model/provider/mcp 等发现服务。                                               |

新增公司内部 Skill 是否会污染上游：当前代码已有 `source` 区分，`agentSkillsRouter.list` 支持 `source: 'builtin' | 'market' | 'user'`，`packages/database/src/models/agentSkill.ts` 有 `listBySource`。同时 `packages/business/*` 已作为业务覆盖层存在。因此内部 Skill 可以落在用户 / 企业数据源或 business 覆盖层，不必直接改上游 marketplace 数据源。

## 10. 国际化与品牌定制点

品牌与静态资源：

| 文件 / 目录                                                      | 说明                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/business/const/src/branding.ts`                        | `BRANDING_NAME`、`BRANDING_LOGO_URL`、`ORG_NAME`、`SOCIAL_URL`、`BRANDING_PROVIDER`。 |
| `packages/const/src/meta.ts`                                     | 默认头像和 logo fallback 使用 business branding。                                     |
| `packages/const/src/version.ts`                                  | 判断是否自定义品牌。                                                                  |
| `src/app/manifest.ts`                                            | PWA manifest，生产环境读取 `BRANDING_NAME`、`BRANDING_LOGO_URL`。                     |
| `public/favicon.ico`、`public/favicon-32x32.ico` 等              | favicon。                                                                             |
| `public/icons/icon-192x192.png`、`public/icons/icon-512x512.png` | PWA icon。                                                                            |
| `public/avatars/lobe-ai.png`                                     | 默认 Lobe AI 头像。                                                                   |

i18n：

| 路径                                   | 说明                            |
| -------------------------------------- | ------------------------------- |
| `locales/zh-CN/*.json`                 | 中文文案。                      |
| `locales/en-US/*.json`                 | 英文文案。                      |
| `src/locales/default/*`                | 默认文案模块。                  |
| `.i18nrc.js`                           | i18n 配置。                     |
| `package.json` / `i18n`、`i18n:unused` | 文案同步和未使用 key 检查脚本。 |

主题色：

| 文件                                 | 说明                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| `packages/const/src/theme.ts`        | `LOBE_THEME_PRIMARY_COLOR`、`LOBE_THEME_NEUTRAL_COLOR` 常量。 |
| `src/store/user/slices/preference/*` | 用户外观偏好状态。                                            |
| `locales/zh-CN/setting.json`         | 外观设置文案，如主题色、明暗主题。                            |

## 11. 测试基础设施

单测框架：Vitest。根配置在 `vitest.config.mts`，测试 setup 在 `tests/setup.ts`，根脚本在 `package.json`：`test`、`test-app`、`test-server`、`test:update`、`test-app:coverage`。

测试目录约定：

| 路径 / 模式                                                                         | 说明                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------- |
| `src/**/*.test.ts`、`src/**/*.test.tsx`                                             | 主应用单测。                           |
| `src/**/__tests__/*`                                                                | 主应用聚合测试。                       |
| `packages/*/src/**/*.test.ts`                                                       | package 单测。                         |
| `packages/*/vitest.config.mts`                                                      | 部分 package 自带 Vitest 配置。        |
| `packages/database/vitest.config.mts`、`packages/database/vitest.config.server.mts` | DB package 测试配置。                  |
| `e2e`                                                                               | Cucumber + Playwright E2E。            |
| `e2e/src/steps/*`                                                                   | E2E step definitions。                 |
| `e2e/src/support/*`                                                                 | E2E world、web server、测试用户 seed。 |

CI 配置：

| 文件                                         | 说明                              |
| -------------------------------------------- | --------------------------------- |
| `.github/workflows/test.yml`                 | 主测试流水线。                    |
| `.github/workflows/e2e.yml`                  | E2E 测试。                        |
| `.github/workflows/pr-build-docker.yml`      | PR Docker 构建。                  |
| `.github/workflows/pr-build-desktop.yml`     | PR Desktop 构建。                 |
| `.github/workflows/release.yml`              | 主发布。                          |
| `.github/workflows/release-docker.yml`       | Docker 发布。                     |
| `.github/workflows/release-desktop-*.yml`    | Desktop beta/canary/stable 发布。 |
| `.github/workflows/sync-database-schema.yml` | 数据库结构同步。                  |
| `codecov.yml`                                | 覆盖率配置。                      |

## 12. 上游同步风险评估

当前工作树已改动文件清单：

| 文件                                                               | 改动内容                                                                                     | 上游合并风险                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` | NewAPI + `kimi-*` 删除 `thinking`，增加 `DEBUG_NEWAPI_SAFE_PAYLOAD` 日志。                   | 高。该文件是多 provider 共用核心，后续上游 runtime 改动容易冲突。 |
| `src/initialize.ts`                                                | `react-scan` 仅在 `NEXT_PUBLIC_ENABLE_REACT_SCAN=1` 时启用，避免本地 UI 卡顿和扫描遮罩干扰。 | 中。入口初始化文件较小，但上游可能改初始化逻辑。                  |

配置驱动、风险较低的定制点：

| 文件 / 位置                               | 说明                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `.env` / `NEWAPI_MODEL_LIST`              | 可控制 NewAPI 模型列表，例如只暴露 `kimi-k2.6`。 |
| `packages/business/const/src/branding.ts` | 品牌名、logo、链接。                             |
| `public/*`                                | favicon、PWA icon、头像等静态资源。              |
| `locales/zh-CN/*.json`                    | 中文文案。                                       |
| `src/envs/auth.ts` + `.env`               | SSO provider env 配置。                          |

未来同步策略：以保持上游可持续同步为目标，建议长期用 fork 分支跟踪上游主分支，企业化改造集中在独立 feature 分支；上游更新以 merge 为主，避免频繁重写团队共享历史。对 `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` 这类高冲突核心文件，尽量把企业差异收敛到小范围条件分支或 business 覆盖层，减少每次同步的冲突面。
