/**
 * @vitest-environment happy-dom
 */
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { type Cache, SWRConfig, unstable_serialize } from 'swr';
import { beforeEach, describe, expect, it } from 'vitest';

import { messageListKey } from '@/services/message/cache';
import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useHydratedConversationMessages } from './useHydratedConversationMessages';

const context: ConversationContext = {
  agentId: 'agent-1',
  scope: 'main',
  threadId: null,
  topicId: 'topic-1',
};
const hydratedMessages = [{ content: 'cached', id: 'cached', role: 'user' }] as UIChatMessage[];
const liveMessages = [{ content: 'streaming', id: 'live', role: 'assistant' }] as UIChatMessage[];

const createWrapper = () => {
  const cache = new Map([
    [unstable_serialize(messageListKey(context)), { data: hydratedMessages }],
  ]);

  return ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => cache as unknown as Cache } }, children);
};

describe('useHydratedConversationMessages', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState }, false);
  });

  it('returns the hydrated SWR snapshot before ChatStore has projected it', () => {
    const { result } = renderHook(() => useHydratedConversationMessages(context), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBe(hydratedMessages);
  });

  it('prefers live ChatStore messages over persisted cache data', () => {
    useChatStore.setState({
      dbMessagesMap: { [messageMapKey(context)]: liveMessages },
    });

    const { result } = renderHook(() => useHydratedConversationMessages(context), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBe(liveMessages);
  });
});
