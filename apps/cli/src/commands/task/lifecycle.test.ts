import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStreamHistoryError } from '../../utils/agentStreamTransport';
import { registerLifecycleCommands } from './lifecycle';

const { client, streamAgentEventsViaWebSocket } = vi.hoisted(() => ({
  client: {
    task: {
      find: { query: vi.fn() },
      heartbeat: { mutate: vi.fn() },
      run: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
  },
  streamAgentEventsViaWebSocket: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('../../api/http', () => ({
  getAgentStreamAuthInfo: vi.fn(async () => ({
    token: 'test',
    tokenType: 'apiKey',
    serverUrl: 'https://example.com',
  })),
}));
vi.mock('../../settings', () => ({ resolveAgentGatewayUrl: () => 'https://gateway.test' }));
vi.mock('../../utils/agentStream', () => ({ streamAgentEventsViaWebSocket }));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerLifecycleCommands(program.command('task'));
  return program;
};

describe('task lifecycle — following the agent stream', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
    for (const fn of Object.values(client.task)) Object.values(fn)[0].mockReset();
    streamAgentEventsViaWebSocket.mockReset();
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
    process.exitCode = undefined;
  });

  it('stops with an unknown outcome when complete history cannot be recovered', async () => {
    streamAgentEventsViaWebSocket.mockRejectedValue(new AgentStreamHistoryError('History expired'));

    await createProgram().parseAsync(['task', 'run', 'task-1', '--follow', '--topics', '2'], {
      from: 'user',
    });

    expect(process.exitCode).toBe(3);
    expect(client.task.run.mutate).toHaveBeenCalledTimes(1);
    expect(client.task.heartbeat.mutate).not.toHaveBeenCalled();
  });

  it('task run --topics 2 stops with exit 1 when a run fails, without starting the next one', async () => {
    streamAgentEventsViaWebSocket.mockResolvedValue({
      error: 'boom',
      kind: 'failed',
      status: 'error',
    });

    await createProgram().parseAsync(['node', 'test', 'task', 'run', 'T-1', '--topics', '2']);
    expect(process.exitCode).toBe(1);

    expect(client.task.run.mutate).toHaveBeenCalledTimes(1);
    expect(client.task.heartbeat.mutate).not.toHaveBeenCalled();
  });

  it('task start --follow exits 1 on a failed run', async () => {
    streamAgentEventsViaWebSocket.mockResolvedValue({
      error: 'boom',
      kind: 'failed',
      status: 'error',
    });

    await createProgram().parseAsync(['node', 'test', 'task', 'start', 'T-1', '--follow']);
    expect(process.exitCode).toBe(1);
  });

  it('a completed run sends the heartbeat and continues the sequence', async () => {
    streamAgentEventsViaWebSocket.mockResolvedValue({ kind: 'completed', status: 'done' });

    await createProgram().parseAsync(['node', 'test', 'task', 'run', 'T-1', '--topics', '2']);

    expect(client.task.run.mutate).toHaveBeenCalledTimes(2);
    expect(client.task.heartbeat.mutate).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
    // task streams opt out of the quiet-window probe: a long silent tool call is healthy
    expect(streamAgentEventsViaWebSocket.mock.calls[0][0]).not.toHaveProperty('onStall');
  });

  it.each([
    ['waiting_for_human', 2],
    ['interrupted', 1],
    ['unknown', 3],
  ] as const)(
    'stops the topic sequence for %s without a completion heartbeat',
    async (kind, code) => {
      streamAgentEventsViaWebSocket.mockResolvedValue({ kind });
      await createProgram().parseAsync(['node', 'test', 'task', 'run', 'T-1', '--topics', '2']);
      expect(process.exitCode).toBe(code);
      expect(client.task.run.mutate).toHaveBeenCalledTimes(1);
      expect(client.task.heartbeat.mutate).not.toHaveBeenCalled();
    },
  );
});
