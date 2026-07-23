import type { CreateMessageParams } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

import { ClientMessageTransport } from './ClientMessageTransport';

const createStore = () =>
  ({
    dbMessagesMap: { 'message-key': [] },
    internal_dispatchMessage: vi.fn(),
    operations: {
      'operation-1': {
        context: { agentId: 'agent-1', topicId: 'topic-1' },
      },
    },
    optimisticCreateMessage: vi.fn(),
    optimisticUpdatePluginState: vi.fn(),
    optimisticUpdateToolMessage: vi.fn(),
    replaceMessages: vi.fn(),
  }) as unknown as ChatStore;

describe('ClientMessageTransport', () => {
  beforeEach(() => {
    vi.spyOn(messageService, 'batchMutate').mockImplementation(async (operations) => ({
      results: operations.map((operation, index) => ({
        id: operation.type === 'createMessage' ? operation.message.id : operation.id,
        index,
        success: true,
        type: operation.type,
      })),
      success: true,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an optimistic message with a stable id and persists it quietly', async () => {
    const store = createStore();
    const transport = new ClientMessageTransport(() => store, 'message-key', 'operation-1');
    const params: CreateMessageParams = {
      agentId: 'agent-1',
      content: '',
      role: 'assistant',
      topicId: 'topic-1',
    };

    const message = await transport.createAssistantMessage(params);

    expect(message.id).toEqual(expect.any(String));
    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      { id: message.id, type: 'createMessage', value: { ...params, id: message.id } },
      { operationId: 'operation-1' },
    );
    expect(messageService.batchMutate).toHaveBeenCalledWith([
      { message: { ...params, id: message.id }, type: 'createMessage' },
    ]);
    expect(store.optimisticCreateMessage).not.toHaveBeenCalled();
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it('applies message and tool updates optimistically before quiet persistence', async () => {
    const store = createStore();
    const transport = new ClientMessageTransport(() => store, 'message-key', 'operation-1');

    await transport.update('assistant-1', { content: 'Answer' });
    await transport.updatePluginState('tool-1', { todos: [] });
    await transport.updateToolMessage('tool-1', {
      content: 'Tool result',
      pluginError: { message: 'Handled failure' },
      pluginState: { success: false },
    });

    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      { id: 'assistant-1', type: 'updateMessage', value: { content: 'Answer' } },
      { operationId: 'operation-1' },
    );
    expect(messageService.batchMutate).toHaveBeenNthCalledWith(1, [
      { id: 'assistant-1', type: 'updateMessage', value: { content: 'Answer' } },
    ]);
    expect(messageService.batchMutate).toHaveBeenNthCalledWith(
      2,
      [{ id: 'tool-1', type: 'updateToolMessage', value: { pluginState: { todos: [] } } }],
      expect.any(AbortSignal),
    );
    expect(messageService.batchMutate).toHaveBeenNthCalledWith(
      3,
      [
        {
          id: 'tool-1',
          type: 'updateToolMessage',
          value: {
            content: 'Tool result',
            pluginError: { message: 'Handled failure' },
            pluginState: { success: false },
          },
        },
      ],
      expect.any(AbortSignal),
    );
    expect(store.optimisticUpdatePluginState).not.toHaveBeenCalled();
    expect(store.optimisticUpdateToolMessage).not.toHaveBeenCalled();
    expect(store.replaceMessages).not.toHaveBeenCalled();
  });

  it('marks an optimistic create as failed when batch persistence reports a failure', async () => {
    vi.mocked(messageService.batchMutate).mockResolvedValueOnce({
      results: [{ id: 'assistant-1', index: 0, success: false, type: 'createMessage' }],
      success: false,
    });
    const store = createStore();
    const transport = new ClientMessageTransport(() => store, 'message-key', 'operation-1');

    await expect(
      transport.createAssistantMessage({
        agentId: 'agent-1',
        content: '',
        id: 'assistant-1',
        role: 'assistant',
      }),
    ).rejects.toThrow('Failed to create assistant message');

    expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        type: 'updateMessage',
        value: expect.objectContaining({
          error: expect.objectContaining({
            message: 'Failed to create assistant message',
          }),
        }),
      }),
      { operationId: 'operation-1' },
    );
  });
});
