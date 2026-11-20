import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerGoalSwarmCommands, resolveDeadline } from './swarm';

const { mockClient } = vi.hoisted(() => ({
  mockClient: { goal: { createSwarm: { mutate: vi.fn() } } },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalSwarmCommands(program.command('goal'));
  return program.parseAsync(['node', 'test', 'goal', ...args]);
};

describe('resolveDeadline', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0);

  it('reads durations from now and ISO instants as they are', () => {
    expect(resolveDeadline('2h', now)).toBe('2026-01-01T02:00:00.000Z');
    expect(resolveDeadline('90m', now)).toBe('2026-01-01T01:30:00.000Z');
    expect(resolveDeadline('1d', now)).toBe('2026-01-02T00:00:00.000Z');
    expect(resolveDeadline('2026-03-01T08:00:00+08:00', now)).toBe('2026-03-01T00:00:00.000Z');
    expect(() => resolveDeadline('soon', now)).toThrow(/--deadline/);
  });
});

describe('lh goal swarm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });

  it('creates a swarm goal with an absolute workspace and the objective', async () => {
    mockClient.goal.createSwarm.mutate.mockResolvedValue({
      data: {
        goal: {
          config: { schedule: { deadline: 'x' }, swarm: { lanes: [{}, {}], workspace: '/w' } },
          id: 'goal_1',
        },
      },
    });

    await run(
      'swarm',
      'Raise score',
      '--workspace',
      '/w/k12',
      '--evaluator',
      './score.sh',
      '--deadline',
      '2h',
      '--lanes',
      '2',
      '--direction',
      'min',
      '--agent',
      'agt_1',
    );

    expect(mockClient.goal.createSwarm.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        lanes: 2,
        objective: { direction: 'min', evaluator: './score.sh', title: undefined },
        title: 'Raise score',
        workspace: '/w/k12',
      }),
    );
  });

  it('refuses a direction other than max or min', async () => {
    await expect(
      run(
        'swarm',
        'x',
        '--workspace',
        '/w',
        '--evaluator',
        'e',
        '--deadline',
        '1h',
        '--direction',
        'up',
      ),
    ).rejects.toThrow(/--direction/);
  });
});
