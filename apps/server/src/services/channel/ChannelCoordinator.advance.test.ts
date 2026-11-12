// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const { createChannelWorktree, executions, execAgent, getScopedOnlineDevices, notifyChannel } =
  vi.hoisted(() => ({
    createChannelWorktree: vi.fn(),
    executions: {
      accepted: vi.fn(),
      assignWorktree: vi.fn(),
      candidates: vi.fn(),
      heartbeat: vi.fn(),
      claim: vi.fn(),
      finishDispatch: vi.fn(),
      input: vi.fn(),
      primaryReply: vi.fn(),
      recentContext: vi.fn(),
      worktreeCandidate: vi.fn(),
      worktreeUnavailable: vi.fn(),
    },
    execAgent: vi.fn(),
    getScopedOnlineDevices: vi.fn(),
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
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({ getScopedOnlineDevices }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: () => false }));
vi.mock('./attachments', () => ({ resolveChannelAttachments: vi.fn().mockResolvedValue({}) }));
vi.mock('./ChannelRoutingService', () => ({
  ChannelRoutingService: class {
    advance = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('./notify', () => ({ notifyChannel }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./worktree', () => ({ createChannelWorktree }));

const coordinator = (count = 3, recovering = false, members: unknown[] = []) => {
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
    .mockReturnValueOnce(query(members));
  return new ChannelCoordinator({ select } as never);
};

describe('Channel concurrent startup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getScopedOnlineDevices.mockResolvedValue([]);
    executions.input.mockResolvedValue([]);
    executions.recentContext.mockResolvedValue({ messages: [], omitted: 0 });
    executions.primaryReply.mockResolvedValue(null);
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

  it('hands a deferred follow-up the primary responder’s reply', async () => {
    executions.primaryReply.mockResolvedValue({
      author: { id: 'agt-coder', name: 'Coder', type: 'agent' },
      content: 'Fixed in the tokenizer.',
      id: 'reply',
      replyToId: 'message',
      sequence: 2,
      threadId: null,
    });
    await coordinator(1).advance('channel');

    expect(executions.primaryReply).toHaveBeenCalledWith('channel', 'job-0');
    const [{ prompt }] = execAgent.mock.calls[0];
    expect(prompt).toContain('<channel_reply from="Coder" type="agent"');
    expect(prompt).toContain('Fixed in the tokenizer.');
  });

  describe('a job waiting on its directory', () => {
    const candidate = {
      branch: 'lobe-channel/0123456789ab-main',
      deviceId: 'device-1',
      deviceUserId: 'owner',
      memberId: 'job-0',
      sourceDirectory: '/repo',
      threadId: null,
    };
    const online = () => {
      getScopedOnlineDevices.mockResolvedValue([{ deviceId: 'device-1', online: true }]);
      return [{ config: { deviceId: 'device-1', deviceOwnerId: 'owner' } }];
    };

    it('moves its branch into a worktree and starts it there', async () => {
      const claim = executions.claim.getMockImplementation()!;
      executions.claim.mockResolvedValueOnce(null).mockImplementation(claim);
      executions.worktreeCandidate.mockResolvedValue(candidate);
      executions.assignWorktree.mockResolvedValue(true);
      createChannelWorktree.mockResolvedValue({ path: '/home/.lobehub/worktrees/repo/wt' });

      await coordinator(1, false, online()).advance('channel');

      expect(createChannelWorktree).toHaveBeenCalledWith(candidate, null);
      expect(executions.assignWorktree).toHaveBeenCalledWith(
        'channel',
        candidate,
        '/home/.lobehub/worktrees/repo/wt',
      );
      expect(executions.claim).toHaveBeenCalledTimes(2);
      expect(execAgent).toHaveBeenCalledTimes(1);
    });

    it('keeps waiting when the directory cannot host a worktree', async () => {
      executions.claim.mockResolvedValue(null);
      executions.worktreeCandidate.mockResolvedValue(candidate);
      createChannelWorktree.mockResolvedValue({ error: 'not a git repository' });

      await coordinator(1, false, online()).advance('channel');

      expect(executions.worktreeUnavailable).toHaveBeenCalledWith(
        'channel',
        candidate,
        'not a git repository',
      );
      expect(executions.claim).toHaveBeenCalledTimes(1);
      expect(execAgent).not.toHaveBeenCalled();
    });

    it('does not ask an offline device for a worktree', async () => {
      executions.claim.mockResolvedValue(null);
      executions.worktreeCandidate.mockResolvedValue(candidate);

      await coordinator(1).advance('channel');

      expect(createChannelWorktree).not.toHaveBeenCalled();
    });
  });
});
