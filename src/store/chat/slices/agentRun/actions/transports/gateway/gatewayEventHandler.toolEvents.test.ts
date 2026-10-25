import { createAdapter } from '@lobechat/heterogeneous-agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkServiceModule from '@/services/work';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';

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

describe('createGatewayEventHandler — tool and step events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('step_start', () => {
    it('should notify desktop when human approval is required', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('step_start', {
          pendingToolsCalling: [{ id: 'tool-1' }],
          phase: 'human_approval',
          requiresApproval: true,
        }),
      );

      expect(notifyDesktopHumanApprovalRequired).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          agentId: 'agent-1',
          topicId: 'topic-1',
        }),
      );
      expect(store.updateTopicStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          status: 'waitingForHuman',
          topicId: 'topic-1',
        }),
      );
    });
  });

  describe('tool_execute', () => {
    const toolExecuteData = {
      apiName: 'readFile',
      arguments: '{"path":"/tmp/a.txt"}',
      executionTimeoutMs: 60_000,
      identifier: 'local-system',
      toolCallId: 'call_1',
    };

    it('forwards the payload to internal_executeClientTool with operationId', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_execute', toolExecuteData));
      await flush();

      expect(store.internal_executeClientTool).toHaveBeenCalledWith(toolExecuteData, {
        localOperationId: 'op-1',
        operationId: 'op-1',
      });
    });

    it('uses gatewayOperationId (WS key) when distinct from local operationId', async () => {
      // Locally the handler tracks `op-1` (used for message dispatch), but
      // the Agent Gateway WS is keyed on the server-side id `gw-op-server`.
      // The action must receive the latter so it can look up the live
      // AgentStreamClient in `gatewayConnections` and reply with tool_result.
      const store = createMockStore();
      const handler = createHandler(store, { gatewayOperationId: 'gw-op-server' });

      handler(makeEvent('tool_execute', toolExecuteData));
      await flush();

      expect(store.internal_executeClientTool).toHaveBeenCalledWith(toolExecuteData, {
        localOperationId: 'op-1',
        operationId: 'gw-op-server',
      });
    });

    it('is fire-and-forget — does not block the event pipeline', async () => {
      const store = createMockStore();
      // Simulate a slow tool execution that never resolves
      store.internal_executeClientTool.mockImplementation(() => new Promise(() => {}));
      const handler = createHandler(store);

      handler(makeEvent('tool_execute', toolExecuteData));
      // If the handler awaited the action, this subsequent stream_chunk would
      // be queued behind the pending promise forever. We assert it still runs.
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hi' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ value: { content: 'hi' } }),
        expect.any(Object),
      );
    });

    it('ignores tool_execute events without data', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_execute'));
      await flush();

      expect(store.internal_executeClientTool).not.toHaveBeenCalled();
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

    it('should dispatch onAfterCall when payload is wrapped as { parentMessageId, toolCalling } (real gateway shape)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onAfterCall });

      handler(
        makeEvent('tool_end', {
          isSuccess: true,
          payload: {
            parentMessageId: 'msg-parent',
            toolCalling: {
              apiName: 'deleteTask',
              arguments: JSON.stringify({ identifier: 'T-3' }),
              id: 'tc-1',
              identifier: 'lobe-task',
            },
          },
          result: { content: 'Task deleted', success: true },
        }),
      );
      await flush();

      expect(getExecutorMock).toHaveBeenCalledWith('lobe-task');
      expect(onAfterCall).toHaveBeenCalledWith({
        apiName: 'deleteTask',
        identifier: 'lobe-task',
        params: { identifier: 'T-3' },
        result: { content: 'Task deleted', success: true },
        toolCallId: 'tc-1',
        topicId: 'topic-1',
      });
    });

    it('should also dispatch onAfterCall when payload is the flat ChatToolPayload', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onAfterCall });

      handler(
        makeEvent('tool_end', {
          isSuccess: true,
          payload: {
            apiName: 'createTask',
            arguments: JSON.stringify({ name: 'New', instruction: 'do thing' }),
            id: 'tc-2',
            identifier: 'lobe-task',
          },
          result: { success: true },
        }),
      );
      await flush();

      expect(onAfterCall).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'createTask',
          identifier: 'lobe-task',
          toolCallId: 'tc-2',
        }),
      );
    });

    it('dispatches a Kimi Code Shell result through the registered renderer hook contract', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onAfterCall });
      const adapter = createAdapter('kimi-code');

      adapter.adapt({
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ command: 'git worktree add /tmp/kimi-wt' }),
              name: 'Shell',
            },
            id: 'kimi-shell-1',
            type: 'function',
          },
        ],
      });
      const toolEnd = adapter
        .adapt({ content: 'created', role: 'tool', tool_call_id: 'kimi-shell-1' })
        .find((event) => event.type === 'tool_end');

      expect(toolEnd).toBeDefined();
      handler(makeEvent('tool_end', toolEnd!.data));
      await flush();

      expect(getExecutorMock).toHaveBeenCalledWith('kimi-code');
      expect(onAfterCall).toHaveBeenCalledWith({
        apiName: 'Shell',
        identifier: 'kimi-code',
        params: { command: 'git worktree add /tmp/kimi-wt' },
        result: { content: 'created', success: true },
        toolCallId: 'kimi-shell-1',
        topicId: 'topic-1',
      });
    });

    it('should skip onAfterCall when payload identifier/apiName are missing', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn();
      getExecutorMock.mockReturnValue({ onAfterCall });

      handler(makeEvent('tool_end', { isSuccess: true, payload: { parentMessageId: 'x' } }));
      await flush();

      expect(onAfterCall).not.toHaveBeenCalled();
    });
  });

  describe('tool_start', () => {
    it('should dispatch onBeforeCall with the unwrapped ChatToolPayload', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onBeforeCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onBeforeCall });

      handler(
        makeEvent('tool_start', {
          parentMessageId: 'msg-parent',
          toolCalling: {
            apiName: 'editTask',
            arguments: JSON.stringify({ identifier: 'T-5', name: 'renamed' }),
            id: 'tc-3',
            identifier: 'lobe-task',
          },
        }),
      );
      await flush();

      expect(onBeforeCall).toHaveBeenCalledWith({
        apiName: 'editTask',
        identifier: 'lobe-task',
        params: { identifier: 'T-5', name: 'renamed' },
        toolCallId: 'tc-3',
        topicId: 'topic-1',
      });
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

  describe('step transition timing (orphan tool regression)', () => {
    /**
     * Verifies that after the executor fix, tools_calling events at step
     * boundaries arrive AFTER stream_start (correct order).
     *
     * Previously, the executor forwarded stream_chunk(tools_calling) sync
     * while stream_start was deferred via persistQueue — handler dispatched
     * tools to the OLD assistant. The fix defers all events during step
     * transition through persistQueue, guaranteeing correct ordering.
     */
    it('should dispatch new-step tools to the NEW assistant when events arrive in correct order', async () => {
      const store = createMockStore();
      const handler = createHandler(store, { assistantMessageId: 'ast-old' });

      // Step 1 init
      handler(makeEvent('stream_start', {}));
      await flush();

      handler(makeEvent('stream_end'));
      await flush();
      vi.clearAllMocks();

      // ── Step boundary: executor now guarantees stream_start arrives FIRST ──
      handler(makeEvent('stream_start', { assistantMessage: { id: 'ast-new' } }));
      await flush();

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [{ id: 'toolu_new' }],
        }),
      );
      await flush();

      // ── Assert: tools dispatched to the NEW assistant ──
      const toolsDispatch = store.internal_dispatchMessage.mock.calls.find(
        ([action]: any) => action.value?.tools,
      );
      expect(toolsDispatch).toBeDefined();
      expect(toolsDispatch![0].id).toBe('ast-new');
    });
  });
});
