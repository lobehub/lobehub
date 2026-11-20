// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';

const buildEnd = (data: Record<string, unknown>): AgentStreamEvent => ({
  data,
  operationId: 'op-1',
  stepIndex: 1,
  timestamp: 1_700_000_000_000,
  type: 'agent_runtime_end',
});

const createService = () => {
  const publishStreamEvent = vi.fn(async () => 'ok');
  const persistenceHandler = {
    filterUnpublishedEvents: vi.fn((_operationId: string, events: AgentStreamEvent[]) => events),
    finish: vi.fn(async () => undefined),
    ingest: vi.fn(async () => undefined),
    markEventPublished: vi.fn(),
    publishData: vi.fn((_operationId: string, event: AgentStreamEvent) => event.data),
  };
  const service = new HeterogeneousAgentService({} as any, 'user-1', {
    agentOperationModel: {
      findById: vi.fn(async () => ({ metadata: {} })),
      touchRunning: vi.fn(async () => true),
    } as any,
    persistenceHandler: persistenceHandler as any,
    snapshotStore: null,
    streamEventManager: { publishStreamEvent } as any,
    topicModel: {
      settleRunningOperation: vi.fn(async () => ({ status: 'settled' })),
      updateMetadata: vi.fn(async () => undefined),
    } as any,
  });
  return { persistenceHandler, publishStreamEvent, service };
};

const ingest = (service: HeterogeneousAgentService, event: AgentStreamEvent) =>
  service.heteroIngest({
    agentType: 'claude-code',
    events: [event],
    operationId: 'op-1',
    topicId: 'tpc-1',
  });

/**
 * The CLI's own end lands before heteroFinish clears the topic's running marker,
 * so publishing it finishes the run for clients while the server still says it
 * is running.
 */
describe('HeterogeneousAgentService.heteroIngest — in-stream agent_runtime_end', () => {
  it.each([[{}], [{ reason: 'success' }], [{ reason: 'complete' }]])(
    'leaves a clean end %j for heteroFinish to publish',
    async (data) => {
      const { persistenceHandler, publishStreamEvent, service } = createService();
      const event = buildEnd(data);

      await ingest(service, event);

      expect(persistenceHandler.ingest).toHaveBeenCalledOnce();
      expect(publishStreamEvent).not.toHaveBeenCalled();
      expect(persistenceHandler.markEventPublished).toHaveBeenCalledWith('op-1', event);
    },
  );

  it.each(['interrupted', 'cancelled'])(
    'still publishes a %s end, which heteroFinish cannot report',
    async (reason) => {
      const { publishStreamEvent, service } = createService();

      await ingest(service, buildEnd({ reason }));

      expect(publishStreamEvent).toHaveBeenCalledWith(
        'op-1',
        expect.objectContaining({ type: 'agent_runtime_end' }),
      );
    },
  );

  it('publishes exactly one end across a clean ingest and heteroFinish', async () => {
    vi.spyOn(CompletionLifecycle.prototype, 'completeOperation').mockResolvedValue(
      undefined as any,
    );
    const { publishStreamEvent, service } = createService();

    await ingest(service, buildEnd({}));
    await service.heteroFinish({
      agentType: 'claude-code',
      operationId: 'op-1',
      result: 'success',
      topicId: 'tpc-1',
    });

    expect(publishStreamEvent).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
