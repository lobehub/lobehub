import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBatchCommands } from './batch';

const { client } = vi.hoisted(() => ({
  client: {
    task: {
      batchArchive: { mutate: vi.fn() },
      batchDelete: { mutate: vi.fn() },
      batchUpdate: { mutate: vi.fn() },
      batchUpdateStatus: { mutate: vi.fn() },
      find: { query: vi.fn() },
    },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerBatchCommands(program.command('task'));
  return program.parseAsync(['node', 'test', 'task', 'batch', ...args]);
};

const empty = { failed: [], skipped: [], updated: [] };

describe('task batch commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    for (const procedure of [
      client.task.batchArchive,
      client.task.batchDelete,
      client.task.batchUpdate,
      client.task.batchUpdateStatus,
    ]) {
      procedure.mutate.mockReset();
      procedure.mutate.mockResolvedValue(empty);
    }
    client.task.find.query.mockReset();
    client.task.find.query.mockImplementation(async ({ id }: { id: string }) => ({
      data: { id: `task_${id}` },
    }));
  });

  it('resolves identifiers to raw ids and archives', async () => {
    await run('archive', 'T-1', 'task_2', 'T-1');

    expect(client.task.batchArchive.mutate).toHaveBeenCalledWith({
      archived: true,
      ids: ['task_T-1', 'task_2'],
    });
  });

  it('unarchives with --undo', async () => {
    await run('archive', 'task_1', '--undo');

    expect(client.task.batchArchive.mutate).toHaveBeenCalledWith({
      archived: false,
      ids: ['task_1'],
    });
  });

  it('writes nothing when a ref cannot be resolved', async () => {
    client.task.find.query.mockRejectedValueOnce(new Error('Task not found'));

    await expect(run('delete', 'T-404', 'task_1', '-y')).rejects.toThrow('Task not found');
    expect(client.task.batchDelete.mutate).not.toHaveBeenCalled();
  });

  it('updates only the fields given, and unassigns with null', async () => {
    await run('update', 'task_1', '--priority', '2', '--agent', 'null');

    expect(client.task.batchUpdate.mutate).toHaveBeenCalledWith({
      assigneeAgentId: null,
      assigneeUserId: undefined,
      ids: ['task_1'],
      priority: 2,
    });
  });

  it('refuses an empty update', async () => {
    await expect(run('update', 'task_1')).rejects.toThrow('Nothing to update');
  });

  it('updates status and flags failures in the exit code', async () => {
    client.task.batchUpdateStatus.mutate.mockResolvedValue({
      ...empty,
      failed: [{ error: 'boom', id: 'task_1' }],
    });

    await run('update-status', 'task_1', '--status', 'paused', '--json');

    expect(client.task.batchUpdateStatus.mutate).toHaveBeenCalledWith({
      ids: ['task_1'],
      status: 'paused',
    });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
