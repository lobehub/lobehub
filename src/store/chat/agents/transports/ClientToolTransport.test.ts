import type { ToolRunContext } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';
import { takeWorkIntent } from '@/utils/clientWorkIntentStash';

import type { ClientMessageTransport } from './ClientMessageTransport';
import { ClientToolTransport } from './ClientToolTransport';

vi.mock('@/utils/clientWorkIntentStash', () => ({
  stashWorkIntent: vi.fn(),
  takeWorkIntent: vi.fn(),
}));

const takeWorkIntentMock = vi.mocked(takeWorkIntent);

beforeEach(() => {
  takeWorkIntentMock.mockReset();
});

describe('ClientToolTransport', () => {
  it.each([false, true])(
    'preserves an unsuccessful result when reusing a placeholder: %s',
    async (reuseExistingMessage) => {
      const completeOperation = vi.fn();
      const failOperation = vi.fn();
      let operationIndex = 0;
      const store = {
        completeOperation,
        dbMessagesMap: {
          'message-key': [{ id: 'assistant-message', parentId: 'user-message', role: 'assistant' }],
        },
        failOperation,
        internal_invokeDifferentTypePlugin: vi.fn().mockResolvedValue({
          content: 'Tool reported a handled failure',
          success: false,
        }),
        onOperationCancel: vi.fn(),
        operations: {
          'root-operation': {
            context: { agentId: 'agent-1', messageId: 'assistant-message' },
          },
        },
        optimisticCreateMessage: vi.fn().mockResolvedValue({ id: 'tool-message' }),
        startOperation: vi.fn(() => ({ operationId: `child-operation-${++operationIndex}` })),
        updateOperationMetadata: vi.fn(),
      } as unknown as ChatStore;
      const createToolMessageForOperation = vi.fn().mockResolvedValue({ id: 'tool-message' });
      const messages = { createToolMessageForOperation } as unknown as ClientMessageTransport;
      const transport = new ClientToolTransport(
        () => store,
        'message-key',
        'root-operation',
        messages,
      );
      const call: ChatToolPayload = {
        apiName: 'run',
        arguments: '{}',
        id: 'tool-call',
        identifier: 'client-tool',
        type: 'default',
      };
      const context = {
        callIndex: 1,
        effectiveManifestMap: {},
        mode: 'single',
        operationId: 'root-operation',
        parentMessageId: 'assistant-message',
        parsedArgs: {},
        reuseExistingMessage,
        toolMessageId: reuseExistingMessage ? 'tool-message' : undefined,
        state: {},
        stepIndex: 0,
        toolName: 'client-tool/run',
      } as ToolRunContext;

      const execution = await transport.run(call, context);

      expect(execution.result).toMatchObject({
        content: 'Tool reported a handled failure',
        success: false,
      });
      expect(failOperation).toHaveBeenCalledWith('child-operation-1', {
        message: 'Tool execution failed',
        type: 'ToolExecutionError',
      });
      expect(completeOperation).not.toHaveBeenCalledWith('child-operation-1');
      if (reuseExistingMessage) {
        expect(createToolMessageForOperation).not.toHaveBeenCalled();
        expect(execution.toolMessageId).toBe('tool-message');
      } else {
        expect(createToolMessageForOperation).toHaveBeenCalledWith(
          expect.objectContaining({ role: 'tool', tool_call_id: 'tool-call' }),
          'child-operation-2',
        );
      }
      expect(store.optimisticCreateMessage).not.toHaveBeenCalled();
    },
  );

  it('always drains the stashed Work intent even when the tool invoke throws', async () => {
    const failOperation = vi.fn();
    let operationIndex = 0;
    const store = {
      completeOperation: vi.fn(),
      dbMessagesMap: {
        'message-key': [{ id: 'assistant-message', parentId: 'user-message', role: 'assistant' }],
      },
      failOperation,
      // The invoke rejects — the stash must still be drained for this toolCallId.
      internal_invokeDifferentTypePlugin: vi.fn().mockRejectedValue(new Error('invoke boom')),
      onOperationCancel: vi.fn(),
      operations: {
        'root-operation': {
          context: { agentId: 'agent-1', messageId: 'assistant-message' },
        },
      },
      optimisticCreateMessage: vi.fn().mockResolvedValue({ id: 'tool-message' }),
      startOperation: vi.fn(() => ({ operationId: `child-operation-${++operationIndex}` })),
      updateOperationMetadata: vi.fn(),
    } as unknown as ChatStore;
    const messages = {
      createToolMessageForOperation: vi.fn().mockResolvedValue({ id: 'tool-message' }),
    } as unknown as ClientMessageTransport;
    const transport = new ClientToolTransport(
      () => store,
      'message-key',
      'root-operation',
      messages,
    );
    const call: ChatToolPayload = {
      apiName: 'run',
      arguments: '{}',
      id: 'tool-call',
      identifier: 'client-tool',
      type: 'default',
    };
    const context = {
      callIndex: 1,
      effectiveManifestMap: {},
      mode: 'single',
      operationId: 'root-operation',
      parentMessageId: 'tool-message',
      parsedArgs: {},
      reuseExistingMessage: true,
      state: {},
      stepIndex: 0,
      toolName: 'client-tool/run',
    } as ToolRunContext;

    await expect(transport.run(call, context)).rejects.toThrow('invoke boom');

    // The stash entry for this toolCallId was drained despite the throw.
    expect(takeWorkIntentMock).toHaveBeenCalledWith('tool-call');
    expect(failOperation).toHaveBeenCalled();
  });

  it('hands the run context stepContext (with batch-threaded todos) to the client executor', async () => {
    const invoke = vi.fn().mockResolvedValue({ content: 'ok', success: true });
    let operationIndex = 0;
    const store = {
      completeOperation: vi.fn(),
      dbMessagesMap: {
        'message-key': [{ id: 'assistant-message', parentId: 'user-message', role: 'assistant' }],
      },
      failOperation: vi.fn(),
      internal_invokeDifferentTypePlugin: invoke,
      onOperationCancel: vi.fn(),
      operations: {
        'root-operation': { context: { agentId: 'agent-1', messageId: 'assistant-message' } },
      },
      optimisticCreateMessage: vi.fn().mockResolvedValue({ id: 'tool-message' }),
      startOperation: vi.fn(() => ({ operationId: `child-operation-${++operationIndex}` })),
      updateOperationMetadata: vi.fn(),
    } as unknown as ChatStore;
    const messages = {
      createToolMessageForOperation: vi.fn().mockResolvedValue({ id: 'tool-message' }),
    } as unknown as ClientMessageTransport;
    const transport = new ClientToolTransport(
      () => store,
      'message-key',
      'root-operation',
      messages,
    );
    const stepContext = {
      todos: { items: [{ status: 'todo', text: 'new 1' }], updatedAt: '2026-11-07T00:00:00.000Z' },
    };

    await transport.run(
      {
        apiName: 'updateTodos',
        arguments: '{"operations":[{"index":0,"type":"complete"}]}',
        id: 'tool-call',
        identifier: 'lobe-agent',
        type: 'builtin',
      },
      {
        callIndex: 1,
        effectiveManifestMap: {},
        mode: 'batch',
        operationId: 'root-operation',
        parentMessageId: 'assistant-message',
        parsedArgs: {},
        state: {},
        stepContext,
        stepIndex: 0,
        toolName: 'lobe-agent/updateTodos',
      } as unknown as ToolRunContext,
    );

    expect(invoke).toHaveBeenCalledWith('tool-message', expect.anything(), stepContext);
  });
});
