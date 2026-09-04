// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StaleOperationReaper } from '../StaleOperationReaper';

const claimStaleRedriveMock = vi.fn();
const findByIdMock = vi.fn();
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(() => ({
    claimStaleRedrive: claimStaleRedriveMock,
    findById: findByIdMock,
  })),
}));

const finalizeAbandonedMock = vi.fn().mockResolvedValue({});
vi.mock('../AbandonOperationService', () => ({
  AbandonOperationService: vi.fn().mockImplementation(() => ({
    finalizeAbandoned: finalizeAbandonedMock,
  })),
}));

/** Minimal drizzle select chain returning `rows`. */
const buildDb = (rows: any[]) =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: vi.fn().mockResolvedValue(rows) }),
        }),
      }),
    }),
  }) as any;

const candidate = (id = 'op_x') => ({
  id,
  threadId: null,
  topicId: 'tpc_x',
  userId: 'user_x',
  workspaceId: null,
});

const buildCoordinator = (state: any) => ({ loadAgentState: vi.fn().mockResolvedValue(state) });
const buildQueue = () => ({ scheduleMessage: vi.fn().mockResolvedValue('msg_1') });

const runningState = (overrides: Record<string, any> = {}) => ({
  metadata: {},
  status: 'running',
  stepCount: 7,
  ...overrides,
});

const buildReaper = (rows: any[], state: any, queue: any = buildQueue()) =>
  new StaleOperationReaper(buildDb(rows), {
    coordinator: buildCoordinator(state) as any,
    queueService: queue as any,
  });

describe('StaleOperationReaper', () => {
  beforeEach(() => {
    claimStaleRedriveMock.mockReset().mockResolvedValue(1);
    findByIdMock.mockReset().mockResolvedValue(null);
    finalizeAbandonedMock.mockClear();
    process.env.APP_URL = 'https://app.lobehub.test';
  });

  it('re-queues the unfinished step of a resumable operation', async () => {
    const queue = buildQueue();
    const result = await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        // stepCount is the count of COMPLETED steps, so it is also the index
        // of the one that never finished.
        endpoint: 'https://app.lobehub.test/api/agent/run',
        operationId: 'op_x',
        stepIndex: 7,
      }),
    );
    expect(finalizeAbandonedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ abandoned: 0, examined: 1, redriven: 1 });
  });

  it('keys deduplication per attempt so a later redrive is not deduped away', async () => {
    const queue = buildQueue();
    claimStaleRedriveMock.mockResolvedValue(2);

    await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ deduplicationId: 'stale-redrive:op_x:7:2' }),
    );
  });

  it('redrives step 0 for an operation whose first step never executed', async () => {
    // Born-dead shape: state exists but is still `idle` at step 0.
    const queue = buildQueue();
    await buildReaper([candidate()], runningState({ status: 'idle', stepCount: 0 }), queue).sweep();

    expect(queue.scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0 }));
  });

  it('abandons instead of redriving when no resumable state survives', async () => {
    const queue = buildQueue();
    const result = await buildReaper([candidate()], null, queue).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(claimStaleRedriveMock).not.toHaveBeenCalled();
    expect(finalizeAbandonedMock).toHaveBeenCalledWith('op_x', 'stale_lease_unresumable');
    expect(result).toMatchObject({ abandoned: 1, redriven: 0 });
  });

  it.each(['waiting_for_human', 'waiting_for_async_tool'])(
    'never redrives a deliberately parked operation (%s)',
    async (status) => {
      const queue = buildQueue();
      await buildReaper([candidate()], runningState({ status }), queue).sweep();

      expect(queue.scheduleMessage).not.toHaveBeenCalled();
    },
  );

  it('leaves an operation alone when a heartbeat wins the claim race', async () => {
    const queue = buildQueue();
    claimStaleRedriveMock.mockResolvedValue(null);
    // Row is no longer stale → the step is alive and owns itself again.
    findByIdMock.mockResolvedValue({ status: 'running', updatedAt: new Date() });

    const result = await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(finalizeAbandonedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ alive: 1, redriven: 0 });
  });

  it('abandons once the redrive budget is spent', async () => {
    const queue = buildQueue();
    claimStaleRedriveMock.mockResolvedValue(null);
    // Still stale → the claim failed on the attempt budget, not a heartbeat.
    findByIdMock.mockResolvedValue({ status: 'running', updatedAt: new Date(0) });

    const result = await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(finalizeAbandonedMock).toHaveBeenCalledWith('op_x', 'stale_lease_redrive_exhausted');
    expect(result).toMatchObject({ abandoned: 1 });
  });

  it('keeps sweeping after one operation throws', async () => {
    const queue = buildQueue();
    queue.scheduleMessage
      .mockRejectedValueOnce(new Error('queue down'))
      .mockResolvedValueOnce('msg_2');

    const result = await buildReaper(
      [candidate('op_a'), candidate('op_b')],
      runningState(),
      queue,
    ).sweep();

    expect(result).toMatchObject({ examined: 2, redriven: 1 });
  });

  it('passes the caller stall window through to the claim', async () => {
    const before = Date.now();
    await buildReaper([candidate()], runningState()).sweep({ staleAfterMs: 60_000 });

    const [, staleBefore, maxAttempts] = claimStaleRedriveMock.mock.calls[0];
    expect(maxAttempts).toBe(3);
    expect(staleBefore.getTime()).toBeLessThanOrEqual(before - 60_000 + 5);
  });
});
