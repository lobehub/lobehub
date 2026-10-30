import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './task';

const mocks = vi.hoisted(() => ({
  agentConfig: vi.fn(),
  create: vi.fn(),
  detail: vi.fn(),
  getTrpcClient: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mocks.getTrpcClient }));
vi.mock('../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTaskCommand(program);
  await program.parseAsync(['node', 'test', 'task', ...args]);
};

describe('task model flags', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const task = { id: 'task_1', identifier: 'T-1', name: 'Run' };
    mocks.create.mockReset().mockResolvedValue({ data: task, success: true });
    mocks.update.mockReset().mockResolvedValue({ data: task, success: true });
    mocks.detail.mockReset();
    mocks.agentConfig.mockReset();
    mocks.getTrpcClient.mockResolvedValue({
      agent: { getAgentConfigById: { query: mocks.agentConfig } },
      task: {
        create: { mutate: mocks.create },
        detail: { query: mocks.detail },
        update: { mutate: mocks.update },
      },
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('creates a task with --model and --provider in config', async () => {
    await run(
      'create',
      '-i',
      'Run',
      '--agent',
      'agt_1',
      '--model',
      'deepseek-flash',
      '--provider',
      'lobehub',
    );

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ config: { model: 'deepseek-flash', provider: 'lobehub' } }),
    );
  });

  it('creates without config when no model flag is passed', async () => {
    await run('create', '-i', 'Run', '--agent', 'agt_1');

    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('config');
  });

  it('edits the model through a merged config patch', async () => {
    await run('edit', 'T-1', '--model', 'deepseek-flash', '--provider', 'lobehub');

    expect(mocks.update).toHaveBeenCalledWith({
      configPatch: { model: 'deepseek-flash', provider: 'lobehub' },
      id: 'T-1',
    });
  });

  it('clears the override with --model null', async () => {
    await run('edit', 'T-1', '--model', 'null');

    expect(mocks.update).toHaveBeenCalledWith({
      configPatch: { model: null, provider: null },
      id: 'T-1',
    });
  });

  it('shows the model of an unassigned task without looking up an agent', async () => {
    mocks.detail.mockResolvedValue({
      data: {
        config: { model: 'deepseek-flash', provider: 'lobehub' },
        id: 'task_1',
        identifier: 'T-1',
        instruction: 'Run',
        name: 'Run',
        priority: 0,
        status: 'backlog',
      },
    });

    await run('view', 'T-1');

    expect(mocks.agentConfig).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('lobehub/deepseek-flash (pinned)'),
    );
  });

  it('shows whether the task model overrides its agent in view', async () => {
    mocks.detail.mockResolvedValue({
      data: {
        agentId: 'agt_1',
        config: { model: 'deepseek-flash', provider: 'lobehub' },
        id: 'task_1',
        identifier: 'T-1',
        instruction: 'Run',
        name: 'Run',
        priority: 0,
        status: 'backlog',
      },
    });
    mocks.agentConfig.mockResolvedValue({ model: 'claude-opus', provider: 'anthropic' });

    await run('view', 'T-1');

    expect(mocks.agentConfig).toHaveBeenCalledWith({ agentId: 'agt_1' });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('lobehub/deepseek-flash (override)'),
    );
  });
});
