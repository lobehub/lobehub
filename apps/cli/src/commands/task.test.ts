import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './task';

const { mockCreateTask, mockGetTrpcClient, mockGetWorkspace, mockLogInfo, mockResolveWorkspaceId } =
  vi.hoisted(() => ({
    mockCreateTask: vi.fn(),
    mockGetTrpcClient: vi.fn(),
    mockGetWorkspace: vi.fn(),
    mockLogInfo: vi.fn(),
    mockResolveWorkspaceId: vi.fn(),
  }));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
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
    mockCreateTask.mockResolvedValue({
      data: { id: 'task_1', identifier: 'T-1', name: 'Personal task' },
      message: 'Task created',
      success: true,
    });

    await run('--instruction', 'Do the thing', '--json');

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          id: 'task_1',
          identifier: 'T-1',
          name: 'Personal task',
          url: 'https://app.example.com/task/T-1',
        },
        null,
        2,
      ),
    );
  });

  it('prints a clickable workspace task URL in human output', async () => {
    mockResolveWorkspaceId.mockReturnValue('ws-1');
    mockGetWorkspace.mockResolvedValue({ id: 'ws-1', slug: 'lobehub' });
    mockCreateTask.mockResolvedValue({
      data: { id: 'task_2', identifier: 'LOBE-321', name: 'Workspace task' },
      message: 'Task created',
      success: true,
    });

    await run('--instruction', 'Do the workspace thing');

    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('LOBE-321'));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://app.example.com/lobehub/task/LOBE-321'),
    );
  });
});
