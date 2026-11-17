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

  it('reports arguments that are not JSON instead of running the tool', async () => {
    const failOperation = vi.fn();
    let operationIndex = 0;
    const invoke = vi.fn();
    const store = {
      completeOperation: vi.fn(),
      dbMessagesMap: {
        'message-key': [{ id: 'assistant-message', parentId: 'user-message', role: 'assistant' }],
      },
      failOperation,
      internal_invokeDifferentTypePlugin: invoke,
      onOperationCancel: vi.fn(),
      operations: {
        'root-operation': {
          context: { agentId: 'agent-1', messageId: 'assistant-message' },
        },
      },
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
    // An invalid escape: partial-json used to turn this into {path} and the Canvas tool ran
    // without the content the model sent.
    const invalidArguments = String.raw`{"title":"Report","files":[{"path":"index.html","content":"<p>it\'s</p>"}]}`;
    const call: ChatToolPayload = {
      apiName: 'createCanvas',
      arguments: invalidArguments,
      id: 'tool-call',
      identifier: 'lobe-canvas',
      type: 'builtin',
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
      toolName: 'lobe-canvas/createCanvas',
    } as ToolRunContext;

    const execution = await transport.run(call, context);

    expect(invoke).not.toHaveBeenCalled();
    expect(execution.result).toMatchObject({
      error: { code: 'INVALID_JSON_ARGUMENTS' },
      success: false,
    });
    expect(execution.result.content).toMatch(/not valid JSON/);
    expect(execution.result.content).toContain(invalidArguments);
    // The runtime persists the result into the tool message created for this call.
    expect(execution.resultPersisted).toBe(false);
    expect(execution.toolMessageId).toBe('tool-message');
    expect(failOperation).toHaveBeenCalledWith('child-operation-1', {
      message: expect.stringMatching(/not valid JSON/),
      type: 'ToolExecutionError',
    });
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
