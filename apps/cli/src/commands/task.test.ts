import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './task';

const {
  mockCreateTask,
  mockGetTrpcClient,
  mockGetWorkspace,
  mockLogInfo,
  mockResolveWorkspaceId,
  sdk,
} = vi.hoisted(() => ({
  mockCreateTask: vi.fn(),
  mockGetTrpcClient: vi.fn(),
  mockGetWorkspace: vi.fn(),
  mockLogInfo: vi.fn(),
  mockResolveWorkspaceId: vi.fn(),
  sdk: {
    tasks: { create: vi.fn(), list: vi.fn(), update: vi.fn(), updateStatus: vi.fn() },
  },
}));

/** A REST success envelope as the SDK resolves it. */
const envelope = (data: unknown) => ({ data: { data, success: true } });

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/sdk', () => ({ getSdkClient: async () => sdk }));
vi.mock('../api/workspace', () => ({ resolveWorkspaceId: mockResolveWorkspaceId }));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: mockLogInfo, warn: vi.fn() },
}));

describe('task create', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCreateTask.mockReset();
    sdk.tasks.create.mockReset();
    mockGetWorkspace.mockReset();
    mockResolveWorkspaceId.mockReset();
    mockGetTrpcClient.mockResolvedValue({
      task: { create: { mutate: mockCreateTask } },
      workspace: { getById: { query: mockGetWorkspace } },
    });
    mockLogInfo.mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'create', ...args]);
  };

  it('includes the personal task URL in JSON output', async () => {
    sdk.tasks.create.mockResolvedValue(
      envelope({ id: 'task_1', identifier: 'T-1', name: 'Personal task' }),
    );

    await run('--instruction', 'Do the thing', '--json');

    expect(sdk.tasks.create).toHaveBeenCalledWith({
      body: { instruction: 'Do the thing', priority: 0 },
    });
    expect(mockCreateTask).not.toHaveBeenCalled();

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          id: 'task_1',
          identifier: 'T-1',
          name: 'Personal task',
          url: 'https://app.example.com/task/T-1/personal-task',
        },
        null,
        2,
      ),
    );
  });

  it('prints a clickable workspace task URL in human output', async () => {
    mockResolveWorkspaceId.mockReturnValue('ws-1');
    mockGetWorkspace.mockResolvedValue({ id: 'ws-1', slug: 'lobehub' });
    sdk.tasks.create.mockResolvedValue(
      envelope({ id: 'task_2', identifier: 'T-321', name: 'Workspace task' }),
    );

    await run('--instruction', 'Do the workspace thing');

    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('T-321'));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://app.example.com/lobehub/task/T-321/workspace-task'),
    );
  });
});

describe('task edit', () => {
  const mockUpdate = vi.fn();
  const mockUpdateStatus = vi.fn();

  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue({
      data: { id: 'task_1', identifier: 'T-1' },
      success: true,
    });
    mockUpdateStatus.mockReset();
    sdk.tasks.update.mockReset().mockResolvedValue(envelope({ id: 'task_1', identifier: 'T-1' }));
    sdk.tasks.updateStatus
      .mockReset()
      .mockResolvedValue(
        envelope({ paused: [], task: { id: 'task_1', identifier: 'T-1' }, unlocked: [] }),
      );
    mockGetTrpcClient.mockResolvedValue({
      task: {
        update: { mutate: mockUpdate },
        updateStatus: { mutate: mockUpdateStatus },
      },
    });
    mockLogInfo.mockReset();
  });

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'edit', ...args]);
  };

  // --status used to early-return, silently dropping --agent and every other
  // field passed in the same invocation.
  it('applies --agent and --status together in one invocation', async () => {
    await run('task_1', '--agent', 'agt_new', '--status', 'backlog');

    // Fields plus a status stay on tRPC: only it applies both in one transaction.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeAgentId: 'agt_new', id: 'task_1', status: 'backlog' }),
    );
    expect(sdk.tasks.update).not.toHaveBeenCalled();
    expect(sdk.tasks.updateStatus).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('backlog'));
  });

  it('keeps the status-only path on the lifecycle API alone', async () => {
    await run('task_1', '--status', 'paused');

    expect(sdk.tasks.updateStatus).toHaveBeenCalledWith({
      body: { status: 'paused' },
      path: { id: 'task_1' },
    });
    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('T-1'));
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(sdk.tasks.update).not.toHaveBeenCalled();
  });

  it('keeps field-only edits off the lifecycle API', async () => {
    await run('task_1', '--agent', 'agt_new');

    expect(sdk.tasks.update).toHaveBeenCalledWith({
      body: { assigneeAgentId: 'agt_new' },
      path: { id: 'task_1' },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(sdk.tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('keeps fields the REST patch lacks on tRPC', async () => {
    await run('task_1', '--heartbeat-timeout', '0', '--model', 'gpt-5');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ heartbeatTimeout: null, id: 'task_1' }),
    );
    expect(sdk.tasks.update).not.toHaveBeenCalled();
  });

  it('prints the status-only result as JSON in the tRPC shape', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run('task_1', '--status', 'paused', '--json');

    // The task alone, as tRPC's `data`: REST's `paused` / `unlocked` stay out.
    expect(JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]))).toEqual({
      id: 'task_1',
      identifier: 'T-1',
    });
    consoleSpy.mockRestore();
  });
});

