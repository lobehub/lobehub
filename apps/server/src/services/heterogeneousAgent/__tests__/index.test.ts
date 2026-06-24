// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';

import type { HeterogeneousPersistenceHandler } from '..';
import { HeterogeneousAgentService, StaleHeteroOperationError } from '..';

const createFakeStreamManager = () => {
  const published: Array<{ event: any; operationId: string }> = [];
  const manager: Partial<IStreamEventManager> = {
    publishStreamEvent: vi.fn(async (operationId, event) => {
      published.push({ event, operationId });
      return `${operationId}-${published.length}`;
    }),
  };
  return { manager: manager as IStreamEventManager, published };
};

const createFakePersistenceHandler = () => {
  const handler = {
    finish: vi.fn(async () => {}),
    ingest: vi.fn(async () => {}),
  };
  return handler as unknown as HeterogeneousPersistenceHandler & typeof handler;
};

const buildEvent = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown> = {},
): AgentStreamEvent => ({
  data,
  operationId: 'op-test',
  stepIndex,
  timestamp: 1_700_000_000_000 + stepIndex,
  type,
});

const createService = (overrides: { streamEventManager?: IStreamEventManager } = {}) => {
  const { manager, published } = createFakeStreamManager();
  const persistenceHandler = createFakePersistenceHandler();
  const service = new HeterogeneousAgentService({} as any, 'user-test', {
    persistenceHandler,
    streamEventManager: overrides.streamEventManager ?? manager,
  });
  return { manager, persistenceHandler, published, service };
};

