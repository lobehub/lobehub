// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const { executions, execAgent, getScopedOnlineDevices } = vi.hoisted(() => ({
  execAgent: vi.fn(),
  executions: {
    accepted: vi.fn(),
    candidates: vi.fn(),
    claim: vi.fn(),
    finishDispatch: vi.fn(),
    heartbeat: vi.fn(),
    input: vi.fn(),
    openingReply: vi.fn(),
    primaryReply: vi.fn(),
    recentContext: vi.fn(),
  },
  getScopedOnlineDevices: vi.fn(),
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
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./replyOpening', () => ({ openChannelReply: vi.fn() }));
vi.mock('./worktree', () => ({ createChannelWorktree: vi.fn() }));

const chain = (rows: unknown[]) => {
  const result = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    where: vi.fn(),
  });
  for (const method of ['from', 'limit', 'orderBy', 'where'] as const)
    result[method].mockReturnValue(result);
  return result;
};

/** A Channel row as `advance` reads it, with only the fields the dispatch path needs. */
const channelRow = (projectId: string | null) => ({
  id: 'channel',
  isDeleted: false,
  projectId,
  status: 'active',
  workspaceId: null,
});

const oneJob = (projectId: string | null) => {
  const coordinator = new ChannelCoordinator({
    select: vi
      .fn()
      .mockReturnValueOnce(chain([channelRow(projectId)]))
      .mockReturnValueOnce(chain([])),
  } as never);
  executions.candidates.mockResolvedValue({
    heads: [{ id: 'job-1', memberId: 'job-1', status: 'queued' }],
    inFlight: [],
  });
  executions.claim.mockResolvedValue({
    job: {
      channelId: 'channel',
      executionConfig: { runtime: 'native' },
      id: 'job-1',
      leaseOwner: 'dispatcher',
      manifest: {
        cutoffSequence: 1,
        requestMessageId: 'message-1',
        self: { agentId: 'agt-1', memberId: 'job-1', name: 'Agent' },
        threadId: null,
        threadRootSequence: null,
      },
      operationId: 'op-1',
    },
    member: { agentId: 'agt-1' },
    topic: { id: 'tpc-1', userId: 'user-1' },
  });
  return coordinator;
};

describe('Channel dispatch project context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getScopedOnlineDevices.mockResolvedValue([]);
    executions.input.mockResolvedValue([]);
    executions.recentContext.mockResolvedValue({ messages: [], omitted: 0 });
    executions.primaryReply.mockResolvedValue(null);
    executions.openingReply.mockResolvedValue(undefined);
    executions.heartbeat.mockResolvedValue(true);
    execAgent.mockResolvedValue({ success: true });
  });

  it("passes the Channel's project to the run as appContext.projectId", async () => {
    await oneJob('proj-apollo').advance('channel');

    expect(execAgent).toHaveBeenCalledTimes(1);
    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: { projectId: 'proj-apollo', topicId: 'tpc-1' },
      }),
    );
  });

  it('sends no projectId for a Channel that belongs to no project', async () => {
    await oneJob(null).advance('channel');

    expect(execAgent).toHaveBeenCalledTimes(1);
    const [{ appContext }] = execAgent.mock.calls[0];
    expect(appContext).toEqual({ topicId: 'tpc-1' });
  });
});
