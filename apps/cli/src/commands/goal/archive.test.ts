import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerGoalCommand } from '.';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      archive: { mutate: vi.fn() },
      list: { query: vi.fn() },
    },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
vi.mock('../task/url', () => ({
  resolveAppUrlBuilder: vi
    .fn()
    .mockResolvedValue((pathname: string) => `https://app.lobehub.com${pathname}`),
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalCommand(program);
  return program.parseAsync(['node', 'test', 'goal', ...args]);
};

describe('goal archive', () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    info = vi.spyOn(log, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    info.mockRestore();
  });

  it.each([
    ['archive', true, 'Goal archived'],
    ['unarchive', false, 'Goal restored'],
  ] as const)(
    '%s sends the archived flag and prints the result',
    async (name, archived, message) => {
      mockClient.goal.archive.mutate.mockResolvedValue({ data: { id: 'goal-1' }, message });

      await run(name, 'goal-1');

      expect(mockClient.goal.archive.mutate).toHaveBeenCalledWith({ archived, id: 'goal-1' });
      expect(log.info).toHaveBeenCalledWith(message);
    },
  );

  it('links the goal in JSON output', async () => {
    const write = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockClient.goal.archive.mutate.mockResolvedValue({
      data: { id: 'goal-1' },
      message: 'Goal archived',
    });

    await run('archive', 'goal-1', '--json');

    expect(JSON.parse(write.mock.calls[0][0] as string)).toMatchObject({
      id: 'goal-1',
      url: 'https://app.lobehub.com/goal/goal-1',
    });
    write.mockRestore();
  });

  it('lists archived goals only with --archived', async () => {
    mockClient.goal.list.query.mockResolvedValue({ goals: [], total: 0 });

    await run('list');
    expect(mockClient.goal.list.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: undefined }),
    );

    await run('list', '--archived');
    expect(mockClient.goal.list.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true }),
    );
  });
});
