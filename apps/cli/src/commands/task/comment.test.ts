import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLifecycleCommands } from './lifecycle';

const { client } = vi.hoisted(() => ({
  client: {
    task: {
      addComment: { mutate: vi.fn() },
      deleteComment: { mutate: vi.fn() },
      detail: { query: vi.fn() },
      updateComment: { mutate: vi.fn() },
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

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  const task = program.command('task');
  registerLifecycleCommands(task);
  // Help and errors of the nested commands exit too, instead of killing the test.
  for (const command of task.commands) {
    command.exitOverride();
    for (const child of command.commands) child.exitOverride();
  }
  return program.parseAsync(['node', 'test', 'task', 'comment', ...args]);
};

describe('task comment commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('LOBEHUB_AGENT_ID', '');
    vi.stubEnv('LOBEHUB_TOPIC_ID', '');
    vi.stubEnv('LOBEHUB_OPERATION_ID', '');
    for (const procedure of Object.values(client.task)) {
      ('mutate' in procedure ? procedure.mutate : procedure.query).mockReset();
    }
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('still adds a comment with `comment <id> -m`', async () => {
    await run('T-1', '-m', 'hello');

    expect(client.task.addComment.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello', id: 'T-1' }),
    );
  });

  it('still requires a message when adding', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(run('T-1')).rejects.toThrow('--message');
    expect(client.task.addComment.mutate).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('routes -m to `comment edit`, not to the parent', async () => {
    client.task.updateComment.mutate.mockResolvedValue({ data: { taskId: 'task_1' } });

    await run('edit', 'cmt_1', '-m', 'updated');

    expect(client.task.updateComment.mutate).toHaveBeenCalledWith({
      commentId: 'cmt_1',
      content: 'updated',
    });
    expect(client.task.addComment.mutate).not.toHaveBeenCalled();
  });

  it('requires a message when editing', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(run('edit', 'cmt_1')).rejects.toThrow('--message');
    expect(client.task.updateComment.mutate).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('does not require a message for the other subcommands', async () => {
    await run('delete', 'cmt_1', '-y');

    expect(client.task.deleteComment.mutate).toHaveBeenCalled();
  });

  it('deletes a comment and reports it as JSON', async () => {
    await run('delete', 'cmt_1', '-y', '--json');

    expect(client.task.deleteComment.mutate).toHaveBeenCalledWith({ commentId: 'cmt_1' });
    expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ deleted: true, id: 'cmt_1' });
  });

  it('lists only the comment activities, with the task url', async () => {
    client.task.detail.query.mockResolvedValue({
      data: {
        activities: [
          { content: 'first', id: 'cmt_1', type: 'comment' },
          { id: 'tpc_1', type: 'topic' },
        ],
        identifier: 'T-1',
      },
    });

    await run('list', 'T-1', '--json');

    expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([
      expect.objectContaining({ id: 'cmt_1', url: 'https://app.example.com/task/T-1' }),
    ]);
  });
});
