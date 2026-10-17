import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { getSessionStoreState } from '@/store/session';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, createMockMessage, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } } },
}));

const context = { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: TEST_IDS.TOPIC_ID };

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gateway send: user message parent', () => {
  // LOBE-14875: the server anchored gateway turns on the newest row, which after
  // a regenerate can sit on a branch the user is not viewing. The client must
  // tell the server which branch tail it renders the new turn under.
  it('sends the tail of the branch on screen, not the newest branch', async () => {
    const { result } = renderHook(() => useChatStore());
    const executeGatewayAgent = vi.fn().mockResolvedValue({
      assistantMessageId: 'msg_assistant',
      operationId: 'op_gateway',
      topicId: TEST_IDS.TOPIC_ID,
      userMessageId: 'msg_user',
    });

    act(() => {
      useChatStore.setState({ executeGatewayAgent, isGatewayModeEnabled: () => true });
      // Raw rows, so the store derives the rendered branch from
      // `activeBranchIndex` exactly as it does for a fetched topic.
      useChatStore.getState().replaceMessages(
        [
          createMockMessage({
            content: 'question',
            createdAt: 1,
            id: 'msg_question',
            metadata: { activeBranchIndex: 0 },
            role: 'user',
          }),
          createMockMessage({
            content: 'selected answer',
            createdAt: 2,
            id: 'msg_selected_answer',
            parentId: 'msg_question',
            role: 'assistant',
          }),
          createMockMessage({
            content: 'regenerated answer',
            createdAt: 3,
            id: 'msg_regenerated_answer',
            parentId: 'msg_question',
            role: 'assistant',
          }),
        ],
        { context },
      );
    });

    await act(async () => {
      await result.current.sendMessage({ context, message: 'follow up' });
    });

    await waitFor(() => expect(executeGatewayAgent).toHaveBeenCalledOnce());
    expect(executeGatewayAgent.mock.calls[0][0].clientIds).toMatchObject({
      userMessageParentId: 'msg_selected_answer',
    });
  });
});
