import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import * as agentSignalBridge from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';

import { createGatewayEventHandler } from './gatewayEventHandler';

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  getExecutor: vi.fn(() => ({})),
  registerBuiltinToolExecutors: vi.fn(),
}));

const context = { agentId: 'agent-1', topicId: 'topic-1' } as ConversationContext;

const makeEvent = (type: AgentStreamEvent['type'], data?: AgentStreamEvent['data']) =>
  ({ data, id: 'e', operationId: 'op-1', stepIndex: 1, timestamp: 0, type }) as AgentStreamEvent;

const createStore = () =>
  ({
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap: {},
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    operations: {},
    operationsByContext: {},
    replaceMessages: vi.fn(),
    updateOperationMetadata: vi.fn(),
  }) as unknown as ChatStore;

const createLifecycle = () => ({
  afterRunComplete: vi.fn().mockResolvedValue(undefined),
  completeRun: vi.fn().mockResolvedValue({ requeued: false }),
});

const flush = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

const workingDirectoryError = {
  body: {
    agentType: 'claude-code',
    code: 'working_directory_not_found',
    message: 'Working directory does not exist: /gone',
  },
  message: 'Working directory does not exist: /gone',
  type: 'AgentRuntimeError',
};

describe('createGatewayEventHandler — failed run terminal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(agentSignalBridge, 'emitClientAgentSignalSourceEvent').mockResolvedValue(undefined);
    vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as unknown as UIChatMessage[]);
  });

  it('settles a `reason: error` end as failed and notifies with the persisted error', async () => {
    const lifecycle = createLifecycle();
    const handler = createGatewayEventHandler(createStore, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    handler(
      makeEvent('agent_runtime_end', {
        reason: 'error',
        uiMessages: [
          {
            children: [{ content: '...', error: workingDirectoryError, id: 'answer-msg' }],
            content: '...',
            id: 'answer-msg',
            role: 'assistantGroup',
          },
        ] as unknown as UIChatMessage[],
      }),
    );
    await flush();

    expect(lifecycle.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(lifecycle.afterRunComplete).toHaveBeenCalledTimes(1);
    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: { error: workingDirectoryError },
        status: 'failed',
      }),
    );
  });

  it('announces a run that fails with an `error` event, once, before the dropped end event', async () => {
    const updateMessageError = vi
      .spyOn(messageService, 'updateMessageError')
      .mockResolvedValue({ success: true } as any);
    const lifecycle = createLifecycle();
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    handler(makeEvent('error', { message: 'Provider quota exceeded', type: 'ProviderBizError' }));
    handler(makeEvent('agent_runtime_end', { reason: 'error' }));
    await flush();

    expect(lifecycle.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(lifecycle.afterRunComplete).toHaveBeenCalledTimes(1);
    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: {
          error: expect.objectContaining({ message: 'Provider quota exceeded' }),
        },
        status: 'failed',
      }),
    );
    // The error the banner points to is persisted and shown before it fires.
    const notifiedAt = lifecycle.afterRunComplete.mock.invocationCallOrder[0];
    expect(updateMessageError.mock.invocationCallOrder[0]).toBeLessThan(notifiedAt);
    const overlayAt = vi.mocked(store.internal_dispatchMessage).mock.invocationCallOrder.at(-1)!;
    expect(overlayAt).toBeLessThan(notifiedAt);
  });

  it('still announces a failed run whose snapshot carries no error', async () => {
    const lifecycle = createLifecycle();
    const handler = createGatewayEventHandler(createStore, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runLifecycle: lifecycle as any,
      runtimeType: 'gateway',
    });

    handler(makeEvent('agent_runtime_end', { reason: 'error' }));
    await flush();

    expect(lifecycle.afterRunComplete).toHaveBeenCalledWith(
      expect.objectContaining({ notification: { error: undefined }, status: 'failed' }),
    );
  });

  it('does not mark a failed hetero-reconciled run unread', async () => {
    const store = createStore();
    (store as any).operations = { 'op-1': { context } };
    (store as any).markTopicUnread = vi.fn();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
      runtimeType: 'hetero',
    });

    handler(makeEvent('agent_runtime_end', { reason: 'error' }));
    await flush();

    expect(store.completeOperation).toHaveBeenCalledWith('op-1');
    expect((store as any).markTopicUnread).not.toHaveBeenCalled();
  });
});
