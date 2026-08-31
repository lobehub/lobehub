import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  advanceGoal: vi.fn(),
  create: vi.fn(),
  scheduleGoalAdvance: vi.fn(),
}));

vi.mock('@/server/services/goal', () => ({
  GoalService: vi.fn(() => ({ create: mocks.create })),
}));
vi.mock('@/server/services/goal/advanceGoal', () => ({ advanceGoal: mocks.advanceGoal }));
vi.mock('@/server/services/goal/scheduler', () => ({
  scheduleGoalAdvance: mocks.scheduleGoalAdvance,
}));

const { goalRuntime } = await import('../goal');

const runtime = () =>
  goalRuntime.factory({
    agentId: 'agt_1',
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
    workspaceId: 'ws-1',
  } as never);

const args = {
  criteria: [{ title: 'It works' }],
  instruction: 'do the thing',
  name: 'A goal',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ goal: { id: 'goal_1', title: 'A goal' } });
});

describe('goalRuntime.createGoal', () => {
  it('queues the advance so a failed kickoff is genuinely recoverable', async () => {
    // This path calls GoalService directly, so nothing else schedules the goal.
    // Without the queued advance the "the server will pick it up" message below
    // is false and the goal sits in `planning` forever.
    mocks.advanceGoal.mockRejectedValue(new Error('runner offline'));

    const result = await runtime().createGoal(args);

    expect(mocks.scheduleGoalAdvance).toHaveBeenCalledWith({
      goalId: 'goal_1',
      // The label survives the queue hop onto the trajectory, so a run can be
      // sliced by what drove it — asserted here rather than left loose.
      trigger: 'create',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Do not create it again');
  });

  it('reports the started goal when the kickoff succeeds', async () => {
    mocks.advanceGoal.mockResolvedValue({ result: { message: 'Started task T-1', taskId: 't1' } });

    const result = await runtime().createGoal(args);

    expect(mocks.scheduleGoalAdvance).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.content).toContain('Started task T-1');
  });
});
