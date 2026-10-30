import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerMessageReplyCommand } from '../message/reply';
import { registerTopicSendCommand } from './send';

const { client, mockGetTrpcClient } = vi.hoisted(() => ({
  client: {
    agentSteerQueue: { append: { mutate: vi.fn() } },
    aiAgent: { execAgent: { mutate: vi.fn() } },
    message: { getMessageOrigin: { query: vi.fn() } },
    topic: { getTopicDetail: { query: vi.fn() } },
  },
  mockGetTrpcClient: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../api/workspaceRef', () => ({ resolveWorkspaceRef: vi.fn(async () => undefined) }));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTopicSendCommand(program.command('topic'));
  registerMessageReplyCommand(program.command('message'));
  await program.parseAsync(['node', 'lh', ...args]);
};

describe('lh topic send', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let logged: string[];

  beforeEach(() => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-sender');
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-here');
    mockGetTrpcClient.mockResolvedValue(client);
    client.topic.getTopicDetail.query.mockResolvedValue({ agentId: 'agt-target', groupId: null });
    client.agentSteerQueue.append.mutate.mockResolvedValue({ queued: false, reason: 'idle' });
    client.aiAgent.execAgent.mutate.mockResolvedValue({ operationId: 'op-new', success: true });
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
    Object.values(client).forEach((router) =>
      Object.values(router).forEach((procedure) =>
        Object.values(procedure).forEach((fn) => (fn as any).mockReset()),
      ),
    );
  });

  it("starts the topic's own agent on the message, authored by the sending run", async () => {
    await run('topic', 'send', 'tpc-target', '-c', 'Please iterate the verifier.');

    const request = {
      agentId: 'agt-target',
      appContext: { topicId: 'tpc-target' },
      prompt: 'Please iterate the verifier.',
      sourceOperationId: 'op-sender',
      trigger: 'cli',
      userInterventionConfig: { approvalMode: 'headless' },
    };
    // Tried as a queued follow-up first, so a busy topic is never interrupted.
    expect(client.agentSteerQueue.append.mutate).toHaveBeenCalledWith({ request });
    expect(client.aiAgent.execAgent.mutate).toHaveBeenCalledWith(request);
    expect(logged.join('\n')).toContain('op-new');
  });

  it('queues behind a running turn instead of starting a second run', async () => {
    client.agentSteerQueue.append.mutate.mockResolvedValue({ id: 'q-1', queued: true });

    await run('topic', 'send', 'tpc-target', '-c', 'hello', '--json');

    expect(client.aiAgent.execAgent.mutate).not.toHaveBeenCalled();
    expect(JSON.parse(logged[0])).toMatchObject({ delivery: 'queued', topicId: 'tpc-target' });
  });

  it('refuses to send into the conversation it runs in', async () => {
    await run('topic', 'send', 'tpc-here', '-c', 'hello');

    expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('refuses a group conversation and a full queue', async () => {
    client.topic.getTopicDetail.query.mockResolvedValueOnce({ agentId: null, groupId: 'grp-1' });
    await run('topic', 'send', 'tpc-group', '-c', 'hello');
    expect(client.agentSteerQueue.append.mutate).not.toHaveBeenCalled();

    client.agentSteerQueue.append.mutate.mockResolvedValueOnce({ queued: false, reason: 'full' });
    await run('topic', 'send', 'tpc-target', '-c', 'hello');
    expect(client.aiAgent.execAgent.mutate).not.toHaveBeenCalled();

    expect(exit).toHaveBeenCalledTimes(2);
  });

  it('passes the relay-limit refusal through to the agent', async () => {
    client.agentSteerQueue.append.mutate.mockRejectedValue(
      new Error('Agent relay limit reached: this would be agent-to-agent send #6 in a row'),
    );

    await run('topic', 'send', 'tpc-target', '-c', 'hello');

    expect(vi.mocked(log.error).mock.calls[0][0]).toContain('Agent relay limit reached');
    expect(exit).toHaveBeenCalledWith(1);
  });

  describe('lh message reply', () => {
    it("answers into the sender's conversation, waking it", async () => {
      client.message.getMessageOrigin.query.mockResolvedValue({
        agentSender: { agentId: 'agt-writer', threadId: 'thd-1', topicId: 'tpc-writer' },
        id: 'msg-1',
      });
      client.topic.getTopicDetail.query.mockResolvedValue({ agentId: 'agt-writer' });

      await run('message', 'reply', 'msg-1', '-c', 'Verifier v1.2 is ready.');

      expect(client.topic.getTopicDetail.query).toHaveBeenCalledWith({ id: 'tpc-writer' });
      expect(client.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agt-writer',
          appContext: { threadId: 'thd-1', topicId: 'tpc-writer' },
          prompt: 'Verifier v1.2 is ready.',
          sourceOperationId: 'op-sender',
        }),
      );
    });

    it('refuses a message a person wrote, and one whose origin was not kept', async () => {
      client.message.getMessageOrigin.query.mockResolvedValueOnce({ agentSender: null, id: 'm' });
      await run('message', 'reply', 'msg-1', '-c', 'hi');
      client.message.getMessageOrigin.query.mockResolvedValueOnce({
        agentSender: { agentId: 'agt-writer' },
        id: 'm',
      });
      await run('message', 'reply', 'msg-1', '-c', 'hi');

      expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledTimes(2);
      expect(vi.mocked(log.error).mock.calls[0][0]).toContain('lh topic send');
    });
  });
});
