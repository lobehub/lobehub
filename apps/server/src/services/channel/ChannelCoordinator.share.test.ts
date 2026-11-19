// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const {
  checkSpend,
  execAgent,
  executions,
  findOperation,
  findShare,
  getScopedOnlineDevices,
  resolveChannelAttachments,
  serviceOptions,
} = vi.hoisted(() => ({
  checkSpend: vi.fn(),
  getScopedOnlineDevices: vi.fn(),
  execAgent: vi.fn(),
  executions: {
    accepted: vi.fn(),
    candidates: vi.fn(),
    claim: vi.fn(),
    fail: vi.fn(),
    finishDispatch: vi.fn(),
    heartbeat: vi.fn(),
    input: vi.fn(),
    coAddressed: vi.fn(),
    openingReply: vi.fn(),
    primaryReply: vi.fn(),
    recentContext: vi.fn(),
    retireReservation: vi.fn(),
  },
  findOperation: vi.fn(),
  findShare: vi.fn(),
  resolveChannelAttachments: vi.fn(),
  serviceOptions: [] as Array<{ options: unknown; userId: string }>,
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    constructor() {
      return executions;
    }
  },
}));
vi.mock('@/database/models/agentShare', () => ({ AgentShareModel: { findByShareId: findShare } }));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = findOperation;
  },
}));
vi.mock('@/business/server/agent-share/spendGate', () => ({
  checkAgentShareSpendAllowance: checkSpend,
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgent;
    constructor(_db: unknown, userId: string, options: unknown) {
      serviceOptions.push({ options, userId });
    }
  },
}));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultAgentConfig: () => ({}) }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({ getScopedOnlineDevices }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: () => false }));
vi.mock('./attachments', () => ({ resolveChannelAttachments }));
vi.mock('./ChannelRoutingService', () => ({
  ChannelRoutingService: class {
    advance = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./replyOpening', () => ({ openChannelReply: vi.fn() }));
vi.mock('./worktree', () => ({ createChannelWorktree: vi.fn() }));

const share = { ownerId: 'owner', shareId: 'share-1', workspaceId: 'owner-ws' };
const liveShare = {
  agentId: 'agt_shared',
  ownerId: 'owner',
  shareConfig: { monthlySpendLimit: 5, toolGrants: [] },
  shareId: 'share-1',
  visibility: 'link',
  workspaceId: 'owner-ws',
};

const coordinator = () => {
  executions.candidates.mockResolvedValue({
    heads: [{ id: 'job', memberId: 'member', status: 'queued' }],
    inFlight: [],
  });
  const query = (rows: unknown[]) => {
    const result = Object.assign(Promise.resolve(rows), {
      from: vi.fn(),
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      limit: vi.fn(),
      orderBy: vi.fn(),
      where: vi.fn(),
    });
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit'] as const)
      result[method].mockReturnValue(result);
    return result;
  };
  const select = vi
    .fn()
    .mockReturnValue(query([]))
    .mockReturnValueOnce(
      query([{ id: 'channel', projectId: 'visitor-project', workspaceId: null }]),
    )
    .mockReturnValueOnce(query([]));
  return new ChannelCoordinator({ select } as never);
};

describe('dispatching a contact’s shared Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serviceOptions.length = 0;
    getScopedOnlineDevices.mockResolvedValue([]);
    executions.input.mockResolvedValue([]);
    executions.recentContext.mockResolvedValue({ messages: [], omitted: 0 });
    executions.primaryReply.mockResolvedValue(null);
    executions.coAddressed.mockResolvedValue([]);
    executions.openingReply.mockResolvedValue(undefined);
    executions.heartbeat.mockResolvedValue(true);
    execAgent.mockResolvedValue({ success: true });
    findShare.mockResolvedValue(liveShare);
    checkSpend.mockResolvedValue({ allowed: true });
    findOperation.mockResolvedValue({ status: 'idle' });
    executions.claim.mockResolvedValue({
      job: {
        channelId: 'channel',
        executionConfig: { runtime: 'native', share },
        id: 'job',
        leaseOwner: 'dispatcher',
        manifest: {
          cutoffSequence: 1,
          requestMessageId: 'message',
          requesterMemberId: 'visitor-member',
          self: { agentId: 'agt_shared', memberId: 'member', name: 'Shared' },
          threadId: null,
          threadRootSequence: null,
        },
        operationId: 'op',
      },
      member: { agentId: 'agt_shared' },
      topic: { id: 'topic', senderId: 'visitor', userId: 'owner' },
    });
  });

  it('runs as the owner, in the owner’s scope, under the live share gate', async () => {
    await coordinator().advance('channel');

    expect(serviceOptions).toEqual([
      { options: { includeShareVisitor: true, workspaceId: 'owner-ws' }, userId: 'owner' },
    ]);
    const [params] = execAgent.mock.calls[0];
    expect(params.shareGate).toEqual({
      agentId: 'agt_shared',
      // The live share sets no `deviceAccess`, so the Channel visitor gets no device.
      canUseDevice: false,
      shareConfig: liveShare.shareConfig,
      shareId: 'share-1',
      visitorUserId: 'visitor',
    });
    // Neither the visitor's project nor the visitor's files reach the owner's run.
    expect(params.appContext).toEqual({ topicId: 'topic' });
    expect(resolveChannelAttachments).not.toHaveBeenCalled();
    expect(checkSpend).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlySpendLimit: 5,
        ownerUserId: 'owner',
        visitorUserId: 'visitor',
      }),
    );
    expect(executions.accepted).toHaveBeenCalledWith('channel', 'job');
  });

  it('records the run as a share run that runs only granted tools without approval', async () => {
    await coordinator().advance('channel');

    const [params] = execAgent.mock.calls[0];
    expect(params.trigger).toBe('agent_share');
    // Nobody can approve mid-run; the share gate limits the run to the granted tools.
    expect(params.userInterventionConfig).toEqual({ approvalMode: 'headless' });
    expect(params.shareGate).toBeDefined();
  });

  it.each([
    [
      'the share was paused',
      () => findShare.mockResolvedValue({ ...liveShare, visibility: 'private' }),
    ],
    [
      'the share moved to another owner',
      () => findShare.mockResolvedValue({ ...liveShare, ownerId: 'x' }),
    ],
    ['the monthly limit is reached', () => checkSpend.mockResolvedValue({ allowed: false })],
  ])('submits nothing when %s', async (_, arrange) => {
    arrange();
    await coordinator().advance('channel');

    expect(execAgent).not.toHaveBeenCalled();
    expect(executions.retireReservation).toHaveBeenCalledWith(
      'channel',
      'job',
      expect.toBeOneOf([undefined, expect.any(Object)]),
    );
  });

  // The visitor saw only "no reason recorded" when the owner's monthly cap refused the reply.
  it('records the spend-limit refusal so the visitor learns why', async () => {
    checkSpend.mockResolvedValue({ allowed: false });
    await coordinator().advance('channel');

    expect(executions.retireReservation).toHaveBeenCalledWith('channel', 'job', {
      message: 'This shared Agent reached its monthly usage limit',
      type: 'ShareSpendLimitExceeded',
    });
  });

  // A shared Claude Code / Codex Agent's run stops at the share gate when the share grants the
  // visitor no device, or the owner's device is offline; the visitor must learn which.
  it.each(['ShareHeterogeneousAgentUnsupported', 'ShareHeteroDeviceUnavailable'])(
    'records the share gate’s %s refusal so the visitor learns why',
    async (type) => {
      execAgent.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: type }));
      await coordinator().advance('channel');

      expect(executions.retireReservation).toHaveBeenCalledWith('channel', 'job', {
        message: type,
        type,
      });
    },
  );
  // A visitor past the owner's message cap is refused by the atomic turn guard inside execAgent
  // (the admission pre-check can race it); the receipt must still say why.
  it('records the message-limit refusal raised by the turn guard', async () => {
    execAgent.mockRejectedValue(
      new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'ShareMessageLimitExceeded' }),
    );
    await coordinator().advance('channel');

    expect(executions.retireReservation).toHaveBeenCalledWith('channel', 'job', {
      message: 'ShareMessageLimitExceeded',
      type: 'ShareMessageLimitExceeded',
    });
  });
});
