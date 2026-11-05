import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArchiveCommands } from './archive';

const { client } = vi.hoisted(() => ({
  client: { task: { archive: { mutate: vi.fn() } } },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerArchiveCommands(program.command('task'));
  return program.parseAsync(['node', 'test', 'task', ...args]);
};

describe('task archive commands', () => {
  beforeEach(() => {
    client.task.archive.mutate.mockReset();
    client.task.archive.mutate.mockResolvedValue({ data: { identifier: 'T-1' }, success: true });
  });

  it('archives a task', async () => {
    await run('archive', 'T-1');

    expect(client.task.archive.mutate).toHaveBeenCalledWith({ archived: true, id: 'T-1' });
  });

  it('unarchives a task', async () => {
    await run('unarchive', 'T-1');

    expect(client.task.archive.mutate).toHaveBeenCalledWith({ archived: false, id: 'T-1' });
  });
});
