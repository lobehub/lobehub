import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './index';
import { describeVisibilityError, parseVisibility, withVisibilityHint } from './visibility';

const { mockGetTrpcClient, mockLogError, mockLogInfo } = vi.hoisted(() => ({
  mockGetTrpcClient: vi.fn(),
  mockLogError: vi.fn(),
  mockLogInfo: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: () => undefined }));
vi.mock('../../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));
vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn(), error: mockLogError, info: mockLogInfo, warn: vi.fn() },
}));

const PRIVATE_AGENT_ERROR =
  'A public task cannot be assigned to a private agent. Either pick a workspace agent or make the task private first.';

const row = (extra: Record<string, unknown> = {}) => ({
  data: { id: 'task_1', identifier: 'T-1', name: 'Task', ...extra },
  success: true,
});

const mocks = {
  changeLabels: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  updateVisibility: vi.fn(),
};

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTaskCommand(program);
  await program.parseAsync(['node', 'test', 'task', ...args]);
};

describe('parseVisibility', () => {
  it('accepts private and public, case-insensitively', () => {
    expect(parseVisibility('private')).toBe('private');
    expect(parseVisibility(' Public ')).toBe('public');
    expect(parseVisibility(undefined)).toBeUndefined();
  });

  it('rejects anything else with the accepted values', () => {
    expect(() => parseVisibility('secret')).toThrow(
      'Invalid visibility "secret". Must be one of: private, public',
    );
  });
});

describe('withVisibilityHint', () => {
  it('keeps the server message and points create at --visibility private', () => {
    const error = withVisibilityHint(new Error(PRIVATE_AGENT_ERROR), { command: 'create' });

    expect((error as Error).message).toBe(
      `${PRIVATE_AGENT_ERROR}\nHint: Create it with \`--visibility private\` instead.`,
    );
  });

  it('points edit at making the task private first', () => {
    const error = withVisibilityHint(new Error(PRIVATE_AGENT_ERROR), {
      command: 'edit',
      id: 'T-1',
    });

    expect((error as Error).message).toContain('lh task edit T-1 --visibility private');
  });

  it('passes unrelated errors through untouched', () => {
    const original = new Error('Task not found');

    expect(withVisibilityHint(original, { command: 'create' })).toBe(original);
  });
});

describe('describeVisibilityError', () => {
  it('keeps the server reason verbatim and says what was attempted', () => {
    const error = describeVisibilityError(
      new Error('Only the task creator can make this task private'),
      'T-1',
      'private',
    );

    expect(error.message).toBe(
      'Could not make T-1 private: Only the task creator can make this task private',
    );
  });
});

describe('task create --visibility', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.create.mockReset().mockResolvedValue(row());
    mockGetTrpcClient.mockResolvedValue({ task: { create: { mutate: mocks.create } } });
    mockLogError.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('sends the visibility to the server', async () => {
    await run('create', '-i', 'Do it', '--visibility', 'private', '--agent', 'agt_private');

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeAgentId: 'agt_private', visibility: 'private' }),
    );
  });

  it('leaves visibility to the server when the flag is omitted', async () => {
    await run('create', '-i', 'Do it');

    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('visibility');
  });

  it('rejects an invalid value before calling the server', async () => {
    await run('create', '-i', 'Do it', '--visibility', 'team');

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(expect.stringContaining('Invalid visibility'));
    expect(process.exitCode).toBe(1);
  });

  it('suggests --visibility private when a public task gets a private agent', async () => {
    mocks.create.mockRejectedValue(new Error(PRIVATE_AGENT_ERROR));

    await expect(
      run('create', '-i', 'Do it', '--visibility', 'public', '--agent', 'agt_private'),
    ).rejects.toThrow('Hint: Create it with `--visibility private` instead.');
  });
});

