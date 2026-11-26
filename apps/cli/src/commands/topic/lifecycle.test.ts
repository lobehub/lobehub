import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerTopicCommand } from '../topic';

const { client, mockGetTrpcClient } = vi.hoisted(() => ({
  client: {
    aiAgent: { interruptTask: { mutate: vi.fn() } },
    topic: { getTopics: { query: vi.fn() }, updateTopic: { mutate: vi.fn() } },
  },
  mockGetTrpcClient: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../api/workspaceRef', () => ({ resolveWorkspaceRef: vi.fn(async () => undefined) }));
vi.mock('./resourceUrl', () => ({
  resolveUrlBuilder: vi.fn(async () => undefined),
  resourcePath: { topic: vi.fn() },
  withUrls: (items: unknown[]) => items,
}));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTopicCommand(program);
  await program.parseAsync(['node', 'lh', ...args]);
};

describe('topic lifecycle and child topics', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let logged: string[];

  beforeEach(() => {
    mockGetTrpcClient.mockResolvedValue(client);
    client.topic.getTopics.query.mockResolvedValue({ items: [], total: 0 });
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...parts) => {
      logged.push(parts.join(' '));
    });
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.mocked(log.error).mockClear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stops the topic's runs through the existing interrupt entry", async () => {
    client.aiAgent.interruptTask.mutate.mockResolvedValue({
      running: 1,
      stopped: 1,
      success: true,
    });

    await run('topic', 'stop', 'tpc-a');

    expect(client.aiAgent.interruptTask.mutate).toHaveBeenCalledWith({ topicId: 'tpc-a' });
    expect(logged.join('\n')).toMatch(/Stopped tpc-a/);
  });

  it('fails when a run could not be confirmed stopped', async () => {
    client.aiAgent.interruptTask.mutate.mockResolvedValue({
      running: 1,
      stopped: 0,
      success: false,
    });

    await run('topic', 'stop', 'tpc-a');

    expect(vi.mocked(log.error).mock.calls[0][0]).toMatch(/could not be confirmed stopped/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('archives and unarchives through topic.updateTopic, like the app', async () => {
    await run('topic', 'archive', 'tpc-a');
    expect(client.topic.updateTopic.mutate).toHaveBeenCalledWith({
      id: 'tpc-a',
      value: { completedAt: expect.any(Date), status: 'completed' },
    });

    await run('topic', 'unarchive', 'tpc-a');
    expect(client.topic.updateTopic.mutate).toHaveBeenLastCalledWith({
      id: 'tpc-a',
      value: { completedAt: null, status: 'active' },
    });
  });

  it('lists the child topics of a parent, or of the running conversation', async () => {
    await run('topic', 'list', '--parent-topic-id', 'tpc-parent');
    expect(client.topic.getTopics.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ openedByTopicId: 'tpc-parent' }),
    );

    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-here');
    await run('topic', 'list', '--opened-by-me');
    expect(client.topic.getTopics.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ openedByTopicId: 'tpc-here' }),
    );
  });

  it('needs a conversation for --opened-by-me', async () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', '');

    await run('topic', 'list', '--opened-by-me');

    expect(exit).toHaveBeenCalledWith(1);
    expect(client.topic.getTopics.query).not.toHaveBeenCalled();
  });
});
