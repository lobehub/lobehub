import { describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@/libs/agent-stream';

import { createGatewayEventHandler } from '../gatewayEventHandler';

// ─── Test Helpers ───

function createMockStore() {
  return {
    internal_dispatchMessage: vi.fn(),
    internal_toggleMessageLoading: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    refreshMessages: vi.fn().mockResolvedValue(undefined),
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

// ─── Tests ───

describe('createGatewayEventHandler', () => {
  describe('stream_start', () => {
    it('should switch assistantMessageId from event data', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));

      // Loading should target the new message ID
      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(true, 'msg-step2');
      expect(store.refreshMessages).toHaveBeenCalled();
    });

    it('should keep current ID if event data has no assistantMessage', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', {}));

      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(true, 'msg-initial');
    });

    it('should reset accumulators on each stream_start', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Accumulate some content
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello' }));
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ value: { content: 'hello' } }),
      );

      // New stream_start resets
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'world' }));

      // Content should be 'world', not 'helloworld'
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: { content: 'world' },
        }),
      );
    });
  });

  describe('stream_chunk', () => {
    it('should accumulate text content', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hello' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: ' world' }));

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith({
        id: 'msg-initial',
        type: 'updateMessage',
        value: { content: 'Hello world' },
      });
    });

    it('should accumulate reasoning content', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'Think' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'ing...' }));

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith({
        id: 'msg-initial',
        type: 'updateMessage',
        value: { reasoning: { content: 'Thinking...' } },
      });
    });

    it('should dispatch tools and toggle tool calling streaming', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      const toolsCalling = [{ id: 'tc-1' }, { id: 'tc-2' }];
      handler(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling }));

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith({
        id: 'msg-initial',
        type: 'updateMessage',
        value: { tools: toolsCalling },
      });

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-initial', [
        true,
        true,
      ]);
    });

    it('should ignore chunk with no data', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', undefined));

      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
    });
  });

  describe('stream_end', () => {
    it('should toggle loading off and clear tool streaming', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_end'));

      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(false, 'msg-initial');
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
    });
  });

  describe('tool_start', () => {
    it('should be a no-op', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_start', { parentMessageId: 'msg-initial', toolCalling: {} }));

      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
      expect(store.refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('tool_end', () => {
    it('should refresh messages to pull tool results', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_end', { isSuccess: true }));

      expect(store.refreshMessages).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', topicId: 'topic-1' }),
      );
    });
  });

  describe('step_complete', () => {
    it('should refresh on execution_complete phase', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('step_complete', { phase: 'execution_complete', reason: 'done' }));

      expect(store.refreshMessages).toHaveBeenCalled();
    });

    it('should not refresh on other phases', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('step_complete', { phase: 'human_approval' }));

      expect(store.refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('agent_runtime_end', () => {
    it('should toggle loading off and refresh messages', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end'));

      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(false, 'msg-initial');
      expect(store.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should dispatch error to current message', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('error', { message: 'Something went wrong' }));

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith({
        id: 'msg-initial',
        type: 'updateMessage',
        value: {
          error: { body: { message: 'Something went wrong' }, type: 'AgentRuntimeError' },
        },
      });
      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(false, 'msg-initial');
    });

    it('should dispatch error to switched message ID', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Switch to step 2
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));

      handler(makeEvent('error', { error: 'Timeout' }));

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-step2' }),
      );
    });
  });

  describe('multi-step integration', () => {
    it('should handle full LLM → tools → LLM cycle', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Step 1: LLM call
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-1' } }));
      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(true, 'msg-1');

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Let me search.' }));
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-1', value: { content: 'Let me search.' } }),
      );

      const tools = [{ id: 'tc-1' }];
      handler(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: tools }));
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-1', [true]);

      handler(makeEvent('stream_end'));
      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(false, 'msg-1');
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-1', undefined);

      // Tool execution
      handler(makeEvent('tool_start', { parentMessageId: 'msg-1', toolCalling: tools[0] }));
      handler(makeEvent('tool_end', { isSuccess: true }));
      expect(store.refreshMessages).toHaveBeenCalled();

      // Step 2: Next LLM call with new assistant message
      vi.clearAllMocks();
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-2' } }));
      expect(store.refreshMessages).toHaveBeenCalled();
      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(true, 'msg-2');

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Here are the results.' }));
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-2', value: { content: 'Here are the results.' } }),
      );

      handler(makeEvent('stream_end'));
      handler(makeEvent('agent_runtime_end'));
      expect(store.internal_toggleMessageLoading).toHaveBeenCalledWith(false, 'msg-2');
    });
  });
});