describe('task edit --visibility', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let order: string[];

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    order = [];
    mocks.update.mockReset().mockImplementation(async () => {
      order.push('update');
      return row();
    });
    mocks.updateStatus.mockReset().mockImplementation(async () => {
      order.push('updateStatus');
      return row();
    });
    mocks.updateVisibility.mockReset().mockImplementation(async ({ visibility }) => {
      order.push(`visibility:${visibility}`);
      return row({ visibility });
    });
    mocks.changeLabels.mockReset().mockImplementation(async () => {
      order.push('labels');
      return [{ id: 'lbl_bug', name: 'bug' }];
    });
    mocks.find.mockReset().mockResolvedValue(row({ visibility: 'public' }));
    mockGetTrpcClient.mockResolvedValue({
      task: {
        find: { query: mocks.find },
        update: { mutate: mocks.update },
        updateStatus: { mutate: mocks.updateStatus },
        updateVisibility: { mutate: mocks.updateVisibility },
      },
      taskLabel: {
        changeForTask: { mutate: mocks.changeLabels },
        list: { query: async () => [{ id: 'lbl_bug', name: 'bug' }] },
      },
    });
    mockLogError.mockReset();
    mockLogInfo.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('changes only the visibility through its own endpoint', async () => {
    await run('edit', 'T-1', '--visibility', 'private');

    expect(mocks.updateVisibility).toHaveBeenCalledWith({ id: 'T-1', visibility: 'private' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('is now private'));
  });

  it('prints the changed task as JSON for a visibility-only edit', async () => {
    await run('edit', 'T-1', '--visibility', 'private', '--json', 'identifier,visibility');

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      identifier: 'T-1',
      visibility: 'private',
    });
  });

  it('orders the visibility change around a label-only edit', async () => {
    await run('edit', 'T-1', '--label', 'bug', '--visibility', 'public');
    expect(order).toEqual(['labels', 'visibility:public']);

    order = [];
    await run('edit', 'T-1', '--label', 'bug', '--visibility', 'private');
    expect(order).toEqual(['visibility:private', 'labels']);
  });

  it('says the task was already made private when a later edit fails', async () => {
    mocks.update.mockRejectedValue(new Error('Task is being edited by another user'));

    await expect(
      run('edit', 'T-1', '--visibility', 'private', '--agent', 'agt_private'),
    ).rejects.toThrow('Task is being edited by another user (T-1 was already made private)');
  });

  it('makes the task private before assigning a private agent in the same command', async () => {
    await run('edit', 'T-1', '--visibility', 'private', '--agent', 'agt_private');

    expect(order).toEqual(['visibility:private', 'update']);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeAgentId: 'agt_private', id: 'T-1' }),
    );
  });

  it('makes the task public after moving it to another agent', async () => {
    await run('edit', 'T-1', '--agent', 'agt_workspace', '--visibility', 'public', '--json');

    expect(order).toEqual(['update', 'visibility:public']);
    const printed = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(printed.visibility).toBe('public');
  });

  it('makes the task public after a status-only change', async () => {
    await run('edit', 'T-1', '--status', 'paused', '--visibility', 'public');

    expect(order).toEqual(['updateStatus', 'visibility:public']);
  });

  it('stops before other edits when the server refuses to make the task private', async () => {
    mocks.updateVisibility.mockRejectedValue(
      new Error('Only the task creator can make this task private'),
    );

    await expect(
      run('edit', 'T-1', '--visibility', 'private', '--agent', 'agt_private'),
    ).rejects.toThrow(
      'Could not make T-1 private: Only the task creator can make this task private',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('says the other edits landed when making the task public fails afterwards', async () => {
    mocks.updateVisibility.mockRejectedValue(new Error(PRIVATE_AGENT_ERROR));

    await expect(run('edit', 'T-1', '--name', 'New', '--visibility', 'public')).rejects.toThrow(
      'Could not make T-1 public (the other changes in this command were applied)',
    );
    expect(mocks.update).toHaveBeenCalled();
  });

  it('suggests --visibility private when assigning a private agent to a public task', async () => {
    mocks.update.mockRejectedValue(new Error(PRIVATE_AGENT_ERROR));

    await expect(run('edit', 'T-1', '--agent', 'agt_private')).rejects.toThrow(
      'lh task edit T-1 --visibility private',
    );
  });

  it('rejects an invalid value before calling the server', async () => {
    await run('edit', 'T-1', '--visibility', 'team', '--agent', 'agt_private');

    expect(mocks.updateVisibility).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
