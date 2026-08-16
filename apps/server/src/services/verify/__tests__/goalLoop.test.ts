// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveGoalRoundBudget } from '../goalBudget';
import { maybeContinueGoalLoop, syncGoalToolState } from '../goalLoop';

const {
  runTaskMock,
  sumCostMock,
  findToolMessageIdMock,
  updateToolMessageMock,
  updateGoalStatusMock,
} = vi.hoisted(() => ({
  findToolMessageIdMock: vi.fn(),
  runTaskMock: vi.fn(),
  sumCostMock: vi.fn(),
  updateGoalStatusMock: vi.fn(),
  updateToolMessageMock: vi.fn(),
}));

vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn(() => ({ runTask: runTaskMock })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ sumCostByTask: sumCostMock })),
}));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(() => ({ updateStatus: updateGoalStatusMock })),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    findToolMessageIdByToolCallId: findToolMessageIdMock,
    updateToolMessage: updateToolMessageMock,
  })),
}));

const db = {} as any;
const baseTask = { id: 'task-1', identifier: 'T-1', totalTopics: 1 } as any;
const goalItem = (partial: Record<string, unknown>) =>
  ({ id: 'goal-1', maxRounds: null, maxTotalCost: null, ...partial }) as any;

describe('resolveGoalRoundBudget', () => {
  it('null → uncapped (write time already resolved the default)', () => {
    expect(resolveGoalRoundBudget({ maxRounds: null })).toBe(Number.POSITIVE_INFINITY);
  });
  it('numbers are floored at 2', () => {
    expect(resolveGoalRoundBudget({ maxRounds: 1 })).toBe(2);
    expect(resolveGoalRoundBudget({ maxRounds: 5 })).toBe(5);
  });
});

describe('maybeContinueGoalLoop', () => {
  beforeEach(() => {
    [runTaskMock, sumCostMock, updateGoalStatusMock].forEach((m) => m.mockReset());
  });

  it('spawns the next round with the goal trigger while budgets last', async () => {
    runTaskMock.mockResolvedValue({});
    const outcome = await maybeContinueGoalLoop({
      db,
      goal: goalItem({ maxRounds: 3 }),
      task: baseTask,
      userId: 'u1',
    });
    expect(outcome).toBe('continued');
    expect(runTaskMock).toHaveBeenCalledWith({ taskId: 'task-1', trigger: 'goal' });
    expect(updateGoalStatusMock).toHaveBeenCalledWith('goal-1', 'running');
  });

  it('stops at the round budget', async () => {
    const outcome = await maybeContinueGoalLoop({
      db,
      goal: goalItem({ maxRounds: 3 }),
      task: { ...baseTask, totalTopics: 3 },
      userId: 'u1',
    });
    expect(outcome).toBe('exhausted-rounds');
    expect(runTaskMock).not.toHaveBeenCalled();
    expect(updateGoalStatusMock).not.toHaveBeenCalled();
  });

  it('uncapped rounds (null) keep looping', async () => {
    runTaskMock.mockResolvedValue({});
    const outcome = await maybeContinueGoalLoop({
      db,
      goal: goalItem({ maxRounds: null }),
      task: { ...baseTask, totalTopics: 42 },
      userId: 'u1',
    });
    expect(outcome).toBe('continued');
  });

  it('stops when the cost budget is spent', async () => {
    sumCostMock.mockResolvedValue(21.5);
    const outcome = await maybeContinueGoalLoop({
      db,
      goal: goalItem({ maxRounds: 5, maxTotalCost: 20 }),
      task: baseTask,
      userId: 'u1',
    });
    expect(outcome).toBe('exhausted-cost');
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('ignores cost when no cost budget is set', async () => {
    runTaskMock.mockResolvedValue({});
    const outcome = await maybeContinueGoalLoop({
      db,
      goal: goalItem({ maxRounds: 5, maxTotalCost: null }),
      task: baseTask,
      userId: 'u1',
    });
    expect(outcome).toBe('continued');
    expect(sumCostMock).not.toHaveBeenCalled();
  });

  it('degrades a spawn failure (e.g. CONFLICT: topic still running) to spawn-failed', async () => {
    runTaskMock.mockRejectedValue(new Error('CONFLICT'));
    const outcome = await maybeContinueGoalLoop({
      db,
      goal: goalItem({ maxRounds: 3 }),
      task: baseTask,
      userId: 'u1',
    });
    expect(outcome).toBe('spawn-failed');
    expect(updateGoalStatusMock).not.toHaveBeenCalled();
  });
});

describe('syncGoalToolState', () => {
  beforeEach(() => {
    [findToolMessageIdMock, updateToolMessageMock].forEach((m) => m.mockReset());
  });

  it('no origin toolCallId → silent no-op', async () => {
    await syncGoalToolState({
      db,
      state: { phase: 'running' },
      task: { ...baseTask, context: {} },
      userId: 'u1',
    });
    expect(findToolMessageIdMock).not.toHaveBeenCalled();
  });

  it('pushes phase + counters onto the origin tool card', async () => {
    findToolMessageIdMock.mockResolvedValue('msg-9');
    await syncGoalToolState({
      db,
      state: { phase: 'paused', roundsRun: 3 },
      task: { ...baseTask, context: { origin: { toolCallId: 'call-1' } } },
      userId: 'u1',
    });
    expect(findToolMessageIdMock).toHaveBeenCalledWith('call-1');
    expect(updateToolMessageMock).toHaveBeenCalledWith('msg-9', {
      pluginState: expect.objectContaining({
        goalPhase: 'paused',
        phase: 'paused',
        roundsRun: 3,
        updatedAt: expect.any(String),
      }),
    });
  });

  it('missing tool card → no write, no throw', async () => {
    findToolMessageIdMock.mockResolvedValue(null);
    await syncGoalToolState({
      db,
      state: { phase: 'done' },
      task: { ...baseTask, context: { origin: { toolCallId: 'call-1' } } },
      userId: 'u1',
    });
    expect(updateToolMessageMock).not.toHaveBeenCalled();
  });
});
