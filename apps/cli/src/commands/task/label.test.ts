import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './index';

const registry = [
  { id: 'g-type', isGroup: true, name: 'Type', parentId: null, sortOrder: 0, usageCount: 0 },
  { id: 'bug', isGroup: false, name: 'Bug', parentId: 'g-type', sortOrder: 0, usageCount: 2 },
  { id: 'feat', isGroup: false, name: 'Feature', parentId: 'g-type', sortOrder: 0, usageCount: 0 },
  { id: 'fe', isGroup: false, name: 'Frontend', parentId: null, sortOrder: 0, usageCount: 1 },
];

const { client } = vi.hoisted(() => ({
  client: {
    task: {
      create: { mutate: vi.fn() },
      list: { query: vi.fn() },
      update: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
    taskLabel: {
      addToTask: { mutate: vi.fn() },
      changeForTask: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      list: { query: vi.fn() },
      removeFromTask: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
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

const { log } = await import('../../utils/logger');

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTaskCommand(program);
  await program.parseAsync(['node', 'lh', 'task', ...args]);
};

describe('lh task --label', () => {
  beforeEach(() => {
    client.taskLabel.list.query.mockResolvedValue(registry);
    client.task.create.mutate.mockResolvedValue({ data: { id: 'task_1', identifier: 'T-1' } });
    client.task.list.query.mockResolvedValue({ data: [], total: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('create resolves names and paths to label ids', async () => {
    await run('create', '-i', 'do it', '--label', 'bug', '--label', 'Frontend');

    expect(client.task.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ labelIds: ['bug', 'fe'] }),
    );
  });

  it('create fails on an unknown label with suggestions and writes nothing', async () => {
    await run('create', '-i', 'do it', '--label', 'Frontnd');

    expect(client.task.create.mutate).not.toHaveBeenCalled();
    expect(vi.mocked(log.error).mock.calls[0][0]).toContain('did you mean: Frontend');
    expect(process.exitCode).toBe(1);
  });

  it('create refuses a label group', async () => {
    await run('create', '-i', 'do it', '--label', 'Type');

    expect(client.task.create.mutate).not.toHaveBeenCalled();
    expect(vi.mocked(log.error).mock.calls[0][0]).toContain('is a label group');
  });

  it('edit adds and removes labels in one label request only', async () => {
    client.taskLabel.changeForTask.mutate.mockResolvedValue([{ id: 'feat', name: 'Feature' }]);
    await run('edit', 'T-1', '--label', 'Type/Feature', '--remove-label', 'Frontend');

    expect(client.taskLabel.changeForTask.mutate).toHaveBeenCalledWith({
      add: ['feat'],
      remove: ['fe'],
      taskId: 'T-1',
    });
    expect(client.taskLabel.addToTask.mutate).not.toHaveBeenCalled();
    expect(client.taskLabel.removeFromTask.mutate).not.toHaveBeenCalled();
    expect(client.task.update.mutate).not.toHaveBeenCalled();
  });

  it('edit rejects an invalid status before touching labels', async () => {
    await run('edit', 'T-1', '--label', 'Bug', '--status', 'typo');

    expect(vi.mocked(log.error).mock.calls[0][0]).toContain('Invalid status "typo"');
    expect(client.taskLabel.changeForTask.mutate).not.toHaveBeenCalled();
    expect(client.task.update.mutate).not.toHaveBeenCalled();
    expect(client.task.updateStatus.mutate).not.toHaveBeenCalled();
  });

  it('list filters by label, by group and by "no labels"', async () => {
    await run('list', '--label', 'Type,Frontend', '--unlabeled');

    expect(client.task.list.query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { label: { operator: 'is', values: ['g-type', 'fe', '__none__'] } },
      }),
    );
  });
});

describe('lh task label', () => {
  beforeEach(() => {
    client.taskLabel.list.query.mockResolvedValue(registry);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('create puts a label into a group by name', async () => {
    client.taskLabel.create.mutate.mockResolvedValue({ id: 'chore', name: 'Chore' });
    await run('label', 'create', 'Chore', '--parent', 'Type', '--color', '#EB5757');

    expect(client.taskLabel.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#EB5757', name: 'Chore', parentId: 'g-type' }),
    );
  });

  it('create rejects a non-hex color', async () => {
    await expect(run('label', 'create', 'X', '--color', 'red')).rejects.toThrow('Invalid color');
    expect(client.taskLabel.create.mutate).not.toHaveBeenCalled();
  });

  it('edit moves a label out of its group', async () => {
    client.taskLabel.update.mutate.mockResolvedValue({ id: 'bug', name: 'Bug' });
    await run('label', 'edit', 'Type/Bug', '--parent', 'none');

    expect(client.taskLabel.update.mutate).toHaveBeenCalledWith({
      id: 'bug',
      value: { parentId: null },
    });
  });

  it('delete with --yes deletes by name', async () => {
    await run('label', 'delete', 'frontend', '--yes');

    expect(client.taskLabel.delete.mutate).toHaveBeenCalledWith({ id: 'fe' });
  });
});

describe('formatTaskLabels', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('picocolors');
  });

  const load = async (isColorSupported: boolean) => {
    vi.resetModules();
    vi.doMock('picocolors', async (importOriginal) => {
      const actual = (await importOriginal<{ default: object }>()).default;
      return { default: { ...actual, isColorSupported } };
    });
    return (await import('./label')).formatTaskLabels;
  };

  it('writes no true-color escape when color output is off', async () => {
    const format = await load(false);
    expect(format([{ color: '#EB5757', id: 'bug', name: 'Bug', parentId: null }])).not.toContain(
      '\u001B[38;2;',
    );
  });

  it('colors the dot with the label color when supported', async () => {
    const format = await load(true);
    expect(format([{ color: '#EB5757', id: 'bug', name: 'Bug', parentId: null }])).toContain(
      '\u001B[38;2;235;87;87m',
    );
  });
});
