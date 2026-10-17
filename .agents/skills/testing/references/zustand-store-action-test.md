# Zustand Store Action Testing Guide

## Basic Structure

```typescript
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../../store';

vi.mock('zustand/traditional');

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState(
    {
      activeId: 'test-session-id',
      messagesMap: {},
      loadingIds: [],
    },
    false,
  );

  vi.spyOn(messageService, 'createMessage').mockResolvedValue('new-message-id');

  act(() => {
    useChatStore.setState({
      refreshMessages: vi.fn(),
      executeGatewayAgent: vi.fn().mockResolvedValue({ operationId: 'gateway-op' }),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

## Key Principles

### 1. Spy Direct Dependencies Only

```typescript
// ✅ Good: stub the store action the code under test calls directly.
// `sendMessage` hands every agent run to `executeGatewayAgent`.
const executeGatewayAgent = vi.fn().mockResolvedValue({ operationId: 'gateway-op' });
act(() => {
  useChatStore.setState({ executeGatewayAgent, isGatewayModeEnabled: () => true });
});

// ❌ Bad: mock what sits below it (the tRPC service, the WebSocket client)
vi.spyOn(aiAgentService, 'execAgentTask').mockImplementation(...);
```

### 2. Minimize Global Spies

```typescript
// ✅ Spy only when needed
it('should start a gateway run', async () => {
  const execSpy = vi.spyOn(aiAgentService, 'execAgentTask').mockResolvedValue(...);
  // test logic
  execSpy.mockRestore();
});

// ❌ Don't setup all spies globally
beforeEach(() => {
  vi.spyOn(aiAgentService, 'execAgentTask').mockResolvedValue({} as any);
  vi.spyOn(fileService, 'uploadFile').mockResolvedValue({});
});
```

### 3. Use act() for Async Operations

```typescript
it('should send message', async () => {
  const { result } = renderHook(() => useChatStore());

  await act(async () => {
    await result.current.sendMessage({ message: 'Hello' });
  });

  expect(messageService.createMessage).toHaveBeenCalled();
});
```

### 4. Test Organization

```typescript
describe('sendMessage', () => {
  describe('validation', () => {
    it('should not send when session is inactive');
    it('should not send when message is empty');
  });
  describe('message creation', () => {
    it('should create user message and trigger AI processing');
  });
  describe('error handling', () => {
    it('should handle message creation errors gracefully');
  });
});
```

## Agent Run Mock (gateway)

Every agent run executes on the server and streams back over the Agent Gateway, so a
chat-store test stubs `executeGatewayAgent` at the store boundary. Keep the stub true to
the contract the caller relies on: complete the parent operation and echo the client ids.

```typescript
const mockGatewayAgent = (impl?: (params: any) => Promise<any>) => {
  const executeGatewayAgent = vi.fn(
    impl ??
      (async (params: any) => {
        useChatStore.getState().completeOperation(params.parentOperationId);
        return {
          assistantMessageId: params.clientIds.assistantMessageId,
          operationId: 'gateway-op',
          topicId: params.clientIds.topicId ?? params.context.topicId ?? undefined,
          userMessageId: params.clientIds.userMessageId,
        };
      }),
  );
  act(() => {
    useChatStore.setState({ executeGatewayAgent, isGatewayModeEnabled: () => true });
  });
  return executeGatewayAgent;
};

it('hands the turn to the gateway', async () => {
  const { result } = renderHook(() => useChatStore());
  const executeGatewayAgent = mockGatewayAgent();

  await act(async () => {
    await result.current.sendMessage({ message: 'Hello', context: { agentId, topicId: null } });
  });

  expect(executeGatewayAgent).toHaveBeenCalledOnce();
});
```

- Full helper: `mockGatewayAgent` in `src/store/chat/slices/agentRun/actions/__tests__/conversationLifecycle.test.ts`
- Streamed events (text chunks, tool calls, `uiMessages` snapshots) are handled by the gateway
  transport; test that layer in `src/store/chat/slices/agentRun/actions/__tests__/gateway.test.ts`
  by feeding events, not by mocking an LLM stream in the browser

## Fetch Hook Testing

### Replica-backed hooks (`useFetch*` over `@lobechat/replica`)

A replica hook returns sync flags plus a `queryKey`; the data lives in the store and is read through selectors. The engine is what the test exercises, so the SWR driver is a bare recorder: capture the registered sync, run its fetcher, fold the response through `onSuccess`, then read it back with the selector.

```typescript
vi.mock('@/services/discover', () => ({
  discoverService: { getPluginCategories: vi.fn() },
}));

// The replica schedules its fetches through the app's SWR driver.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const syncCalls = async (name: string) => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([, fetcher, config]) => ({
      config: config as { onSuccess?: (data: unknown) => void },
      fetcher: fetcher as () => Promise<any>,
    }));
};

it('folds the categories into the replica view the selectors read', async () => {
  const mockData = [{ category: 'tools', count: 1 }];
  vi.mocked(discoverService.getPluginCategories).mockResolvedValue(mockData as any);

  const { result } = renderHook(() => useStore.getState().useFetchPluginCategories({ q: 'x' }));
  const [call] = await syncCalls('pluginCategories');
  const fetched = await call.fetcher();
  act(() => call.config.onSuccess!(fetched));

  expect(pluginSelectors.pluginCategories(result.current.queryKey)(useStore.getState())).toEqual(
    mockData,
  );
});
```

**Key points for replica hooks:**

- Assert on the store through selectors, not on a hook-returned `data`
- Assert the sync options that matter (e.g. `config.revalidateOnFocus`) on the recorded call
- See `src/store/discover/slices/*/action.test.ts` for full examples

### Plain SWR hooks

```typescript
it('should fetch data', async () => {
  const mockData = [{ id: '1', name: 'Item 1' }];
  vi.spyOn(someService, 'getItems').mockResolvedValue(mockData);

  const { result } = renderHook(() => useStore.getState().useFetchItems(params));

  await waitFor(() => {
    expect(result.current.data).toEqual(mockData);
  });
});
```

**Key points for SWR:**

- DO NOT mock useSWR - let it use real implementation
- Only mock service methods (fetchers)
- Use `waitFor` for async operations

## Anti-Patterns

```typescript
// ❌ Don't mock entire store
vi.mock('../../store', () => ({ useChatStore: vi.fn(() => ({...})) }));

// ❌ Don't test internal state structure
expect(result.current.messagesMap).toHaveProperty('test-session');

// ✅ Test behavior instead
expect(result.current.refreshMessages).toHaveBeenCalled();
```
