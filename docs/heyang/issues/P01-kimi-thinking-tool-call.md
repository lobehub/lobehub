# P01 Kimi thinking + tool_call 历史消息兼容排查

## 状态

已修复。

## 复现与验证步骤

环境：

- Provider：`newapi`
- Model：`kimi-k2.6`
- Endpoint：`http://172.17.***.60:****/innerapi/newapi/v1/chat/completions`
- Key：已脱敏

最小验证分两类：

1. 第一轮请求开启 `thinking`，带 `tools`，验证 Kimi 会返回 `reasoning_content`。
2. 第二轮请求带历史 `assistant.tool_calls` 和 `tool` 回填，验证历史消息需要被整理成 Kimi 可接受的 OpenAI-compatible 格式。

## 第一轮请求 payload（脱敏）

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Use tool."
    }
  ],
  "model": "kimi-k2.6",
  "stream": true,
  "stream_options": {
    "include_usage": true
  },
  "temperature": 1,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 1024
  },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "testTool",
        "description": "Return a test result",
        "parameters": {
          "type": "object",
          "properties": {},
          "required": []
        }
      }
    }
  ]
}
```

响应观察：

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
delta.reasoning_content: "The ..."
```

结论：Kimi thinking 模式会在响应中产出 `reasoning_content`。

## 第二轮请求 payload（脱敏）

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Use the test tool and then summarize."
    },
    {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "id": "call_test_1",
          "type": "function",
          "function": {
            "name": "testTool",
            "arguments": "{}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_test_1",
      "content": "{ \"ok\": true }"
    },
    {
      "role": "user",
      "content": "Continue. Reply OK only."
    }
  ],
  "model": "kimi-k2.6",
  "stream": false,
  "temperature": 1,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 1024
  },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "testTool",
        "description": "Return a test result",
        "parameters": {
          "type": "object",
          "properties": {},
          "required": []
        }
      }
    }
  ]
}
```

当前网关在直接 HTTP 最小样例下返回 200；用户在 LobeHub Agent 流程中观察到的报错为：

```text
thinking is enabled but reasoning_content is missing in assistant tool call message
```

这说明问题不是网络连通性，而是 LobeHub 内部历史消息和最终 wire payload 的兼容性风险：当上游严格校验 Kimi thinking 历史消息时，`assistant.tool_calls` 历史消息不能缺少需要的 reasoning 字段。

## 根因分析

关键文件：

- `packages/model-runtime/src/core/contextBuilders/openai.ts`
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts`

链路：

```text
RuntimeExecutors 收集 onThinking
  -> state.messages 写入 assistant.reasoning.content
  -> openaiCompatibleFactory 调用 convertOpenAIMessages
  -> convertOpenAIMessages 只对 DeepSeek 从 reasoning.content 回填 reasoning_content
  -> Kimi 历史 assistant.tool_calls 可能只剩 tool_calls，没有 reasoning_content
  -> 如果最终 payload 仍带 thinking，严格网关会拒绝第二轮请求
```

同时，`thinking` 参数来自模型扩展参数解析，最终会进入 OpenAI-compatible payload。对公司 NewAPI 的 `kimi-*` 模型来说，我们当前约定不把 LobeHub 的通用 `thinking` 参数直接透传，而是按普通 OpenAI-compatible 请求发送，避免不同厂商 thinking 协议差异。

## 候选修复方案

方案 A：在 `packages/model-runtime/src/core/contextBuilders/openai.ts` 为 Kimi 增加 DeepSeek 类似逻辑。

- 优点：贴近消息转换位置。
- 缺点：上游高频变动文件，且会把企业 Kimi 兼容逻辑散到通用转换层。

方案 B：在业务层新增 Kimi 兼容函数，并在最终 OpenAI-compatible payload 形成前调用。

- 优点：Kimi 特殊逻辑集中在 `packages/business/heyang/src/kimi-compat.ts`；后续扩展点清楚。
- 缺点：仍需要在 `openaiCompatibleFactory` 接一行调用，因为只有这里同时拿到 provider id、model、provider handlePayload 后的最终 payload。

方案 C：在 Agent Runtime 存储状态时强制写入 `reasoning_content`。

- 优点：第二轮上下文天然带字段。
- 缺点：会污染通用 Agent 状态格式，并影响非 Kimi provider。

## 最终方案

采用方案 B。

新增：

- `packages/business/heyang/src/kimi-compat.ts`
- `packages/business/heyang/src/kimi-compat.test.ts`

行为：

1. `isKimiNewApi(providerId, model)` 只匹配 `provider=newapi` 且 `model` 以 `kimi-` 开头。
2. `applyKimiCompat(payload, providerId)` 对匹配请求执行：
   - 删除顶层 `thinking`。
   - 对 `assistant.tool_calls` 历史消息，如果存在完整 `reasoning.content`，转换为 `reasoning_content`。
   - 移除不完整的 `reasoning_content`，避免空值或非字符串污染请求。
3. 在 `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` 最终 Chat Completions payload 形成处调用。

## 为什么必须触碰高冲突文件

`packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` 是 OpenAI-compatible provider 最终出线口。此处同时拥有：

- runtime provider id：`this.id`
- provider `handlePayload` 后的 payload
- 采样参数清理后的 payload
- `convertOpenAIMessages` 前的历史消息

如果不在这里接入，业务层无法稳定判断 `provider=newapi + model=kimi-*`，也无法覆盖工具回填的第二轮请求。实际改动保持为一处 import 和一处 `applyKimiCompat(...)` 包裹。

## 回归测试

新增：

- `packages/business/heyang/src/kimi-compat.test.ts`

覆盖：

- 只对 NewAPI Kimi 生效。
- Kimi payload 删除 `thinking`。
- `assistant.tool_calls` 历史消息从 `reasoning.content` 回填 `reasoning_content`。
- 空 `reasoning_content` 被移除。
- 非 Kimi payload 保持同一对象引用，不被改写。
