// @vitest-environment node
import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const {
  checkSpend,
  countMessagesBySender,
  execAgent,
  executions,
  findOperation,
  findShare,
  getScopedOnlineDevices,
  resolveChannelAttachments,
  serviceOptions,
} = vi.hoisted(() => ({
  checkSpend: vi.fn(),
  countMessagesBySender: vi.fn(),
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
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    countMessagesBySender = countMessagesBySender;
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
  shareConfig: { maxMessagesPerVisitor: 2, monthlySpendLimit: 5, toolGrants: [] },
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
    countMessagesBySender.mockResolvedValue(1);
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
        message: expect.not.stringContaining(type),
        type,
      });
    },
  );

  // Sending no longer refuses for a share's limits: the reply fails here, so the visitor's message
  // stays and its failure explains the limit after a reload.
  it('refuses a prompt beyond the share’s length cap before submission', async () => {
    executions.input.mockResolvedValue([
      { content: 'x'.repeat(SHARE_VISITOR_PROMPT_MAX_LENGTH + 1), id: 'message' },
    ]);
    await coordinator().advance('channel');

    expect(execAgent).not.toHaveBeenCalled();
    expect(executions.retireReservation).toHaveBeenCalledWith('channel', 'job', {
      message: `Messages to a shared Agent are limited to ${SHARE_VISITOR_PROMPT_MAX_LENGTH} characters`,
      type: 'SharePromptTooLong',
    });
  });

  // The quoted message rides in the input beside the request, but only the request is the prompt.
  it('admits a short request quoting a message beyond the length cap', async () => {
    const author = { id: 'visitor', name: 'Visitor', type: 'user' };
    executions.input.mockResolvedValue([
      { author, content: 'x'.repeat(SHARE_VISITOR_PROMPT_MAX_LENGTH + 1), id: 'quoted' },
      { author, content: 'Summarize this', id: 'message' },
    ]);
    await coordinator().advance('channel');

    expect(execAgent).toHaveBeenCalledOnce();
    expect(executions.retireReservation).not.toHaveBeenCalled();
  });

  it('refuses once the visitor sent maxMessagesPerVisitor, counted as the owner', async () => {
    countMessagesBySender.mockResolvedValue(2);
    await coordinator().advance('channel');

    expect(countMessagesBySender).toHaveBeenCalledWith({
      agentId: 'agt_shared',
      senderId: 'visitor',
    });
    expect(execAgent).not.toHaveBeenCalled();
    expect(checkSpend).not.toHaveBeenCalled();
    expect(executions.retireReservation).toHaveBeenCalledWith('channel', 'job', {
      message: 'You have sent all the messages this shared Agent allows',
      type: 'ShareMessageLimitExceeded',
    });
  });
  // A visitor past the owner's message cap is refused by the atomic turn guard inside execAgent
  // (the gate's count can race it); the receipt must still say why, as readable text.
  it('records the message-limit refusal raised by the turn guard', async () => {
    execAgent.mockRejectedValue(
      new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'ShareMessageLimitExceeded' }),
    );
    await coordinator().advance('channel');

    expect(executions.retireReservation).toHaveBeenCalledWith('channel', 'job', {
      message: 'You have sent all the messages this shared Agent allows',
      type: 'ShareMessageLimitExceeded',
    });
  });
});
