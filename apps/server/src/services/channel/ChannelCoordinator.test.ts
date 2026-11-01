// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const { executions, executeToolCall, interruptTask } = vi.hoisted(() => ({
  interruptTask: vi.fn().mockResolvedValue({ success: true }),
  executions: {
    publish: vi.fn(),
    releaseWriter: vi.fn(),
    retireReservation: vi.fn().mockResolvedValue(false),
    revokeExpiredLease: vi.fn(),
  },
  executeToolCall: vi.fn(),
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    constructor() {
      return executions;
    }
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    interruptTask = interruptTask;
  },
}));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: { executeToolCall } }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultAgentConfig: vi.fn() }));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn(),
}));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: vi.fn() }));
vi.mock('./ChannelRoutingService', () => ({ ChannelRoutingService: vi.fn() }));
vi.mock('./attachments', () => ({ resolveChannelAttachments: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));

describe('Channel completion physical writer confirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  const coordinator = (
    publicationRevoked = false,
    runtime = 'codex',
    leaseOwner: string | null = null,
    status = 'done',
  ) => {
    const job = {
      channelId: 'channel',
      draft: 'Final reply',
      id: 'job',
      leaseOwner,
      manifest: {},
      operationId: 'op',
      publicationRevoked,
      writerHeld: true,
    };
    const operation = { id: 'op', status, userId: 'user', workspaceId: null };
    const rows = [
      {
        ...job,
        job,
        operation,
        config: { runtime, deviceId: 'device', deviceOwnerId: 'owner' },
      },
    ];
    const query = Object.assign(Promise.resolve(rows), {
      from: vi.fn(),
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    });
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'limit'] as const)
      query[method].mockReturnValue(query);
    return new ChannelCoordinator({ select: () => query } as never);
  };

  it.each([false, true])(
    'keeps the directory held without physical confirmation (revoked: %s)',
    async (revoked) => {
      executeToolCall.mockResolvedValue({ success: true, state: { exited: false } });
      await coordinator(revoked).complete('channel', 'job', 'op');
      expect(executions.releaseWriter).not.toHaveBeenCalled();
      expect(executeToolCall).toHaveBeenCalled();
      expect(executions.publish).toHaveBeenCalledTimes(revoked ? 0 : 1);
    },
  );

  it('releases a completed writer only after the device confirms termination', async () => {
    executeToolCall.mockResolvedValue({ success: true, state: { exited: true } });
    await coordinator().complete('channel', 'job', 'op');
    expect(executeToolCall).toHaveBeenCalled();
    expect(executions.releaseWriter).toHaveBeenCalledWith('channel', 'job');
  });

  it.each([false, true])(
    'does not release a Native writer on runtime interruption alone (revoked: %s)',
    async (revoked) => {
      executeToolCall.mockResolvedValue({ success: true, state: { exited: false } });
      await coordinator(revoked, 'native').complete('channel', 'job', 'op');
      expect(executions.releaseWriter).not.toHaveBeenCalled();
    },
  );

  it('releases a Native writer only after its device tools and processes have drained', async () => {
    executeToolCall.mockResolvedValue({ success: true, state: { exited: true } });
    await coordinator(true, 'native').complete('channel', 'job', 'op');
    expect(executeToolCall).toHaveBeenCalled();
    expect(executions.releaseWriter).toHaveBeenCalledWith('channel', 'job');
  });

  // A worker that crashed after starting the run never reached finishDispatch.
  it('revokes an expired dispatch lease, then releases only after confirmed termination', async () => {
    executions.revokeExpiredLease.mockResolvedValue('revoked');
    executeToolCall.mockResolvedValue({ success: true, state: { exited: true } });
    await coordinator(false, 'codex', 'crashed-worker').complete('channel', 'job', 'op');
    expect(executions.revokeExpiredLease).toHaveBeenCalledWith('channel', 'job');
    expect(executeToolCall).toHaveBeenCalled();
    expect(executions.releaseWriter).toHaveBeenCalledWith('channel', 'job');
  });

  it('keeps the writer held after revoking an expired lease without confirmed termination', async () => {
    executions.revokeExpiredLease.mockResolvedValue('revoked');
    executeToolCall.mockResolvedValue({ success: true, state: { exited: false } });
    await coordinator(false, 'native', 'crashed-worker').complete('channel', 'job', 'op');
    expect(executions.releaseWriter).not.toHaveBeenCalled();
  });

  it('does not stop a writer while a live dispatcher still holds its lease', async () => {
    executions.revokeExpiredLease.mockResolvedValue('live');
    await coordinator(false, 'codex', 'live-worker').complete('channel', 'job', 'op');
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(executions.releaseWriter).not.toHaveBeenCalled();
  });

  // A worker passed its lease check and started the operation, then stalled past the lease.
  // A stop revokes the lease; the Desktop finds no process because the late start has not
  // arrived yet. Releasing now would let another writer into the directory before it does.
  it('keeps the writer when a revoked dispatcher may still start the run late', async () => {
    executions.revokeExpiredLease.mockResolvedValue('revoked');
    executeToolCall.mockResolvedValue({
      success: true,
      state: { exited: true, reason: 'not_found' },
    });
    await coordinator(true, 'codex', 'stalled-worker', 'running').stopWriters([
      { channelId: 'channel', id: 'job', operationId: 'op' },
    ]);
    expect(executeToolCall).toHaveBeenCalled();
    expect(executions.releaseWriter).not.toHaveBeenCalled();
  });

  it('releases a revoked dispatch once the device itself reported the run done', async () => {
    executions.revokeExpiredLease.mockResolvedValue('revoked');
    executeToolCall.mockResolvedValue({
      success: true,
      state: { exited: true, reason: 'not_found' },
    });
    await coordinator(false, 'codex', 'crashed-worker').complete('channel', 'job', 'op');
    expect(executions.releaseWriter).toHaveBeenCalledWith('channel', 'job');
  });

  it('trusts a missing process after the dispatch settled normally', async () => {
    executeToolCall.mockResolvedValue({
      success: true,
      state: { exited: true, reason: 'not_found' },
    });
    await coordinator(true, 'codex', null, 'running').stopWriters([
      { channelId: 'channel', id: 'job', operationId: 'op' },
    ]);
    expect(executions.revokeExpiredLease).not.toHaveBeenCalled();
    expect(executions.releaseWriter).toHaveBeenCalledWith('channel', 'job');
  });
});
