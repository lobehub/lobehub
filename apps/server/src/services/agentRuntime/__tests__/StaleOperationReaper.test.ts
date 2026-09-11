// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StaleOperationReaper } from '../StaleOperationReaper';

const claimStaleRedriveMock = vi.fn();
const settleStaleRunningMock = vi.fn();
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return {
      claimStaleRedrive: claimStaleRedriveMock,
      settleStaleRunning: settleStaleRunningMock,
    };
  }),
}));

const finalizeAbandonedMock = vi.fn().mockResolvedValue({});
vi.mock('../AbandonOperationService', () => ({
  AbandonOperationService: vi.fn().mockImplementation(function () {
    return { finalizeAbandoned: finalizeAbandonedMock };
  }),
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

const buildCoordinator = (state: any, history: any[] = []) => ({
  getExecutionHistory: vi.fn().mockResolvedValue(history),
  loadAgentState: vi.fn().mockResolvedValue(state),
});
const buildQueue = () => ({ scheduleMessage: vi.fn().mockResolvedValue('msg_1') });

const runningState = (overrides: Record<string, any> = {}) => ({
  metadata: {},
  status: 'running',
  stepCount: 7,
  ...overrides,
});

/** `saveStepResult` files the context for step N+1 under producing step N. */
const historyFor = (stepIndex: number, context: any = { phase: 'tool_result' }) => [
  { context: { phase: 'llm_result' }, stepIndex: stepIndex - 1 },
  { context, stepIndex },
];

const buildReaper = (
  rows: any[],
  state: any,
  queue: any = buildQueue(),
  history: any[] = historyFor(6),
) =>
  new StaleOperationReaper(buildDb(rows), {
    coordinator: buildCoordinator(state, history) as any,
    queueService: queue as any,
  });

describe('StaleOperationReaper', () => {
  beforeEach(() => {
    claimStaleRedriveMock.mockReset().mockResolvedValue(1);
    settleStaleRunningMock.mockReset().mockResolvedValue(true);
    finalizeAbandonedMock.mockClear();
    process.env.APP_URL = 'https://app.lobehub.test';
  });

  it('re-queues the unfinished step of a resumable operation', async () => {
    const queue = buildQueue();
    const result = await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        // The context step 6 produced for step 7 — without it `runtime.step`
        // would synthesize a `user_input` context and drop the pending work.
        context: { phase: 'tool_result' },
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

  it('redrives step 0 with the context the operation was created with', async () => {
    // Born-dead shape: state exists but is still `idle` at step 0. There is no
    // producing step, so the context comes off the state — the same field the
    // intervention continuation re-publishes from.
    const queue = buildQueue();
    await buildReaper(
      [candidate()],
      runningState({ initialContext: { phase: 'user_input' }, status: 'idle', stepCount: 0 }),
      queue,
      [],
    ).sweep();

    expect(queue.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ context: { phase: 'user_input' }, stepIndex: 0 }),
    );
  });

  it('abandons rather than redriving when the step context cannot be recovered', async () => {
    // Resuming with a synthesized context would re-enter at `user_input` and
    // silently drop pending tool work — a visible error is the lesser harm.
    const queue = buildQueue();
    const result = await buildReaper([candidate()], runningState(), queue, []).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(claimStaleRedriveMock).not.toHaveBeenCalled();
    // Irreversible cleanup only after the lease is re-checked atomically.
    expect(settleStaleRunningMock).toHaveBeenCalledWith('op_x', expect.any(Date));
    expect(finalizeAbandonedMock).toHaveBeenCalledWith('op_x', 'stale_lease_context_unavailable');
    expect(result).toMatchObject({ abandoned: 1, redriven: 0 });
  });

  it('never touches an operation with no coordinator state', async () => {
    // This is the shape of a HEALTHY heterogeneous run: an external Claude
    // Code / Codex CLI drives it, it never creates coordinator state, and it
    // only refreshes its lease on `heteroIngest` batches — so one long tool
    // call reads as stale here. Retiring it would make `heteroIngest` drop
    // every subsequent batch of a live session.
    const queue = buildQueue();
    const result = await buildReaper([candidate()], null, queue).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(claimStaleRedriveMock).not.toHaveBeenCalled();
    expect(finalizeAbandonedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ abandoned: 0, redriven: 0, skipped: 1 });
  });

  it.each(['waiting_for_human', 'waiting_for_async_tool'])(
    'never redrives a deliberately parked operation (%s)',
    async (status) => {
      const queue = buildQueue();
      const result = await buildReaper([candidate()], runningState({ status }), queue).sweep();

      expect(queue.scheduleMessage).not.toHaveBeenCalled();
      expect(finalizeAbandonedMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ skipped: 1 });
    },
  );

  it('leaves an operation alone when a heartbeat wins the claim race', async () => {
    const queue = buildQueue();
    claimStaleRedriveMock.mockResolvedValue(null);
    // The stale CAS finds the row refreshed → the step is alive and owns itself
    // again, so nothing irreversible may happen to it.
    settleStaleRunningMock.mockResolvedValue(false);

    const result = await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(finalizeAbandonedMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ alive: 1, redriven: 0 });
  });

  it('abandons once the redrive budget is spent', async () => {
    const queue = buildQueue();
    claimStaleRedriveMock.mockResolvedValue(null);
    // CAS still matches → the claim failed on the attempt budget, not a heartbeat.
    settleStaleRunningMock.mockResolvedValue(true);

    const result = await buildReaper([candidate()], runningState(), queue).sweep();

    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(settleStaleRunningMock).toHaveBeenCalledWith('op_x', expect.any(Date));
    expect(finalizeAbandonedMock).toHaveBeenCalledWith('op_x', 'stale_lease_redrive_exhausted');
    expect(result).toMatchObject({ abandoned: 1 });
  });

  it('refuses to abandon a run that heartbeated while its context was being read', async () => {
    // The window Codex flagged: `listStaleRunning` selected this row, then the
    // worker resumed while `resolveRedriveContext` was doing its Redis reads.
    // Abandoning is irreversible and user-visible, so it must re-check the
    // lease atomically rather than trust the stale select.
    const queue = buildQueue();
    settleStaleRunningMock.mockResolvedValue(false);

    const result = await buildReaper([candidate()], runningState(), queue, []).sweep();

    expect(finalizeAbandonedMock).not.toHaveBeenCalled();
    expect(queue.scheduleMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ abandoned: 0, alive: 1 });
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
