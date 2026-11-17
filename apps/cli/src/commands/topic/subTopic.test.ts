import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerTopicCommand } from '../topic';

const { client, mockGetTrpcClient } = vi.hoisted(() => ({
  client: {
    subTopic: {
      archive: { mutate: vi.fn() },
      list: { query: vi.fn() },
      stop: { mutate: vi.fn() },
    },
    topic: { getTopics: { query: vi.fn() } },
  },
  mockGetTrpcClient: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../api/workspaceRef', () => ({ resolveWorkspaceRef: vi.fn(async () => undefined) }));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTopicCommand(program);
  await program.parseAsync(['node', 'lh', ...args]);
};

describe('lh topic — sub-topics', () => {
  let logged: string[];

  beforeEach(() => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-here');
    mockGetTrpcClient.mockResolvedValue(client);
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...parts) => void logged.push(parts.join(' ')));
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.mocked(log.error).mockClear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('lists the sub-topics this conversation opened', async () => {
    client.subTopic.list.query.mockResolvedValue([
      { agentId: 'agt-codex', state: 'running', title: 'Fix CI', topicId: 'tpc-child' },
    ]);

    await run('topic', 'list', '--opened-by-me');

    expect(client.subTopic.list.query).toHaveBeenCalledWith({ openerTopicId: 'tpc-here' });
    expect(client.topic.getTopics.query).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('tpc-child');
  });

  it('needs a parent topic to list sub-topics', async () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', '');

    await run('topic', 'list', '--opened-by-me');

    expect(vi.mocked(log.error).mock.calls[0][0]).toMatch(/--parent-topic-id/);
  });

  it('stops a topic and archives with or without its sub-topics', async () => {
    client.subTopic.stop.mutate.mockResolvedValue({ stopped: 1, topicId: 'tpc-child' });
    client.subTopic.archive.mutate.mockResolvedValue({ detached: [], retired: ['tpc-child'] });

    await run('topic', 'stop', 'tpc-child');
    await run('topic', 'archive', 'tpc-child');
    await run('topic', 'archive', 'tpc-child', '--all');

    expect(client.subTopic.stop.mutate).toHaveBeenCalledWith({ topicId: 'tpc-child' });
    expect(client.subTopic.archive.mutate.mock.calls).toEqual([
      [{ mode: 'self', topicId: 'tpc-child' }],
      [{ mode: 'all', topicId: 'tpc-child' }],
    ]);
  });
});
