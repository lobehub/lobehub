import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiAgentService } from '@/services/aiAgent';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('../transports/hetero/heterogeneousAgentExecutor', () => ({
  executeHeterogeneousAgent: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

const context = { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: TEST_IDS.TOPIC_ID };
const contextKey = messageMapKey(context);

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  vi.spyOn(aiAgentService, 'listQueuedFollowUps').mockResolvedValue([]);
  useUserStore.setState({ workspaceUserPreference: {} });

  act(() => {
    useChatStore.setState({
      executeClientAgent: vi.fn(),
      executeGatewayAgent: vi.fn(),
      isGatewayModeEnabled: () => false,
      mainInputEditor: null,
      // The run the queue waited behind has just completed.
      operations: {
        'op-done': {
          childOperationIds: [],
          context,
          id: 'op-done',
          metadata: { startTime: 1 },
          status: 'completed',
          type: 'execAgentRuntime',
        },
      } as any,
      operationsByContext: { [contextKey]: ['op-done'] },
      queuedMessages: {
        [contextKey]: [{ content: 'second', createdAt: 2, id: 'queued-2', interruptMode: 'soft' }],
      },
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sendMessage of a queue head (Follow-up behavior: Queue)', () => {
  it('starts its own turn and leaves the rest of the queue behind it', async () => {
    const { result } = renderHook(() => useChatStore());
    const enqueue = vi.spyOn(result.current, 'enqueueMessage');

    await act(async () => {
      await result.current.sendMessage({ context, message: 'first', queueHead: true });
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(useChatStore.getState().queuedMessages[contextKey].map((m) => m.id)).toEqual([
      'queued-2',
    ]);
  });

  it('without the mark, a send behind a waiting queue joins it (legacy behavior)', async () => {
    const { result } = renderHook(() => useChatStore());
    const enqueue = vi.spyOn(result.current, 'enqueueMessage');

    await act(async () => {
      await result.current.sendMessage({ context, message: 'first' });
    });

    expect(enqueue).toHaveBeenCalledWith(
      contextKey,
      expect.objectContaining({ content: 'first' }),
      undefined,
    );
  });
});
