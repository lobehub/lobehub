import { toast } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRejectedCopyKey } from '@/features/Conversation/Messages/AssistantGroup/Tool/Detail/resolveRejectedCopyKey';
import { lambdaClient } from '@/libs/trpc/client';
import { aiAgentService } from '@/services/aiAgent';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import { messagesReducer } from '@/store/chat/slices/message/reducer';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createMockMessage } from '../__tests__/fixtures';
import { preserveSkippedIntervention } from '../transports/hetero/interventionAck';
import { ConversationControlActionImpl } from './conversationControl';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { resolveAgentInterventionBySource: vi.fn() },
}));
vi.mock('@/services/message', () => ({
  messageService: { getMessages: vi.fn(), updateMessagePluginState: vi.fn() },
}));
vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: { submitIntervention: vi.fn() },
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

beforeEach(() => vi.resetAllMocks());

describe('question actions racing tool completion', () => {
  it.each(['desktop', 'remote', 'source'] as const)(
    'preserves skip intent until the %s ACK and clears it for a later cancel',
    async (transport) => {
      const { control, state } = makeState(false);
      if (transport === 'source') {
        state.internal_confirmQuestionSubmission = vi.fn();
        vi.mocked(aiAgentService.resolveAgentInterventionBySource)
          .mockResolvedValueOnce({ handled: true, state: 'claimed' })
          .mockResolvedValueOnce({ handled: true, state: 'claimed' });
      } else {
        state.dbMessagesMap[key][0].pluginIntervention = { status: 'pending' };
        state.messageOperationMap = { assistant: 'operation' };
        state.operations = {
          operation: {
            type: transport === 'desktop' ? 'execHeterogeneousAgent' : 'execServerAgentRuntime',
            context,
          },
        } as ChatStore['operations'];
        state.internal_getConversationContext = () => context;
        vi.mocked(heterogeneousAgentService.submitIntervention).mockResolvedValue(undefined);
        vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate).mockResolvedValue(
          undefined,
        );
      }

      await control.submitHeteroIntervention('question', 'skip', undefined, context);
      const pending = state.dbMessagesMap[key][0].pluginIntervention;
      expect(pending).toMatchObject({ status: 'pending', resolving: true, skipped: true });
      const ack = { status: 'rejected' as const, rejectedReason: 'user_cancelled' };
      const skipped = preserveSkippedIntervention(ack, pending);
      expect(
        resolveRejectedCopyKey({
          ...skipped,
          apiName: 'askUserQuestion',
          reason: ack.rejectedReason,
        }),
      ).toBe('tool.intervention.questionSkipped');

      // A retry using Cancel must not inherit an earlier unconfirmed skip.
      await control.submitHeteroIntervention('question', 'cancel', undefined, context);
      const cancelled = preserveSkippedIntervention(
        ack,
        state.dbMessagesMap[key][0].pluginIntervention,
      );
      expect(cancelled.skipped).not.toBe(true);
      expect(
        resolveRejectedCopyKey({
          ...cancelled,
          apiName: 'askUserQuestion',
          reason: ack.rejectedReason,
        }),
      ).toBe('tool.intervention.rejectedWithReason');
    },
  );

  it('restores the skip marker when desktop delivery fails without an ACK', async () => {
    const { control, state } = makeState(false);
    state.dbMessagesMap[key][0].pluginIntervention = { status: 'pending' };
    state.messageOperationMap = { assistant: 'operation' };
    state.operations = {
      operation: { type: 'execHeterogeneousAgent', context },
    } as ChatStore['operations'];
    state.internal_getConversationContext = () => context;
    state.checkQuestionSubmission = vi.fn().mockResolvedValue(false);
    vi.mocked(heterogeneousAgentService.submitIntervention).mockRejectedValueOnce(
      new Error('IPC delivery failed'),
    );
    await expect(
      control.submitHeteroIntervention('question', 'skip', undefined, context),
    ).rejects.toThrow('IPC delivery failed');
    expect(state.dbMessagesMap[key][0].pluginIntervention).toMatchObject({
      status: 'pending',
      resolving: false,
    });
    expect(state.dbMessagesMap[key][0].pluginIntervention?.skipped).not.toBe(true);
  });

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
