import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRetryParentMessage } from './useRetryParentMessage';

const storeMock = vi.hoisted(() => ({
  displayMessages: [] as { id: string; parentId?: string }[],
  regenerateUserMessage: vi.fn(async (_id: string) => {}),
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (
    selector: (state: {
      displayMessages: { id: string; parentId?: string }[];
      regenerateUserMessage: typeof storeMock.regenerateUserMessage;
    }) => unknown,
  ) =>
    selector({
      displayMessages: storeMock.displayMessages,
      regenerateUserMessage: storeMock.regenerateUserMessage,
    }),
}));

describe('useRetryParentMessage', () => {
  beforeEach(() => {
    storeMock.displayMessages = [{ id: 'assistant-message', parentId: 'user-message' }];
    storeMock.regenerateUserMessage.mockClear();
  });

  it('should retry the parent message', async () => {
    const { result } = renderHook(() => useRetryParentMessage('assistant-message'));

    await act(async () => {
      await result.current.retryParentMessage();
    });

    expect(result.current.disabled).toBe(false);
    expect(storeMock.regenerateUserMessage).toHaveBeenCalledWith('user-message');
  });

  it('should run the pre-retry action before regenerating the parent message', async () => {
    const calls: string[] = [];
    const beforeRetry = vi.fn(async () => {
      calls.push('before');
    });
    storeMock.regenerateUserMessage.mockImplementationOnce(async () => {
      calls.push('regenerate');
    });

    const { result } = renderHook(() => useRetryParentMessage('assistant-message'));

    await act(async () => {
      await result.current.retryParentMessage(beforeRetry);
    });

    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['before', 'regenerate']);
  });

  it('should skip retry when the message has no parent', async () => {
    storeMock.displayMessages = [{ id: 'assistant-message' }];
    const { result } = renderHook(() => useRetryParentMessage('assistant-message'));

    await act(async () => {
      await result.current.retryParentMessage();
    });

    expect(result.current.disabled).toBe(true);
    expect(storeMock.regenerateUserMessage).not.toHaveBeenCalled();
  });
});
