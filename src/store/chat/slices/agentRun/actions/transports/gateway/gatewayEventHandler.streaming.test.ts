import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type * as WorkServiceModule from '@/services/work';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';

import { createHandler, createMockStore, flush, makeEvent } from './testUtils';

vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn().mockResolvedValue([]),
    updateMessageError: vi.fn().mockResolvedValue({ success: true }),
  },
}));
vi.mock('@/services/work', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkServiceModule>();
  return {
    ...actual,
    workService: {
      refreshConversationViews: vi.fn().mockResolvedValue(undefined),
    },
  };
});
vi.mock('@/store/chat/utils/desktopNotification', () => ({
  notifyDesktopAgentFailed: vi.fn().mockResolvedValue(undefined),
  notifyDesktopHumanApprovalRequired: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));
const getExecutorMock = vi.fn();
vi.mock('@/store/tool/slices/builtin/executors', () => ({
  getExecutor: (...args: unknown[]) => getExecutorMock(...args),
  registerBuiltinToolExecutors: vi.fn().mockResolvedValue(undefined),
}));

describe('createGatewayEventHandler — stream lifecycle events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('stream_start', () => {
    it('should associate new message with operation and skip the DB refetch', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_start', {
          assistantMessage: { id: 'msg-step2', role: 'assistant' },
        }),
      );
      await flush();

      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-step2', 'op-1');
      // Native gateway ships the assistant seed on stream_start, so the client
      // inserts the message shell locally (createMessage) and must NOT trigger a
      // DB refetch — the refetch is what clobbered the streamed assistantGroup
      // with a stale placeholder.
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-step2', type: 'createMessage' }),
        { operationId: 'op-1' },
      );
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
      expect(emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: 'msg-step2',
            assistantMessageId: 'msg-step2',
            operationId: 'op-1',
            stepIndex: 0,
          }),
          sourceType: 'client.gateway.stream_start',
        }),
      );
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

    it('should resolve the new assistant from DB on hetero newStep when the event has no assistantMessage id', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      vi.mocked(messageService.getMessages).mockResolvedValueOnce([
        { id: 'msg-initial', role: 'assistant' } as any,
        { id: 'tool-1', role: 'tool' } as any,
        { id: 'msg-step2', role: 'assistant' } as any,
      ]);

      handler(makeEvent('stream_start', { newStep: true }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'world' }));
      await flush();

      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-step2', 'op-1');
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: { content: 'world' },
        }),
        { operationId: 'op-1' },
      );
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

    it('applies replace snapshots and drops redelivered snapshot seqs', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // `lh hetero exec` sends full-text snapshots: each carries the WHOLE
      // message so far and must replace, not append.
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'text',
          content: 'Hello',
          snapshotMode: 'replace',
          snapshotSeq: 1,
        }),
      );
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'text',
          content: 'Hello world',
          snapshotMode: 'replace',
          snapshotSeq: 2,
        }),
      );
      // Redelivery of seq 2 (server-side batch retry) — must be dropped, not
      // appended: appending would render "Hello worldHello world".
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'text',
          content: 'Hello world',
          snapshotMode: 'replace',
          snapshotSeq: 2,
        }),
      );
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { content: 'Hello world' },
        },
        { operationId: 'op-1' },
      );
      const textDispatches = store.internal_dispatchMessage.mock.calls.filter(
        ([action]: any[]) => action.type === 'updateMessage' && 'content' in action.value,
      );
      expect(textDispatches).toHaveLength(2); // the redelivered snapshot dispatched nothing
    });

    it('applies reasoning replace snapshots and drops redelivered seqs', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'reasoning',
          reasoning: 'thinking',
          snapshotMode: 'replace',
          snapshotSeq: 1,
        }),
      );
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'reasoning',
          reasoning: 'thinking done',
          snapshotMode: 'replace',
          snapshotSeq: 2,
        }),
      );
      // Redelivered seq 2 — appending it would render "thinking donethinking done".
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'reasoning',
          reasoning: 'thinking done',
          snapshotMode: 'replace',
          snapshotSeq: 2,
        }),
      );
      await flush();

      const reasoningDispatches = store.internal_dispatchMessage.mock.calls.filter(
        ([action]: any[]) => action.type === 'updateMessage' && 'reasoning' in action.value,
      );
      expect(reasoningDispatches).toHaveLength(2); // duplicate dropped
      expect(reasoningDispatches.at(-1)?.[0].value).toEqual({
        reasoning: { content: 'thinking done' },
      });
    });

    it('a snapshot replaces text accumulated from plain deltas', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hel' }));
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'text',
          content: 'Hello world',
          snapshotMode: 'replace',
          snapshotSeq: 1,
        }),
      );
      await flush();

      // Replace, not append — appending would render "HelHello world".
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

    it('should DROP subagent-tagged tool chunks so they do not leak into the main bubble', async () => {
      // Regression: on a live gateway / remote-CC stream, a subagent (Agent/Task)
      // inner tool chunk is tagged with `data.subagent`. It belongs to an
      // isolation Thread, not the main assistant. If dispatched here it appends
      // to the MAIN assistant's tools[] until the terminal DB refetch corrects it
      // ("流式时漏出来、结束后正常"). It must be dropped before any dispatch.
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          subagent: { parentToolCallId: 'toolu_agent', subagentMessageId: 'sub-1' },
          toolsCalling: [{ id: 'inner-1' }],
        }),
      );
      await flush();

      // Not dispatched onto the main assistant, and no tool-calling spinner.
      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
      expect(store.internal_toggleToolCallingStreaming).not.toHaveBeenCalled();
    });

    it('should still dispatch a NON-subagent tool chunk (drop is scoped to subagent)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [{ id: 'm-1' }] }),
      );
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        { id: 'msg-initial', type: 'updateMessage', value: { tools: [{ id: 'm-1' }] } },
        { operationId: 'op-1' },
      );
    });
  });

  describe('reasoning operation lifecycle', () => {
    it('starts a reasoning op on the first reasoning chunk and associates it with the current assistant', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'pondering' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: '...' }));
      await flush();

      // Only one startOperation call — second chunk reuses the existing op
      expect(store.startOperation).toHaveBeenCalledTimes(1);
      expect(store.startOperation).toHaveBeenCalledWith({
        context: expect.objectContaining({
          agentId: 'agent-1',
          messageId: 'msg-initial',
          topicId: 'topic-1',
        }),
        parentOperationId: 'op-1',
        type: 'reasoning',
      });
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith(
        'msg-initial',
        'op-reasoning-1',
      );
      // The reasoning op is NOT completed while only reasoning chunks have arrived
      expect(store.completeOperation).not.toHaveBeenCalled();
    });

    it('completes the reasoning op when text starts streaming', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'answer' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes the reasoning op when tools_calling starts', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [{ id: 'tc-1' }],
        }),
      );
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('starts a new reasoning op when reasoning resumes after text in the same stream', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'first pass' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'second pass' }));
      await flush();

      expect(store.startOperation).toHaveBeenCalledTimes(2);
      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-reasoning-2');
    });

    it('completes any open reasoning op on stream_end', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes any open reasoning op on stream_start (carry-over between steps)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes any open reasoning op on agent_runtime_end', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes any open reasoning op on error', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('error', { message: 'boom' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('does not start a reasoning op for text-only streams', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello' }));
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.startOperation).not.toHaveBeenCalled();
    });
  });

  describe('stream_end', () => {
    it('keeps visible loading for a plain no-tool stream boundary', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello back' }));
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      expect(store.updateOperationMetadata).not.toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-1');
    });

    it('keeps visible loading after stream_end when tool calls need another step', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [{ id: 'tc-1' }],
        }),
      );
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      expect(store.updateOperationMetadata).not.toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-1');
    });

    it('applies finalContent before ending a reasoning-only stream', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking text' }));
      handler(makeEvent('stream_end', { finalContent: 'final answer' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { content: 'final answer' },
        },
        { operationId: 'op-1' },
      );
      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
      expect(store.updateOperationMetadata).not.toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
    });

    it('should clear tool streaming', async () => {
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

  describe('visible_output_end', () => {
    it('marks visible loading done without completing the operation or clearing topic loading', async () => {
      const store = createMockStore();
      // The streamed content has landed in the store — the visible_output_end
      // guard only clears loading once the assistant row is present
      // with its content, so seed it here to represent that state.
      store.dbMessagesMap['main_agent-1_topic-1'] = [
        { content: 'hello back', id: 'msg-initial', role: 'assistant' },
      ];
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello back' }));
      handler(makeEvent('visible_output_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      expect(store.updateOperationMetadata).toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-1');
    });
  });
});
