import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

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

describe('sendMessage optimistic attachments', () => {
  it('renders every attached file on the sent bubble before the server answers', async () => {
    const { result } = renderHook(() => useChatStore());
    const agentId = TEST_IDS.SESSION_ID;
    const topicId = TEST_IDS.TOPIC_ID;
    const key = messageMapKey({ agentId, topicId });
    act(() => {
      useChatStore.setState({ activeAgentId: agentId, activeTopicId: topicId });
    });
    // The send is still in flight: the bubble must already show the files.
    let releaseServer!: () => void;
    vi.spyOn(aiChatService, 'sendMessageInServer').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseServer = () => resolve(undefined as any);
        }),
    );
    const zip = (id: string, name: string, size: number) =>
      ({
        file: Object.defineProperty(new File([], name, { type: 'application/zip' }), 'size', {
          value: size,
        }),
        fileUrl: `https://example.com/${id}.zip`,
        id,
        status: 'success',
      }) as any;

    let sending!: Promise<unknown>;
    act(() => {
      sending = result.current.sendMessage({
        context: { agentId, threadId: null, topicId },
        files: [
          zip('file-twitter', 'Twitter 配图.zip', 175_000_000),
          zip('file-site', '官网与文章配图.zip', 177_500_000),
          zip('file-mail', '邮件配图.zip', 6_400_000),
        ],
        message: '好，都给你',
      });
    });

    await waitFor(() => {
      const userMessage = useChatStore
        .getState()
        .dbMessagesMap[key]?.find((message) => message.role === 'user');
      expect(userMessage?.fileList).toEqual([
        expect.objectContaining({
          fileType: 'application/zip',
          id: 'file-twitter',
          name: 'Twitter 配图.zip',
          size: 175_000_000,
        }),
        expect.objectContaining({
          id: 'file-site',
          name: '官网与文章配图.zip',
          size: 177_500_000,
        }),
        expect.objectContaining({ id: 'file-mail', name: '邮件配图.zip', size: 6_400_000 }),
      ]);
    });

    await act(async () => {
      releaseServer();
      await sending;
    });
  });
});
