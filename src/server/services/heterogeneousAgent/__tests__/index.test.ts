// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';

import type { HeterogeneousPersistenceHandler } from '..';
import { HeterogeneousAgentService } from '..';

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
  });
});
