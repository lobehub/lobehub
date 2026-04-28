# Tower AI Provider 集成实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Tower AI 作为新 AI 提供商集成到 lobehub Electron 桌面版，复用已有 `/group` 群组对话 UI 实现多 AI 讨论功能。

**Architecture:** Tower AI 按标准 provider 模式接入：`model-bank` 声明模型列表，`model-runtime` 实现 HTTP 调用（token/authToken 替代 apiKey），Electron 主进程通过 TowerAI SDK 管理 OA SSO 登录和 token 缓存，渲染进程调 IPC 拿 token 后初始化 runtime。

**Tech Stack:** TypeScript, openaiCompatibleFactory, Puppeteer（TowerAI SDK），electron-server-ipc，Vitest

---

## Task 1: model-bank — 声明 Tower AI 模型列表

**Files:**

- Create: `packages/model-bank/src/aiModels/towerai.ts`
- Modify: `packages/model-bank/src/aiModels/index.ts`

### Step 1: 新建 towerai 模型定义文件

参考 `packages/model-bank/src/aiModels/deepseek.ts` 的格式（`AIChatModelCard[]`）。

```ts
// packages/model-bank/src/aiModels/towerai.ts
import type { AIChatModelCard } from '../types/aiModel';

const toweraiChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true },
    contextWindowTokens: 128_000,
    description: 'GPT-5.4 via Tower AI proxy',
    displayName: 'GPT-5.4',
    enabled: true,
    id: 'gpt-5.4',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 128_000,
    description: 'GPT-5.2 via Tower AI proxy',
    displayName: 'GPT-5.2',
    enabled: true,
    id: 'gpt-5.2',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 128_000,
    description: 'GPT-4o via Tower AI proxy',
    displayName: 'GPT-4o',
    enabled: true,
    id: 'gpt-4o',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 200_000,
    description: 'Claude Sonnet 4.6 via Tower AI proxy',
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    id: 'claude-sonnet-4-6',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 200_000,
    description: 'Claude Sonnet 4.5 via Tower AI proxy',
    displayName: 'Claude Sonnet 4.5',
    enabled: true,
    id: 'claude-sonnet-4-5-20250929',
  },
  {
    abilities: {},
    contextWindowTokens: 1_000_000,
    description: 'Gemini 3.1 Pro Preview via Tower AI proxy',
    displayName: 'Gemini 3.1 Pro Preview',
    enabled: true,
    id: 'gemini-3.1-pro-preview',
  },
  {
    abilities: {},
    contextWindowTokens: 1_000_000,
    description: 'Gemini 3.0 Flash via Tower AI proxy',
    displayName: 'Gemini 3.0 Flash',
    enabled: true,
    id: 'gemini-3-flash-preview',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 64_000,
    description: 'DeepSeek V3 via Tower AI proxy',
    displayName: 'DeepSeek V3',
    enabled: true,
    id: 'deepseek-v3-2',
  },
];

export default toweraiChatModels;
```

### Step 2: 注册到 aiModels/index.ts

在 `packages/model-bank/src/aiModels/index.ts` 里，按字母顺序在 `import` 列表末尾添加（`t` 部分）：

```ts
import { default as towerai } from './towerai';
```

并在导出的 `allModels` map（或 `export const aiProviderModelList`）里加入 `towerai`。查看该文件末尾的导出结构，按同样格式追加 `towerai`。

### Step 3: 类型检查

```bash
cd packages/model-bank && bunx tsc --noEmit
```

Expected: 无类型错误

### Step 4: Commit

```bash
git add packages/model-bank/src/aiModels/towerai.ts packages/model-bank/src/aiModels/index.ts
git commit -m "feat(model-bank): add Tower AI model definitions"
```

---

## Task 2: model-runtime — 实现 Tower AI provider

**Files:**

- Create: `packages/model-runtime/src/providers/towerai/index.ts`
- Modify: `packages/model-runtime/src/runtimeMap.ts`

### Step 1: 写失败测试

