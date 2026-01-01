# E2E Testing Guide for Claude

本文档记录了在 LobeHub E2E 测试开发中的经验和最佳实践。

Related: [LOBE-2417](https://linear.app/lobehub/issue/LOBE-2417/建立核心产品功能-e2e-测试体验基准线)

## 测试策略：体验驱动的 E2E 测试

### 核心理念

建立完整的**用户体验链路 E2E 测试**，作为未来变更和重构的**体验基准线**。

**目的**：

- 确保核心用户体验在代码变更后不会退化
- 为重构提供安全网，敢于大胆改进代码
- 从用户视角验证功能完整性

### 产品架构覆盖

| 模块             | 子功能               | 优先级 | 状态 |
| ---------------- | -------------------- | ------ | ---- |
| **Agent**        | Builder, 对话，Task  | P0     | 🚧   |
| **Agent Group**  | Builder, 群聊        | P1     | ⏳   |
| **Page（文稿）** | 创建，编辑，分享     | P1     | ⏳   |
| **知识库**       | 创建，上传，RAG 对话 | P1     | ⏳   |
| **记忆**         | 查看，编辑，关联     | P2     | ⏳   |

### 标签系统

```gherkin
@journey      # 用户旅程测试（体验基准线）
@smoke        # 冒烟测试（快速验证）
@regression   # 回归测试

@P0           # 最高优先级（CI 必跑）
@P1           # 高优先级（Nightly）
@P2           # 中优先级（发版前）

@agent        # Agent 模块
@agent-group  # Agent Group 模块
@page         # Page 文稿模块
@knowledge    # 知识库模块
@memory       # 记忆模块
```

### 执行策略

```bash
# CI - P0 冒烟测试（每次 PR）
pnpm exec cucumber-js --config cucumber.config.js --tags "@smoke and @P0"

# Nightly - 所有用户旅程
pnpm exec cucumber-js --config cucumber.config.js --tags "@journey"

# 发版前 - 完整回归
pnpm exec cucumber-js --config cucumber.config.js --tags "@P0 or @P1"

# 完整测试
pnpm exec cucumber-js --config cucumber.config.js
```

### 测试设计原则

1. **按 CRUD + 核心交互覆盖**：每个模块覆盖创建、读取、更新、删除及核心交互流程
2. **LLM 响应必须 Mock**：保证测试稳定性和可重复性
3. **中文描述场景**：Feature 文件使用中文，贴近产品需求
4. **优先级分层**：合理分配 P0/P1/P2，控制 CI 执行时间

## 目录结构

```
e2e/
├── src/
│   ├── features/                    # Cucumber feature 文件
│   │   ├── journeys/                # 用户旅程（体验基准线）
│   │   │   ├── agent/
│   │   │   │   ├── agent-builder.feature
│   │   │   │   ├── agent-conversation.feature  ✅
│   │   │   │   └── agent-task.feature
│   │   │   ├── agent-group/
│   │   │   │   ├── group-builder.feature
│   │   │   │   └── group-chat.feature
│   │   │   ├── page/
│   │   │   │   └── page-crud.feature
│   │   │   ├── knowledge/
│   │   │   │   └── knowledge-rag.feature
│   │   │   └── memory/
│   │   │       └── memory-crud.feature
│   │   ├── smoke/                   # 冒烟测试
│   │   │   └── discover/
│   │   └── regression/              # 回归测试
│   ├── steps/                       # Step definitions
│   │   ├── agent/                   # Agent 相关 steps
│   │   ├── common/                  # 通用 steps (auth, navigation)
│   │   └── hooks.ts                 # Before/After hooks
│   ├── mocks/                       # Mock 框架
│   │   └── llm/                     # LLM Mock (拦截 AI 请求) ✅
│   └── support/                     # 测试支持文件
│       └── world.ts                 # CustomWorld 定义
├── screenshots/                     # 失败截图
├── reports/                         # 测试报告
├── cucumber.config.js               # Cucumber 配置
└── CLAUDE.md                        # 本文档
```

## 运行测试

```bash
# 从 e2e 目录运行
cd e2e

# 运行特定标签的测试
HEADLESS=false BASE_URL=http://localhost:3010 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@AGENT-CHAT-001"

# 运行所有测试
pnpm exec cucumber-js --config cucumber.config.js
```

**重要**: 必须显式指定 `--config cucumber.config.js`，否则配置不会被正确加载。

## LLM Mock 实现

### 核心原理

LLM Mock 通过 Playwright 的 `page.route()` 拦截对 `/webapi/chat/openai` 的请求，返回预设的 SSE 流式响应。

### SSE 响应格式

LobeHub 使用特定的 SSE 格式，必须严格匹配：

```typescript
// 1. 初始 data 事件
id: msg_xxx
event: data
data: {"id":"msg_xxx","model":"gpt-4o-mini","role":"assistant","type":"message",...}

// 2. 文本内容分块（text 事件）
id: msg_xxx
event: text
data: "Hello"

id: msg_xxx
event: text
data: "! I am"

// 3. 停止事件
id: msg_xxx
event: stop
data: "end_turn"

// 4. 使用量统计
id: msg_xxx
event: usage
data: {"totalTokens":100,...}

// 5. 最终停止
id: msg_xxx
event: stop
data: "message_stop"
```

### 使用示例

```typescript
import { llmMockManager, presetResponses } from '../../mocks/llm';

// 在测试步骤中设置 mock
llmMockManager.setResponse('hello', presetResponses.greeting);
await llmMockManager.setup(this.page);
```

### 添加自定义响应

```typescript
// 为特定用户消息设置响应
llmMockManager.setResponse('你好', '你好！我是 Lobe AI，有什么可以帮助你的？');

// 清除所有自定义响应
llmMockManager.clearResponses();
```

## 页面元素定位技巧

### 富文本编辑器 (contenteditable) 输入

LobeHub 使用 `@lobehub/editor` 作为聊天输入框，是一个 contenteditable 的富文本编辑器。

**关键点**:

1. 不能直接用 `locator.fill()` - 对 contenteditable 不生效
2. 需要先 click 容器让编辑器获得焦点
3. 使用 `keyboard.type()` 输入文本

```typescript
// 正确的输入方式
await chatInputContainer.click();
await this.page.waitForTimeout(500); // 等待焦点
await this.page.keyboard.type(message, { delay: 30 });
await this.page.keyboard.press('Enter'); // 发送
```

### 添加 data-testid

为了更可靠的元素定位，可以在组件上添加 `data-testid`：

```tsx
// src/features/ChatInput/Desktop/index.tsx
<ChatInput
  data-testid="chat-input"
  ...
/>
```

## 调试技巧

### 添加步骤日志

在每个关键步骤添加 console.log，帮助定位问题：

```typescript
Given('用户进入页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 导航到首页...');
  await this.page.goto('/');

  console.log('   📍 Step: 查找元素...');
  const element = this.page.locator('...');

  console.log('   ✅ 步骤完成');
});
```

### 查看失败截图

测试失败时会自动保存截图到 `e2e/screenshots/` 目录。

### 非 headless 模式

设置 `HEADLESS=false` 可以看到浏览器操作：

```bash
HEADLESS=false pnpm exec cucumber-js --config cucumber.config.js --tags "@smoke"
```

## 环境变量

运行测试需要以下环境变量：

```bash
BASE_URL=http://localhost:3010   # 测试服务器地址
DATABASE_URL=postgresql://...    # 数据库连接
DATABASE_DRIVER=node             # 数据库驱动
KEY_VAULTS_SECRET=...            # 密钥
BETTER_AUTH_SECRET=...           # Auth 密钥
NEXT_PUBLIC_ENABLE_BETTER_AUTH=1 # 启用 Better Auth

# 可选：S3 相关（如果测试涉及文件上传）
S3_ACCESS_KEY_ID=e2e-mock-access-key
S3_SECRET_ACCESS_KEY=e2e-mock-secret-key
S3_BUCKET=e2e-mock-bucket
S3_ENDPOINT=https://e2e-mock-s3.localhost
```

## 常见问题

### 1. 测试超时 (function timed out)

**原因**: 元素定位失败或等待时间不足

**解决**:

- 检查选择器是否正确
- 增加 timeout 参数
- 添加显式等待 `waitForTimeout()`

### 2. strict mode violation (多个元素匹配)

**原因**: 选择器匹配到多个元素（如 desktop/mobile 双组件）

**解决**:

- 使用 `.first()` 或 `.nth(n)`
- 使用 `boundingBox()` 过滤可见元素

### 3. LLM Mock 未生效

**原因**: 路由拦截设置在页面导航之后

**解决**: 确保在 `page.goto()` 之前调用 `llmMockManager.setup(page)`

### 4. 输入框内容为空

**原因**: contenteditable 编辑器的特殊性

**解决**:

- 先 click 容器确保焦点
- 使用 `keyboard.type()` 而非 `fill()`
- 添加适当的等待时间

## 编写新测试的流程

1. **创建 Feature 文件** (`src/features/xxx/xxx.feature`)
   - 使用中文描述场景
   - 添加适当的标签 (@journey, @P0, @smoke 等)

2. **创建 Step Definitions** (`src/steps/xxx/xxx.steps.ts`)
   - 导入必要的 mock 和工具
   - 每个步骤添加日志
   - 处理元素定位的边界情况

3. **设置 Mock**（如需要）
   - 在 `src/mocks/` 下创建对应的 mock
   - 在步骤中初始化 mock

4. **调试和验证**
   - 先用 `HEADLESS=false` 运行观察
   - 检查失败截图
   - 确保稳定通过后再提交
