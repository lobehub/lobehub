import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression test for the abandoned-reservation sweep
// (`apps/server/src/router-hono/workflows/agent-share/handlers/sweep.ts`):
//
// If the request process handling a share-visitor turn dies AFTER
// `AgentRuntimeService.createOperation` schedules the first queue message but
// BEFORE `AiAgentService.execAgent` reaches `confirmReservation`, the queued
// step still executes under the creator's credentials/budget — with no topic
// `runningOperation` marker for the visitor's `interruptTask` (or a later
// owner revocation) to ever find. Merely deleting the aged-out
// `agent_share_run_reservations` row (the previous behavior) freed the table
// but left that run billing the creator indefinitely past this sweep's
// 30-minute cutoff. This test asserts the handler actively interrupts every
// operation it sweeps, resolving each row's creator from `agents.userId`
// (the sweep is agent/owner-agnostic — see `sweepAbandonedReservations`'s
// JSDoc for why `agentId` rides along on each row).

const { getServerDB, sweepAbandonedReservations, interruptTask, dbSelect } = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  getServerDB: vi.fn(),
  interruptTask: vi.fn(),
  sweepAbandonedReservations: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB }));
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: { sweepAbandonedReservations },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({ interruptTask })),
}));

const makeContext = () => {
  const json = vi.fn((payload, status = 200) => ({ payload, status }));
  return { context: { json } as any, json };
};

describe('agent-share sweep handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptTask.mockResolvedValue({ success: true });

    // Chainable `db.select().from().where()` mock matching the handler's
    // single batched owner lookup.
    dbSelect.mockReturnValue({
      from: () => ({
        where: vi.fn().mockResolvedValue([{ id: 'agent-1', userId: 'creator-1' }]),
      }),
    });
    getServerDB.mockResolvedValue({ select: dbSelect });
  });

  it('interrupts every swept operation instead of only deleting its reservation', async () => {
    sweepAbandonedReservations.mockResolvedValue([
      { agentId: 'agent-1', operationId: 'op-orphaned', topicId: 'topic-1' },
    ]);

    const { sweep } = await import('./sweep');
    const { context, json } = makeContext();

    await sweep(context);

    expect(interruptTask).toHaveBeenCalledWith({
      operationId: 'op-orphaned',
      topicId: 'topic-1',
    });
    expect(json).toHaveBeenCalledWith({ deleted: 1, interrupted: 1, success: true });
  });

  it('is a no-op when nothing was swept', async () => {
    sweepAbandonedReservations.mockResolvedValue([]);

    const { sweep } = await import('./sweep');
    const { context, json } = makeContext();

    await sweep(context);

    expect(interruptTask).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ deleted: 0, interrupted: 0, success: true });
  });

  it('skips a row whose agent has since been deleted, without failing the sweep', async () => {
    sweepAbandonedReservations.mockResolvedValue([
      { agentId: 'agent-deleted', operationId: 'op-orphaned', topicId: 'topic-1' },
    ]);
    dbSelect.mockReturnValue({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) });

    const { sweep } = await import('./sweep');
    const { context, json } = makeContext();

    await sweep(context);

    expect(interruptTask).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ deleted: 1, interrupted: 0, success: true });
  });

  it('keeps interrupting remaining rows when one interrupt fails', async () => {
    sweepAbandonedReservations.mockResolvedValue([
      { agentId: 'agent-1', operationId: 'op-fails', topicId: 'topic-1' },
      { agentId: 'agent-1', operationId: 'op-succeeds', topicId: 'topic-2' },
    ]);
    interruptTask
      .mockRejectedValueOnce(new Error('transient gateway error'))
      .mockResolvedValueOnce({ success: true });

    const { sweep } = await import('./sweep');
    const { context, json } = makeContext();

    await sweep(context);

    expect(interruptTask).toHaveBeenCalledTimes(2);
    expect(json).toHaveBeenCalledWith({ deleted: 2, interrupted: 1, success: true });
  });
});
