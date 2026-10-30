// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const { executions, execAgent, notifyChannel } = vi.hoisted(() => ({
  executions: {
    accepted: vi.fn(),
    candidates: vi.fn(),
    heartbeat: vi.fn(),
    claim: vi.fn(),
    finishDispatch: vi.fn(),
    input: vi.fn(),
  },
  execAgent: vi.fn(),
  notifyChannel: vi.fn(),
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
    execAgent = execAgent;
  },
}));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultAgentConfig: () => ({}) }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: () => false }));
vi.mock('./attachments', () => ({ resolveChannelAttachments: vi.fn().mockResolvedValue({}) }));
vi.mock('./ChannelRoutingService', () => ({
  ChannelRoutingService: class {
    advance = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('./notify', () => ({ notifyChannel }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));

const coordinator = (count = 3, recovering = false) => {
  const pending = Array.from({ length: count }, (_, index) => ({
    id: `job-${index}`,
    memberId: `job-${index}`,
    status: 'queued',
  }));
  executions.candidates.mockResolvedValue({
    heads: pending,
    inFlight: recovering ? [{ id: 'previous', memberId: 'job-0', status: 'running' }] : [],
  });
  const query = (rows: unknown[]) => {
    const result = Object.assign(Promise.resolve(rows), {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    });
    for (const method of ['from', 'where', 'orderBy', 'limit'] as const)
      result[method].mockReturnValue(result);
    return result;
  };
  const select = vi
    .fn()
    .mockReturnValueOnce(query([{ id: 'channel', workspaceId: null }]))
    .mockReturnValueOnce(query([]));
  return new ChannelCoordinator({ select } as never);
};

describe('Channel concurrent startup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    executions.input.mockResolvedValue([]);
    executions.heartbeat.mockResolvedValue(true);
    execAgent.mockResolvedValue({ success: true });
    executions.claim.mockImplementation(async (_channelId, id: string) => ({
      job: {
        channelId: 'channel',
        id,
        operationId: id,
        leaseOwner: 'dispatcher',
        executionConfig: { runtime: 'native' },
        manifest: {
          self: { agentId: id, memberId: id, name: id },
          cutoffSequence: 1,
          requestMessageId: 'message',
          requesterMemberId: 'user',
          threadId: null,
          threadRootSequence: null,
        },
      },
      member: { agentId: id },
      topic: { id, userId: 'user' },
    }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('notifies the claimed reply state before runtime startup resolves', async () => {
    const gate = Promise.withResolvers<{ success: boolean }>();
    execAgent.mockReturnValue(gate.promise);
    const advancing = coordinator(1).advance('channel');
    try {
      await vi.waitFor(() => expect(execAgent).toHaveBeenCalledTimes(1));
      expect(executions.accepted).not.toHaveBeenCalled();
      expect(notifyChannel).toHaveBeenCalledWith(expect.anything(), 'channel');
    } finally {
      gate.resolve({ success: true });
      await advancing;
    }
  });

  it('does not delay runtime startup while a status notification is slow', async () => {
    const gate = Promise.withResolvers<void>();
    notifyChannel.mockReturnValue(gate.promise);
    const advancing = coordinator(1).advance('channel');
    try {
      await vi.waitFor(() => expect(notifyChannel).toHaveBeenCalled());
      await vi.waitFor(() => expect(execAgent).toHaveBeenCalledTimes(1));
    } finally {
      gate.resolve();
      await advancing;
    }
  });

  it('starts other Agents before a slow Agent finishes starting', async () => {
    const gate = Promise.withResolvers<{ success: boolean }>();
    execAgent.mockImplementation(({ agentId }: { agentId: string }) =>
      agentId === 'job-0' ? gate.promise : Promise.resolve({ success: true }),
    );
    const advancing = coordinator().advance('channel');
    try {
      await vi.waitFor(() => expect(executions.accepted).toHaveBeenCalledWith('channel', 'job-2'));
      expect(executions.accepted).not.toHaveBeenCalledWith('channel', 'job-0');
    } finally {
      gate.resolve({ success: true });
      await advancing;
    }
    expect(executions.accepted).toHaveBeenCalledTimes(3);
  });

  it('recovers an earlier run before claiming the same member again without blocking others', async () => {
    const gate = Promise.withResolvers<void>();
    const instance = coordinator(3, true);
    vi.spyOn(instance, 'complete').mockReturnValue(gate.promise);
    const advancing = instance.advance('channel');
    try {
      await vi.waitFor(() => expect(executions.accepted).toHaveBeenCalledWith('channel', 'job-2'));
      expect(execAgent).not.toHaveBeenCalledWith(expect.objectContaining({ agentId: 'job-0' }));
    } finally {
      gate.resolve();
      await advancing;
    }
    expect(executions.accepted).toHaveBeenCalledWith('channel', 'job-0');
  });

  it('bounds startup concurrency and drains the remaining Agents', async () => {
    const gate = Promise.withResolvers<{ success: boolean }>();
    execAgent.mockReturnValue(gate.promise);
    const advancing = coordinator(8).advance('channel');
    try {
      await vi.waitFor(() => expect(execAgent).toHaveBeenCalledTimes(5));
      expect(executions.claim).toHaveBeenCalledTimes(5);
    } finally {
      gate.resolve({ success: true });
      await advancing;
    }
    expect(executions.accepted).toHaveBeenCalledTimes(8);
  });

  it('drains other startups and notifies even when one claim fails', async () => {
    executions.claim.mockRejectedValueOnce(new Error('Claim failed'));
    const result = coordinator()
      .advance('channel')
      .catch((error: unknown) => error);
    expect(await result).toBeInstanceOf(Error);
    expect(executions.accepted).toHaveBeenCalledTimes(2);
    expect(notifyChannel).toHaveBeenCalledWith(expect.anything(), 'channel');
  });

  it('does not dispatch a blocked job or prevent other Agents from starting', async () => {
    executions.claim.mockResolvedValueOnce(null);
    await coordinator().advance('channel');
    expect(execAgent).toHaveBeenCalledTimes(2);
    expect(executions.accepted).not.toHaveBeenCalledWith('channel', 'job-0');
  });
});
