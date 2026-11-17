// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectChannelSteer } from './steer';

const { create, notifyChannel, steer } = vi.hoisted(() => ({
  create: vi.fn(),
  notifyChannel: vi.fn(),
  steer: vi.fn(),
}));

vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    steer = steer;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    create = create;
  },
}));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultAgentConfig: () => ({}) }));
vi.mock('@/server/services/aiAgent/pipeline/resolveUserMessageParentId', () => ({
  createUserTurnAnchor: () => ({ resolveParentId: async () => 'msg-parent' }),
}));
vi.mock('./notify', () => ({ notifyChannel }));

const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const stateOf = (origin: AgentState['origin']) => ({ origin }) as AgentState;
const channelRun = stateOf({ agentId: 'agt-1', topicId: 'tpc-1', trigger: 'channel' });

describe('injectChannelSteer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: 'msg-steer' });
    notifyChannel.mockResolvedValue(undefined);
    // Runs the write as the repository would, under its lock.
    steer.mockImplementation(async (_operationId, { join }) =>
      join({
        channelId: 'chn-1',
        context: [],
        jobId: 'job-1',
        manifest: {
          cutoffSequence: 4,
          requestMessageId: 'm1',
          requestMessageIds: ['m1', 'm4'],
          requesterMemberId: 'member-1',
          self: { agentId: 'agt-1', memberId: 'agent-member', name: 'Justin' },
          threadId: null,
          threadRootSequence: null,
        },
        omitted: 0,
        requests: [
          {
            author: { id: 'user-2', name: 'LiJian', type: 'user' },
            content: 'How is it going?',
            id: 'm4',
            sequence: 4,
            threadId: null,
          },
        ],
      }),
    );
  });

  it('writes the joined requests into the run as one steer user message', async () => {
    await expect(
      injectChannelSteer(ctx, { operationId: 'op-1', state: channelRun }),
    ).resolves.toEqual({ messageId: 'msg-steer' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt-1',
        metadata: { steer: true },
        parentId: 'msg-parent',
        role: 'user',
        topicId: 'tpc-1',
      }),
    );
    const { content } = create.mock.calls[0][0];
    expect(content).toContain('How is it going?');
    expect(content).toContain('<channel_steer');
    expect(notifyChannel).toHaveBeenCalledWith(ctx.db, 'chn-1');
  });

  it('leaves runs that are not top-level Channel runs alone', async () => {
    await injectChannelSteer(ctx, {
      operationId: 'op-1',
      state: stateOf({ topicId: 'tpc-1', trigger: 'chat' }),
    });
    await injectChannelSteer(ctx, {
      operationId: 'op-1',
      state: stateOf({
        lineage: { isSubAgent: true, parentOperationId: 'op-0' },
        topicId: 'tpc-1',
        trigger: 'channel',
      }),
    });

    expect(steer).not.toHaveBeenCalled();
  });

  it('writes nothing when no request joined', async () => {
    steer.mockResolvedValue(undefined);

    await expect(
      injectChannelSteer(ctx, { operationId: 'op-1', state: channelRun }),
    ).resolves.toBeUndefined();
    expect(notifyChannel).not.toHaveBeenCalled();
  });
});
