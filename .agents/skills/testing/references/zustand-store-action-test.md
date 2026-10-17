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
      internal_coreProcessMessage: vi.fn(),
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
// ✅ Good: Spy on direct dependency
const fetchAIChatSpy = vi.spyOn(result.current, 'internal_fetchAIChatMessage')
  .mockResolvedValue({ isFunctionCall: false, content: 'AI response' });

// ❌ Bad: Spy on lower-level implementation
const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream')
  .mockImplementation(...);
```

### 2. Minimize Global Spies

```typescript
// ✅ Spy only when needed
it('should process message', async () => {
  const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream')
    .mockImplementation(...);
  // test logic
  streamSpy.mockRestore();
});

// ❌ Don't setup all spies globally
beforeEach(() => {
  vi.spyOn(chatService, 'createAssistantMessageStream').mockResolvedValue({});
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

## Streaming Response Mock

```typescript
it('should handle streaming chunks', async () => {
  const { result } = renderHook(() => useChatStore());

  const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream')
    .mockImplementation(async ({ onMessageHandle, onFinish }) => {
      await onMessageHandle?.({ type: 'text', text: 'Hello' } as any);
      await onMessageHandle?.({ type: 'text', text: ' World' } as any);
      await onFinish?.('Hello World', {});
    });

  await act(async () => {
    await result.current.internal_fetchAIChatMessage({...});
  });

  streamSpy.mockRestore();
});
```

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
