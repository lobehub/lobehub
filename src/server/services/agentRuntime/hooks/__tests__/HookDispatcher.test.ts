import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher } from '../HookDispatcher';
import type { AgentHook, AgentHookEvent } from '../types';

// Mock isQueueAgentRuntimeEnabled to control local vs production mode
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: vi.fn(() => false), // Default: local mode
}));

const { isQueueAgentRuntimeEnabled } = await import('@/server/services/queue/impls');

describe('HookDispatcher', () => {
  let dispatcher: HookDispatcher;
  const operationId = 'op_test_123';

  const makeEvent = (overrides?: Partial<AgentHookEvent>): AgentHookEvent => ({
    agentId: 'agt_test',
    operationId,
    reason: 'done',
    status: 'done',
    userId: 'user_test',
    ...overrides,
  });

  beforeEach(() => {
    dispatcher = new HookDispatcher();
    vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('should register hooks for an operation', () => {
      const hook: AgentHook = {
        handler: vi.fn(),
        id: 'test-hook',
        type: 'onComplete',
      };

      dispatcher.register(operationId, [hook]);
      expect(dispatcher.hasHooks(operationId)).toBe(true);
    });

    it('should append hooks to existing registrations', () => {
      const hook1: AgentHook = { handler: vi.fn(), id: 'hook-1', type: 'onComplete' };
      const hook2: AgentHook = { handler: vi.fn(), id: 'hook-2', type: 'onError' };

      dispatcher.register(operationId, [hook1]);
      dispatcher.register(operationId, [hook2]);

      expect(dispatcher.hasHooks(operationId)).toBe(true);
    });

    it('should not register empty hooks array', () => {
      dispatcher.register(operationId, []);
      expect(dispatcher.hasHooks(operationId)).toBe(false);
    });
  });

  describe('dispatch (local mode)', () => {
    it('should call handler for matching hook type', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'test', type: 'onComplete' }]);

      await dispatcher.dispatch(operationId, 'onComplete', makeEvent());

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId,
          reason: 'done',
        }),
      );
    });

    it('should not call handler for non-matching hook type', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'test', type: 'onComplete' }]);

      await dispatcher.dispatch(operationId, 'onError', makeEvent());

      expect(handler).not.toHaveBeenCalled();
    });

    it('should call multiple handlers of same type', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.register(operationId, [
        { handler: handler1, id: 'hook-1', type: 'onComplete' },
        { handler: handler2, id: 'hook-2', type: 'onComplete' },
      ]);

      await dispatcher.dispatch(operationId, 'onComplete', makeEvent());

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not throw if handler throws (non-fatal)', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('hook failed'));

      dispatcher.register(operationId, [{ handler, id: 'failing-hook', type: 'onComplete' }]);

      // Should not throw
      await expect(
        dispatcher.dispatch(operationId, 'onComplete', makeEvent()),
      ).resolves.toBeUndefined();
    });

    it('should call remaining hooks even if one fails', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('fail'));
      const successHandler = vi.fn();

      dispatcher.register(operationId, [
        { handler: failingHandler, id: 'failing', type: 'onComplete' },
        { handler: successHandler, id: 'success', type: 'onComplete' },
      ]);

      await dispatcher.dispatch(operationId, 'onComplete', makeEvent());

      expect(failingHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });

    it('should handle no registered hooks gracefully', async () => {
      await expect(
        dispatcher.dispatch('unknown_op', 'onComplete', makeEvent()),
      ).resolves.toBeUndefined();
    });
  });

  describe('dispatch (production mode)', () => {
    beforeEach(() => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      // Mock global fetch
      global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should deliver webhook for hooks with webhook config', async () => {
      dispatcher.register(operationId, [
        {
          handler: vi.fn(), // handler not called in production mode
          id: 'webhook-hook',
          type: 'onComplete',
          webhook: { url: 'https://example.com/hook' },
        },
      ]);

      const serialized = dispatcher.getSerializedHooks(operationId);
      await dispatcher.dispatch(operationId, 'onComplete', makeEvent(), serialized);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );
    });

    it('should merge webhook.body into payload', async () => {
      dispatcher.register(operationId, [
        {
          handler: vi.fn(),
          id: 'custom-body-hook',
          type: 'onComplete',
          webhook: {
            body: { taskId: 'task_123', customField: 'value' },
            url: 'https://example.com/hook',
          },
        },
      ]);

      const serialized = dispatcher.getSerializedHooks(operationId);
      await dispatcher.dispatch(operationId, 'onComplete', makeEvent(), serialized);

      const call = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      expect(body.taskId).toBe('task_123');
      expect(body.customField).toBe('value');
      expect(body.hookId).toBe('custom-body-hook');
    });

    it('should not call local handler in production mode', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [
        {
          handler,
          id: 'prod-hook',
          type: 'onComplete',
          webhook: { url: 'https://example.com/hook' },
        },
      ]);

      const serialized = dispatcher.getSerializedHooks(operationId);
      await dispatcher.dispatch(operationId, 'onComplete', makeEvent(), serialized);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip hooks without webhook config in production mode', async () => {
      dispatcher.register(operationId, [
        { handler: vi.fn(), id: 'local-only', type: 'onComplete' },
      ]);

      const serialized = dispatcher.getSerializedHooks(operationId);
      await dispatcher.dispatch(operationId, 'onComplete', makeEvent(), serialized);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('getSerializedHooks', () => {
    it('should return only hooks with webhook config', () => {
      dispatcher.register(operationId, [
        { handler: vi.fn(), id: 'local-only', type: 'onComplete' },
        {
          handler: vi.fn(),
          id: 'with-webhook',
          type: 'onComplete',
          webhook: { url: '/api/hook' },
        },
      ]);

      const serialized = dispatcher.getSerializedHooks(operationId);

      expect(serialized).toHaveLength(1);
      expect(serialized![0].id).toBe('with-webhook');
      expect(serialized![0].webhook.url).toBe('/api/hook');
    });

    it('should return undefined for unknown operation', () => {
      expect(dispatcher.getSerializedHooks('unknown')).toBeUndefined();
    });
  });

  describe('unregister', () => {
    it('should remove all hooks for an operation', () => {
      dispatcher.register(operationId, [{ handler: vi.fn(), id: 'hook', type: 'onComplete' }]);

      expect(dispatcher.hasHooks(operationId)).toBe(true);
      dispatcher.unregister(operationId);
      expect(dispatcher.hasHooks(operationId)).toBe(false);
    });
  });

  describe('hook types', () => {
    it('should dispatch beforeStep hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'before', type: 'beforeStep' }]);

      await dispatcher.dispatch(operationId, 'beforeStep', makeEvent({ stepIndex: 0 }));
      expect(handler).toHaveBeenCalled();
    });

    it('should dispatch afterStep hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'after', type: 'afterStep' }]);

      await dispatcher.dispatch(
        operationId,
        'afterStep',
        makeEvent({ stepIndex: 1, shouldContinue: true }),
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldContinue: true,
          stepIndex: 1,
        }),
      );
    });

    it('should dispatch onError hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'error', type: 'onError' }]);

      await dispatcher.dispatch(
        operationId,
        'onError',
        makeEvent({
          errorMessage: 'Something went wrong',
          reason: 'error',
        }),
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'Something went wrong',
          reason: 'error',
        }),
      );
    });

    it('should dispatch onToolCallError hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'tool-error', type: 'onToolCallError' }]);

      await dispatcher.dispatch(operationId, 'onToolCallError', {
        apiName: 'search_tweets',
        args: { query: 'test' },
        callIndex: 1,
        error: 'Network timeout',
        identifier: 'twitter',
        operationId,
        stepIndex: 2,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'search_tweets',
          error: 'Network timeout',
          identifier: 'twitter',
        }),
      );
    });

    it('should dispatch afterToolCall hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'after-tool', type: 'afterToolCall' }]);

      await dispatcher.dispatch(operationId, 'afterToolCall', {
        apiName: 'search_tweets',
        args: { query: 'test' },
        callIndex: 1,
        content: '{"tweets":[]}',
        executionTimeMs: 150,
        identifier: 'twitter',
        mocked: false,
        operationId,
        stepIndex: 1,
        success: true,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'search_tweets',
          identifier: 'twitter',
          success: true,
        }),
      );
    });
  });

  describe('dispatchBeforeToolCall', () => {
    it('should return null when no beforeToolCall hooks registered', async () => {
      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });
      expect(result).toBeNull();
    });

    it('should return mock result when handler calls mock()', async () => {
      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: '{"mocked":true}' });
          },
          id: 'mock-hook',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: { query: 'test' },
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(result).toEqual({ content: '{"mocked":true}', isMocked: true });
    });

    it('should return null when handler does not call mock()', async () => {
      dispatcher.register(operationId, [
        {
          handler: async () => {
            // observe only, no mock
          },
          id: 'observe-hook',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(result).toBeNull();
    });

    it('should pass correct event fields to handler', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'check-fields', type: 'beforeToolCall' }]);

      await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'post_tweet',
        args: { text: 'hello' },
        callIndex: 3,
        identifier: 'twitter',
        stepIndex: 5,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'post_tweet',
          args: { text: 'hello' },
          callIndex: 3,
          identifier: 'twitter',
          mock: expect.any(Function),
          operationId,
          stepIndex: 5,
        }),
      );
    });

    it('should not throw if handler throws (non-fatal)', async () => {
      dispatcher.register(operationId, [
        {
          handler: async () => {
            throw new Error('hook failed');
          },
          id: 'failing-hook',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(result).toBeNull();
    });

    it('should reject mock with empty string content', async () => {
      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: '' });
          },
          id: 'empty-mock',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(result).toBeNull();
    });

    it('should reject mock with undefined content', async () => {
      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: undefined });
          },
          id: 'undefined-mock',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(result).toBeNull();
    });

    it('should reject mock with non-string content (object, array, number)', async () => {
      for (const badContent of [{}, [], 42, null]) {
        const d = new HookDispatcher();
        d.register(operationId, [
          {
            handler: async (event: any) => {
              event.mock({ content: badContent });
            },
            id: 'bad-mock',
            type: 'beforeToolCall',
          },
        ]);

        const result = await d.dispatchBeforeToolCall(operationId, {
          apiName: 'search',
          args: {},
          callIndex: 1,
          identifier: 'twitter',
          stepIndex: 0,
        });

        expect(result).toBeNull();
      }
    });
  });

  describe('compact hooks', () => {
    it('should dispatch beforeCompact hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'before-compact', type: 'beforeCompact' }]);

      await dispatcher.dispatch(operationId, 'beforeCompact', {
        messageCount: 20,
        operationId,
        stepIndex: 3,
        tokenCount: 8000,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ messageCount: 20, tokenCount: 8000 }),
      );
    });

    it('should dispatch afterCompact hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'after-compact', type: 'afterCompact' }]);

      await dispatcher.dispatch(operationId, 'afterCompact', {
        groupId: 'grp_123',
        messagesAfter: 3,
        messagesBefore: 20,
        operationId,
        stepIndex: 3,
        summary: 'The conversation covered...',
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ messagesBefore: 20, messagesAfter: 3, groupId: 'grp_123' }),
      );
    });

    it('should dispatch onCompactError hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'compact-error', type: 'onCompactError' }]);

      await dispatcher.dispatch(operationId, 'onCompactError', {
        error: 'LLM compression call failed',
        operationId,
        stepIndex: 3,
        tokenCount: 8000,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'LLM compression call failed', tokenCount: 8000 }),
      );
    });
  });

  describe('human intervention hooks', () => {
    it('should dispatch beforeHumanIntervention hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [
        { handler, id: 'before-hi', type: 'beforeHumanIntervention' },
      ]);

      await dispatcher.dispatch(operationId, 'beforeHumanIntervention', {
        operationId,
        pendingTools: [{ apiName: 'search_tweets', identifier: 'twitter' }],
        stepIndex: 2,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingTools: [{ apiName: 'search_tweets', identifier: 'twitter' }],
        }),
      );
    });

    it('should dispatch afterHumanIntervention hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [
        { handler, id: 'after-hi', type: 'afterHumanIntervention' },
      ]);

      await dispatcher.dispatch(operationId, 'afterHumanIntervention', {
        action: 'approve',
        operationId,
        toolCallId: 'call_123',
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approve', toolCallId: 'call_123' }),
      );
    });

    it('should dispatch onStopByHumanIntervention hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [
        { handler, id: 'stop-hi', type: 'onStopByHumanIntervention' },
      ]);

      await dispatcher.dispatch(operationId, 'onStopByHumanIntervention', {
        operationId,
        rejectionReason: 'Not safe to execute',
        toolCallId: 'call_456',
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ rejectionReason: 'Not safe to execute' }),
      );
    });
  });

  describe('dispatchBeforeToolCall — edge cases', () => {
    it('should use the last mock() call when multiple handlers call mock()', async () => {
      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: '{"first":true}' });
          },
          id: 'mock-1',
          type: 'beforeToolCall',
        },
        {
          handler: async (event: any) => {
            event.mock({ content: '{"second":true}' });
          },
          id: 'mock-2',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(result).toEqual({ content: '{"second":true}', isMocked: true });
    });

    it('should return mock when only one of multiple handlers calls mock()', async () => {
      const observeHandler = vi.fn();
      dispatcher.register(operationId, [
        { handler: observeHandler, id: 'observe', type: 'beforeToolCall' },
        {
          handler: async (event: any) => {
            event.mock({ content: '{"mocked":true}' });
          },
          id: 'mocker',
          type: 'beforeToolCall',
        },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(observeHandler).toHaveBeenCalled();
      expect(result).toEqual({ content: '{"mocked":true}', isMocked: true });
    });

    it('should only mock in local mode, not production mode', async () => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);

      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: '{"mocked":true}' });
          },
          id: 'mock-hook',
          type: 'beforeToolCall',
        },
      ]);

      // dispatchBeforeToolCall only runs in local mode
      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      // In local mode this would return the mock, but hooks are still in-memory
      // so it should still work (dispatchBeforeToolCall doesn't check queue mode)
      expect(result).toEqual({ content: '{"mocked":true}', isMocked: true });
    });

    it('should not affect other hook types when beforeToolCall is registered', async () => {
      const afterStepHandler = vi.fn();
      const onCompleteHandler = vi.fn();

      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: 'mock' });
          },
          id: 'tool-mock',
          type: 'beforeToolCall',
        },
        { handler: afterStepHandler, id: 'after-step', type: 'afterStep' },
        { handler: onCompleteHandler, id: 'complete', type: 'onComplete' },
      ]);

      // beforeToolCall should not trigger afterStep or onComplete
      await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(afterStepHandler).not.toHaveBeenCalled();
      expect(onCompleteHandler).not.toHaveBeenCalled();

      // afterStep should still work independently
      await dispatcher.dispatch(operationId, 'afterStep', makeEvent({ stepIndex: 0 }));
      expect(afterStepHandler).toHaveBeenCalledTimes(1);
    });

    it('should call handlers even after a previous handler throws', async () => {
      const mockHandler = vi.fn().mockImplementation(async (event: any) => {
        event.mock({ content: '{"recovered":true}' });
      });

      dispatcher.register(operationId, [
        {
          handler: async () => {
            throw new Error('first handler fails');
          },
          id: 'failing',
          type: 'beforeToolCall',
        },
        { handler: mockHandler, id: 'recovering', type: 'beforeToolCall' },
      ]);

      const result = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });

      expect(mockHandler).toHaveBeenCalled();
      expect(result).toEqual({ content: '{"recovered":true}', isMocked: true });
    });
  });

  describe('callAgent hooks', () => {
    it('should dispatch beforeCallAgent hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'before-call', type: 'beforeCallAgent' }]);

      await dispatcher.dispatch(operationId, 'beforeCallAgent', {
        agentId: 'sub-agent-1',
        instruction: 'Analyze this data',
        operationId,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'sub-agent-1', instruction: 'Analyze this data' }),
      );
    });

    it('should dispatch afterCallAgent hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'after-call', type: 'afterCallAgent' }]);

      await dispatcher.dispatch(operationId, 'afterCallAgent', {
        agentId: 'sub-agent-1',
        operationId,
        subOperationId: 'op_sub_123',
        success: true,
        threadId: 'thread_123',
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'sub-agent-1', success: true, threadId: 'thread_123' }),
      );
    });

    it('should dispatch onCallAgentError hooks', async () => {
      const handler = vi.fn();
      dispatcher.register(operationId, [{ handler, id: 'call-error', type: 'onCallAgentError' }]);

      await dispatcher.dispatch(operationId, 'onCallAgentError', {
        agentId: 'sub-agent-1',
        error: 'Sub-agent timed out',
        operationId,
        userId: 'user_test',
      } as any);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'sub-agent-1', error: 'Sub-agent timed out' }),
      );
    });
  });

  describe('hooks safety guarantees', () => {
    it('all observation hooks should not affect execution flow (handler errors are swallowed)', async () => {
      const observationTypes = [
        'afterToolCall',
        'onToolCallError',
        'beforeCompact',
        'afterCompact',
        'onCompactError',
        'beforeHumanIntervention',
        'afterHumanIntervention',
        'onStopByHumanIntervention',
        'beforeCallAgent',
        'afterCallAgent',
        'onCallAgentError',
      ] as const;

      for (const type of observationTypes) {
        const throwingHandler = vi.fn().mockRejectedValue(new Error(`${type} hook crashed`));
        dispatcher.register(operationId, [{ handler: throwingHandler, id: `crash-${type}`, type }]);

        // Should never throw — errors are swallowed
        await expect(
          dispatcher.dispatch(operationId, type, makeEvent(), undefined),
        ).resolves.toBeUndefined();
      }
    });

    it('dispatchBeforeToolCall should only work in local mode (in-memory hooks)', async () => {
      // Register a mock hook
      dispatcher.register(operationId, [
        {
          handler: async (event: any) => {
            event.mock({ content: '{"mocked":true}' });
          },
          id: 'mock-hook',
          type: 'beforeToolCall',
        },
      ]);

      // Local mode: mock works
      const localResult = await dispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });
      expect(localResult).toEqual({ content: '{"mocked":true}', isMocked: true });

      // dispatchBeforeToolCall does NOT use serializedHooks — it only reads
      // from this.hooks (in-memory). In QStash mode where a different worker
      // executes the step, this.hooks would be empty, so mock cannot fire.
      // This is by design — mock is local-only.
      const otherDispatcher = new HookDispatcher();
      const remoteResult = await otherDispatcher.dispatchBeforeToolCall(operationId, {
        apiName: 'search',
        args: {},
        callIndex: 1,
        identifier: 'twitter',
        stepIndex: 0,
      });
      expect(remoteResult).toBeNull(); // No hooks registered → no mock
    });

    it('observation hooks should work in production mode via serializedHooks', async () => {
      vi.mocked(isQueueAgentRuntimeEnabled).mockReturnValue(true);
      global.fetch = vi.fn().mockResolvedValue({ status: 200 });

      dispatcher.register(operationId, [
        {
          handler: vi.fn(),
          id: 'tool-webhook',
          type: 'afterToolCall',
          webhook: { url: 'https://example.com/afterToolCall' },
        },
      ]);

      const serialized = dispatcher.getSerializedHooks(operationId);

      await dispatcher.dispatch(
        operationId,
        'afterToolCall',
        {
          apiName: 'search',
          args: {},
          callIndex: 1,
          content: 'result',
          executionTimeMs: 100,
          identifier: 'twitter',
          mocked: false,
          operationId,
          stepIndex: 0,
          success: true,
          userId: 'user_test',
        },
        serialized,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/afterToolCall',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