```ts
// packages/model-runtime/src/providers/towerai/__tests__/index.test.ts
import { describe, expect, it } from 'vitest';

import { LobeTowerAI } from '../index';

describe('LobeTowerAI', () => {
  it('should resolve correct endpoint for GPT model', () => {
    const ai = new LobeTowerAI({
      apiKey: 'test-token',
      baseURL: 'https://tower-ai.yottastudios.com',
    });
    expect(ai).toBeDefined();
  });

  it('should use vertexai endpoint for claude models', () => {
    expect(LobeTowerAI.resolveEndpoint('https://base', 'claude-sonnet-4-6')).toBe(
      'https://base/zi/webapi/chat/vertexai',
    );
  });

  it('should use newapi endpoint for deepseek models', () => {
    expect(LobeTowerAI.resolveEndpoint('https://base', 'deepseek-v3-2')).toBe(
      'https://base/zi/webapi/chat/newapi',
    );
  });

  it('should use openai endpoint for gpt models', () => {
    expect(LobeTowerAI.resolveEndpoint('https://base', 'gpt-5.4')).toBe(
      'https://base/zi/webapi/chat/openai',
    );
  });
});
```

### Step 2: 运行确认测试失败

```bash
bunx vitest run --silent='passed-only' 'packages/model-runtime/src/providers/towerai/__tests__/index.test.ts'
```

Expected: FAIL — `Cannot find module '../index'`

### Step 3: 实现 Tower AI provider

Tower AI 本质上是 OpenAI 兼容接口，只是端点和认证方式不同。使用 `createOpenAICompatibleRuntime`，通过 `baseURL` 在运行时动态选择端点（在 `handlePayload` 里根据 model 改写 `baseURL`）：

```ts
// packages/model-runtime/src/providers/towerai/index.ts
import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export class LobeTowerAI {
  static resolveEndpoint(baseUrl: string, model: string): string {
    const base = baseUrl.replace(/\/$/, '');
    if (model.startsWith('gemini') || model.startsWith('claude')) {
      return `${base}/zi/webapi/chat/vertexai`;
    }
    if (model.startsWith('deepseek')) {
      return `${base}/zi/webapi/chat/newapi`;
    }
    return `${base}/zi/webapi/chat/openai`;
  }

  constructor(options: { apiKey: string; baseURL?: string }) {
    const baseURL = options.baseURL || 'https://tower-ai.yottastudios.com';
    return createOpenAICompatibleRuntime({
      baseURL: `${baseURL}/zi/webapi/chat/openai`,
      chatCompletion: {
        handlePayload: (payload) => {
          return {
            ...payload,
            baseURL: LobeTowerAI.resolveEndpoint(baseURL, payload.model as string),
          };
        },
      },
      errorType: {
        bizError: 'TowerAIBizError',
        invalidAPIKey: 'InvalidTowerAIAPIKey',
      },
      provider: ModelProvider.TowerAI,
    })(options);
  }
}
```

**注意**：`ModelProvider.TowerAI` 需要先在 `model-bank` 的 `ModelProvider` 枚举中添加。检查 `packages/model-bank/src/const/modelProvider.ts`，按字母序追加 `TowerAI = 'towerai'`。

### Step 4: 注册到 runtimeMap.ts

在 `packages/model-runtime/src/runtimeMap.ts` 末尾 import 列表和 `providerRuntimeMap` 对象里，按字母序（`t` 区域）添加：

```ts
import { LobeTowerAI } from './providers/towerai';
// ...
export const providerRuntimeMap = {
  // ...
  towerai: LobeTowerAI,
  // ...
};
```

### Step 5: 运行测试确认通过

```bash
bunx vitest run --silent='passed-only' 'packages/model-runtime/src/providers/towerai/__tests__/index.test.ts'
```

Expected: PASS

### Step 6: 类型检查

```bash
cd packages/model-runtime && bunx tsc --noEmit
```

### Step 7: Commit

```bash
git add packages/model-runtime/src/providers/towerai/ packages/model-runtime/src/runtimeMap.ts packages/model-bank/src/const/modelProvider.ts
git commit -m "feat(model-runtime): add Tower AI provider runtime"
```

---

## Task 3: Electron 主进程 — Tower AI 认证模块

**Files:**

- Create: `apps/desktop/src/main/modules/towerai/index.ts`
- Create: `apps/desktop/src/main/modules/towerai/auth.ts`
- Modify: `apps/desktop/src/main/core/App.ts`（注册 IPC handler）

