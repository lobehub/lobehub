import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import * as agentSignalBridge from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';

import { createGatewayEventHandler } from './gatewayEventHandler';

const context = {
  agentId: 'agent-1',
  topicId: 'topic-1',
} as ConversationContext;

const makeEvent = (type: AgentStreamEvent['type'], data?: AgentStreamEvent['data']) =>
  ({
    data,
    id: 'event-1',
    operationId: 'op-1',
    stepIndex: 1,
    timestamp: 0,
    type,
  }) as AgentStreamEvent;

const createStore = (dbMessagesMap: Record<string, UIChatMessage[]> = {}) =>
  ({
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap,
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    operations: {},
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => ({
      abortController: new AbortController(),
      operationId: 'reasoning-op',
    })),
    updateOperationMetadata: vi.fn(),
  }) as unknown as ChatStore;

// The handler enqueues work on an internal promise chain; flush the microtask
// queue so async event handlers settle before assertions.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('createGatewayEventHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(agentSignalBridge, 'emitClientAgentSignalSourceEvent').mockResolvedValue(undefined);
  });

  it('inserts the assistant shell locally when stream_start carries the message seed (new server)', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_start', {
        assistantMessage: {
          id: 'step2-msg',
          model: 'gpt-4o',
          provider: 'openai',
          role: 'assistant',
        },
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'step2-msg',
        type: 'createMessage',
        value: expect.objectContaining({
          content: '',
          model: 'gpt-4o',
          provider: 'openai',
          role: 'assistant',
          topicId: 'topic-1',
        }),
      },
      { operationId: 'op-1' },
    );
    // No DB roundtrip needed when the seed is present.
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it('falls back to a DB refetch when stream_start ships only { id } (old server)', async () => {
    const getMessages = vi
      .spyOn(messageService, 'getMessages')
      .mockResolvedValue([] as unknown as UIChatMessage[]);
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('stream_start', { assistantMessage: { id: 'step2-msg' } }));
    await flush();

    expect(getMessages).toHaveBeenCalled();
    expect(store.replaceMessages).toHaveBeenCalled();
    // No local shell insert when the seed is absent.
    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('does not insert a shell when the assistant row is already in the store', async () => {
    const store = createStore({
      key: [{ content: 'existing', id: 'step2-msg', role: 'assistant' } as UIChatMessage],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'seed-msg',
      context,
      operationId: 'op-1',
    });

    handler(
      makeEvent('stream_start', {
        assistantMessage: { id: 'step2-msg', role: 'assistant' },
      }),
    );
    await flush();

    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('skips the visible_output_end hint while the assistant row is missing (LOBE-11501)', async () => {
    const store = createStore();
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'missing-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('visible_output_end'));
    await flush();

    expect(store.updateOperationMetadata).not.toHaveBeenCalled();
  });

  it('honors the visible_output_end hint once the streamed content has landed', async () => {
    const store = createStore({
      key: [{ content: 'answer', id: 'answer-msg', role: 'assistant' } as UIChatMessage],
    });
    const handler = createGatewayEventHandler(() => store, {
      assistantMessageId: 'answer-msg',
      context,
      operationId: 'op-1',
    });

    handler(makeEvent('visible_output_end'));
    await flush();

    expect(store.updateOperationMetadata).toHaveBeenCalledWith('op-1', {
      visibleLoadingDone: true,
    });
  });
});
