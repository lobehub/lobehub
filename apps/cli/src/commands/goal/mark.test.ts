import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerGoalMarkCommands } from './mark';

const { mockClient, operationToken } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      addMark: { mutate: vi.fn() },
      addMarkOperation: { mutate: vi.fn() },
      judgeMarkOperation: { mutate: vi.fn() },
      marks: { query: vi.fn() },
      marksOperation: { query: vi.fn() },
      retireMark: { mutate: vi.fn() },
    },
  },
  operationToken: { value: false },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
vi.mock('./reads', () => ({ hasOperationToken: () => operationToken.value }));

const markId = '11111111-1111-4111-8111-111111111111';

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalMarkCommands(program.command('goal'));
  return program.parseAsync(['node', 'test', 'goal', 'mark', ...args]);
};

describe('lh goal mark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, 'info').mockImplementation(() => {});
    operationToken.value = false;
  });
  afterEach(() => vi.restoreAllMocks());

  describe('inside a Goal Task run', () => {
    beforeEach(() => {
      operationToken.value = true;
    });

    it('leaves a mark for the run’s own goal without naming it', async () => {
      mockClient.goal.addMarkOperation.mutate.mockResolvedValue({ data: { id: markId } });

      await run('add', 'pattern', 'tsc fails → mock', '-d', 'details');

      expect(mockClient.goal.addMarkOperation.mutate).toHaveBeenCalledWith({
        description: 'details',
        kind: 'pattern',
        title: 'tsc fails → mock',
      });
      expect(mockClient.goal.addMark.mutate).not.toHaveBeenCalled();
    });

    it('lists the run’s goal marks', async () => {
      mockClient.goal.marksOperation.query.mockResolvedValue({ data: [] });

      await run('list');

      expect(mockClient.goal.marksOperation.query).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith('No marks yet.');
    });

    it('records a refutation for a mark the run relied on', async () => {
      mockClient.goal.judgeMarkOperation.mutate.mockResolvedValue({
        data: { confirms: 0, refutes: 1 },
      });

      await run('refute', markId);

      expect(mockClient.goal.judgeMarkOperation.mutate).toHaveBeenCalledWith({
        markId,
        verdict: 'refutes',
      });
    });
  });

  describe('with a person’s login', () => {
    it('needs the goal named to leave a mark', async () => {
      await expect(run('add', 'hazard', 'do not touch')).rejects.toThrow(/goal id/);

      mockClient.goal.addMark.mutate.mockResolvedValue({ data: { id: markId } });
      await run('add', 'hazard', 'do not touch', '--goal', 'goal_1');
      expect(mockClient.goal.addMark.mutate).toHaveBeenCalledWith({
        description: undefined,
        id: 'goal_1',
        kind: 'hazard',
        title: 'do not touch',
      });
    });

    it('cannot judge a mark, since no run relied on it', async () => {
      await expect(run('confirm', markId)).rejects.toThrow(/Only a Goal Task run/);
      expect(mockClient.goal.judgeMarkOperation.mutate).not.toHaveBeenCalled();
    });

    it('retires a mark on the named goal', async () => {
      mockClient.goal.retireMark.mutate.mockResolvedValue({ message: 'Mark retired' });

      await run('retire', 'goal_1', markId, '--reason', 'superseded');

      expect(mockClient.goal.retireMark.mutate).toHaveBeenCalledWith({
        id: 'goal_1',
        markId,
        reason: 'superseded',
      });
    });
  });

  it('refuses an unknown kind and names the valid ones', async () => {
    operationToken.value = true;
    await expect(run('add', 'finding', 'x')).rejects.toThrow(
      'Unknown mark kind "finding". Kinds: pattern, tool, hazard, dead_end.',
    );
  });
});
