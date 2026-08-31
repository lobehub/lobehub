import type { GoalTickOutcome, GoalTickResult } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createStore: vi.fn(() => null as unknown),
  execute: vi.fn(),
  status: vi.fn(),
  tick: vi.fn(),
  upsert: vi.fn(),
}));

// The trajectory write runs inside a transaction so it can hold a per-goal
// advisory lock, so the fake database has to model that seam.
vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({
    execute: mocks.execute,
    transaction: (run: (tx: unknown) => unknown) => run({ execute: mocks.execute }),
  }),
}));
vi.mock('./index', () => ({
  GoalService: vi.fn(() => ({ status: mocks.status, tick: mocks.tick })),
}));
vi.mock('./traceStore', () => ({ createDefaultGoalTraceStore: mocks.createStore }));
vi.mock('@/database/models/goalTrace', () => ({
  GoalTraceModel: vi.fn(() => ({ upsert: mocks.upsert })),
}));

const { advanceGoal, MAX_TICKS_PER_ADVANCE } = await import('./advanceGoal');

const tickResult = (outcome: GoalTickOutcome): GoalTickResult => ({
  goalId: 'goal-1',
  message: outcome,
  outcome,
});

const advance = () => advanceGoal({ goalId: 'goal-1', userId: 'user-1' });

describe('advanceGoal', () => {
  beforeEach(() => mocks.tick.mockReset());

  it('keeps ticking while the coordinator reports progress', async () => {
    mocks.tick
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('achieved'));

    const { result, ticks } = await advance();

    expect(ticks).toBe(3);
    expect(result.outcome).toBe('achieved');
  });

  it('hands off at waiting_external instead of polling a running task', async () => {
    // The Work Task's own settle queues the next advance. Polling here would
    // hold a worker open for the whole execution and duplicate that event.
    mocks.tick
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('waiting_external'));

    const { result, ticks } = await advance();

    expect(ticks).toBe(2);
    expect(result.outcome).toBe('waiting_external');
    expect(mocks.tick).toHaveBeenCalledTimes(2);
  });

  it.each(['achieved', 'failed', 'no_progress', 'waiting_human'] as const)(
    'stops on %s without another tick',
    async (outcome) => {
      mocks.tick.mockResolvedValue(tickResult(outcome));

      const { result } = await advance();

      expect(mocks.tick).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe(outcome);
    },
  );

  it('gives up at the per-advance limit rather than looping forever', async () => {
    mocks.tick.mockResolvedValue(tickResult('advanced'));

    const { ticks } = await advance();

    expect(ticks).toBe(MAX_TICKS_PER_ADVANCE);
    expect(mocks.tick).toHaveBeenCalledTimes(MAX_TICKS_PER_ADVANCE);
  });

  it('runs as the goal owner, not as the caller', async () => {
    const { GoalService } = await import('./index');
    mocks.tick.mockResolvedValue(tickResult('no_progress'));

    await advanceGoal({ goalId: 'goal-1', userId: 'owner-9', workspaceId: 'ws-3' });

    expect(GoalService).toHaveBeenCalledWith(expect.anything(), 'owner-9', 'ws-3');
  });
});

