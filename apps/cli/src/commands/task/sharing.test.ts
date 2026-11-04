import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSharingCommands } from './sharing';

const { client } = vi.hoisted(() => ({
  client: {
    task: {
      acquireTaskLock: { mutate: vi.fn() },
      copyTaskToWorkspace: { mutate: vi.fn() },
      getTaskLock: { query: vi.fn() },
      releaseTaskLock: { mutate: vi.fn() },
      updateVisibility: { mutate: vi.fn() },
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
  registerSharingCommands(program.command('task'));
  return program.parseAsync(['node', 'test', 'task', ...args]);
};

describe('task sharing commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    client.task.updateVisibility.mutate.mockReset();
    client.task.updateVisibility.mutate.mockResolvedValue({ data: { identifier: 'T-1' } });
    client.task.copyTaskToWorkspace.mutate.mockReset();
    client.task.copyTaskToWorkspace.mutate.mockResolvedValue({ rootId: 'task_copy' });
    client.task.acquireTaskLock.mutate.mockReset();
    client.task.releaseTaskLock.mutate.mockReset();
  });

  it('changes visibility', async () => {
    await run('visibility', 'T-1', 'private', '--take-ownership');

    expect(client.task.updateVisibility.mutate).toHaveBeenCalledWith({
      id: 'T-1',
      takeOwnership: true,
      visibility: 'private',
    });
  });

  it('rejects an unknown visibility before calling the server', async () => {
    await expect(run('visibility', 'T-1', 'secret')).rejects.toThrow('Invalid visibility');
    expect(client.task.updateVisibility.mutate).not.toHaveBeenCalled();
  });

  it('copies to a workspace or to the personal scope', async () => {
    await run('copy', 'T-1', '--to', 'ws_1', '--visibility', 'public');
    await run('copy', 'T-1', '--to', 'personal');

    expect(client.task.copyTaskToWorkspace.mutate.mock.calls.map(([input]) => input)).toEqual([
      { targetVisibility: 'public', targetWorkspaceId: 'ws_1', taskId: 'T-1' },
      { targetVisibility: undefined, targetWorkspaceId: null, taskId: 'T-1' },
    ]);
  });

  it('has no transfer command, since the server always refuses it', async () => {
    const program = new Command();
    const task = program.command('task');
    registerSharingCommands(task);

    expect(task.commands.map((command) => command.name())).not.toContain('transfer');
  });

  it('fails acquire when another member holds the lock', async () => {
    client.task.acquireTaskLock.mutate.mockResolvedValue({
      holderId: 'user_2',
      lockedByOther: true,
    });

    await run('lock', 'acquire', 'T-1');

    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('releases the lock', async () => {
    client.task.getTaskLock.query.mockResolvedValue({ holderId: null, lockedByOther: false });

    await run('lock', 'release', 'T-1');

    expect(client.task.releaseTaskLock.mutate).toHaveBeenCalledWith({ id: 'T-1' });
    expect(process.exitCode).toBeUndefined();
  });

  it('fails release when another member took the lock over', async () => {
    client.task.getTaskLock.query.mockResolvedValue({ holderId: 'user_2', lockedByOther: true });

    await run('lock', 'release', 'T-1');

    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