### Step 1: 安装 TowerAI SDK 依赖

TowerAI SDK 源码在 `E:/workspace/GitRepository/chathub/TowerAI/`。方案：将其作为本地包引入，或直接把 `src/auth.ts`、`src/helper/server.ts`、`src/helper/state-store.ts` 拷贝到 `apps/desktop/src/main/modules/towerai/sdk/`。

**推荐：直接拷贝源文件**（避免跨 repo 依赖）：

```bash
cp E:/workspace/GitRepository/chathub/TowerAI/src/auth.ts \
  apps/desktop/src/main/modules/towerai/sdk/auth.ts
cp E:/workspace/GitRepository/chathub/TowerAI/src/helper/server.ts \
  apps/desktop/src/main/modules/towerai/sdk/helper-server.ts
cp E:/workspace/GitRepository/chathub/TowerAI/src/helper/state-store.ts \
  apps/desktop/src/main/modules/towerai/sdk/state-store.ts
```

然后检查依赖：TowerAI SDK 使用了 `playwright` 或 `puppeteer`，需要确认 `apps/desktop/package.json` 是否已有。查看 `chathub/TowerAI/package.json` 确认依赖后添加到 desktop。

### Step 2: 实现认证管理模块

```ts
// apps/desktop/src/main/modules/towerai/auth.ts
import { fetchTowerAIToken } from './sdk/auth';
import { StateStore } from './sdk/state-store';

export interface TowerAICredentials {
  token: string;
  authToken: string;
}

export interface TowerAIAuthState {
  connected: boolean;
  expiresSoon: boolean;
  hasToken: boolean;
  lastRefreshAt?: string;
  loggedIn: boolean;
}

const store = new StateStore<TowerAICredentials & { lastRefresh?: string }>(
  {} as TowerAICredentials,
);

export async function towerAILogin(options: {
  baseUrl?: string;
  oaPassword: string;
  oaUsername: string;
}): Promise<TowerAICredentials> {
  const result = await fetchTowerAIToken({
    baseUrl: options.baseUrl || 'https://tower-ai.yottastudios.com',
    headless: true,
    oaPassword: options.oaPassword,
    oaUsername: options.oaUsername,
    persistToStateDir: undefined,
  });
  store.set({ ...result, lastRefresh: new Date().toISOString() });
  return { authToken: result.authToken || '', token: result.token };
}

export async function getTowerAIToken(): Promise<TowerAICredentials> {
  const state = store.get();
  if (!state.token) throw new Error('Not logged in');
  return { authToken: state.authToken, token: state.token };
}

export function getTowerAIAuthState(): TowerAIAuthState {
  const state = store.get();
  return {
    connected: true,
    expiresSoon: false,
    hasToken: Boolean(state.token),
    lastRefreshAt: state.lastRefresh,
    loggedIn: Boolean(state.token),
  };
}

export function setTowerAIManualToken(token: string, authToken: string): void {
  store.set({ authToken, lastRefresh: new Date().toISOString(), token });
}
```

### Step 3: 实现 IPC handler 入口

```ts
// apps/desktop/src/main/modules/towerai/index.ts
import type { ElectronIPCEventHandler } from '@lobechat/electron-server-ipc';

import { getTowerAIAuthState, getTowerAIToken, setTowerAIManualToken, towerAILogin } from './auth';

export const towerAIIPCHandlers: ElectronIPCEventHandler = {
  'towerai:getState': async () => {
    return getTowerAIAuthState();
  },
  'towerai:getToken': async () => {
    return getTowerAIToken();
  },
  'towerai:login': async (params: { baseUrl?: string; password: string; username: string }) => {
    return towerAILogin({
      baseUrl: params.baseUrl,
      oaPassword: params.password,
      oaUsername: params.username,
    });
  },
  'towerai:setManualToken': async (params: { authToken: string; token: string }) => {
    setTowerAIManualToken(params.token, params.authToken);
    return { ok: true };
  },
};
```

### Step 4: 注册到主进程

查看 `apps/desktop/src/main/core/App.ts` 里 IPC server 的初始化方式（搜索 `ElectronIPCServer`），将 `towerAIIPCHandlers` 合并进去：

