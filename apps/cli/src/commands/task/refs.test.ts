import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from '../task';
import { registerCheckpointCommands } from './checkpoint';
import { registerDepCommands } from './dep';
import { registerLifecycleCommands } from './lifecycle';

const { client, info } = vi.hoisted(() => ({
  info: vi.fn(),
  client: {
    task: {
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      heartbeat: { mutate: vi.fn() },
      getDependencies: { query: vi.fn() },
      getCheckpoint: { query: vi.fn() },
      updateCheckpoint: { mutate: vi.fn() },
    },
  },
}));
vi.mock('../../api/client', () => ({ getTrpcClient: async () => client }));
vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: () => undefined }));
vi.mock('../../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));
vi.mock('../../utils/logger', () => ({
  log: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const run = async (register: (command: Command) => void, ...args: string[]) => {
  const root = new Command();
  root.exitOverride();
  register(root.command('task'));
  await root.parseAsync(['node', 'test', 'task', ...args]);
};
let output: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const printed = () => output.mock.calls.map((call) => call.join(' ')).join('\n');

describe('task reference output', () => {
  it('shows identifier and stable id for dependencies', async () => {
    client.task.getDependencies.query.mockResolvedValue({
      data: [
        {
          type: 'blocks',
          dependsOnId: 'task_2',
          dependsOnIdentifier: 'T-2',
          createdAt: new Date(),
        },
      ],
    });
    await run(registerDepCommands, 'dep', 'list', 'T-1');
    expect(printed()).toContain('T-2');
    expect(printed()).toContain('task_2');
  });
  it('shows checkpoint labels while preserving the legacy field format', async () => {
    client.task.getCheckpoint.query.mockResolvedValue({
      data: {
        tasks: { beforeIds: ['T-2'] },
        beforeTasks: [{ id: 'task_2', identifier: 'T-2' }],
      },
    });
    await run(registerCheckpointCommands, 'checkpoint', 'view', 'task_1');
    expect(printed()).toContain('tasks.beforeIds: T-2');
  });
  it('forwards checkpoint references without converting user input to ids', async () => {
    const beforeTasks = [{ id: 'task_1', identifier: 'T-1' }];
    client.task.getCheckpoint.query.mockResolvedValue({
      data: { tasks: { beforeIds: ['T-1'], beforeTasks } },
    });
    await run(registerCheckpointCommands, 'checkpoint', 'set', 't-1', '--before', 't-2,task_3');
    expect(client.task.updateCheckpoint.mutate).toHaveBeenCalledWith({
      id: 't-1',
      checkpoint: { tasks: { beforeIds: ['t-2', 'task_3'] } },
    });
  });
  it('preserves existing pairs when editing unrelated checkpoint options', async () => {
    const tasks = { beforeIds: ['T-1'], beforeTasks: [{ id: 'task_1', identifier: 'T-1' }] };
    client.task.getCheckpoint.query.mockResolvedValue({ data: { tasks } });
    await run(registerCheckpointCommands, 'checkpoint', 'set', 'T-9', '--topic-after', 'true');
    expect(client.task.updateCheckpoint.mutate).toHaveBeenCalledWith({
      id: 'T-9',
      checkpoint: { tasks, topic: { after: true } },
    });
  });
  it('uses returned identity for heartbeat acknowledgements', async () => {
    client.task.heartbeat.mutate.mockResolvedValue({ data: { id: 'task_1', identifier: 'T-1' } });
    await run(registerLifecycleCommands, 'heartbeat', 't-1');
    expect(info).toHaveBeenCalledWith('Heartbeat sent for T-1 (id: task_1).');
  });
  it('uses returned identity for delete acknowledgements', async () => {
    client.task.delete.mutate.mockResolvedValue({ data: { id: 'task_1', identifier: 'T-1' } });
    const root = new Command();
    registerTaskCommand(root);
    await root.parseAsync(['node', 'test', 'task', 'delete', 't-1', '--yes']);
    expect(info).toHaveBeenCalledWith('Task T-1 (id: task_1) deleted.');
  });
  it('prints a stable id and a public identifier link after create', async () => {
    client.task.create.mutate.mockResolvedValue({
      data: { id: 'task_1', identifier: 'T-1', name: 'Ship' },
    });
    const root = new Command();
    registerTaskCommand(root);
    await root.parseAsync([
      'node',
      'test',
      'task',
      'create',
      '--instruction',
      'Ship it',
      '--name',
      'Ship',
    ]);
    expect(printed()).toContain('ID: task_1');
    expect(printed()).toContain('/task/T-1/ship');
  });
});
