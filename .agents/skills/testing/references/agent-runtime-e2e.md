# Agent Runtime E2E Testing Guide

## Core Principles

### Minimal Mock Principle

Only mock **three external dependencies**:

| Dependency | Mock                       | Description                                             |
| ---------- | -------------------------- | ------------------------------------------------------- |
| Database   | PGLite                     | In-memory database from `@lobechat/database/test-utils` |
| Redis      | InMemoryAgentStateManager  | Memory implementation                                   |
| Redis      | InMemoryStreamEventManager | Memory implementation                                   |

**NOT mocked:**

- `model-bank` - Uses real model config
- `Mecha` (AgentToolsEngine, ContextEngineering)
- `AgentRuntimeService`
- `AgentRuntimeCoordinator`

### Use vi.spyOn, not vi.mock

Different tests need different LLM responses. `vi.spyOn` provides:

- Flexible return values per test
- Easy testing of different scenarios
- Better test isolation

### Default Model: gpt-5

- Always available in `model-bank`
- Stable across model updates

## Technical Implementation

### Database Setup

```typescript
import { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';

let testDB: LobeChatDatabase;

beforeEach(async () => {
  testDB = await getTestDB();
});
```

### OpenAI Stream Response Helper

```typescript
export const createOpenAIStreamResponse = (options: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: 'stop' | 'tool_calls';
}) => {
  const { content, toolCalls, finishReason = 'stop' } = options;

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        if (content) {
          const chunk = {
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            model: 'gpt-5',
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }

        // ... tool_calls handling
        // ... finish chunk
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};
```

### State Management

```typescript
import {
  InMemoryAgentStateManager,
  InMemoryStreamEventManager,
} from '@/server/modules/AgentRuntime';

const stateManager = new InMemoryAgentStateManager();
const streamEventManager = new InMemoryStreamEventManager();

const service = new AgentRuntimeService(serverDB, userId, {
  coordinatorOptions: { stateManager, streamEventManager },
  queueService: null,
  streamEventManager,
});
```

### Mock OpenAI API

```typescript
const fetchSpy = vi.spyOn(globalThis, 'fetch');

it('should handle text response', async () => {
  fetchSpy.mockResolvedValueOnce(createOpenAIStreamResponse({ content: 'Response text' }));
  // ... execute test
});

it('should handle tool calls', async () => {
  fetchSpy.mockResolvedValueOnce(
    createOpenAIStreamResponse({
      toolCalls: [
        {
          id: 'call_123',
          name: 'lobe-web-browsing____search____builtin',
          arguments: JSON.stringify({ query: 'weather' }),
        },
      ],
      finishReason: 'tool_calls',
    }),
  );
  // ... execute test
});
```

## Notes

1. **Test isolation**: Clean `InMemoryAgentStateManager` and `InMemoryStreamEventManager` after each test
2. **Timeout**: E2E tests may need longer timeouts
3. **Debug**: Use `DEBUG=lobe-server:*` for detailed logs
