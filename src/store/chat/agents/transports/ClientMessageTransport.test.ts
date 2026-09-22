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

  describe('query', () => {
    const projectedRow = {
      content: '',
      id: 'tool-1',
      payloadOmitted: 'detail',
      role: 'tool',
    } as any;

    const storeWith = (messages: any[]) => {
      const store = createStore();
      (store as any).dbMessagesMap['message-key'] = messages;
      return store;
    };

    it('refills a projected tool payload before the list becomes a context', async () => {
      const fetchPayloads = vi
        .spyOn(messageService, 'getToolResultPayloads')
        .mockResolvedValue({ 'tool-1': { content: 'REAL TOOL OUTPUT', pluginState: { a: 1 } } });
      const transport = new ClientMessageTransport(
        () => storeWith([projectedRow]),
        'message-key',
        'operation-1',
      );

      const [row] = await transport.query();

      expect(fetchPayloads).toHaveBeenCalledWith(['tool-1']);
      expect(row.content).toBe('REAL TOOL OUTPUT');
      expect(row.pluginState).toEqual({ a: 1 });
    });

    it('fetches each stored payload once across the steps of a run', async () => {
      const fetchPayloads = vi
        .spyOn(messageService, 'getToolResultPayloads')
        .mockResolvedValue({ 'tool-1': { content: 'REAL TOOL OUTPUT' } });
      const store = storeWith([projectedRow]);
      const transport = new ClientMessageTransport(() => store, 'message-key', 'operation-1');

      await transport.query();
      (store as any).dbMessagesMap['message-key'] = [
        projectedRow,
        { content: 'hi', id: 'user-1', role: 'user' },
      ];
      const second = await transport.query();

      expect(fetchPayloads).toHaveBeenCalledTimes(1);
      expect(second[0].content).toBe('REAL TOOL OUTPUT');
    });

    it('leaves an unprojected list alone without asking the server', async () => {
      const fetchPayloads = vi.spyOn(messageService, 'getToolResultPayloads');
      const rows = [{ content: 'FULL', id: 'tool-1', role: 'tool' }] as any[];
      const transport = new ClientMessageTransport(
        () => storeWith(rows),
        'message-key',
        'operation-1',
      );

      expect(await transport.query()).toEqual(rows);
      expect(fetchPayloads).not.toHaveBeenCalled();
    });

    it('keeps the projected row when the refill fails, rather than failing the step', async () => {
      vi.spyOn(messageService, 'getToolResultPayloads').mockRejectedValue(new Error('offline'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const transport = new ClientMessageTransport(
        () => storeWith([projectedRow]),
        'message-key',
        'operation-1',
      );

      const [row] = await transport.query();

      expect(row.content).toBe('');
      error.mockRestore();
    });
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
