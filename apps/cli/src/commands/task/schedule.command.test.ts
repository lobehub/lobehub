import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './index';

const { client } = vi.hoisted(() => ({
  client: {
    agent: { getAgentConfigById: { query: vi.fn() } },
    task: {
      create: { mutate: vi.fn() },
      detail: { query: vi.fn() },
      getPinnedDocuments: { query: vi.fn() },
      groupList: { query: vi.fn() },
      list: { query: vi.fn() },
      update: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
    workspace: { getById: { query: vi.fn() } },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: () => undefined }));
vi.mock('../../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const buildProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerTaskCommand(program);
  return program;
};

const run = (...args: string[]) => buildProgram().parseAsync(['node', 'test', 'task', ...args]);

const task = { id: 'task_1', identifier: 'T-1', name: 'x' };

describe('task schedule wiring', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  const printed = () => consoleSpy.mock.calls.map((call) => String(call[0])).join('\n');

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    client.task.create.mutate.mockReset();
    client.task.create.mutate.mockResolvedValue({ data: task });
    client.task.update.mutate.mockReset();
    client.task.update.mutate.mockResolvedValue({ data: task });
    client.task.updateStatus.mutate.mockReset();
    client.task.updateStatus.mutate.mockResolvedValue({ data: task });
    client.task.list.query.mockReset();
    client.task.detail.query.mockReset();
    client.task.groupList.query.mockReset();
    client.task.getPinnedDocuments.query.mockReset();
    client.agent.getAgentConfigById.query.mockResolvedValue(null);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('creates a schedule-mode task from --schedule', async () => {
    await run(
      'create',
      '-n',
      'x',
      '-i',
      'y',
      '--agent',
      'agt_1',
      '--schedule',
      '0 22 * * *',
      '--timezone',
      'Asia/Shanghai',
      '--max-executions',
      '1',
    );

    expect(client.task.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeAgentId: 'agt_1',
        automationMode: 'schedule',
        config: { schedule: { maxExecutions: 1 } },
        schedulePattern: '0 22 * * *',
        scheduleTimezone: 'Asia/Shanghai',
      }),
    );
  });

  it('keeps the model override next to the schedule config', async () => {
    await run('create', '-i', 'y', '--model', 'm', '--max-executions', '2');

    expect(client.task.create.mutate.mock.calls[0][0].config).toEqual({
      model: 'm',
      schedule: { maxExecutions: 2 },
    });
  });

  it('sends no schedule fields when no flag is given', async () => {
    await run('create', '-i', 'y');

    const input = client.task.create.mutate.mock.calls[0][0];
    expect(input).not.toHaveProperty('automationMode');
    expect(input).not.toHaveProperty('schedulePattern');
    expect(input).not.toHaveProperty('config');
  });

  it('accepts --status scheduled', async () => {
    await run('edit', 'T-1', '--status', 'scheduled');

    expect(client.task.updateStatus.mutate).toHaveBeenCalledWith({
      id: 'T-1',
      status: 'scheduled',
    });
  });

  it('clears the schedule through task.update', async () => {
    await run('edit', 'T-1', '--schedule-clear');

    expect(client.task.update.mutate).toHaveBeenCalledWith({
      id: 'T-1',
      schedulePattern: null,
      scheduleTimezone: null,
    });
  });

  it('merges max executions with a model patch', async () => {
    await run('edit', 'T-1', '--model', 'm', '--max-executions', 'null');

    expect(client.task.update.mutate).toHaveBeenCalledWith({
      configPatch: { model: 'm', provider: null, schedule: { maxExecutions: null } },
      id: 'T-1',
    });
  });

  it.each([
    [
      { maxExecutions: 1, pattern: '0 22 * * *', timezone: 'Asia/Shanghai' },
      '0 22 * * * · Asia/Shanghai · max 1',
    ],
    [undefined, 'none'],
  ])('prints the schedule line in view', async (schedule, expected) => {
    client.task.detail.query.mockResolvedValue({
      data: { ...task, instruction: 'y', schedule, status: 'scheduled' },
    });

    await run('view', 'T-1');

    expect(printed()).toContain(expected);
  });

  it('shows scheduled tasks on the board', async () => {
    client.task.list.query.mockResolvedValue({
      data: [{ ...task, status: 'scheduled' }],
      total: 1,
    });

    await run('list', '--board');

    expect(printed()).toContain('SCHEDULED');
  });

  it('passes multiple statuses and the new filters to task.list', async () => {
    client.task.list.query.mockResolvedValue({ data: [], total: 0 });

    await run('list', '--status', 'backlog,scheduled', '--priority', '1', '--project', 'proj_1');

    expect(client.task.list.query).toHaveBeenCalledWith(
      expect.objectContaining({
        priorities: [1],
        projectId: 'proj_1',
        statuses: ['backlog', 'scheduled'],
      }),
    );
  });

  it('groups through task.groupList', async () => {
    client.task.groupList.query.mockResolvedValue({
      data: [{ key: 'priority:1', tasks: [{ ...task, status: 'running' }], total: 1 }],
    });

    await run('list', '--group-by', 'priority', '--json');

    expect(client.task.groupList.query).toHaveBeenCalledWith({ groupBy: 'priority' });
    expect(JSON.parse(printed())[0].tasks[0].url).toBe('https://app.example.com/task/T-1/x');
    expect(client.task.list.query).not.toHaveBeenCalled();
  });

  it('refuses --group-by with an explicit --limit', async () => {
    await expect(run('list', '--group-by', 'priority', '-L', '5')).rejects.toThrow('--limit');
  });

  it('says when a group is truncated', async () => {
    client.task.groupList.query.mockResolvedValue({
      data: [
        { hasMore: true, key: 'priority:1', tasks: [{ ...task, status: 'running' }], total: 80 },
      ],
    });

    await run('list', '--group-by', 'priority');

    expect(printed()).toContain('79 more not shown');
  });

  it('refuses --group-by with --board', async () => {
    await expect(run('list', '--group-by', 'priority', '--board')).rejects.toThrow('--group-by');
  });

  it('lists pinned documents', async () => {
    client.task.getPinnedDocuments.query.mockResolvedValue({
      data: [{ documentId: 'docs_1', pinnedBy: 'user' }],
    });

    await run('doc', 'list', 'T-1', '--json');

    expect(JSON.parse(printed())[0]).toMatchObject({ documentId: 'docs_1' });
  });

  it('no longer advertises the removed pending status', () => {
    const taskCommand = buildProgram().commands.find((command) => command.name() === 'task')!;
    const helpOf = (name: string) =>
      taskCommand.commands.find((command) => command.name() === name)!.helpInformation();

    expect(helpOf('list')).not.toContain('pending');
    expect(helpOf('list')).toContain('scheduled');
    expect(helpOf('start')).not.toContain('pending');
    expect(helpOf('edit')).toContain('scheduled');
  });
});
