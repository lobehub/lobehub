/**
 * @vitest-environment happy-dom
 */
import type { IEditor } from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerFocus } from './useComposerFocus';
import { useFollowUpQueue } from './useFollowUpQueue';

const mocks = vi.hoisted(() => {
  const context = { agentId: 'agt_assignee', isolatedTopic: true, scope: 'main', topicId: 'tpc_1' };
  return {
    context,
    conversationState: { context, editor: undefined as unknown },
    queuedCount: 0,
    restoreServerQueue: vi.fn(),
  };
});

vi.mock('@/features/Conversation/ChatInput/useRestoreServerQueue', () => ({
  useRestoreServerQueue: mocks.restoreServerQueue,
}));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: typeof mocks.conversationState) => unknown) =>
    selector(mocks.conversationState),
  useConversationStoreApi: () => ({
    setState: (patch: Partial<typeof mocks.conversationState>) =>
      Object.assign(mocks.conversationState, patch),
  }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: { queuedMessageCount: () => () => mocks.queuedCount },
}));

const editor = { focus: vi.fn() } as unknown as IEditor;
const reveal = vi.fn();

describe('useFollowUpQueue', () => {
  beforeEach(() => {
    mocks.queuedCount = 0;
    mocks.conversationState.editor = undefined;
    mocks.restoreServerQueue.mockClear();
  });

  it('shows the queue and keeps the composer open while a follow-up waits', () => {
    mocks.queuedCount = 1;

    const { result } = renderHook(() =>
      useFollowUpQueue({ editor, enabled: true, expanded: false, reveal }),
    );

    expect(result.current).toEqual({ composerExpanded: true, hasQueuedMessages: true });
  });

  it('hands the drawer editor to the conversation so Edit can refill it', () => {
    renderHook(() => useFollowUpQueue({ editor, enabled: true, expanded: true, reveal }));

    expect(mocks.conversationState.editor).toBe(editor);
  });

  it('restores the follow-ups still queued on the server for this conversation', () => {
    renderHook(() => useFollowUpQueue({ editor, enabled: true, expanded: false, reveal }));

    expect(mocks.restoreServerQueue).toHaveBeenCalledWith(mocks.context, true);
  });

  it('leaves the composer as the user set it when nothing is queued', () => {
    const { result } = renderHook(() =>
      useFollowUpQueue({ editor, enabled: true, expanded: false, reveal }),
    );

    expect(result.current).toEqual({ composerExpanded: false, hasQueuedMessages: false });
  });

  it('keeps the composer open after Edit takes the last queued follow-up out', () => {
    mocks.queuedCount = 1;
    const { result, rerender } = renderHook(() => {
      const focus = useComposerFocus({ defaultExpanded: false, editor });
      return useFollowUpQueue({
        editor,
        enabled: true,
        expanded: focus.expanded,
        reveal: focus.reveal,
      });
    });

    // Edit withdraws the only queued message into the editor.
    mocks.queuedCount = 0;
    rerender();

    expect(result.current).toEqual({ composerExpanded: true, hasQueuedMessages: false });
    expect(editor.focus).not.toHaveBeenCalled();
  });

  it('shows no queue to a viewer who cannot reply', () => {
    mocks.queuedCount = 1;

    const { result } = renderHook(() =>
      useFollowUpQueue({ editor, enabled: false, expanded: false, reveal }),
    );

    expect(result.current).toEqual({ composerExpanded: false, hasQueuedMessages: false });
    expect(mocks.restoreServerQueue).toHaveBeenCalledWith(mocks.context, false);
  });
});
