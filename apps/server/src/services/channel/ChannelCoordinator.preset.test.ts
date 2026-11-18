// @vitest-environment node
import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import { CHANNEL_INSTRUCTIONS } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const {
  checkSpend,
  resolvePreset,
  execAgent,
  executions,
  findOperation,
  findShare,
  getScopedOnlineDevices,
  resolveChannelAttachments,
  serviceOptions,
} = vi.hoisted(() => ({
  checkSpend: vi.fn(),
  resolvePreset: vi.fn(),
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
vi.mock('@/business/server/channel/runPreset', () => ({
  resolveChannelRunPreset: resolvePreset,
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
    .mockReturnValueOnce(query([{ id: 'channel', projectId: null, workspaceId: 'ws' }]))
    .mockReturnValueOnce(query([]));
  return new ChannelCoordinator({ select } as never);
};

const claim = (executionConfig: Record<string, unknown>) => ({
  job: {
    channelId: 'channel',
    executionConfig,
    id: 'job',
    leaseOwner: 'dispatcher',
    manifest: {
      cutoffSequence: 1,
      requestMessageId: 'message',
      requesterMemberId: 'requester-member',
      self: { agentId: 'agt_new', memberId: 'member', name: 'New' },
      threadId: null,
      threadRootSequence: null,
    },
    operationId: 'op',
  },
  member: { agentId: 'agt_new' },
  topic: { id: 'topic', senderId: null, userId: 'user' },
});

describe('dispatching a Channel run with a business preset', () => {
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
    resolveChannelAttachments.mockResolvedValue({});
    execAgent.mockResolvedValue({ success: true });
    findOperation.mockResolvedValue({ status: 'idle' });
    executions.claim.mockResolvedValue(claim({ runtime: 'native' }));
  });

  it('submits the run unchanged when there is no preset', async () => {
    resolvePreset.mockResolvedValue(undefined);
    await coordinator().advance('channel');

    expect(resolvePreset).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_new',
        executionConfig: { runtime: 'native' },
        userId: 'user',
        workspaceId: 'ws',
      }),
    );
    const [params] = execAgent.mock.calls[0];
    expect(params.additionalPluginIds).toEqual([ChannelIdentifier]);
    expect(params.appContext).toEqual({ topicId: 'topic' });
    expect(params.instructions).toBe(CHANNEL_INSTRUCTIONS);
  });

  it('appends the preset instructions and lets the Agent configure only itself', async () => {
    resolvePreset.mockResolvedValue({ instructions: 'Set yourself up.', selfConfiguration: true });
    await coordinator().advance('channel');

    const [params] = execAgent.mock.calls[0];
    expect(params.additionalPluginIds).toEqual([ChannelIdentifier, AgentBuilderIdentifier]);
    expect(params.appContext).toEqual({ editingAgentId: 'agt_new', topicId: 'topic' });
    expect(params.instructions).toBe(`${CHANNEL_INSTRUCTIONS}\n\nSet yourself up.`);
    expect(executions.accepted).toHaveBeenCalledWith('channel', 'job');
  });

  it('still submits the run when the preset fails', async () => {
    resolvePreset.mockRejectedValue(new Error('preset down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await coordinator().advance('channel');

    const [params] = execAgent.mock.calls[0];
    expect(params.instructions).toBe(CHANNEL_INSTRUCTIONS);
    expect(params.appContext).toEqual({ topicId: 'topic' });
    expect(executions.accepted).toHaveBeenCalledWith('channel', 'job');
  });

  it('never adjusts a shared Agent run', async () => {
    executions.claim.mockResolvedValue({
      ...claim({
        runtime: 'native',
        share: { ownerId: 'owner', shareId: 'share-1', workspaceId: 'owner-ws' },
      }),
      topic: { id: 'topic', senderId: 'visitor', userId: 'owner' },
    });
    findShare.mockResolvedValue({
      agentId: 'agt_new',
      ownerId: 'owner',
      shareConfig: { monthlySpendLimit: 5, toolGrants: [] },
      shareId: 'share-1',
      visibility: 'link',
      workspaceId: 'owner-ws',
    });
    checkSpend.mockResolvedValue({ allowed: true });
    await coordinator().advance('channel');

    expect(resolvePreset).not.toHaveBeenCalled();
    const [params] = execAgent.mock.calls[0];
    expect(params.additionalPluginIds).toEqual([ChannelIdentifier]);
  });
});