describe('HeterogeneousAgentService', () => {
  describe('heteroIngest', () => {
    it('republishes every event through the stream manager preserving ordering', async () => {
      const { manager, published, service } = createService();

      const events: AgentStreamEvent[] = [
        buildEvent('stream_start', 0, { assistantMessage: { id: 'asst-1' } }),
        buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'hi' }),
        buildEvent('tool_start', 2, { parentMessageId: 'asst-1' }),
        buildEvent('tool_result', 3, { toolCallId: 'tc-1' }),
        buildEvent('agent_runtime_end', 4, { reason: 'success' }),
      ];

      await service.heteroIngest({
        agentType: 'claude-code',
        events,
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(manager.publishStreamEvent).toHaveBeenCalledTimes(5);

      // Verify events arrive in submission order with correct payloads
      published.forEach((entry, idx) => {
        expect(entry.operationId).toBe('op-1');
        expect(entry.event.type).toBe(events[idx].type);
        expect(entry.event.stepIndex).toBe(events[idx].stepIndex);
        expect(entry.event.data).toEqual(events[idx].data);
      });
    });

    it('uses the operationId from the request, not from the event itself', async () => {
      const { manager, service } = createService();

      // Producer-side bug simulation: events tagged with stale op id
      const events: AgentStreamEvent[] = [
        { ...buildEvent('stream_chunk', 0), operationId: 'op-stale' },
      ];

      await service.heteroIngest({
        agentType: 'claude-code',
        events,
        operationId: 'op-current',
        topicId: 'topic-1',
      });

      expect(manager.publishStreamEvent).toHaveBeenCalledWith(
        'op-current',
        expect.objectContaining({ stepIndex: 0, type: 'stream_chunk' }),
      );
    });

    it('propagates publish failures so the CLI ingester retries the batch', async () => {
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi
          .fn()
          .mockResolvedValueOnce('ok-0')
          .mockRejectedValueOnce(new Error('redis down')),
      };
      const persistenceHandler = createFakePersistenceHandler();
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await expect(
        service.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0), buildEvent('stream_chunk', 1)],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('redis down');
    });

    it('persists before publishing — DB is the source of truth fetchAndReplace reads', async () => {
      const callOrder: string[] = [];
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi.fn(async () => {
          callOrder.push('publish');
          return 'ok';
        }),
      };
      const persistenceHandler = {
        finish: vi.fn(async () => {}),
        ingest: vi.fn(async () => {
          callOrder.push('persist');
        }),
      } as unknown as HeterogeneousPersistenceHandler;
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await service.heteroIngest({
        agentType: 'claude-code',
        events: [buildEvent('stream_chunk', 0)],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(callOrder).toEqual(['persist', 'publish']);
    });

    it('throws on persistence failure without publishing — keep DB and stream consistent', async () => {
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi.fn(),
      };
      const persistenceHandler = {
        finish: vi.fn(async () => {}),
        ingest: vi.fn(async () => {
          throw new Error('topic missing runningOperation');
        }),
      } as unknown as HeterogeneousPersistenceHandler;
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await expect(
        service.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/runningOperation/);
      expect(manager.publishStreamEvent).not.toHaveBeenCalled();
    });

    it('ignores stale operation batches without publishing or throwing', async () => {
      const manager: Partial<IStreamEventManager> = {
        publishStreamEvent: vi.fn(),
      };
      const persistenceHandler = {
        finish: vi.fn(async () => {}),
        ingest: vi.fn(async () => {
          throw new StaleHeteroOperationError('stale old batch');
        }),
      } as unknown as HeterogeneousPersistenceHandler;
      const service = new HeterogeneousAgentService({} as any, 'user-test', {
        persistenceHandler,
        streamEventManager: manager as IStreamEventManager,
      });

      await expect(
        service.heteroIngest({
          agentType: 'claude-code',
          events: [buildEvent('stream_chunk', 0)],
          operationId: 'op-old',
          topicId: 'topic-1',
        }),
      ).resolves.toBeUndefined();
      expect(manager.publishStreamEvent).not.toHaveBeenCalled();
    });
  });

  describe('heteroFinish', () => {
    it('publishes a terminal agent_runtime_end with the high-level result', async () => {
      const { manager, published, service } = createService();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-1',
        result: 'success',
        sessionId: 'cc-session-abc',
        topicId: 'topic-1',
      });

      expect(manager.publishStreamEvent).toHaveBeenCalledTimes(1);
      expect(published[0].operationId).toBe('op-1');
      expect(published[0].event.type).toBe('agent_runtime_end');
      expect(published[0].event.data).toMatchObject({
        agentType: 'claude-code',
        operationId: 'op-1',
        reason: 'success',
        sessionId: 'cc-session-abc',
      });
    });

    it('forwards classified error details when the run failed', async () => {
      const { published, service } = createService();

      await service.heteroFinish({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        operationId: 'op-2',
        result: 'error',
        topicId: 'topic-2',
      });

      expect(published[0].event.data).toMatchObject({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        reason: 'error',
      });
      expect(published[0].event.data.sessionId).toBeUndefined();
    });

    it('handles cancelled runs and runs without sessionId', async () => {
      const { published, service } = createService();

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-3',
        result: 'cancelled',
        topicId: 'topic-3',
      });

      expect(published[0].event.data).toMatchObject({
        operationId: 'op-3',
        reason: 'cancelled',
      });
    });

    // The unified terminal funnel: heteroFinish must drive the run's lifecycle
    // hooks through the shared hookDispatcher (the same mechanism the normal LLM
    // path uses), which is what marks the owning task done/failed and fires any
    // IM bot completion callback. These register a local-mode handler hook for
    // the operation and assert heteroFinish dispatches it.
    const registerHook = (operationId: string): { onComplete: any; onError: any } => {
      const onComplete = vi.fn(async () => {});
      const onError = vi.fn(async () => {});
      const hooks: AgentHook[] = [
        { handler: onComplete, id: 'task-on-complete', type: 'onComplete' },
        { handler: onError, id: 'task-on-error', type: 'onError' },
      ];
      hookDispatcher.register(operationId, hooks);
      return { onComplete, onError };
    };

    it('fires onComplete (reason=done) hooks on a successful run', async () => {
      const { service } = createService();
      const { onComplete, onError } = registerHook('op-hook-success');

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-hook-success',
        result: 'success',
        topicId: 'topic-hook-1',
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0]).toMatchObject({
        operationId: 'op-hook-success',
        reason: 'done',
      });
      expect(onError).not.toHaveBeenCalled();
      // Hooks are unregistered after dispatch so a replay can't double-fire.
      expect(hookDispatcher.hasHooks('op-hook-success')).toBe(false);
    });

    it('fires both onComplete and onError (reason=error) hooks on a failed run', async () => {
      const { service } = createService();
      const { onComplete, onError } = registerHook('op-hook-error');

      await service.heteroFinish({
        agentType: 'codex',
        error: { message: 'auth required', type: 'AuthRequired' },
        operationId: 'op-hook-error',
        result: 'error',
        topicId: 'topic-hook-2',
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toMatchObject({
        errorMessage: 'auth required',
        errorType: 'AuthRequired',
        operationId: 'op-hook-error',
        reason: 'error',
      });
    });

    it('does NOT fire hooks on a cancelled run (the real result fires them)', async () => {
      const { service } = createService();
      const { onComplete, onError } = registerHook('op-hook-cancelled');

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-hook-cancelled',
        result: 'cancelled',
        topicId: 'topic-hook-3',
      });

      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      // Still registered — the subsequent success/error call will dispatch them.
      expect(hookDispatcher.hasHooks('op-hook-cancelled')).toBe(true);
      hookDispatcher.unregister('op-hook-cancelled');
    });
  });
});
