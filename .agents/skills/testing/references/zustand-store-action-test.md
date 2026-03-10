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

## SWR Hook Testing

```typescript
it('should fetch data', async () => {
  const mockData = [{ id: '1', name: 'Item 1' }];
  vi.spyOn(discoverService, 'getPluginCategories').mockResolvedValue(mockData);

  const { result } = renderHook(() => useStore.getState().usePluginCategories(params));

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