```ts
import { towerAIIPCHandlers } from '../modules/towerai';
// 在 eventHandler 合并处添加 ...towerAIIPCHandlers
```

### Step 5: 类型检查

```bash
cd apps/desktop && bunx tsc --noEmit
```

### Step 6: Commit

```bash
git add apps/desktop/src/main/modules/towerai/ apps/desktop/src/main/core/App.ts
git commit -m "feat(desktop): add Tower AI auth IPC module"
```

---

## Task 4: 渲染进程 — IPC 客户端 + 凭证注入

**Files:**

- Create: `src/services/towerai.ts`

渲染进程在发起 Tower AI 请求前，先调 IPC 拿 token，再创建 runtime：

```ts
// src/services/towerai.ts
import { ipcClient } from '@lobechat/electron-client-ipc';

export interface TowerAICredentials {
  authToken: string;
  token: string;
}

export async function getTowerAICredentials(): Promise<TowerAICredentials> {
  return ipcClient.invoke('towerai:getToken');
}

export async function loginToTowerAI(params: {
  baseUrl?: string;
  password: string;
  username: string;
}): Promise<TowerAICredentials> {
  return ipcClient.invoke('towerai:login', params);
}

export async function getTowerAIAuthState() {
  return ipcClient.invoke('towerai:getState');
}

export async function setTowerAIManualToken(token: string, authToken: string) {
  return ipcClient.invoke('towerai:setManualToken', { authToken, token });
}
```

查看 `packages/electron-client-ipc/` 确认 `ipcClient.invoke` 的实际 API，按实际调整。

### Commit

```bash
git add src/services/towerai.ts
git commit -m "feat: add Tower AI IPC client service"
```

---

## Task 5: 设置 UI — Tower AI 提供商配置面板

**Files:**

- Create: `src/features/Provider/TowerAI/index.tsx`（设置面板组件）
- Modify: `src/locales/default/providers.ts`（添加 i18n key）

### Step 1: 参考现有 provider 设置

查看 `src/features/Provider/` 下的某个现有 provider（如 `OpenAI` 或 `Anthropic`）了解组件结构。

### Step 2: 实现配置面板

面板包含：

- 认证模式切换（`账号自动登录` / `手动 Token`）
- **账号模式**：企业邮箱输入、密码输入、"登录" 按钮、连接状态 badge
- **手动模式**：Token 文本框、AuthToken 文本框、"保存" 按钮
- Base URL 输入（默认 `https://tower-ai.yottastudios.com`）

调用 `src/services/towerai.ts` 里的函数。

### Step 3: 注册 provider 配置

在 lobehub 的 provider 配置列表里（搜索 `ProviderConfig` 或 provider 设置的注册点），加入 `towerai`。

### Step 4: 添加 i18n

在 `src/locales/default/providers.ts` 里添加：

```ts
towerai: {
  authMode: {
    account: '账号自动登录',
    manual: '手动 Token',
    title: '认证方式',
  },
  authToken: 'Auth Token',
  baseUrl: '服务地址',
  connected: '已连接',
  login: '登录',
  loginFailed: '登录失败',
  password: '密码',
  token: 'Token',
  username: '企业邮箱',
},
```

同样在 `src/locales/zh-CN/providers.ts` 和 `src/locales/en-US/providers.ts` 添加对应翻译。

### Step 5: Commit

```bash
git add src/features/Provider/TowerAI/ src/locales/
git commit -m "feat: add Tower AI provider settings UI"
```

---

## 验收标准

1. lobehub 设置页出现 Tower AI provider，可切换账号 / 手动两种认证模式
2. 账号模式：填入企业邮箱 + 密码点登录，状态变为 "已连接"
3. 在 `/group` 群组对话里，成员可以选择 Tower AI 的各个模型（GPT-5.4、Claude Sonnet 等）
4. 发送消息后，对应 Tower AI 模型正常响应

---

## 注意事项

- Puppeteer 依赖只在 Electron 主进程中，不会打包进 SPA
- token 过期时（错误码 600015），需在 runtime 层捕获并触发 `towerai:refresh`，可在 Task 3 完成后补充
- TowerAI SDK 的 `src/auth.ts` 使用了 `playwright`，确认 desktop 已有该依赖，否则改用 `puppeteer`
