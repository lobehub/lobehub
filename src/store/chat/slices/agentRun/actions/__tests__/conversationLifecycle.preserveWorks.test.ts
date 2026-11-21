import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
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

describe('sendMessage server response', () => {
  it('keeps the Work summaries of earlier replies that the send response omits', async () => {
    const agentId = TEST_IDS.SESSION_ID;
    const topicId = TEST_IDS.TOPIC_ID;
    const works = [{ event: { version: 1 }, id: 'work-1', resourceId: 'cvs_1', type: 'canvas' }];
    const earlierReply = createMockMessage({ id: 'earlier-reply', role: 'assistant', topicId });
    const key = messageMapKey({ agentId, topicId });

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: topicId,
        dbMessagesMap: { [key]: [{ ...earlierReply, works } as any] },
        messagesMap: { [key]: [{ ...earlierReply, works } as any] },
      });
    });

    vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
      assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
      messages: [
        earlierReply,
        createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          parentId: earlierReply.id,
          role: 'user',
          topicId,
        }),
        createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          topicId,
        }),
      ],
      topicId,
      userMessageId: TEST_IDS.USER_MESSAGE_ID,
    } as any);

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId },
        message: TEST_CONTENT.USER_MESSAGE,
      });
    });

    const stored = useChatStore.getState().dbMessagesMap[key];
    expect(stored.find((message) => message.id === earlierReply.id)?.works).toEqual(works);
  });
});
