import type { ToolRunContext } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import { ClientToolTransport } from './ClientToolTransport';

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
    const transport = new ClientToolTransport(() => store, 'message-key', 'root-operation');
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
  });
});
