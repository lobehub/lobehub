import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRestoreServerQueue } from './useRestoreServerQueue';

const { restoreServerQueuedMessages } = vi.hoisted(() => ({
  restoreServerQueuedMessages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/chat/slices/agentRun/actions/transports/gateway/serverSteerQueue', () => ({
  restoreServerQueuedMessages,
}));

describe('useRestoreServerQueue', () => {
  beforeEach(() => restoreServerQueuedMessages.mockClear());

  // ROOT CAUSE:
  //
  // Reconnecting to a running operation was the only path that read the
  // server queue back. Follow-ups that went back to the queue after their
  // next turn failed to start sat behind an idle topic, which never showed
  // them when reopened.
  //
  // Before: only a reconnect restored them.
  // After: opening the conversation does too.
  it('reads the server queue back when a conversation opens, once per conversation', () => {
    const context = { agentId: 'agt-1', topicId: 'tpc-1' };
    const { rerender } = renderHook(({ ctx }) => useRestoreServerQueue(ctx, true), {
      initialProps: { ctx: context },
    });
    rerender({ ctx: { ...context } });
    expect(restoreServerQueuedMessages).toHaveBeenCalledTimes(1);
    expect(restoreServerQueuedMessages).toHaveBeenCalledWith(expect.any(Function), context);

    rerender({ ctx: { ...context, topicId: 'tpc-2' } });
    expect(restoreServerQueuedMessages).toHaveBeenCalledTimes(2);
  });

  it('skips threads, new conversations and surfaces without a queue', () => {
    renderHook(() =>
      useRestoreServerQueue({ agentId: 'agt-1', threadId: 'thd-1', topicId: 'tpc-1' }, true),
    );
    renderHook(() => useRestoreServerQueue({ agentId: 'agt-1', topicId: null }, true));
    renderHook(() => useRestoreServerQueue({ agentId: 'agt-1', topicId: 'tpc-1' }, false));
    expect(restoreServerQueuedMessages).not.toHaveBeenCalled();
  });
});
