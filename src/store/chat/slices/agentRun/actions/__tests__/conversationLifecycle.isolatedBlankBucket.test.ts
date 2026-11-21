import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { clearBlankConversationBucket } from '../clearBlankBucket';
import { createMockAgentConfig, createMockMessage, TEST_CONTENT, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: { getGeneralAccess: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  useUserStore.setState({ workspaceUserPreference: {} });

  act(() => {
    useChatStore.setState({
      executeClientAgent: vi.fn(),
      mainInputEditor: null,
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const agentId = TEST_IDS.SESSION_ID;
const blankKey = messageMapKey({ agentId, scope: 'main', topicId: null });

describe('isolated sends and the blank conversation bucket', () => {
  it('empties the blank bucket once an isolated send has created its topic', async () => {
    // The Home composer sends with `isolatedTopic` and shows the optimistic pair in
    // the agent's blank bucket. Left there, the next blank send (e.g. a direct
    // @Agent) adopted those rows as its new topic's messages, moving them out of
    // the topic they had just been created in.
    const newTopicId = TEST_IDS.NEW_TOPIC_ID;
    vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
      assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
      isCreateNewTopic: true,
      messages: [
        createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId: newTopicId }),
        createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          topicId: newTopicId,
        }),
      ],
      topicId: newTopicId,
      topics: { items: [{ id: newTopicId, title: 'Server Topic' }], total: 1 },
      userMessageId: TEST_IDS.USER_MESSAGE_ID,
    } as any);
    const onTopicCreated = vi.fn();
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, isNew: true, isolatedTopic: true, scope: 'main' },
        message: TEST_CONTENT.USER_MESSAGE,
        onTopicCreated,
      });
    });

    expect(onTopicCreated).toHaveBeenCalledWith(newTopicId);
    expect(useChatStore.getState().dbMessagesMap[blankKey] ?? []).toEqual([]);
    expect(
      useChatStore.getState().dbMessagesMap[messageMapKey({ agentId, topicId: newTopicId })],
    ).toHaveLength(2);
  });

  it('clears only the blank bucket of the conversation the send came from', () => {
    const topicKey = messageMapKey({ agentId, topicId: TEST_IDS.TOPIC_ID });
    const leftover = createMockMessage({ id: 'leftover', role: 'user' });
    const kept = createMockMessage({ id: 'kept', role: 'user', topicId: TEST_IDS.TOPIC_ID });
    act(() => {
      useChatStore.setState({
        dbMessagesMap: { [blankKey]: [leftover], [topicKey]: [kept] },
        messagesMap: { [blankKey]: [leftover], [topicKey]: [kept] },
      });
    });

    act(() => clearBlankConversationBucket(useChatStore.getState, { agentId, scope: 'main' }));

    expect(useChatStore.getState().dbMessagesMap[blankKey]).toEqual([]);
    expect(useChatStore.getState().dbMessagesMap[topicKey]).toHaveLength(1);
  });
});
