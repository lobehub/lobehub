import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type * as WorkServiceModule from '@/services/work';
import { workService } from '@/services/work';
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

describe('createGatewayEventHandler — terminal and error events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('agent_runtime_end', () => {
    it('should complete operation and refresh messages', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.replaceMessages).toHaveBeenCalled();
      expect(workService.refreshConversationViews).not.toHaveBeenCalled();
    });

    it('should refresh Work views once after a run with a Work-mutating tool', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('tool_end', {
          isSuccess: true,
          payload: {
            parentMessageId: 'msg-parent',
            toolCalling: {
              apiName: 'createTask',
              arguments: '{}',
              id: 'tool-call-1',
              identifier: 'lobe-task',
            },
          },
          result: { success: true, workRegistration: { type: 'task' } },
        }),
      );
      handler(makeEvent('agent_runtime_end', { uiMessages: [] }));
      await flush();

      expect(workService.refreshConversationViews).toHaveBeenCalledTimes(1);
      expect(workService.refreshConversationViews).toHaveBeenCalledWith('topic-1', undefined);
    });

    it('should emit runtime end signal with the current assistant message id', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(emitClientAgentSignalSourceEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: 'msg-step2',
            assistantMessageId: 'msg-step2',
            operationId: 'op-1',
          }),
          sourceType: 'client.gateway.runtime_end',
        }),
      );
    });

    // MID-stream cancel. The server-side coordinator skips the
    // uiMessages snapshot when state.status='interrupted' to avoid pushing
    // a LOADING_FLAT placeholder. The client must mirror that intent: when
    // `reason='interrupted'` arrives without uiMessages AND we already have
    // server-confirmed streamed state, do NOT fall back to a DB refetch —
    // the executor's partial-finalize catch is still racing to write the
    // real content, and a fetch here would return placeholder and clobber
    // in-memory streamed content.
    it('should NOT refetch from DB when reason=interrupted AND stream had progressed', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Simulate a stream that had progressed: server-assigned assistant id
      // arrived via stream_start, then a text chunk landed.
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial answer' }));
      await flush();
      vi.mocked(messageService.getMessages).mockClear();
      store.replaceMessages.mockClear();

      handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
    });

    // Reviewer feedback on PR #15173: if cancel arrives BEFORE any
    // stream activity (no server-assigned assistant id, no chunks), the
    // optimistic `tmp_*` placeholder messages are the only client-side
    // state and they need the DB refetch to be reconciled with the
    // server-side rows. Skipping the fallback would leave the tmp_*
    // ids stuck in the store indefinitely.
    it('should refetch from DB when reason=interrupted but stream never progressed', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // No stream_start / stream_chunk before the cancel — only optimistic
      // local state exists, no server-confirmed assistant id, no chunks.
      handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      // Refetch IS called so the tmp_* placeholders get reconciled.
      expect(messageService.getMessages).toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should still use uiMessages SoT when reason=interrupted but server included a snapshot', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const uiMessages = [{ id: 'msg-initial', role: 'assistant', content: 'partial' }];

      handler(
        makeEvent('agent_runtime_end', {
          reason: 'interrupted',
          uiMessages,
        }),
      );
      await flush();

      // uiMessages present takes precedence over the interrupted skip — the
      // SoT push is authoritative when server chose to send it.
      expect(store.replaceMessages).toHaveBeenCalledWith(uiMessages, {
        action: 'gateway/agent_runtime_end',
        context: expect.any(Object),
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should dispatch inline error, complete operation, and refresh messages', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('error', { message: 'Something went wrong' }));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      // error→fail: an errored gateway run FAILS the op (not complete).
      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(store.completeOperation).not.toHaveBeenCalled();
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: { message: 'Something went wrong' },
          message: 'Something went wrong',
          type: 'AgentRuntimeError',
        }),
        {
          agentId: 'agent-1',
          groupId: undefined,
          threadId: undefined,
          topicId: 'topic-1',
        },
      );

      // Should dispatch inline error immediately
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: {
            error: expect.objectContaining({
              body: { message: 'Something went wrong' },
              message: 'Something went wrong',
              type: 'AgentRuntimeError',
            }),
          },
        },
        { operationId: 'op-1' },
      );

      // Should also refresh messages
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should dispatch inline error with switched message ID', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('error', { error: 'Timeout' }));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-step2',
        undefined,
      );
      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(store.completeOperation).not.toHaveBeenCalled();
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-step2',
        expect.objectContaining({
          body: { error: 'Timeout' },
          message: 'Timeout',
          type: 'AgentRuntimeError',
        }),
        {
          agentId: 'agent-1',
          groupId: undefined,
          threadId: undefined,
          topicId: 'topic-1',
        },
      );

      // Should dispatch inline error with the switched message ID
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: expect.objectContaining({
            error: expect.objectContaining({
              message: 'Timeout',
              body: { error: 'Timeout' },
            }),
          }),
        }),
        { operationId: 'op-1' },
      );
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should preserve structured heterogeneous agent error payloads', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          body: {
            agentType: 'codex',
            code: 'cli_not_found',
            docsUrl: 'https://github.com/openai/codex',
            installCommands: ['npm install -g @openai/codex'],
            message: 'Codex CLI was not found',
          },
          message: 'Codex CLI was not found',
          type: 'AgentRuntimeError',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          errorRef: 'H8001',
          body: {
            agentType: 'codex',
            code: 'cli_not_found',
            details: { kind: 'cli_not_found' },
            docsUrl: 'https://github.com/openai/codex',
            installCommands: ['npm install -g @openai/codex'],
            message: 'Codex CLI was not found',
          },
          message: 'Codex CLI was not found',
          type: 'AgentRuntimeError',
        }),
        expect.any(Object),
      );
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          value: {
            error: expect.objectContaining({
              errorRef: 'H8001',
              body: {
                agentType: 'codex',
                code: 'cli_not_found',
                details: { kind: 'cli_not_found' },
                docsUrl: 'https://github.com/openai/codex',
                installCommands: ['npm install -g @openai/codex'],
                message: 'Codex CLI was not found',
              },
              message: 'Codex CLI was not found',
              type: 'AgentRuntimeError',
            }),
          },
        }),
        { operationId: 'op-1' },
      );
    });

    it('should prefer updateMessageError returned messages over an extra refetch', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const persistedMessages = [{ id: 'msg-initial', role: 'assistant' }];

      vi.mocked(messageService.updateMessageError).mockResolvedValueOnce({
        messages: persistedMessages as any,
        success: true,
      });

      handler(makeEvent('error', { message: 'Something went wrong' }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalledWith(persistedMessages, {
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    it('should ignore late events after an error so the inline error is not overwritten', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const persistedMessages = [{ id: 'msg-initial', role: 'assistant' }];

      vi.mocked(messageService.updateMessageError).mockResolvedValueOnce({
        messages: persistedMessages as any,
        success: true,
      });

      handler(makeEvent('error', { message: 'Something went wrong' }));
      handler(makeEvent('tool_end', { isSuccess: true }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'late chunk' }));
      await flush();

      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.internal_dispatchMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          value: { content: 'late chunk' },
        }),
        expect.any(Object),
      );
      expect(store.replaceMessages).toHaveBeenCalledTimes(1);
    });
  });

  describe('sequential processing', () => {
    it('should dispatch stream_chunk to the new assistant id after stream_start switches it', async () => {
      // Native gateway streams no longer await a DB fetch on stream_start
      // — but stream_chunk must still queue behind stream_start
      // so the chunk targets the NEW assistant id (from stream_start.data),
      // not the previous one.
      const store = createMockStore();
      const callOrder: string[] = [];

      store.internal_dispatchMessage.mockImplementation(() => {
        callOrder.push('dispatch');
      });
      store.associateMessageWithOperation.mockImplementation(() => {
        callOrder.push('associate');
      });

      const handler = createHandler(store);

      handler(
        makeEvent('stream_start', { assistantMessage: { id: 'msg-new', role: 'assistant' } }),
      );
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hello' }));
      await flush();

      // associate (from stream_start) precedes dispatch (from stream_chunk)
      const associateIdx = callOrder.indexOf('associate');
      const dispatchIdx = callOrder.indexOf('dispatch');
      expect(associateIdx).toBeGreaterThan(-1);
      expect(dispatchIdx).toBeGreaterThan(associateIdx);

      // Chunk targets the new id, proving the queue ordering held
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'msg-new', value: { content: 'Hello' } }),
        { operationId: 'op-1' },
      );
      // And no DB refetch was issued for the native stream
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    it('should still fetch from DB on stream_start when assistantMessage id is absent (hetero CLI)', async () => {
      // Hetero CLI adapters (Claude Code / Codex) never set
      // `assistantMessage.id` on stream_start, so the DB read is still
      // mandatory — it pulls the executor-created placeholder into
      // `dbMessagesMap` so subsequent chunks have a target.
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', {}));
      await flush();

      expect(messageService.getMessages).toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });
  });

  describe('multi-step integration', () => {
    it('should handle full LLM → tools → LLM cycle', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Step 1: LLM call
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-1', role: 'assistant' } }));
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

      // Tool execution — tool_end still refreshes from DB to pick up the
      // server-created tool message row.
      handler(makeEvent('tool_start', { parentMessageId: 'msg-1', toolCalling: tools[0] }));
      handler(makeEvent('tool_end', { isSuccess: true }));
      await flush();
      expect(store.replaceMessages).toHaveBeenCalled();

      // Step 2: Next LLM call with new assistant message — native stream_start
      // carries the id directly, so it must NOT trigger a DB refetch
      // Only the association switch happens.
      vi.clearAllMocks();
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-2', role: 'assistant' } }));
      await flush();
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-2', 'op-1');
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();

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
