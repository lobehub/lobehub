import { toast } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { aiAgentService } from '@/services/aiAgent';
import { messageService } from '@/services/message';
import { messagesReducer } from '@/store/chat/slices/message/reducer';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createMockMessage } from '../__tests__/fixtures';
import { ConversationControlActionImpl } from './conversationControl';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { resolveAgentInterventionBySource: vi.fn() },
}));
vi.mock('@/services/message', () => ({
  messageService: { getMessages: vi.fn(), updateMessagePluginState: vi.fn() },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { aiAgent: { submitHeteroIntervention: { mutate: vi.fn() } } },
}));

const context = {
  agentId: 'agent',
  topicId: 'topic',
  scope: 'thread' as const,
  threadId: 'thread',
};
const key = messageMapKey(context);
const makeState = (ended: boolean) => {
  const message = createMockMessage({
    id: 'question',
    role: 'tool',
    tool_call_id: 'call',
    parentId: 'assistant',
    pluginIntervention: {
      batchId: 'batch',
      operationId: 'operation',
      status: ended ? 'aborted' : 'pending',
      ...(ended && { rejectedReason: 'session_ended' }),
    },
    pluginState: { heterogeneousIntervention: { interactionKind: 'question' } },
  });
  const state = {
    dbMessagesMap: { [key]: [message] },
    questionSubmissions: {},
    messageOperationMap: {},
    refreshMessages: vi.fn(),
  } as unknown as ChatStore;
  state.internal_dispatchMessage = (action) => {
    state.dbMessagesMap[key] = messagesReducer(state.dbMessagesMap[key], action);
  };
  const control = new ConversationControlActionImpl(vi.fn(), () => state);
  return { state, control };
};

beforeEach(() => vi.clearAllMocks());

describe('question actions racing tool completion', () => {
  it.each(['submit', 'skip', 'cancel'] as const)(
    'notifies on a late %s without delivering or reopening an ended question',
    async (type) => {
      const { control, state } = makeState(true);
      const notice = vi.spyOn(toast, 'info').mockImplementation(() => '' as never);
      await control.submitHeteroIntervention('question', type, { Color: 'Blue' }, context);
      expect(notice).toHaveBeenCalledOnce();
      expect(aiAgentService.resolveAgentInterventionBySource).not.toHaveBeenCalled();
      expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe('aborted');
      notice.mockRestore();
    },
  );

  it('refreshes a server-ended question and reports the late action without replacing it', async () => {
    const { control, state } = makeState(false);
    const notice = vi.spyOn(toast, 'info').mockImplementation(() => '' as never);
    vi.mocked(aiAgentService.resolveAgentInterventionBySource).mockResolvedValueOnce({
      handled: true,
      state: 'already_resolved',
    });
    vi.mocked(state.refreshMessages).mockImplementationOnce(async () => {
      state.dbMessagesMap[key] = [
        {
          ...state.dbMessagesMap[key][0],
          pluginIntervention: {
            status: 'aborted',
            resolving: false,
            rejectedReason: 'session_ended',
          },
        },
      ];
    });
    await control.submitHeteroIntervention('question', 'submit', { Color: 'Blue' }, context);
    expect(state.refreshMessages).toHaveBeenCalledWith(context);
    expect(notice).toHaveBeenCalledOnce();
    expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe('aborted');
    notice.mockRestore();
  });

  it('does not publish or reopen a desktop question that ends while saving the answer', async () => {
    const { control, state } = makeState(false);
    state.dbMessagesMap[key] = [
      { ...state.dbMessagesMap[key][0], pluginIntervention: { status: 'pending' } },
    ];
    state.messageOperationMap = { assistant: 'desktop-operation' };
    state.operations = {
      'desktop-operation': { type: 'execHeterogeneousAgent', context },
    } as ChatStore['operations'];
    state.internal_getConversationContext = () => context;
    state.optimisticUpdateMessagePlugin = vi.fn();
    const notice = vi.spyOn(toast, 'info').mockImplementation(() => '' as never);
    vi.mocked(messageService.updateMessagePluginState).mockImplementationOnce(async () => {
      state.internal_dispatchMessage({
        id: 'question',
        type: 'updateMessage',
        value: {
          pluginIntervention: {
            status: 'aborted',
            resolving: false,
            rejectedReason: 'session_ended',
          },
        },
      });
      return { messages: [], success: true };
    });
    await control.submitHeteroIntervention('question', 'submit', { Color: 'Blue' }, context);
    expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe('aborted');
    expect(state.optimisticUpdateMessagePlugin).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledOnce();
    notice.mockRestore();
  });

  it.each(['approved', 'rejected'] as const)(
    'does not roll back producer %s when the transport later fails',
    async (status) => {
      const { control, state } = makeState(false);
      state.dbMessagesMap[key] = [
        {
          ...state.dbMessagesMap[key][0],
          pluginIntervention: { status: 'pending' },
        },
      ];
      state.messageOperationMap = { assistant: 'gc-operation' };
      state.operations = {};
      state.optimisticUpdateMessagePlugin = vi.fn();
      vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate).mockImplementationOnce(
        async () => {
          state.dbMessagesMap[key] = [
            {
              ...state.dbMessagesMap[key][0],
              pluginIntervention: { status, resolving: false },
            },
          ];
          throw new Error('Response lost after producer ACK');
        },
      );
      await expect(
        control.submitHeteroIntervention('question', 'skip', undefined, context),
      ).resolves.toBeUndefined();
      expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe(status);
      expect(state.optimisticUpdateMessagePlugin).not.toHaveBeenCalled();
    },
  );

  it('keeps a terminal event when delivery fails after the tool has ended', async () => {
    const { control, state } = makeState(false);
    const notice = vi.spyOn(toast, 'info').mockImplementation(() => '' as never);
    vi.mocked(aiAgentService.resolveAgentInterventionBySource).mockImplementationOnce(async () => {
      state.dbMessagesMap[key] = [
        {
          ...state.dbMessagesMap[key][0],
          pluginIntervention: {
            status: 'aborted',
            resolving: false,
            rejectedReason: 'session_ended',
          },
        },
      ];
      throw new Error('Producer has already ended');
    });
    await expect(
      control.submitHeteroIntervention('question', 'submit', { Color: 'Blue' }, context),
    ).resolves.toBeUndefined();
    expect(notice).toHaveBeenCalledOnce();
    expect(state.dbMessagesMap[key][0].pluginIntervention?.status).toBe('aborted');
    notice.mockRestore();
  });
});
