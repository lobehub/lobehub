import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerGoalCommand } from './goal';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      tick: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerGoalCommand(program);
  return program;
};

const waitingResult = {
  goalId: 'goal-1',
  message: 'Task T-1 is running',
  nodeId: 'node-1',
  outcome: 'waiting_external',
  taskId: 'task-1',
};

describe('goal run command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('prints a repeated waiting state only once', async () => {
    mockClient.goal.tick.mutate
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({
        data: { goalId: 'goal-1', message: 'Goal achieved', outcome: 'achieved' },
      });

    await createProgram().parseAsync(['node', 'test', 'goal', 'run', 'goal-1', '--poll-ms', '0']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');
    expect(output.match(/Task T-1 is running/g)).toHaveLength(1);
    expect(output).toContain('Goal achieved');
  });

  it('compresses repeated waiting states in JSON output', async () => {
    mockClient.goal.tick.mutate
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({ data: waitingResult })
      .mockResolvedValueOnce({
        data: { goalId: 'goal-1', message: 'Goal achieved', outcome: 'achieved' },
      });

    await createProgram().parseAsync([
      'node',
      'test',
      'goal',
      'run',
      'goal-1',
      '--poll-ms',
      '10',
      '--json',
    ]);

    const result = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ pollCount: 3, waitedMs: 30 });
    expect(result[1]).toMatchObject({ outcome: 'achieved' });
  });
});
