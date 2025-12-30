# E2E Testing Guide for Claude

本文档记录了在 LobeChat E2E 测试开发中的经验和最佳实践。

## 目录结构

```
e2e/
├── src/
│   ├── features/           # Cucumber feature 文件
│   │   ├── journeys/       # 用户旅程测试
│   │   │   └── agent/      # Agent 相关测试
│   │   ├── discover/       # Discover 页面测试
│   │   └── routes/         # 路由测试
│   ├── steps/              # Step definitions
│   │   ├── agent/          # Agent 相关 steps
│   │   ├── common/         # 通用 steps (auth, navigation)
│   │   └── hooks.ts        # Before/After hooks
│   ├── mocks/              # Mock 框架
│   │   └── llm/            # LLM Mock (拦截 AI 请求)
│   └── support/            # 测试支持文件
│       └── world.ts        # CustomWorld 定义
├── cucumber.config.js      # Cucumber 配置
└── CLAUDE.md               # 本文档
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

LobeChat 使用特定的 SSE 格式，必须严格匹配：

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

### Desktop/Mobile 双组件处理

LobeChat 同时渲染 Desktop 和 Mobile 版本的组件，导致同一个 `data-testid` 可能匹配到多个元素。

**解决方案**: 使用 `boundingBox()` 检测可见的组件：

```typescript
const chatInputs = this.page.locator('[data-testid="chat-input"]');
const count = await chatInputs.count();

let visibleContainer = chatInputs.first();
for (let i = 0; i < count; i++) {
  const elem = chatInputs.nth(i);
  const box = await elem.boundingBox();
  if (box && box.width > 0 && box.height > 0) {
    visibleContainer = elem;
    break;
  }
}
```

### 富文本编辑器 (contenteditable) 输入

LobeChat 使用 `@lobehub/editor` 作为聊天输入框，是一个 contenteditable 的富文本编辑器。

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
