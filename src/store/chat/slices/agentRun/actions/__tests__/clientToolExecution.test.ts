import type { ToolExecuteData } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientToolExecutionActionImpl } from '../transports/client/clientToolExecution';

// ─── Hoisted mocks ───

const { hasExecutorMock, invokeExecutorMock, invokeMcpToolCallMock } = vi.hoisted(() => ({
  hasExecutorMock: vi.fn(),
  invokeExecutorMock: vi.fn(),
  invokeMcpToolCallMock: vi.fn(),
}));

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  hasExecutor: hasExecutorMock,
  invokeExecutor: invokeExecutorMock,
}));

vi.mock('@/services/mcp', () => ({
  mcpService: {
    invokeMcpToolCall: invokeMcpToolCallMock,
  },
}));

// ─── Shared harness ───

function makeData(overrides: Partial<ToolExecuteData> = {}): ToolExecuteData {
  return {
    apiName: 'readFile',
    arguments: '{"path":"/tmp/a.txt"}',
    executionTimeoutMs: 60_000,
    identifier: 'local-system',
    toolCallId: 'call_1',
    ...overrides,
  };
}

function setup(options: { hasConnection?: boolean; sendReturns?: boolean } = {}) {
  const { hasConnection = true, sendReturns = true } = options;

  const sendToolResult = vi.fn(() => sendReturns);
  const abort = vi.fn();

  const state: any = {
    gatewayConnections: hasConnection
      ? {
          'op-1': {
            client: {
              connect: vi.fn(),
              disconnect: vi.fn(),
              on: vi.fn(),
              sendInterrupt: vi.fn(),
              sendToolResult,
            },
            status: 'connected',
          },
        }
      : {},
    operations: {
      'op-1': {
        abortController: { abort, signal: { aborted: false } },
        context: {
          agentId: 'agent-1',
          documentId: 'documents-row-id',
          scope: 'page',
          topicId: 'topic-1',
        },
      },
    },
    pendingClientToolExecutions: {},
  };

  const set = vi.fn((updater: any) => {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, patch);
  });
  const get = vi.fn(() => state);

  const action = new ClientToolExecutionActionImpl(set, get);
  return { abort, action, sendToolResult, state, set, get };
}

beforeEach(() => {
  hasExecutorMock.mockReset();
  invokeExecutorMock.mockReset();
  invokeMcpToolCallMock.mockReset();
});

// ─── Tests ───

