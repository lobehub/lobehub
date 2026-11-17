import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerSessionCommand } from './session';

const { client, mockGetTrpcClient } = vi.hoisted(() => ({
  client: {
    device: { listDevices: { query: vi.fn() } },
    subSession: {
      archive: { mutate: vi.fn() },
      get: { query: vi.fn() },
      list: { query: vi.fn() },
      read: { query: vi.fn() },
      send: { mutate: vi.fn() },
      start: { mutate: vi.fn() },
      stop: { mutate: vi.fn() },
    },
  },
  mockGetTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/workspaceRef', () => ({ resolveWorkspaceRef: vi.fn(async () => undefined) }));
vi.mock('../utils/device', () => ({ resolveLocalDeviceId: vi.fn(() => 'dev-mac') }));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerSessionCommand(program);
  await program.parseAsync(['node', 'lh', ...args]);
};

describe('lh session', () => {
  let logged: string[];

  beforeEach(() => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-here');
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-here');
    mockGetTrpcClient.mockResolvedValue(client);
    client.subSession.start.mutate.mockResolvedValue({
      agentId: 'agt-codex',
      branch: 'lobehub/202611171200-brave-river',
      topicId: 'tpc-child',
    });
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...parts) => void logged.push(parts.join(' ')));
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.mocked(log.error).mockClear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('opens a sub-session of this conversation, attributed to this run', async () => {
    await run(
      'session',
      'start',
      '-c',
      'Fix the flaky test',
      '--agent-id',
      'agt-codex',
      '--where',
      'new-worktree',
      '--base-branch',
      'canary',
      '--json',
    );

    expect(client.subSession.start.mutate).toHaveBeenCalledWith({
      agentId: 'agt-codex',
      baseBranch: 'canary',
      openerTopicId: 'tpc-here',
      prompt: 'Fix the flaky test',
      sourceOperationId: 'op-here',
      workspace: 'new-worktree',
    });
    expect(JSON.parse(logged[0]).topicId).toBe('tpc-child');
  });

  it('refuses an unknown working-directory mode', async () => {
    await run('session', 'start', '-c', 'x', '--where', 'elsewhere');

    expect(client.subSession.start.mutate).not.toHaveBeenCalled();
    expect(vi.mocked(log.error).mock.calls[0][0]).toMatch(/--where must be one of/);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('needs a conversation to open it from', async () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', '');

    await run('session', 'start', '-c', 'x');

    expect(vi.mocked(log.error).mock.calls[0][0]).toMatch(/--topic-id/);
  });

  it('sends a follow-up attributed to this run', async () => {
    client.subSession.send.mutate.mockResolvedValue({ delivery: 'queued', topicId: 'tpc-child' });

    await run('session', 'send', 'tpc-child', '-c', 'Also update the docs');

    expect(client.subSession.send.mutate).toHaveBeenCalledWith({
      message: 'Also update the docs',
      sourceOperationId: 'op-here',
      topicId: 'tpc-child',
    });
    expect(logged[0]).toContain('waits behind its current turn');
  });

  it('lists the sub-sessions of this conversation', async () => {
    client.subSession.list.query.mockResolvedValue([
      { agentId: 'agt-codex', state: 'running', title: 'Fix', topicId: 'tpc-child' },
    ]);

    await run('session', 'list', '--json');

    expect(client.subSession.list.query).toHaveBeenCalledWith({ openerTopicId: 'tpc-here' });
  });

  it('archives with or without its own sub-sessions', async () => {
    client.subSession.archive.mutate.mockResolvedValue({ detached: [], retired: ['tpc-child'] });

    await run('session', 'archive', 'tpc-child');
    await run('session', 'archive', 'tpc-child', '--all');

    expect(client.subSession.archive.mutate.mock.calls).toEqual([
      [{ mode: 'self', topicId: 'tpc-child' }],
      [{ mode: 'all', topicId: 'tpc-child' }],
    ]);
  });
});