describe('task usage', () => {
  const mockUsage = vi.fn();

  beforeEach(() => {
    mockUsage.mockReset().mockResolvedValue({
      data: {
        byTask: [],
        runs: 2,
        taskId: 'task_1',
        taskIdentifier: 'T-1',
        totalCost: 0.125,
        totalInputTokens: 1200,
        totalOutputTokens: 300,
        totalTokens: 1500,
      },
      success: true,
    });
    mockGetTrpcClient.mockResolvedValue({ task: { usage: { query: mockUsage } } });
  });

  it('prints the task aggregate as JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);

    await program.parseAsync(['node', 'test', 'task', 'usage', 'T-1', '--json']);

    expect(mockUsage).toHaveBeenCalledWith({ id: 'T-1' });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"totalCost": 0.125'));
    consoleSpy.mockRestore();
  });
});

describe('task list', () => {
  const mockList = vi.fn();
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockList.mockReset();
    sdk.tasks.list.mockReset();
    mockResolveWorkspaceId.mockReset();
    mockGetWorkspace.mockReset();
    mockGetTrpcClient.mockResolvedValue({
      task: { list: { query: mockList } },
      workspace: { getById: { query: mockGetWorkspace } },
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('links every task to its workspace page in JSON output', async () => {
    mockResolveWorkspaceId.mockReturnValue('ws-1');
    mockGetWorkspace.mockResolvedValue({ id: 'ws-1', slug: 'lobehub' });
    mockList.mockResolvedValue({
      data: [{ id: 'task_1', identifier: 'T-1031', name: 'Weekly digest', status: 'backlog' }],
      total: 1,
    });

    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'list', '--json']);

    expect(JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]))).toEqual([
      {
        id: 'task_1',
        identifier: 'T-1031',
        name: 'Weekly digest',
        status: 'backlog',
        url: 'https://app.example.com/lobehub/task/T-1031/weekly-digest',
      },
    ]);
  });

  it('still lists tasks when the workspace lookup behind the link fails', async () => {
    mockResolveWorkspaceId.mockReturnValue('ws-1');
    mockGetWorkspace.mockRejectedValue(new Error('forbidden'));
    mockList.mockResolvedValue({
      data: [{ id: 'task_1', identifier: 'T-1', name: 'A' }],
      total: 1,
    });

    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'list', '--json']);

    expect(JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]))).toEqual([
      { id: 'task_1', identifier: 'T-1', name: 'A' },
    ]);
  });

  it('maps filters onto the REST query and prints the table with the total', async () => {
    mockResolveWorkspaceId.mockReturnValue(undefined);
    sdk.tasks.list.mockResolvedValue(
      envelope({
        hasMore: false,
        nextCursor: null,
        tasks: [{ createdAt: new Date().toISOString(), id: 't', identifier: 'T-1', name: 'A' }],
        total: 7,
      }),
    );
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync([
      'node',
      'test',
      'task',
      'list',
      '--status',
      'running',
      '--agent',
      'agt_1',
      '-L',
      '5',
      '--offset',
      '2',
    ]);

    expect(sdk.tasks.list).toHaveBeenCalledWith({
      query: { assigneeAgentId: 'agt_1', limit: 5, offset: 2, statuses: 'running' },
    });
    expect(mockList).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith('Total: 7');
  });

  it('walks offset pages when --limit exceeds the REST page size', async () => {
    const rows = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `t${from + i}`,
        identifier: `T-${from + i}`,
        name: 'x',
        status: 'backlog',
      }));
    sdk.tasks.list
      .mockResolvedValueOnce(
        envelope({ hasMore: true, nextCursor: 'c', tasks: rows(0, 100), total: 130 }),
      )
      .mockResolvedValueOnce(
        envelope({ hasMore: false, nextCursor: null, tasks: rows(100, 30), total: 130 }),
      );
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'list', '-L', '200']);

    expect(sdk.tasks.list.mock.calls.map(([options]) => options.query)).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
    ]);
    expect(mockLogInfo).toHaveBeenCalledWith('Total: 130');
  });

  // REST rows carry no `participants`, so the printed JSON would lose a field.
  it('keeps --json on tRPC so the printed rows keep every field', async () => {
    mockList.mockResolvedValue({
      data: [{ id: 't', identifier: 'T-1', participants: [{ id: 'u1' }] }],
      total: 1,
    });
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'list', '--json', 'identifier,participants']);

    expect(sdk.tasks.list).not.toHaveBeenCalled();
    expect(JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]))).toEqual([
      { identifier: 'T-1', participants: [{ id: 'u1' }] },
    ]);
  });

  it('keeps parent, archived and label filters on tRPC', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'list', '--root', '--archived']);

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true, parentTaskId: null }),
    );
    expect(sdk.tasks.list).not.toHaveBeenCalled();
  });
});

describe('task topic list', () => {
  it('links each topic through the agent that owns it', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockResolveWorkspaceId.mockReturnValue(undefined);
    mockGetTrpcClient.mockResolvedValue({
      task: {
        getTopics: {
          query: vi.fn().mockResolvedValue({ data: [{ agentId: 'agt_1', id: 'tpc_1', seq: 1 }] }),
        },
      },
    });

    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(['node', 'test', 'task', 'topic', 'list', 'T-1', '--json']);

    expect(JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0]))).toEqual([
      { agentId: 'agt_1', id: 'tpc_1', seq: 1, url: 'https://app.example.com/agent/agt_1/tpc_1' },
    ]);
    consoleSpy.mockRestore();
  });
});
