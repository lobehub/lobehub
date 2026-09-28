import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ advance: vi.fn(), create: vi.fn() }));

vi.mock('@/services/goal', () => ({
  goalService: { advance: mocks.advance, create: mocks.create },
}));
vi.mock('@lobechat/builtin-tool-task/client/executor', () => ({
  taskExecutor: { onAfterCall: vi.fn() },
}));

const { goalExecutor } = await import('./index');

const params = {
  criteria: [{ title: 'It works' }],
  instruction: 'do the thing',
  name: 'A goal',
};

describe('goalExecutor.createGoal', () => {
  it('reports the created goal even when starting it fails', async () => {
    // The goal is already committed. Reporting creation failure makes the agent
    // create a second goal, and both then do the same paid work.
    mocks.create.mockResolvedValue({ goal: { id: 'goal_1', title: 'A goal' } });
    mocks.advance.mockRejectedValue(new Error('device runner offline'));

    const result = await goalExecutor.createGoal(params, { agentId: 'agt_1' } as never);

    expect(result.success).toBe(true);
    expect((result.state as { goalId?: string }).goalId).toBe('goal_1');
    expect(result.content).toContain('device runner offline');
    expect(result.content).toContain('Do not create it again');
  });

  it('fails only when the goal itself was not created', async () => {
    mocks.create.mockRejectedValue(new Error('database is down'));

    const result = await goalExecutor.createGoal(params, { agentId: 'agt_1' } as never);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('GoalCreateFailed');
  });
});
