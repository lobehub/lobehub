import { type ConversationContext } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { t } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockMessage } from './fixtures';
import { resetTestEnvironment } from './helpers';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      resolveAgentInterventionBySource: { mutate: vi.fn() },
    },
    shareChat: {
      resolveInterventionBySource: { mutate: vi.fn() },
    },
  },
}));

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

const unavailable = { contractVersion: 2, status: 'unavailable', success: false } as const;

beforeEach(() => {
  resetTestEnvironment();
  vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate)
    .mockReset()
    .mockResolvedValue(unavailable as any);
  vi.mocked(lambdaClient.shareChat.resolveInterventionBySource.mutate)
    .mockReset()
    .mockResolvedValue(unavailable as any);
  useChatStore.setState({ updateTopicStatus: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const agentId = 'agent-1';
const topicId = 'topic-1';
const toolMessageId = 'tool-msg-1';

type Store = ReturnType<typeof useChatStore.getState>;

// Every resume entry starts a new Gateway run for the paused intervention.
const resumeEntries: [string, (store: Store, context: ConversationContext) => Promise<void>][] = [
  ['approveToolCalling', (s, c) => s.approveToolCalling(toolMessageId, 'group-1', c)],
  ['approveAllToolCalls', (s, c) => s.approveAllToolCalls([toolMessageId], c)],
  ['submitToolInteraction', (s, c) => s.submitToolInteraction(toolMessageId, { a: 1 }, c)],
  ['skipToolInteraction', (s, c) => s.skipToolInteraction(toolMessageId, 'skip', c)],
  ['rejectToolCalling', (s, c) => s.rejectToolCalling(toolMessageId, 'no', c)],
  [
    'rejectAndContinueToolCalling',
    (s, c) => s.rejectAndContinueToolCalling(toolMessageId, 'no', c),
  ],
];

const setup = (context: ConversationContext, gatewayMode: boolean) => {
  const { result } = renderHook(() => useChatStore());
  const toolMessage = createMockMessage({
    id: toolMessageId,
    plugin: { apiName: 'y', arguments: '{}', identifier: 'x', type: 'default' },
    pluginIntervention: { status: 'pending' },
    role: 'tool',
    tool_call_id: 'call_1',
  } as any);
  const chatKey = messageMapKey(context);

  act(() => {
    useChatStore.setState({
      activeAgentId: agentId,
      activeTopicId: topicId,
      dbMessagesMap: { [chatKey]: [toolMessage] },
      messagesMap: { [chatKey]: [toolMessage] },
    });
  });

  vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(gatewayMode);
  const claim = vi.spyOn(result.current, 'tryResolveAgentInterventionBySource');
  const executeGatewayAgent = vi
    .spyOn(result.current, 'executeGatewayAgent')
    .mockResolvedValue({} as any);

  return { claim, executeGatewayAgent, result };
};

describe('ConversationControl resume entries with Gateway mode off', () => {
  it.each(resumeEntries)(
    '%s refuses before claiming the pending intervention',
    async (_name, resume) => {
      const context: ConversationContext = { agentId, threadId: null, topicId };
      const { claim, executeGatewayAgent, result } = setup(context, false);

      let error: unknown;
      await act(async () => {
        await resume(result.current, context).catch((e) => {
          error = e;
        });
      });

      expect((error as Error)?.message).toBe(t('gateway.notConfigured', { ns: 'chat' }));
      expect(claim).not.toHaveBeenCalled();
      expect(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).not.toHaveBeenCalled();
      expect(executeGatewayAgent).not.toHaveBeenCalled();
    },
  );

  it.each(resumeEntries)('%s still resumes a share run', async (_name, resume) => {
    const context: ConversationContext = {
      agentId,
      agentShareId: 'share-1',
      threadId: null,
      topicId,
    };
    const { executeGatewayAgent, result } = setup(context, false);

    await act(async () => {
      await resume(result.current, context);
    });

    expect(executeGatewayAgent).toHaveBeenCalledTimes(1);
  });
});
