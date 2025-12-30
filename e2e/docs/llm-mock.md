# LLM Mock 实现

## 核心原理

LLM Mock 通过 Playwright 的 `page.route()` 拦截对 `/webapi/chat/openai` 的请求，返回预设的 SSE 流式响应。

## SSE 响应格式

LobeHub 使用特定的 SSE 格式，必须严格匹配：

```
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

## 使用示例

```typescript
import { llmMockManager, presetResponses } from '../../mocks/llm';

// 在测试步骤中设置 mock
llmMockManager.setResponse('hello', presetResponses.greeting);
await llmMockManager.setup(this.page);
```

## 添加自定义响应

```typescript
// 为特定用户消息设置响应
llmMockManager.setResponse('你好', '你好！我是 Lobe AI，有什么可以帮助你的？');

// 清除所有自定义响应
llmMockManager.clearResponses();
```

## 常见问题

### LLM Mock 未生效

**原因**: 路由拦截设置在页面导航之后

**解决**: 确保在 `page.goto()` 之前调用 `llmMockManager.setup(page)`
