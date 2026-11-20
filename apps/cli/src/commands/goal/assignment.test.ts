import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureCreatedGoalTaskModel,
  parseGoalModelConfig,
  registerGoalAssignmentCommands,
} from './assignment';

const mocks = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
  setModel: vi.fn(),
  setTaskModel: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mocks.getTrpcClient }));
vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: mocks.warn },
}));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalAssignmentCommands(program.command('goal'));
  await program.parseAsync(['node', 'test', 'goal', ...args]);
};

describe('parseGoalModelConfig', () => {
  it('needs a provider with a model, and a model with a provider', () => {
    expect(() => parseGoalModelConfig({ model: 'gpt-5' })).toThrow('--model requires --provider');
    expect(() => parseGoalModelConfig({ provider: 'openai' })).toThrow(
      '--provider requires --model',
    );
  });

  it('reads none/null as clearing and nothing as unset', () => {
    expect(parseGoalModelConfig({ model: 'none' })).toBeNull();
    expect(parseGoalModelConfig({ model: 'null', provider: 'openai' })).toBeNull();
    expect(parseGoalModelConfig({})).toBeUndefined();
    expect(parseGoalModelConfig({ model: 'gpt-5', provider: 'openai' })).toEqual({
      model: 'gpt-5',
      provider: 'openai',
    });
  });
});

describe('goal model commands', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setModel.mockResolvedValue({ message: 'Goal model updated' });
    mocks.setTaskModel.mockResolvedValue({ message: 'Goal task model updated' });
    mocks.getTrpcClient.mockResolvedValue({
      goal: {
        setModel: { mutate: mocks.setModel },
        setTaskModel: { mutate: mocks.setTaskModel },
      },
    });
  });

  it('sets the planning model', async () => {
    await run('set-model', 'goal_1', '--model', 'gpt-5', '--provider', 'openai');

    expect(mocks.setModel).toHaveBeenCalledWith({
      id: 'goal_1',
      modelConfig: { model: 'gpt-5', provider: 'openai' },
    });
  });

  it('sets and clears the task model', async () => {
    await run('set-task-model', 'goal_1', '--model', 'deepseek-flash', '--provider', 'lobehub');
    await run('set-task-model', 'goal_1', '--model', 'none');

    expect(mocks.setTaskModel).toHaveBeenNthCalledWith(1, {
      id: 'goal_1',
      modelConfig: { model: 'deepseek-flash', provider: 'lobehub' },
    });
    expect(mocks.setTaskModel).toHaveBeenNthCalledWith(2, { id: 'goal_1', modelConfig: null });
  });

  it('skips the follow-up write when the server already applied the model at creation', async () => {
    const client = await mocks.getTrpcClient();

    await ensureCreatedGoalTaskModel(
      client,
      { config: { taskModel: 'gpt-5' }, id: 'goal_1' },
      { model: 'gpt-5', provider: 'openai' },
    );

    expect(mocks.setTaskModel).not.toHaveBeenCalled();
  });

  it('applies the model afterwards on a server that dropped the field', async () => {
    const client = await mocks.getTrpcClient();

    await ensureCreatedGoalTaskModel(
      client,
      { config: {}, id: 'goal_1' },
      { model: 'gpt-5', provider: 'openai' },
    );

    expect(mocks.setTaskModel).toHaveBeenCalledWith({
      id: 'goal_1',
      modelConfig: { model: 'gpt-5', provider: 'openai' },
    });
  });

  // A follow-up write would change the config the turn's snapshot covers, and
  // the printed token's first plan would be rejected as stale_input.
  it('keeps the planning token valid when the server dropped the field', async () => {
    const client = await mocks.getTrpcClient();

    await ensureCreatedGoalTaskModel(
      client,
      { config: {}, id: 'goal_1' },
      { model: 'gpt-5', provider: 'openai' },
      'turn-token',
    );

    expect(mocks.setTaskModel).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Submit the plan first'));
    expect(process.exitCode).toBe(1);
  });

  it('keeps a created goal when its task model is refused, with a retry hint', async () => {
    const client = await mocks.getTrpcClient();
    mocks.setTaskModel.mockRejectedValueOnce(new Error('model is fixed'));

    await ensureCreatedGoalTaskModel(
      client,
      { id: 'goal_1' },
      { model: 'gpt-5', provider: 'openai' },
    );

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('lh goal set-task-model goal_1'),
    );
    expect(process.exitCode).toBe(1);
  });
});
