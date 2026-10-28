import { type UIChatMessage } from '@lobechat/types';
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

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    getFromLocalStorageSync(): State {
      return {} as State;
    }

    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});
vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/electron/completionSound', () => ({
  completionSoundService: {
    getNotificationSoundFile: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
  },
}));

const realExecAgentRuntime = useChatStore.getState().executeClientAgent;
const context = { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID };

const runOnce = async () => {
  const userMessage = {
    content: TEST_CONTENT.USER_MESSAGE,
    id: TEST_IDS.USER_MESSAGE_ID,
    role: 'user',
    sessionId: TEST_IDS.SESSION_ID,
    topicId: TEST_IDS.TOPIC_ID,
  } as UIChatMessage;
  act(() => {
    useChatStore.setState((state) => ({
      dbMessagesMap: { ...state.dbMessagesMap, [messageMapKey(context)]: [userMessage] },
      executeClientAgent: realExecAgentRuntime,
    }));
  });

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

  const { result } = renderHook(() => useChatStore());
  const statusesAtRefresh: (string | undefined)[] = [];
  const refreshMessages = vi.fn(async () => {
    const op = Object.values(useChatStore.getState().operations).find(
      (operation) => operation.type === 'execAgentRuntime',
    );
    statusesAtRefresh.push(op?.status);
  });
  act(() => {
    useChatStore.setState({ refreshMessages });
  });

  await act(async () => {
    await result.current.executeClientAgent({
      context,
      messages: [userMessage],
      parentMessageId: userMessage.id,
      parentMessageType: 'user',
    });
  });

  return statusesAtRefresh;
};

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  act(() => {
    useAgentStore.setState({ availableAgents: [] });
    useAiInfraStore.setState({ isInitAiProviderRuntimeState: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeClientAgent Work refresh', () => {
  it('re-reads the transcript after the run completes when it registered a Work', async () => {
    vi.spyOn(workService, 'listByRootOperation').mockResolvedValue([
      { id: 'registered-work' } as Awaited<
        ReturnType<typeof workService.listByRootOperation>
      >[number],
    ]);

    const statuses = await runOnce();

    expect(statuses.at(-1)).toBe('completed');
  });

  it('keeps a single in-run refresh when the run registered no Work', async () => {
    vi.spyOn(workService, 'listByRootOperation').mockResolvedValue([]);

    const statuses = await runOnce();

    expect(statuses).toEqual(['running']);
  });
});
