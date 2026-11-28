import { LOADING_FLAT } from '@lobechat/const';
import { ChatErrorType, type UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { buildRunLifecycle } from '@/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle';
import type { ChatStore } from '@/store/chat/store';

import { hydrateClientRunContext } from './hydrateClientRun';

const completeRun = vi.fn().mockResolvedValue({ requeued: false });

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle', () => ({
  buildRunLifecycle: vi.fn(() => ({
    completeRun,
  })),
}));

vi.mock('@/store/tool', () => ({
  getToolStoreState: () => ({
    getUninstalledBuiltinToolsForRun: vi.fn().mockResolvedValue([]),
  }),
}));

describe('hydrateClientRunContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeStore = (dbMessages: UIChatMessage[]) => {
    const optimisticCreateMessage = vi.fn().mockResolvedValue(undefined);
    const optimisticUpdateMessageError = vi.fn().mockResolvedValue(undefined);
    const failOperation = vi.fn();
    const store = {
      dbMessagesMap: { agt_1_tpc_1: dbMessages },
      failOperation,
      optimisticCreateMessage,
      optimisticUpdateMessageError,
    } as unknown as ChatStore;
    return { failOperation, optimisticCreateMessage, optimisticUpdateMessageError, store };
  };

  const baseMessages: UIChatMessage[] = [
    {
      content: 'earlier answer',
      createdAt: 1,
      id: 'msg_prev_a',
      reasoning: { protocolOmitted: true },
      role: 'assistant',
      updatedAt: 1,
    } as UIChatMessage,
    {
      content: 'follow-up',
      createdAt: 2,
      id: 'msg_u2',
      role: 'user',
      updatedAt: 2,
    } as UIChatMessage,
    {
      content: LOADING_FLAT,
      createdAt: 3,
      id: 'msg_pending_a2',
      parentId: 'msg_u2',
      role: 'assistant',
      updatedAt: 3,
    } as UIChatMessage,
  ];

  it('sets error on pending assistant reply and finalizes run when getReasonings rejects', async () => {
    vi.spyOn(messageService, 'getReasonings').mockRejectedValueOnce(new Error('network timeout'));
    const { failOperation, optimisticUpdateMessageError, store } = makeStore(baseMessages);

    await expect(
      hydrateClientRunContext({
        context: { agentId: 'agt_1', topicId: 'tpc_1' },
        get: () => store,
        messageKey: 'agt_1_tpc_1',
        operationId: 'op_1',
        originalMessages: baseMessages,
        parentMessageId: 'msg_u2',
        parentMessageType: 'user',
      }),
    ).rejects.toThrow('network timeout');

    expect(optimisticUpdateMessageError).toHaveBeenCalledWith(
      'msg_pending_a2',
      expect.objectContaining({
        message: 'network timeout',
        type: ChatErrorType.InternalServerError,
      }),
      { operationId: 'op_1' },
    );
    expect(failOperation).toHaveBeenCalledWith('op_1', {
      message: 'network timeout',
      type: 'ConversationHydrationError',
    });
    expect(buildRunLifecycle).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op_1',
        runtimeStatus: 'error',
        runtimeType: 'client',
      }),
    );
  });

  it('sets error and finalizes run when getReasonings returns missing reasoning ids', async () => {
    vi.spyOn(messageService, 'getReasonings').mockResolvedValueOnce({});
    const { failOperation, optimisticUpdateMessageError, store } = makeStore(baseMessages);

    await expect(
      hydrateClientRunContext({
        context: { agentId: 'agt_1', topicId: 'tpc_1' },
        get: () => store,
        messageKey: 'agt_1_tpc_1',
        operationId: 'op_2',
        originalMessages: baseMessages,
        parentMessageId: 'msg_u2',
        parentMessageType: 'user',
      }),
    ).rejects.toThrow('Failed to restore omitted reasoning');

    expect(optimisticUpdateMessageError).toHaveBeenCalledWith(
      'msg_pending_a2',
      expect.objectContaining({ type: ChatErrorType.InternalServerError }),
      { operationId: 'op_2' },
    );
    expect(failOperation).toHaveBeenCalledWith(
      'op_2',
      expect.objectContaining({ type: 'ConversationHydrationError' }),
    );
    expect(completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op_2', runtimeStatus: 'error' }),
    );
  });

  it('creates an error assistant card and finalizes immediately on retry when no loading placeholder exists', async () => {
    vi.spyOn(messageService, 'getReasonings').mockRejectedValueOnce(new Error('retry timeout'));
    const retryMessages = baseMessages.slice(0, 2); // prior failed reply was deleted before regenerate
    const { failOperation, optimisticCreateMessage, optimisticUpdateMessageError, store } =
      makeStore(retryMessages);
    // Simulate a slow error-persistence request that never resolves during finalization.
    optimisticCreateMessage.mockReturnValueOnce(new Promise(() => undefined));

    await expect(
      hydrateClientRunContext({
        context: { agentId: 'agt_1', topicId: 'tpc_1' },
        get: () => store,
        messageKey: 'agt_1_tpc_1',
        operationId: 'op_3',
        originalMessages: retryMessages,
        parentMessageId: 'msg_u2',
        parentMessageType: 'user',
      }),
    ).rejects.toThrow('retry timeout');

    expect(optimisticUpdateMessageError).not.toHaveBeenCalled();
    expect(optimisticCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        content: '',
        error: expect.objectContaining({
          message: 'retry timeout',
          type: ChatErrorType.InternalServerError,
        }),
        parentId: 'msg_u2',
        role: 'assistant',
        topicId: 'tpc_1',
      }),
      { operationId: 'op_3' },
    );
    expect(failOperation).toHaveBeenCalledWith('op_3', {
      message: 'retry timeout',
      type: 'ConversationHydrationError',
    });
    expect(completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op_3', runtimeStatus: 'error' }),
    );
  });
});
