import * as agentRuntime from '@lobechat/agent-runtime';
import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { workService } from '@/services/work';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { TEST_CONTENT, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

const mode = vi.hoisted(() => ({ value: 'steer' as 'queue' | 'steer' }));
vi.mock('../lifecycle/followUpMode', () => ({ getFollowUpMode: () => mode.value }));
vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

const realExecAgentRuntime = useChatStore.getState().executeClientAgent;
const context = { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID };
const userMessage = {
  content: TEST_CONTENT.USER_MESSAGE,
  id: TEST_IDS.USER_MESSAGE_ID,
  role: 'user',
  sessionId: TEST_IDS.SESSION_ID,
  topicId: TEST_IDS.TOPIC_ID,
} as UIChatMessage;

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(workService, 'listByRootOperation').mockResolvedValue([]);
  vi.spyOn(chatService, 'buildAssistantMessageContext').mockImplementation(
    async (params, options) => ({
      options: options ?? {},
      params: { ...params, messages: params.messages as any } as any,
      replayAssistantReasoning: false,
    }),
  );
  vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (_params, options) => {
    options?.onMessageHandle?.({ text: TEST_CONTENT.AI_RESPONSE, type: 'text' } as any);
    await options?.onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
    return new Response();
  });
  act(() => {
    useAgentStore.setState({ availableAgents: [] });
    useAiInfraStore.setState({ isInitAiProviderRuntimeState: true });
    useChatStore.setState((state) => ({
      dbMessagesMap: { ...state.dbMessagesMap, [messageMapKey(context)]: [userMessage] },
      executeClientAgent: realExecAgentRuntime,
      queuedMessages: {
        [messageMapKey(context)]: [
          { content: 'queued', createdAt: Date.now(), id: 'q1', interruptMode: 'soft' },
        ],
      },
      refreshMessages: vi.fn(),
    }));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Whether the run was told, at its first step, that messages wait behind it. */
const firstStepSeesQueue = async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const stepSpy = vi.spyOn(agentRuntime.AgentRuntime.prototype, 'step');
  const { result } = renderHook(() => useChatStore());

  await act(async () => {
    await result.current.executeClientAgent({
      context,
      messages: [userMessage],
      parentMessageId: userMessage.id,
      parentMessageType: 'user',
    });
  });

  return stepSpy.mock.calls[0][1]?.stepContext?.hasQueuedMessages;
};

describe('client run and the Follow-up behavior', () => {
  it('hands the turn back for queued messages in Steer mode', async () => {
    mode.value = 'steer';
    await expect(firstStepSeesQueue()).resolves.toBe(true);
  });

  it('lets the run finish in Queue mode: the queue starts once it ends', async () => {
    mode.value = 'queue';
    await expect(firstStepSeesQueue()).resolves.toBeFalsy();
  });
});
