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
  it('preserves an explicit unsuccessful tool result without an error', async () => {
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
    expect(createToolMessageForOperation).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'tool', tool_call_id: 'tool-call' }),
      'child-operation-2',
    );
    expect(store.optimisticCreateMessage).not.toHaveBeenCalled();
  });

  it('reuses the exact batch tool row rather than executing against its parent assistant', async () => {
    const invoke = vi.fn().mockResolvedValue({ content: 'saved', success: true });
    const store = {
      operations: { root: { context: { agentId: 'agent' } } },
      dbMessagesMap: {
        key: [
          { id: 'assistant', role: 'assistant' },
          { id: 'persisted-tool', role: 'tool', parentId: 'assistant' },
        ],
      },
      startOperation: vi.fn().mockReturnValue({ operationId: 'child' }),
      onOperationCancel: vi.fn(),
      internal_invokeDifferentTypePlugin: invoke,
      completeOperation: vi.fn(),
      failOperation: vi.fn(),
    } as unknown as ChatStore;
    const transport = new ClientToolTransport(
      () => store,
      'key',
      'root',
      {} as ClientMessageTransport,
    );
    const execution = await transport.run(
      { id: 'call_1', identifier: 'fixture', apiName: 'form', type: 'mcp', arguments: '{}' },
      {
        mode: 'batch',
        parentMessageId: 'assistant',
        assistantMessageId: 'assistant',
        toolMessageId: 'persisted-tool',
        reuseExistingMessage: true,
        toolName: 'fixture/form',
      } as ToolRunContext,
    );
    expect(invoke).toHaveBeenCalledWith(
      'persisted-tool',
      expect.objectContaining({ id: 'call_1' }),
      undefined,
    );
    expect(execution.toolMessageId).toBe('persisted-tool');
  });

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
});
