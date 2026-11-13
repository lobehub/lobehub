import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerMessageSendCommand } from '../message/send';
import { registerTopicSendCommand } from './send';

const { client, mockGetTrpcClient, mockResolveLocalDeviceId } = vi.hoisted(() => ({
  client: {
    agentSteerQueue: { append: { mutate: vi.fn() } },
    aiAgent: { execAgent: { mutate: vi.fn() } },
    device: { listDevices: { query: vi.fn() } },
    topic: { getTopicDetail: { query: vi.fn() } },
  },
  mockGetTrpcClient: vi.fn(),
  mockResolveLocalDeviceId: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../api/workspaceRef', () => ({ resolveWorkspaceRef: vi.fn(async () => undefined) }));
vi.mock('../../utils/device', () => ({ resolveLocalDeviceId: mockResolveLocalDeviceId }));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTopicSendCommand(program.command('topic'));
  registerMessageSendCommand(program.command('message'));
  await program.parseAsync(['node', 'lh', ...args]);
};

const errorLogged = () =>
  vi
    .mocked(log.error)
    .mock.calls.map(([message]) => message)
    .join('\n');

describe('sending into a new conversation', () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let logged: string[];

  beforeEach(() => {
    vi.stubEnv('LOBEHUB_AGENT_ID', 'agt-self');
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op-sender');
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc-here');
    mockGetTrpcClient.mockResolvedValue(client);
    client.aiAgent.execAgent.mutate.mockResolvedValue({
      operationId: 'op-new',
      success: true,
      topicId: 'tpc-new',
    });
    client.device.listDevices.query.mockResolvedValue([
      { deviceId: 'dev-mac', online: true },
      { deviceId: 'dev-off', online: false },
    ]);
    mockResolveLocalDeviceId.mockReturnValue('dev-mac');
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

  it('opens a new conversation of the calling agent, authored by the sending run', async () => {
    await run('topic', 'send', '--new', '-c', 'Draft the release notes', '--json');

    expect(client.aiAgent.execAgent.mutate).toHaveBeenCalledWith({
      agentId: 'agt-self',
      prompt: 'Draft the release notes',
      sourceOperationId: 'op-sender',
      trigger: 'cli',
      userInterventionConfig: { approvalMode: 'headless' },
    });
    // No topic is named, so nothing is queued and no existing topic is read.
    expect(client.agentSteerQueue.append.mutate).not.toHaveBeenCalled();
    expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
    expect(JSON.parse(logged[0])).toEqual({
      agentId: 'agt-self',
      delivery: 'created',
      operationId: 'op-new',
      topicId: 'tpc-new',
    });
  });

  it('runs the new conversation on the named device, with the given agent and title', async () => {
    await run(
      'topic',
      'send',
      '--new',
      '-c',
      'Check the build',
      '--agent-id',
      'agt-builder',
      '--device',
      'local',
      '--title',
      'Build check',
    );

    expect(client.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt-builder',
        deviceId: 'dev-mac',
        title: 'Build check',
      }),
    );
  });

  it('refuses an offline or unknown device instead of running elsewhere', async () => {
    await run('topic', 'send', '--new', '-c', 'x', '--device', 'dev-off');
    await run('topic', 'send', '--new', '-c', 'x', '--device', 'dev-gone');

    expect(client.aiAgent.execAgent.mutate).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(2);
    expect(errorLogged()).toContain('"dev-off" is not online');
    expect(errorLogged()).toContain('"dev-gone" was not found');
  });

  // ROOT CAUSE:
  //
  // A workspace agent with a fixed execution target always runs on that target;
  // the server dropped a requested device for it, and the CLI still reported a
  // send to that machine. Whether the policy applies depends on the caller's
  // effective config (owners and private agents are exempt), which only the
  // server knows.
  //
  // Before: --device was a preference the fixed target silently overrode.
  // After: the CLI requires the device and the server refuses instead.
  it('requires the device, and surfaces the server refusing one the agent would ignore', async () => {
    client.aiAgent.execAgent.mutate.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'This agent always runs on its configured execution target, so device dev-mac would be ignored.',
        ),
        { data: { code: 'PRECONDITION_FAILED' } },
      ),
    );

    await run('message', 'send', '-c', 'x', '--device', 'local');

    expect(client.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-mac', requireDevice: true }),
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(errorLogged()).toContain('would be ignored');
  });

  it('does not require a device it was not given', async () => {
    await run('topic', 'send', '--new', '-c', 'x');

    expect(client.aiAgent.execAgent.mutate.mock.calls[0][0]).not.toHaveProperty('requireDevice');
  });

  it('needs exactly one of a topic id and --new, and keeps new-only options off existing topics', async () => {
    await run('topic', 'send', 'tpc-target', '--new', '-c', 'x');
    await run('topic', 'send', '-c', 'x');
    await run('topic', 'send', 'tpc-target', '-c', 'x', '--device', 'local');

    expect(client.aiAgent.execAgent.mutate).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(3);
  });

  it('asks for an agent when none is running this command', async () => {
    vi.stubEnv('LOBEHUB_AGENT_ID', '');

    await run('topic', 'send', '--new', '-c', 'x');

    expect(client.aiAgent.execAgent.mutate).not.toHaveBeenCalled();
    expect(errorLogged()).toContain('--agent-id');
  });

  describe('lh message send', () => {
    it('opens a new conversation without --topic-id', async () => {
      await run('message', 'send', '-c', 'Draft the release notes', '--title', 'Notes');

      expect(client.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agt-self', title: 'Notes' }),
      );
      expect(client.agentSteerQueue.append.mutate).not.toHaveBeenCalled();
    });

    it('sends to the conversation named with --topic-id, like topic send', async () => {
      client.topic.getTopicDetail.query.mockResolvedValue({ agentId: 'agt-target' });
      client.agentSteerQueue.append.mutate.mockResolvedValue({ id: 'q-1', queued: true });

      await run('message', 'send', '--topic-id', 'tpc-target', '-c', 'hello', '--json');

      expect(client.agentSteerQueue.append.mutate).toHaveBeenCalledWith({
        id: expect.any(String),
        request: expect.objectContaining({ agentId: 'agt-target', prompt: 'hello' }),
      });
      expect(JSON.parse(logged[0])).toMatchObject({ delivery: 'queued', topicId: 'tpc-target' });
    });

    it('keeps new-conversation options off an existing conversation', async () => {
      await run('message', 'send', '--topic-id', 'tpc-target', '-c', 'x', '--title', 'T');

      expect(client.topic.getTopicDetail.query).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
