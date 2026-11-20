// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

const mocks = vi.hoisted(() => ({
  assertAgentSignalTriggerRateLimit: vi.fn(),
  enqueueAgentSignalSourceEvent: vi.fn(),
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {},
}));

vi.mock('@/server/services/agentSignal', () => ({
  enqueueAgentSignalSourceEvent: mocks.enqueueAgentSignalSourceEvent,
}));

vi.mock('@/server/services/agentSignal/triggerRateLimit', () => ({
  assertAgentSignalTriggerRateLimit: mocks.assertAgentSignalTriggerRateLimit,
}));

vi.mock('@/server/services/agentSignal/services/receiptService', () => ({
  listAgentSignalReceipts: vi.fn(),
}));

const { AgentSignalRestService } = await import('../agent-signal.service');

describe('AgentSignalRestService.triggerSourceEvent', () => {
  const service = new AgentSignalRestService({} as LobeChatDatabase, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAgentSignalTriggerRateLimit.mockResolvedValue(undefined);
    mocks.enqueueAgentSignalSourceEvent.mockResolvedValue({ accepted: true });
  });

  /**
   * ROOT CAUSE:
   *
   * `POST /api/v1/signals/trigger` shares the tRPC trigger path and had no per-user rate limit,
   * so an API key could enqueue model-backed workflows without bound.
   */
  it('stops at the per-user trigger rate limit before enqueueing', async () => {
    mocks.assertAgentSignalTriggerRateLimit.mockRejectedValue(
      new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'limit' }),
    );

    await expect(
      service.triggerSourceEvent({
        agentId: 'agent-1',
        sourceType: 'agent.nightly_review.requested',
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(mocks.assertAgentSignalTriggerRateLimit).toHaveBeenCalledWith('user-1');
    expect(mocks.enqueueAgentSignalSourceEvent).not.toHaveBeenCalled();
  });

  it('enqueues with a server-derived nightly review guard key', async () => {
    await service.triggerSourceEvent({
      agentId: 'agent-1',
      payloadOverride: { localDate: '1999-01-01' },
      sourceId: 'nightly-review:user-1:agent-1:1999-01-01',
      sourceType: 'agent.nightly_review.requested',
    });

    const [sourceEvent] = mocks.enqueueAgentSignalSourceEvent.mock.calls[0]!;
    expect(sourceEvent.payload.localDate).not.toBe('1999-01-01');
    expect(sourceEvent.sourceId).not.toContain('1999-01-01');
  });

  /**
   * ROOT CAUSE:
   *
   * The REST route shares the trigger path, so an agent id set only through
   * `payloadOverride.agentId` reached the handlers without `assertAgentUsableBy` ever seeing it.
   */
  it('authorizes an agent id supplied only through payloadOverride', async () => {
    await service.triggerSourceEvent({
      payloadOverride: { agentId: 'foreign-agent' },
      sourceType: 'agent.user.message',
    });

    expect(mocks.enqueueAgentSignalSourceEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: 'foreign-agent', userId: 'user-1' }),
    );
  });

  it('rejects a payload agent id that differs from the requested agent', async () => {
    await expect(
      service.triggerSourceEvent({
        agentId: 'agent-1',
        payloadOverride: { agentId: 'foreign-agent' },
        sourceType: 'tool.outcome.failed',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.enqueueAgentSignalSourceEvent).not.toHaveBeenCalled();
  });
});
