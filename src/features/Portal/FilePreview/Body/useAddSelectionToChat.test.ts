import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';

import { useAddSelectionToChat } from './useAddSelectionToChat';

const file = { fileId: 'file_abc', name: 'paper.pdf' };
const selection = { content: 'Table 2: ablation results', pageRange: { startPage: 3 } };
const conversationKey = messageMapKey({ agentId: 'agt_1', topicId: 'tpc_1' });

beforeEach(() => {
  useChatStore.setState({ activeAgentId: 'agt_1', activeTopicId: 'tpc_1' });
  useChatStore.getState().clearPortalStack();
});

describe('useAddSelectionToChat', () => {
  it('adds the selection to the active conversation composer with its file and page', () => {
    useChatStore.getState().openFilePreview({ fileId: file.fileId });
    const { result } = renderHook(() => useAddSelectionToChat(file));

    act(() => result.current?.(selection));

    expect(useFileStore.getState().chatContextSelectionsByContext[conversationKey]).toEqual([
      expect.objectContaining({
        content: 'Table 2: ablation results',
        fileId: 'file_abc',
        pageRange: { startPage: 3 },
        source: 'file',
        title: 'paper.pdf',
        type: 'text',
      }),
    ]);
  });

  it('offers nothing for a preview opened from an isolated topic', () => {
    useChatStore.getState().openFilePreview({ fileId: file.fileId }, { sourceTopicId: 'tpc_task' });
    const { result } = renderHook(() => useAddSelectionToChat(file));

    expect(result.current).toBeUndefined();
  });

  it('offers nothing without a stored file or an active agent', () => {
    useChatStore.getState().openFilePreview({ fileId: file.fileId });
    expect(renderHook(() => useAddSelectionToChat(undefined)).result.current).toBeUndefined();

    useChatStore.setState({ activeAgentId: '' });
    expect(renderHook(() => useAddSelectionToChat(file)).result.current).toBeUndefined();
  });
});
