import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLifecycleCommands } from './lifecycle';

const { client, streamAgentEvents } = vi.hoisted(() => ({
  client: {
    task: {
      addComment: { mutate: vi.fn() },
      find: { query: vi.fn() },
      heartbeat: { mutate: vi.fn() },
      run: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
    topic: { getTopicDetail: { query: vi.fn() } },
  },
  streamAgentEvents: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('../../api/http', () => ({
  getAuthInfo: vi.fn(async () => ({ headers: {}, serverUrl: 'https://example.com' })),
}));
vi.mock('../../utils/agentStream', () => ({ streamAgentEvents }));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerLifecycleCommands(program.command('task'));
  return program;
};

describe('task comment attribution', () => {
  const comment = () =>
    createProgram().parseAsync(['node', 'test', 'task', 'comment', 'T-1', '-m', 'Sync finished']);

  beforeEach(() => {
    vi.stubEnv('LOBEHUB_AGENT_ID', '');
    vi.stubEnv('LOBEHUB_TOPIC_ID', '');
    vi.stubEnv('LOBEHUB_OPERATION_ID', '');
    vi.stubEnv('LOBEHUB_JWT', '');
    client.task.addComment.mutate.mockReset();
    client.topic.getTopicDetail.query.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps ordinary terminal comments user-authored', async () => {
    await comment();

    expect(client.task.addComment.mutate).toHaveBeenCalledWith({
      content: 'Sync finished',
      id: 'T-1',
    });
    expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
  });

  it('uses the executing agent, not the task assignee', async () => {
    vi.stubEnv('LOBEHUB_AGENT_ID', 'agt_writer');
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc_current');

    await comment();

    expect(client.task.addComment.mutate).toHaveBeenCalledWith({
      authorAgentId: 'agt_writer',
      content: 'Sync finished',
      id: 'T-1',
      topicId: 'tpc_current',
    });
    expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
  });

  it('preserves the dispatched author after JWT is cleared even when the topic belongs to another agent', async () => {
    vi.stubEnv('LOBEHUB_AGENT_ID', 'agt_device');
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc_device');
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op_device');
    client.topic.getTopicDetail.query.mockResolvedValue({ agentId: 'agt_topic_owner' });

    await comment();

    expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
    expect(client.task.addComment.mutate).toHaveBeenCalledWith({
      authorAgentId: 'agt_device',
      content: 'Sync finished',
      id: 'T-1',
      topicId: 'tpc_device',
    });
  });

  it.each([null, { agentId: 'agt_topic_owner' }])(
    'does not infer the author from a topic (%j)',
    async (topic) => {
      vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc_missing');
      client.topic.getTopicDetail.query.mockResolvedValue(topic);

      await expect(comment()).rejects.toThrow('Cannot determine the agent author');
      expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
      expect(client.task.addComment.mutate).not.toHaveBeenCalled();
    },
  );

  it('refuses an agent run missing both agent and topic context', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op_incomplete');

    await expect(comment()).rejects.toThrow('Cannot determine the agent author');
    expect(client.task.addComment.mutate).not.toHaveBeenCalled();
  });
});

describe('task complete', () => {
  beforeEach(() => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', '');
    client.task.updateStatus.mutate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes the current run so completing its own task is deferred', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op_tick');
    client.task.updateStatus.mutate.mockResolvedValue({
      completionDeferred: true,
      data: { identifier: 'T-1' },
    });

    await createProgram().parseAsync(['node', 'test', 'task', 'complete', 'T-1']);

    expect(client.task.updateStatus.mutate).toHaveBeenCalledWith({
      id: 'T-1',
      operationId: 'op_tick',
      status: 'completed',
    });
  });

  it('omits the operation outside an agent run', async () => {
    client.task.updateStatus.mutate.mockResolvedValue({ data: { identifier: 'T-1' } });

    await createProgram().parseAsync(['node', 'test', 'task', 'complete', 'T-1']);

    expect(client.task.updateStatus.mutate).toHaveBeenCalledWith({
      id: 'T-1',
      operationId: undefined,
      status: 'completed',
    });
  });
});

describe('task lifecycle — following the agent stream', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
    for (const fn of Object.values(client.task)) Object.values(fn)[0].mockReset();
    streamAgentEvents.mockReset();
    client.task.find.query.mockResolvedValue({
      data: { assigneeAgentId: 'agt_1', identifier: 'T-1', status: 'pending' },
    });
    client.task.updateStatus.mutate.mockResolvedValue({ data: { identifier: 'T-1' } });
    client.task.run.mutate.mockResolvedValue({
      operationId: 'op-1',
      success: true,
      taskIdentifier: 'T-1',
      topicId: 'tpc_1',
    });
    client.task.heartbeat.mutate.mockResolvedValue({});
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('task run --topics 2 stops with exit 1 when a run fails, without starting the next one', async () => {
    streamAgentEvents.mockResolvedValue({ error: 'boom', kind: 'failed', status: 'error' });

    await expect(
      createProgram().parseAsync(['node', 'test', 'task', 'run', 'T-1', '--topics', '2']),
    ).rejects.toThrow('process.exit(1)');

    expect(client.task.run.mutate).toHaveBeenCalledTimes(1);
    expect(client.task.heartbeat.mutate).not.toHaveBeenCalled();
  });

  it('task start --follow exits 1 on a failed run', async () => {
    streamAgentEvents.mockResolvedValue({ error: 'boom', kind: 'failed', status: 'error' });

    await expect(
      createProgram().parseAsync(['node', 'test', 'task', 'start', 'T-1', '--follow']),
    ).rejects.toThrow('process.exit(1)');
  });

  it('a completed run sends the heartbeat and continues the sequence', async () => {
    streamAgentEvents.mockResolvedValue({ kind: 'completed', status: 'done' });

    await createProgram().parseAsync(['node', 'test', 'task', 'run', 'T-1', '--topics', '2']);

    expect(client.task.run.mutate).toHaveBeenCalledTimes(2);
    expect(client.task.heartbeat.mutate).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
    // task streams opt out of the quiet-window probe: a long silent tool call is healthy
    expect(streamAgentEvents.mock.calls[0][2]).not.toHaveProperty('onStall');
  });
});
