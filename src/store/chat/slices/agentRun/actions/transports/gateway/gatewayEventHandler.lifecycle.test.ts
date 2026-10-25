import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type * as WorkServiceModule from '@/services/work';

import { buildRunLifecycle } from '../../lifecycle/buildRunLifecycle';
import { createGatewayEventHandler } from './gatewayEventHandler';
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

describe('createGatewayEventHandler — run lifecycle characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Characterization net (LOCKS CURRENT BEHAVIOR for an upcoming
  // lifecycle refactor). These tests must PASS against the code as-is.
  // They describe what the gateway terminal path does NOW, not ideal
  // behavior. If something reads like a bug it is locked as-is with a note.
  describe('gateway terminal characterization (lifecycle refactor regression net)', () => {
    // CONTRACT: the `error` event FAILS the operation
    // (`failOperation`) via the shared run lifecycle — an errored run is a failed
    // run, not a completed one. Like `agent_runtime_end`'s cancel/park endings it
    // does NOT mark the topic unread (no unread badge for a failed generation).
    it('error event FAILS the operation and does NOT call markTopicUnread', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('error', { message: 'kaboom' }));
      await flush();

      // failOperation IS called on error; completeOperation is NOT.
      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(store.completeOperation).not.toHaveBeenCalled();
      // markTopicUnread is NOT — even though operations['op-1'] has a
      // context.agentId (which WOULD trigger it on a clean agent_runtime_end).
      expect(store.markTopicUnread).not.toHaveBeenCalled();
    });

    it.each(['no_executor', 'claim_timeout', 'not_delivered'])(
      'leaves a relay call no client took (%s) to the server: no failure, no row write',
      async (reason) => {
        const store = createMockStore();
        const handler = createHandler(store);

        // What a replay on reconnect delivers long after the run parked.
        handler(
          makeEvent('error', {
            error: { reason, recoverable: true },
            errorType: 'ClientLlmExecutorUnavailable',
            provider: 'lmstudio',
          }),
        );
        await flush();

        expect(store.failOperation).not.toHaveBeenCalled();
        expect(store.completeOperation).not.toHaveBeenCalled();
        expect(messageService.updateMessageError).not.toHaveBeenCalled();
        expect(store.internal_dispatchMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ value: expect.objectContaining({ error: expect.anything() }) }),
          expect.anything(),
        );
        // It shows what the server wrote instead (the waiting notice).
        expect(messageService.getMessages).toHaveBeenCalled();
      },
    );

    it('still fails the run on a relay error no client can fix (wait_timeout)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          error: { reason: 'wait_timeout', recoverable: true },
          errorType: 'ClientLlmExecutorUnavailable',
          provider: 'lmstudio',
        }),
      );
      await flush();

      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(messageService.updateMessageError).toHaveBeenCalled();
    });

    it('error event preserves runtime payload errorType and budget context', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const budget = { required: 12 };

      handler(
        makeEvent('error', {
          budget,
          error: { message: 'Budget exceeded' },
          errorType: 'FreePlanLimit',
          provider: 'lobehub',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: expect.objectContaining({
            budget,
            message: 'Budget exceeded',
            provider: 'lobehub',
          }),
          message: 'Budget exceeded',
          type: 'FreePlanLimit',
        }),
        expect.anything(),
      );
    });

    it('error event preserves _responseBody while merging payload error metadata', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          _responseBody: {
            error: { message: 'Payment required' },
            provider: 'lobehub',
          },
          error: { status: 402 },
          errorType: 'ProviderBizError',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: expect.objectContaining({
            error: { message: 'Payment required', status: 402 },
            message: 'Payment required',
            provider: 'lobehub',
          }),
          message: 'Payment required',
          type: 'InsufficientQuota',
        }),
        expect.anything(),
      );
    });

    it('error event preserves normalized body fields for trace-id error UI', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          body: {
            message: 'Upstream failed',
            traceId: 'trace-123',
          },
          error: 'Upstream failed',
          errorType: 'ProviderBizError',
          phase: 'llm_execution',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: expect.objectContaining({
            message: 'Upstream failed',
            traceId: 'trace-123',
          }),
          message: 'Upstream failed',
          type: 'ProviderBizError',
        }),
        expect.anything(),
      );
    });

    // Contrast probe: agent_runtime_end on the SAME operation (which has a
    // context.agentId) DOES mark unread completed — proving the negative
    // assertion above is the error path's own behavior, not a missing agentId.
    it('agent_runtime_end (same op, has context.agentId) DOES call markTopicUnread', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.markTopicUnread).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', topicId: 'topic-1' }),
      );
    });

    it.each(['interrupted', 'waiting_for_async_tool'])(
      'agent_runtime_end with reason "%s" completes the op but does NOT mark unread (cancel/park)',
      async (reason) => {
        const store = createMockStore();
        const handler = createHandler(store);

        handler(makeEvent('agent_runtime_end', { reason }));
        await flush();

        expect(store.completeOperation).toHaveBeenCalledWith('op-1');
        expect(store.markTopicUnread).not.toHaveBeenCalled();
      },
    );

    // the agent_runtime_end handler completes the op once via
    // the shared run lifecycle, and gateway.ts onSessionComplete no longer
    // double-completes (it only completes as the terminal-missing fallback). The
    // reducer is still idempotent (a stray second completeOperation on an
    // already-'completed' op is a no-throw, no-flip no-op) — locked here as a
    // safety net in case any path issues a redundant completion.
    it('completeOperation is idempotent: double-calling the same op leaves status=completed (no throw, no flip)', async () => {
      // Local harness whose completeOperation MIRRORS the real reducer
      // (operation/actions.ts completeOperation): set status to 'completed'
      // unless the op was 'cancelled'.
      const operations: Record<string, any> = {
        'op-1': {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
          metadata: { startTime: 0 },
          status: 'running',
        },
      };
      const completeOperation = vi.fn((operationId: string) => {
        const op = operations[operationId];
        if (!op) return;
        if (op.status !== 'cancelled') op.status = 'completed';
        op.metadata.endTime = Date.now();
      });
      const store = {
        ...createMockStore(),
        completeOperation,
        operations,
      } as ReturnType<typeof createMockStore>;
      const get = vi.fn(() => store) as any;
      const handler = createGatewayEventHandler(get, {
        assistantMessageId: 'msg-initial',
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
        operationId: 'op-1',
        runLifecycle: buildRunLifecycle(get, {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
          parentMessageId: 'msg-initial',
          parentMessageType: 'assistant',
          runId: 'op-1',
          runScope: 'top_level',
          runtimeType: 'gateway',
        }),
      });

      // First terminal completion (agent_runtime_end handler).
      handler(makeEvent('agent_runtime_end'));
      await flush();
      expect(operations['op-1'].status).toBe('completed');

      // Second completion (as onSessionComplete in gateway.ts would issue).
      store.completeOperation('op-1');
      expect(operations['op-1'].status).toBe('completed');
      expect(completeOperation).toHaveBeenCalledTimes(2);
    });

    // CURRENT BEHAVIOR: if the op was cancelled mid-flight, completeOperation
    // does NOT flip it to 'completed' (operation/actions.ts:288-291 preserves
    // the user's interruption state). Lock this so the refactor can't quietly
    // resurrect a cancelled op into 'completed' on a stray terminal event.
    it('completeOperation preserves a cancelled op (does not flip cancelled → completed)', async () => {
      const operations: Record<string, any> = {
        'op-1': {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
          metadata: { startTime: 0 },
          status: 'cancelled',
        },
      };
      const completeOperation = vi.fn((operationId: string) => {
        const op = operations[operationId];
        if (!op) return;
        if (op.status !== 'cancelled') op.status = 'completed';
        op.metadata.endTime = Date.now();
      });
      const store = {
        ...createMockStore(),
        completeOperation,
        operations,
      } as ReturnType<typeof createMockStore>;
      const get = vi.fn(() => store) as any;
      const handler = createGatewayEventHandler(get, {
        assistantMessageId: 'msg-initial',
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
        operationId: 'op-1',
        runLifecycle: buildRunLifecycle(get, {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
          parentMessageId: 'msg-initial',
          parentMessageType: 'assistant',
          runId: 'op-1',
          runScope: 'top_level',
          runtimeType: 'gateway',
        }),
      });

      handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(operations['op-1'].status).toBe('cancelled');
    });
  });

  describe('waiting_for_async_tool parked characterization (lifecycle refactor regression net)', () => {
    // CURRENT BEHAVIOR (gatewayEventHandler.ts:568-589): the `agent_runtime_end`
    // message-reconciliation branch special-cases BOTH `reason='interrupted'`
    // and `reason='waiting_for_async_tool'` together, gated by
    // `hasStreamedContent`. A `waiting_for_async_tool` terminal is a deferred-
    // tool PAUSE (the run parks waiting for an out-of-band async tool result),
    // and the server's `AgentRuntimeCoordinator.resolveUiMessages` deliberately
    // omits the uiMessages snapshot for this status. These tests lock the exact
    // client-side reconciliation the refactor must preserve.

    // (1) Parked WITH streamed content → preserve in-memory streamed content.
    // When the run parks after some server-confirmed state has landed
    // (server-assigned assistant id from stream_start + a text chunk), the
    // handler does NOT refetch from DB and does NOT replace messages — the
    // executor's partial-finalize catch is still racing to write the real
    // content, so a fetch here would clobber it with the LOADING placeholder.
    // This mirrors the `interrupted` skip exactly (same branch).
    it('should NOT refetch from DB when reason=waiting_for_async_tool AND stream had progressed (preserves streamed content)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Simulate a stream that had progressed: server-assigned assistant id
      // arrived via stream_start, then a text chunk landed (hasStreamedContent).
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial answer' }));
      await flush();
      vi.mocked(messageService.getMessages).mockClear();
      store.replaceMessages.mockClear();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      // Streamed content is preserved: no DB read, no replace.
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
    });

    // (2) Parked WITHOUT streamed content → fall back to DB refetch.
    // If the run parks BEFORE any server-confirmed state landed (no
    // stream_start id, no chunks → hasStreamedContent stays false), the
    // `(interrupted || waiting_for_async_tool) && hasStreamedContent` guard is
    // false, so control falls to the `else` DB-refetch branch. This reconciles
    // the optimistic tmp_* placeholders against server rows. CURRENT BEHAVIOR —
    // verified: the refetch DOES fire here.
    it('should refetch from DB when reason=waiting_for_async_tool but stream never progressed', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // No stream_start / stream_chunk before the park — hasStreamedContent
      // is still false.
      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      // Refetch IS called (falls through to the else branch).
      expect(messageService.getMessages).toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    // (3) uiMessages SoT still wins for a parked terminal. The
    // `Array.isArray(data?.uiMessages)` branch is checked FIRST (line 563),
    // BEFORE the `waiting_for_async_tool && hasStreamedContent` skip. So if a
    // server build DOES attach a snapshot on the park event, it takes
    // precedence over the preserve-streamed-content skip, even though the
    // stream had progressed.
    it('should use uiMessages SoT when reason=waiting_for_async_tool but server included a snapshot (precedence over the skip)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const uiMessages = [{ id: 'msg-server', role: 'assistant', content: 'partial' }];

      // Make the stream progress so hasStreamedContent is true — proving the
      // uiMessages branch wins even when the skip branch would otherwise apply.
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
      await flush();
      vi.mocked(messageService.getMessages).mockClear();
      store.replaceMessages.mockClear();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool', uiMessages }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalledWith(uiMessages, {
        action: 'gateway/agent_runtime_end',
        context: expect.any(Object),
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    // (4) Operation lifecycle on the parked terminal. A `waiting_for_async_tool`
    // park still completes the operation and tears down tool-calling streaming,
    // but it must NOT mark the topic unread — a park is not a finished
    // generation, and persisting it as `unread` would leave a stale badge on a
    // run that's only paused waiting for an async tool. (See `isCompletedRuntimeEnd`.)
    it('completes the operation but does NOT mark unread on a waiting_for_async_tool park', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
      await flush();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      // The parked terminal still completes the op + tears down tool streaming,
      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-server',
        undefined,
      );
      // …but does NOT surface an unread badge for the pause.
      expect(store.markTopicUnread).not.toHaveBeenCalled();
    });

    // (5) Contrast probe: the no-mark behavior is driven by the park `reason`,
    // not by whether content streamed — a parked terminal with NO streamed
    // content also skips the unread mark.
    it('does NOT mark unread on a waiting_for_async_tool park even with NO streamed content', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.markTopicUnread).not.toHaveBeenCalled();
    });
  });
});
