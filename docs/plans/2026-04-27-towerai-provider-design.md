# Tower AI Provider 集成设计

## 背景

tower-ai.yottastudios.com 基于 lobehub 二次开发。我们在 lobehub 上集成 Tower AI 作为新的 AI 提供商，复用 lobehub 已有的群组对话（`/group` 路由 + `groupOrchestration`）来实现多 AI 讨论功能。

## 核心结论

lobehub **已有完整的群组对话系统**（`/group` 路由、`AssistantGroup` 消息渲染、`groupOrchestration` 编排引擎、`@mention` 选人）。我们**不需要重建讨论 UI**，只需把 Tower AI 接入 lobehub 的 provider 系统。

## 部署目标

**Electron 桌面版**（`apps/desktop`），不需要服务器。Tower AI helper 跑在 Electron 主进程。

## 认证方案

两种模式，在设置页切换：

| 模式             | 说明                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| **账号自动登录** | 填企业邮箱 + 密码，Electron 主进程用 Puppeteer 完成 OA SSO 登录，自动缓存并刷新 token |
| **手动 token**   | 用户从浏览器手动复制 `token` + `authToken` 粘贴                                       |

## 三层实现方案

### 层 1：model-runtime（AI 调用层）

**新建** `packages/model-runtime/src/providers/towerai.ts`

- 实现 `LobeRuntimeAI` 接口
- 根据模型名路由到不同端点：
  - `gemini.*` / `claude.*` → `/zi/webapi/chat/vertexai`
  - `deepseek.*` → `/zi/webapi/chat/newapi`
  - `gpt.*` → `/zi/webapi/chat/openai`
- 认证：在请求头注入 `token` + `authToken`（而非 API key）
- 在 `providerRuntimeMap` 注册 `towerai: LobeTowerAI`

### 层 2：model-bank（模型列表）

**新建** `packages/model-bank/src/aiModels/towerai.ts`

- 格式与现有 `deepseek.ts` 一致
- 声明四个模型组：GPT（gpt-5.4、gpt-5.2、gpt-4o）、Claude（claude-sonnet-4-6 等）、Gemini（gemini-3.1-pro-preview 等）、DeepSeek（deepseek-v3-2）

### 层 3：Electron 认证管理

**新建** `apps/desktop/src/main/towerai/`

- 集成 TowerAI SDK（`chathub/TowerAI/` 的 `src/auth.ts` + `src/helper/server.ts`）
- 管理 token 缓存 + 自动刷新（token 过期时 600015 错误触发 refresh）
- 通过 `packages/electron-server-ipc` 暴露 IPC 接口：
  - `towerai:getToken` → `{ token, authToken }`
  - `towerai:login(username, password)` → OA SSO 登录
  - `towerai:getState` → `{ connected, loggedIn, hasToken, expiresSoon }`

渲染进程调 IPC 取 token，再调 `initializeWithProvider('towerai', { token, authToken, baseURL })` 创建 runtime。

### 设置 UI

在 lobehub provider 设置页新增 Tower AI 配置面板：

- 认证模式切换（账号登录 / 手动 token）
- 账号模式：邮箱 + 密码输入，登录状态展示
- 手动模式：token + authToken 文本框
- 连接状态 badge + 手动刷新按钮

## 不需要做的事

- ❌ 重建讨论 UI（lobehub 已有 `/group` 路由）
- ❌ 扩展 session schema（lobehub 的 group session 已满足需求）
- ❌ 重写 @mention 逻辑（已有 `GroupChat.tsx`）
- ❌ 搭建服务器（Electron 主进程直接跑 helper）

## 涉及文件

### 新增

```
packages/model-runtime/src/providers/towerai.ts
packages/model-bank/src/aiModels/towerai.ts
apps/desktop/src/main/towerai/index.ts      # IPC 入口
apps/desktop/src/main/towerai/auth.ts       # 认证状态管理
apps/desktop/src/main/towerai/helper.ts     # TowerAI SDK 包装
src/features/Provider/TowerAI/             # 设置 UI 组件
src/locales/default/providers.ts           # i18n key（追加）
```

### 修改

```
packages/model-runtime/src/runtimeMap.ts   # 注册 towerai
packages/model-bank/src/index.ts           # 导出 towerai models
apps/desktop/src/main/index.ts             # 注册 IPC handlers
```