describe('internal_executeClientTool', () => {
  describe('builtin dispatch', () => {
    it('sends a successful tool_result when the executor returns content', async () => {
      hasExecutorMock.mockReturnValue(true);
      invokeExecutorMock.mockResolvedValue({
        content: 'files: a.txt',
        state: { lastDir: '/tmp' },
        success: true,
      });
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(makeData(), { operationId: 'op-1' });

      expect(invokeExecutorMock).toHaveBeenCalledWith(
        'local-system',
        'readFile',
        { path: '/tmp/a.txt' },
        expect.objectContaining({
          agentId: 'agent-1',
          documentId: 'documents-row-id',
          messageId: 'call_1',
          operationId: 'op-1',
          scope: 'page',
          topicId: 'topic-1',
        }),
      );
      expect(sendToolResult).toHaveBeenCalledWith({
        content: 'files: a.txt',
        state: { lastDir: '/tmp' },
        success: true,
        toolCallId: 'call_1',
      });
    });

    it('sends a failure tool_result when the executor reports error', async () => {
      hasExecutorMock.mockReturnValue(true);
      invokeExecutorMock.mockResolvedValue({
        error: { message: 'ENOENT', type: 'fs_error' },
        success: false,
      });
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(makeData(), { operationId: 'op-1' });

      expect(sendToolResult).toHaveBeenCalledWith({
        content: 'ENOENT',
        error: { message: 'ENOENT', type: 'fs_error' },
        state: undefined,
        success: false,
        toolCallId: 'call_1',
      });
    });

    it('passes {} to executor when arguments is empty', async () => {
      hasExecutorMock.mockReturnValue(true);
      invokeExecutorMock.mockResolvedValue({ content: 'ok', success: true });
      const { action } = setup();

      await action.internal_executeClientTool(makeData({ arguments: '' }), {
        operationId: 'op-1',
      });

      expect(invokeExecutorMock).toHaveBeenCalledWith(
        'local-system',
        'readFile',
        {},
        expect.anything(),
      );
    });
  });

  describe('error paths never block the server', () => {
    it('sends tool_result with parse error when arguments are malformed', async () => {
      hasExecutorMock.mockReturnValue(true);
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(makeData({ arguments: '{not-json' }), {
        operationId: 'op-1',
      });

      expect(invokeExecutorMock).not.toHaveBeenCalled();
      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          content: null,
          error: expect.objectContaining({ type: 'arguments_parse_error' }),
          success: false,
          toolCallId: 'call_1',
        }),
      );
    });

    it('sends tool_result when invokeExecutor throws', async () => {
      hasExecutorMock.mockReturnValue(true);
      invokeExecutorMock.mockRejectedValue(new Error('ipc died'));
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(makeData(), { operationId: 'op-1' });

      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'ipc died',
            type: 'client_tool_execution_error',
          }),
          success: false,
          toolCallId: 'call_1',
        }),
      );
    });

    it('sends a not-found tool_result when no executor matches and MCP returns nothing', async () => {
      hasExecutorMock.mockReturnValue(false);
      invokeMcpToolCallMock.mockResolvedValue(undefined);
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(makeData({ identifier: 'unknown-tool' }), {
        operationId: 'op-1',
      });

      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ type: 'executor_not_found' }),
          success: false,
        }),
      );
    });

    it('does not throw when gateway connection is missing (server will timeout)', async () => {
      hasExecutorMock.mockReturnValue(true);
      invokeExecutorMock.mockResolvedValue({ content: 'ok', success: true });
      const { action, state } = setup({ hasConnection: false });

      await expect(
        action.internal_executeClientTool(makeData(), { operationId: 'op-1' }),
      ).resolves.toBeUndefined();

      // Pending state was cleared even when send couldn't happen
      expect(state.pendingClientToolExecutions).toEqual({});
    });
  });

  describe('MCP fallback', () => {
    it('routes to mcpService when no builtin executor registered', async () => {
      hasExecutorMock.mockReturnValue(false);
      invokeMcpToolCallMock.mockResolvedValue({
        content: 'mcp-ok',
        state: { cursor: 1 },
        success: true,
      });
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(
        makeData({ apiName: 'echo', identifier: 'mcp-demo' }),
        { operationId: 'op-1' },
      );

      expect(invokeMcpToolCallMock).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'echo',
          arguments: '{"path":"/tmp/a.txt"}',
          identifier: 'mcp-demo',
        }),
        expect.objectContaining({ topicId: 'topic-1' }),
      );
      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'mcp-ok',
          state: { cursor: 1 },
          success: true,
          toolCallId: 'call_1',
        }),
      );
    });

    it('sends failure tool_result when MCP returns an error result', async () => {
      hasExecutorMock.mockReturnValue(false);
      invokeMcpToolCallMock.mockResolvedValue({
        content: null,
        error: { message: 'mcp boom', type: 'mcp_error' },
        success: false,
      });
      const { action, sendToolResult } = setup();

      await action.internal_executeClientTool(makeData({ identifier: 'mcp-demo' }), {
        operationId: 'op-1',
      });

      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          content: null,
          error: expect.objectContaining({ message: 'mcp boom', type: 'mcp_error' }),
          success: false,
        }),
      );
    });
  });

  describe('execution timeout (Bug 2)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends a client_executor_timeout failure when the executor exceeds the deadline', async () => {
      hasExecutorMock.mockReturnValue(true);
      // Executor never resolves — only the race timeout can wake the action.
      invokeExecutorMock.mockReturnValue(new Promise(() => {}));
      const { action, sendToolResult, abort } = setup();

      const promise = action.internal_executeClientTool(makeData({ executionTimeoutMs: 2_000 }), {
        operationId: 'op-1',
      });

      // Fast-forward to the safety-buffered deadline (2_000 - 500 = 1_500ms).
      await vi.advanceTimersByTimeAsync(1_500);
      await promise;

      expect(abort).toHaveBeenCalledTimes(1);
      // Error message surfaces the budget so the LLM can adjust on retry.
      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.stringContaining('2000ms'),
            type: 'client_executor_timeout',
          }),
          success: false,
          toolCallId: 'call_1',
        }),
      );
    });

    it('does NOT trip the timeout when executor finishes before the deadline', async () => {
      hasExecutorMock.mockReturnValue(true);
      invokeExecutorMock.mockResolvedValue({ content: 'fast', success: true });
      const { action, sendToolResult, abort } = setup();

      await action.internal_executeClientTool(makeData({ executionTimeoutMs: 60_000 }), {
        operationId: 'op-1',
      });

      expect(abort).not.toHaveBeenCalled();
      expect(sendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'fast', success: true }),
      );
    });
  });

  describe('live gateway connection lookup (Bug 3)', () => {
    it('uses the connection present at send-time, not at action-entry time', async () => {
      hasExecutorMock.mockReturnValue(true);

      let resolver: (v: any) => void = () => {};
      invokeExecutorMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolver = resolve;
          }),
      );

      const { action, state } = setup({ hasConnection: false });

      // Kick off — at this moment gatewayConnections is empty.
      const promise = action.internal_executeClientTool(makeData(), {
        operationId: 'op-1',
      });

      // Simulate a reconnect landing while the executor is still running:
      // a fresh entry appears in gatewayConnections.
      const reconnectedSend = vi.fn(() => true);
      state.gatewayConnections['op-1'] = {
        client: {
          connect: vi.fn(),
          disconnect: vi.fn(),
          on: vi.fn(),
          sendInterrupt: vi.fn(),
          sendToolResult: reconnectedSend,
        },
        status: 'connected',
      };

      resolver({ content: 'late ok', success: true });
      await promise;

      expect(reconnectedSend).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'late ok', success: true }),
      );
    });
  });

  describe('exactly-once send tripwire (Bug 4)', () => {
    it('sends only one tool_result even if the executor resolves *and* the timeout fires', async () => {
      vi.useFakeTimers();
      try {
        hasExecutorMock.mockReturnValue(true);
        let resolver: (v: any) => void = () => {};
        invokeExecutorMock.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolver = resolve;
            }),
        );
        const { action, sendToolResult } = setup();

        const promise = action.internal_executeClientTool(makeData({ executionTimeoutMs: 2_000 }), {
          operationId: 'op-1',
        });

        // Resolve the executor right around the deadline.
        await vi.advanceTimersByTimeAsync(1_400);
        resolver({ content: 'just-in-time', success: true });
        await vi.advanceTimersByTimeAsync(500);
        await promise;

        // No matter which side won the race, we must send exactly once.
        expect(sendToolResult).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('pending state', () => {
    it('marks the call pending during execution and clears it afterwards', async () => {
      hasExecutorMock.mockReturnValue(true);
      let resolver: (v: any) => void = () => {};
      invokeExecutorMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolver = resolve;
          }),
      );
      const { action, state } = setup();

      const promise = action.internal_executeClientTool(makeData(), { operationId: 'op-1' });

      // Between start and resolve: pending map has the id
      await Promise.resolve();
      expect(state.pendingClientToolExecutions).toEqual({ call_1: true });

      resolver({ content: 'done', success: true });
      await promise;

      expect(state.pendingClientToolExecutions).toEqual({});
    });
  });
});
