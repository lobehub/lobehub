// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFromConversation } from './creation';

const mocks = vi.hoisted(() => ({ adoptConversationTurn: vi.fn() }));

vi.mock('../manager', () => ({
  GoalManagerService: vi.fn(function () {
    return { adoptConversationTurn: mocks.adoptConversationTurn };
  }),
}));

const modelConfig = { model: 'deepseek-flash', provider: 'lobehub' };

const setup = () => ({
  create: vi.fn().mockResolvedValue({ goal: { id: 'goal_1' } }),
  db: {},
  goalModel: { delete: vi.fn().mockResolvedValue(undefined) },
  graphModel: { getGraph: vi.fn().mockResolvedValue({ goal: { id: 'goal_1' } }) },
  resolveTopicRun: vi.fn().mockResolvedValue({ agentId: 'agt_1', topicId: 'tpc_1' }),
  setTaskModel: vi.fn().mockResolvedValue({ id: 'goal_1' }),
  userId: 'user-1',
  workspaceId: 'ws-1',
});

describe('createFromConversation with a task model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adoptConversationTurn.mockResolvedValue({ token: 'turn-token' });
  });

  // The turn snapshot covers the goal config; writing the model after adoption
  // made the run's first plan fail as stale_input.
  it('applies the model before adopting the planning turn', async () => {
    const ctx = setup();

    const result = await createFromConversation(ctx as any, 'op_1', {
      taskModelConfig: modelConfig,
      title: 'Goal',
    } as any);

    expect(ctx.setTaskModel).toHaveBeenCalledWith('goal_1', modelConfig);
    expect(ctx.setTaskModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.adoptConversationTurn.mock.invocationCallOrder[0],
    );
    expect(ctx.create.mock.calls[0][0]).not.toHaveProperty('taskModelConfig');
    expect(result.turnToken).toBe('turn-token');
  });

  it('removes the goal and adopts no turn when the model is refused', async () => {
    const ctx = setup();
    ctx.setTaskModel.mockRejectedValue(new Error('This model is not available'));

    await expect(
      createFromConversation(ctx as any, 'op_1', {
        taskModelConfig: modelConfig,
        title: 'Goal',
      } as any),
    ).rejects.toThrow('not available');

    expect(ctx.goalModel.delete).toHaveBeenCalledWith('goal_1');
    expect(mocks.adoptConversationTurn).not.toHaveBeenCalled();
  });

  it('leaves a goal without a task model on the existing path', async () => {
    const ctx = setup();

    await createFromConversation(ctx as any, 'op_1', { title: 'Goal' } as any);

    expect(ctx.setTaskModel).not.toHaveBeenCalled();
  });
});
