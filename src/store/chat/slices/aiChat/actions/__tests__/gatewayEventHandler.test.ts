import { describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@/libs/agent-stream';

import { createGatewayEventHandler } from '../gatewayEventHandler';

vi.mock('@/services/message', () => ({
  messageService: { getMessages: vi.fn().mockResolvedValue([]) },
}));

// ─── Test Helpers ───

function createMockStore() {
  return {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    replaceMessages: vi.fn(),
  };
}

function createHandler(
  store: ReturnType<typeof createMockStore>,
  overrides?: { assistantMessageId?: string },
) {
  const get = vi.fn(() => store) as any;
  return createGatewayEventHandler(get, {
    assistantMessageId: overrides?.assistantMessageId ?? 'msg-initial',
    context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
    operationId: 'op-1',
  });
}

function makeEvent(type: AgentStreamEvent['type'], data?: any): AgentStreamEvent {
  return { data, id: '1', operationId: 'op-1', stepIndex: 0, timestamp: Date.now(), type };
}

/** Flush the async processing queue by draining microtasks + setTimeout queue */
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 15));
  }
};

// ─── Tests ───

describe('createGatewayEventHandler', () => {
  describe('stream_start', () => {
    it('should associate new message with operation', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      await flush();

      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-step2', 'op-1');
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should keep current ID if event data has no assistantMessage', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', {}));
      await flush();

      // No new message to associate, but fetch still happens
      expect(store.associateMessageWithOperation).not.toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should reset accumulators on each stream_start', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Accumulate some content
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello' }));
      await flush();
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ value: { content: 'hello' } }),
        { operationId: 'op-1' },
      );

      // New stream_start resets
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'world' }));
      await flush();

      // Content should be 'world', not 'helloworld'
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: { content: 'world' },
        }),
        { operationId: 'op-1' },
      );
    });
  });

  describe('stream_chunk', () => {
    it('should accumulate text content and pass operationId context', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hello' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: ' world' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { content: 'Hello world' },
        },
        { operationId: 'op-1' },
      );
    });

    it('should accumulate reasoning content', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'Think' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'ing...' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { reasoning: { content: 'Thinking...' } },
        },
        { operationId: 'op-1' },
      );
    });

    it('should dispatch tools and toggle tool calling streaming', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      const toolsCalling = [{ id: 'tc-1' }, { id: 'tc-2' }];
      handler(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { tools: toolsCalling },
        },
        { operationId: 'op-1' },
      );

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-initial', [
        true,
        true,
      ]);
    });

    it('should ignore chunk with no data', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', undefined));
      await flush();

      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
    });
  });

  describe('stream_end', () => {
    it('should clear tool streaming only', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
    });
  });

  describe('tool_start', () => {
    it('should be a no-op (loading already active from stream_start)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_start', { parentMessageId: 'msg-initial', toolCalling: {} }));
      await flush();

      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
    });
  });

  describe('tool_end', () => {
    it('should refresh messages to pull tool results', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_end', { isSuccess: true }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalled();
    });
  });

  describe('step_complete', () => {
    it('should refresh on execution_complete phase', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('step_complete', { phase: 'execution_complete', reason: 'done' }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should not refresh on other phases', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('step_complete', { phase: 'human_approval' }));
      await flush();

      expect(store.replaceMessages).not.toHaveBeenCalled();
    });
  });

  describe('agent_runtime_end', () => {
    it('should complete operation and refresh messages', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.replaceMessages).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should dispatch error to current message with operationId context', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('error', { message: 'Something went wrong' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: {
            error: { body: { message: 'Something went wrong' }, type: 'AgentRuntimeError' },
          },
        },
        { operationId: 'op-1' },
      );
    });

    it('should dispatch error to switched message ID', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('error', { error: 'Timeout' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-step2' }),
        { operationId: 'op-1' },
      );
    });
  });

  describe('sequential processing', () => {
    it('should process stream_chunk only after stream_start refresh completes', async () => {
      const store = createMockStore();
      const callOrder: string[] = [];

      const { messageService } = await import('@/services/message');
      (messageService.getMessages as any).mockImplementation(async () => {
        callOrder.push('refresh_start');
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push('refresh_end');
        return [];
      });
      store.internal_dispatchMessage.mockImplementation(() => {
        callOrder.push('dispatch');
      });
      store.associateMessageWithOperation.mockImplementation(() => {
        callOrder.push('associate');
      });

      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-new' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hello' }));
      await flush();

      const refreshEndIdx = callOrder.indexOf('refresh_end');
      const dispatchIdx = callOrder.indexOf('dispatch');
      expect(refreshEndIdx).toBeGreaterThan(-1);
      expect(dispatchIdx).toBeGreaterThan(refreshEndIdx);
    });
  });

  describe('multi-step integration', () => {
    it('should handle full LLM → tools → LLM cycle', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Step 1: LLM call
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-1' } }));
      await flush();
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-1', 'op-1');

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Let me search.' }));
      await flush();
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-1', value: { content: 'Let me search.' } }),
        { operationId: 'op-1' },
      );

      const tools = [{ id: 'tc-1' }];
      handler(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: tools }));
      await flush();
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-1', [true]);

      handler(makeEvent('stream_end'));
      await flush();
      // Loading stays active between steps — only tool streaming is cleared
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-1', undefined);

      // Tool execution
      handler(makeEvent('tool_start', { parentMessageId: 'msg-1', toolCalling: tools[0] }));
      handler(makeEvent('tool_end', { isSuccess: true }));
      await flush();
      expect(store.replaceMessages).toHaveBeenCalled();

      // Step 2: Next LLM call with new assistant message
      vi.clearAllMocks();
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-2' } }));
      await flush();
      expect(store.replaceMessages).toHaveBeenCalled();
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-2', 'op-1');

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Here are the results.' }));
      await flush();
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-2', value: { content: 'Here are the results.' } }),
        { operationId: 'op-1' },
      );

      handler(makeEvent('stream_end'));
      handler(makeEvent('agent_runtime_end'));
      await flush();
      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
    });
  });
});
