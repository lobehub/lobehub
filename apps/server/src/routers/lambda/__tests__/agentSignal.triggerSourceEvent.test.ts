// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAgentSignalTriggerRateLimit: vi.fn(),
  enqueueAgentSignalSourceEvent: vi.fn(),
  invokedPermissions: [] as string[],
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

// Records which RBAC permission actually guarded the called procedure.
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function (permission: string) {
    return (opts: any) => {
      mocks.invokedPermissions.push(permission);
      return opts.next({ ctx: opts.ctx });
    };
  }),
}));

vi.mock('@/server/services/agentSignal', () => ({
  enqueueAgentSignalSourceEvent: mocks.enqueueAgentSignalSourceEvent,
}));

vi.mock('@/server/services/agentSignal/triggerRateLimit', () => ({
  assertAgentSignalTriggerRateLimit: mocks.assertAgentSignalTriggerRateLimit,
}));

vi.mock('@/server/services/agentSignal/services/receiptRollbackService', () => ({
  rollbackAgentSignalReceipt: vi.fn(),
}));

vi.mock('@/server/services/agentSignal/services/receiptService', () => ({
  listAgentSignalReceipts: vi.fn(),
}));

const { agentSignalRouter } = await import('../agentSignal');

describe('agentSignalRouter.triggerSourceEvent', () => {
  const ctx: any = { userId: 'user-1', workspaceId: null };

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invokedPermissions.length = 0;
    mocks.assertAgentSignalTriggerRateLimit.mockResolvedValue(undefined);
    mocks.enqueueAgentSignalSourceEvent.mockResolvedValue({
      accepted: true,
      scopeKey: 'scope',
      workflowRunId: 'run-1',
    });
  });

  /**
   * ROOT CAUSE:
   *
   * The procedure skipped both the RBAC gate `emitSourceEvent` and the REST route use and any
   * rate limit, so it could enqueue model-backed workflows without bound.
   */
  it('requires message:create and consumes the per-user trigger budget', async () => {
    const caller = agentSignalRouter.createCaller(ctx);

    await caller.triggerSourceEvent({
      agentId: 'agent-1',
      sourceType: 'agent.nightly_review.requested',
    });

    expect(mocks.invokedPermissions).toEqual(['message:create']);
    expect(mocks.assertAgentSignalTriggerRateLimit).toHaveBeenCalledWith('user-1');
    expect(mocks.enqueueAgentSignalSourceEvent).toHaveBeenCalledOnce();
  });

  it('does not enqueue once the rate limit rejects the call', async () => {
    mocks.assertAgentSignalTriggerRateLimit.mockRejectedValue(
      new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'limit' }),
    );
    const caller = agentSignalRouter.createCaller(ctx);

    await expect(
      caller.triggerSourceEvent({
        agentId: 'agent-1',
        sourceType: 'agent.nightly_review.requested',
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(mocks.enqueueAgentSignalSourceEvent).not.toHaveBeenCalled();
  });

  it('ignores caller-chosen nightly review guard inputs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-31T12:00:00.000Z'));
    const caller = agentSignalRouter.createCaller(ctx);

    await caller.triggerSourceEvent({
      agentId: 'agent-1',
      payloadOverride: { localDate: '1999-01-01' },
      sourceId: 'nightly-review:user-1:agent-1:1999-01-01',
      sourceType: 'agent.nightly_review.requested',
    });

    vi.useRealTimers();
    const [sourceEvent] = mocks.enqueueAgentSignalSourceEvent.mock.calls[0]!;
    expect(sourceEvent.payload.localDate).toBe('2026-05-31');
    expect(sourceEvent.sourceId).toBe('nightly-review:user-1:agent-1:2026-05-31');
  });

  /**
   * ROOT CAUSE:
   *
   * The enqueue path authorizes only `context.agentId`, which was the request's `agentId`. For
   * source types that need no agent (`agent.user.message`, tool outcomes) a caller could leave it
   * empty and point `payloadOverride.agentId` at an agent they cannot use.
   */
  it('authorizes an agent id supplied only through payloadOverride', async () => {
    const caller = agentSignalRouter.createCaller(ctx);

    await caller.triggerSourceEvent({
      payloadOverride: { agentId: 'foreign-agent' },
      sourceType: 'agent.user.message',
    });

    expect(mocks.enqueueAgentSignalSourceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ agentId: 'foreign-agent' }) }),
      expect.objectContaining({ agentId: 'foreign-agent', userId: 'user-1' }),
    );
  });

  it.each([
    ['a different agent', { agentId: 'agent-1', payloadOverride: { agentId: 'foreign-agent' } }],
    ['a non-string agent id', { payloadOverride: { agentId: 42 } }],
  ])('rejects a payload override naming %s', async (_label, request) => {
    const caller = agentSignalRouter.createCaller(ctx);

    await expect(
      caller.triggerSourceEvent({ ...request, sourceType: 'tool.outcome.failed' } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.enqueueAgentSignalSourceEvent).not.toHaveBeenCalled();
  });
});
