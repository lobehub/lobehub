import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerGoalConfigurationCommands } from './configuration';

const mocks = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
  setBudget: vi.fn(),
  updateRequirement: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mocks.getTrpcClient }));
vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) =>
    // `set-requirement --file` reads plain markdown, unlike the JSON payloads
    // the rest of the goal commands hand to readFile.
    path === 'requirement.md'
      ? '# What counts as done\n- Ship the migration with real evidence'
      : JSON.stringify({ action: 'verify', reason: 'Ready' }),
}));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalConfigurationCommands(program.command('goal'));
  await program.parseAsync(['node', 'test', 'goal', ...args]);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTrpcClient.mockResolvedValue({
    goal: {
      setBudget: { mutate: mocks.setBudget },
      updateRequirement: { mutate: mocks.updateRequirement },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('goal set-budget command', () => {
  it('edits the limits a goal was created with, so it can continue instead of being copied', async () => {
    mocks.setBudget.mockResolvedValue({ message: 'Goal budget updated' });

    await run(
      'set-budget',
      'goal-1',
      '--max-manager-turns',
      '60',
      '--max-concurrent-tasks',
      '1',
      '--max-attempts-per-task',
      '5',
      '--max-steps-per-run',
      'none',
    );

    expect(mocks.setBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'goal-1',
        maxAttemptsPerTask: 5,
        maxConcurrentTasks: 1,
        maxManagerTurns: 60,
        maxStepsPerRun: null,
      }),
    );
  });
});

describe('goal set-requirement command', () => {
  beforeEach(() => {
    mocks.updateRequirement.mockResolvedValue({ data: { id: 'goal-1' }, success: true });
  });

  it('replaces the requirement from --requirement, trimming the surplus whitespace', async () => {
    await run(
      'set-requirement',
      'goal-1',
      '-r',
      '  Done only when the dashboard reads from the merged backend  ',
    );

    expect(mocks.updateRequirement).toHaveBeenCalledWith({
      id: 'goal-1',
      requirement: 'Done only when the dashboard reads from the merged backend',
    });
  });

  it('reads a long, multi-line requirement from --file instead of the command line', async () => {
    await run('set-requirement', 'goal-1', '--file', 'requirement.md');

    expect(mocks.updateRequirement).toHaveBeenCalledWith({
      id: 'goal-1',
      requirement: '# What counts as done\n- Ship the migration with real evidence',
    });
  });

  it('refuses an empty edit rather than blanking the acceptance bar', async () => {
    await expect(run('set-requirement', 'goal-1')).rejects.toThrow('Provide the requirement');

    expect(mocks.updateRequirement).not.toHaveBeenCalled();
  });

  it('refuses to guess when an inline requirement and a file are both passed', async () => {
    await expect(
      run('set-requirement', 'goal-1', '-r', 'inline text', '--file', 'requirement.md'),
    ).rejects.toThrow('not both');

    expect(mocks.updateRequirement).not.toHaveBeenCalled();
  });
});