describe('advanceGoal trajectory recording', () => {
  const graphState = {
    decisions: [],
    edges: [],
    goal: { id: 'goal-1', status: 'running', title: 'Reproduce nanoGPT' },
    nodes: [],
  };

  const observation = (outcome: GoalTickOutcome) => ({
    at: 1000,
    branch: 'dispatch_task' as const,
    candidates: [],
    effects: [{ operationId: 'op_1', type: 'started_run' as const }],
    graphState,
    message: outcome,
    outcome,
  });

  /** Minimal store that only has to remember what was written. */
  const memoryStore = () => {
    const state: { partial?: any; saved?: any } = {};
    return {
      state,
      store: {
        get: async () => state.saved ?? null,
        list: async () => [],
        listPartials: async () => [],
        loadPartial: async () => state.partial ?? null,
        removePartial: async () => {
          state.partial = undefined;
        },
        save: async (trajectory: any) => {
          state.saved = trajectory;
        },
        savePartial: async (_id: string, partial: any) => {
          state.partial = partial;
        },
      },
    };
  };

  beforeEach(() => {
    mocks.tick.mockReset();
    mocks.status.mockReset();
    mocks.createStore.mockReset();
    mocks.upsert.mockReset();
    mocks.execute.mockReset();
  });

  it('records the ticks it observed, tagged with what triggered the advance', async () => {
    const { state, store } = memoryStore();
    mocks.createStore.mockReturnValue(store);
    mocks.status.mockResolvedValue('running');
    mocks.tick.mockImplementation(async (_goalId: string, options: any) => {
      options?.onDecision?.(observation('waiting_external'));
      return tickResult('waiting_external');
    });

    await advanceGoal({ goalId: 'goal-1', trigger: 'sweep', userId: 'user-1' });

    expect(state.partial.advances).toHaveLength(1);
    expect(state.partial.advances[0]).toMatchObject({
      childOperationIds: ['op_1'],
      seq: 0,
      trigger: 'sweep',
    });
    expect(state.partial.advances[0].ticks[0]).toMatchObject({ branch: 'dispatch_task', index: 0 });
    expect(state.saved).toBeUndefined();
  });

  it('serializes the write behind a per-goal lock so overlapping advances cannot erase one another', async () => {
    const { store } = memoryStore();
    mocks.createStore.mockReturnValue(store);
    mocks.status.mockResolvedValue('running');
    mocks.tick.mockImplementation(async (_goalId: string, options: any) => {
      options?.onDecision?.(observation('waiting_external'));
      return tickResult('waiting_external');
    });

    await advanceGoal({ goalId: 'goal-1', trigger: 'sweep', userId: 'user-1' });

    // Appending is read-modify-write on one object; without this the settle,
    // sweep and manual advances that overlap on a goal would pick the same
    // `seq` and the last writer would drop the others.
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.execute.mock.calls[0][0])).toContain('pg_advisory_xact_lock');
  });

  it('writes the observation row while the goal is still running, not only at the end', async () => {
    const { store } = memoryStore();
    mocks.createStore.mockReturnValue(store);
    mocks.status.mockResolvedValue('running');
    mocks.tick.mockImplementation(async (_goalId: string, options: any) => {
      options?.onDecision?.(observation('waiting_external'));
      return tickResult('waiting_external');
    });

    await advanceGoal({ goalId: 'goal-1', trigger: 'sweep', userId: 'user-1' });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        advancesByTrigger: { sweep: 1 },
        advancesTotal: 1,
        finalStatus: null,
        goalId: 'goal-1',
        ticksTotal: 1,
        traceS3Key: 'goal-traces/goal-1.json.zst',
        // The column name, not the rollup's. Pinned so the mapping in
        // `writeObservationRow` cannot drift silently.
        workOperations: 1,
      }),
    );
  });

  it('closes the trajectory once the goal itself is terminal', async () => {
    const { state, store } = memoryStore();
    mocks.createStore.mockReturnValue(store);
    mocks.status.mockResolvedValue('achieved');
    mocks.tick.mockImplementation(async (_goalId: string, options: any) => {
      options?.onDecision?.(observation('achieved'));
      return tickResult('achieved');
    });

    await advanceGoal({ goalId: 'goal-1', trigger: 'settle', userId: 'user-1' });

    expect(state.saved).toMatchObject({ completionReason: 'achieved', totalAdvances: 1 });
    expect(state.partial).toBeUndefined();
  });

  it('leaves the trajectory open for a goal that is merely parked', async () => {
    const { state, store } = memoryStore();
    mocks.createStore.mockReturnValue(store);
    mocks.status.mockResolvedValue('paused');
    mocks.tick.mockImplementation(async (_goalId: string, options: any) => {
      options?.onDecision?.(observation('no_progress'));
      return tickResult('no_progress');
    });

    await advanceGoal({ goalId: 'goal-1', trigger: 'sweep', userId: 'user-1' });

    expect(state.saved).toBeUndefined();
    expect(state.partial.advances).toHaveLength(1);
  });

  it('keeps what a failing advance managed to do, with the failure attached', async () => {
    const { state, store } = memoryStore();
    mocks.createStore.mockReturnValue(store);
    mocks.tick
      .mockImplementationOnce(async (_goalId: string, options: any) => {
        options?.onDecision?.(observation('advanced'));
        return tickResult('advanced');
      })
      .mockRejectedValueOnce(new Error('database is gone'));

    await expect(advanceGoal({ goalId: 'goal-1', userId: 'user-1' })).rejects.toThrow(
      'database is gone',
    );

    expect(state.partial.advances[0]).toMatchObject({
      error: { message: 'database is gone', type: 'advance' },
    });
    expect(state.partial.advances[0].ticks).toHaveLength(1);
  });

  it('does not read the goal status when tracing is off', async () => {
    mocks.createStore.mockReturnValue(null);
    mocks.tick.mockResolvedValue(tickResult('no_progress'));

    await advanceGoal({ goalId: 'goal-1', userId: 'user-1' });

    expect(mocks.status).not.toHaveBeenCalled();
  });
});
