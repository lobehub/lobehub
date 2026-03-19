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
  });
});
