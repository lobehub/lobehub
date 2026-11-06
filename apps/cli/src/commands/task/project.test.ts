import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './index';

const { client } = vi.hoisted(() => ({
  client: {
    task: {
      update: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
    taskLabel: { list: { query: vi.fn() } },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('./url', () => ({
  resolveAppUrl: vi.fn(async () => 'https://app/task'),
  resolveAppUrlBuilder: vi.fn(async () => () => 'https://app/task'),
  taskPath: vi.fn(() => '/task'),
}));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTaskCommand(program);
  await program.parseAsync(['node', 'lh', 'task', ...args]);
};

describe('lh task edit --project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    client.task.update.mutate.mockResolvedValue({ data: { id: 'task_1', identifier: 'T-1' } });
  });

  it('moves the task to the project', async () => {
    await run('edit', 'T-1', '--project', 'proj_1');
    expect(client.task.update.mutate).toHaveBeenCalledWith({ id: 'T-1', projectId: 'proj_1' });
  });

  it('removes the task from its project with "null"', async () => {
    await run('edit', 'T-1', '--project', 'null');
    expect(client.task.update.mutate).toHaveBeenCalledWith({ id: 'T-1', projectId: null });
  });

  it('sends an empty project so the server rejects it instead of silently ignoring it', async () => {
    await run('edit', 'T-1', '--project', '');
    expect(client.task.update.mutate).toHaveBeenCalledWith({ id: 'T-1', projectId: '' });
  });

  it('does not send a project when the option is absent', async () => {
    await run('edit', 'T-1', '--name', 'Renamed');
    expect(client.task.update.mutate).toHaveBeenCalledWith({ id: 'T-1', name: 'Renamed' });
  });
});
