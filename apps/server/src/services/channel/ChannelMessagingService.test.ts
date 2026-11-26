// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelMessagingService } from './ChannelMessagingService';

const { currentRun, directory, openAgentPair, send } = vi.hoisted(() => ({
  currentRun: vi.fn(),
  directory: vi.fn(),
  openAgentPair: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelHistoryRepository: class {
    currentRun = currentRun;
  },
  ChannelRepository: class {
    directory = directory;
    openAgentPair = openAgentPair;
  },
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    findById = async () => ({ slug: 'lobehub' });
  },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com/' } }));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));
vi.mock('./ChannelService', () => ({
  ChannelService: class {
    send = send;
  },
}));

const self = { agentId: 'agent-self', memberId: 'member-self', name: 'Project Agent' };
const run = (extra: Record<string, unknown> = {}) => ({
  channelId: 'channel-current',
  manifest: { self, threadId: null },
  ...extra,
});
const lobehub = {
  agents: [
    {
      agentId: 'agent-lobehub',
      description: 'Owns the LobeHub repo',
      memberId: 'member-lobehub',
      name: 'LobeHub Agent',
    },
    { agentId: 'agent-docs', description: '', memberId: 'member-docs', name: 'Docs' },
  ],
  channel: { agentId: null, id: 'channel-lobehub', projectId: 'project-lobehub', title: 'General' },
};
const otherDirect = {
  agents: [
    { agentId: 'agent-lobehub', description: '', memberId: 'member-direct', name: 'LobeHub' },
  ],
  channel: { agentId: 'agent-lobehub', id: 'channel-direct', projectId: null, title: 'LobeHub' },
};
/** Answers the member environment lookup in `askAgent`. */
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ config: null }] }) }) }),
};
const current = {
  agents: [{ agentId: self.agentId, description: null, memberId: self.memberId, name: self.name }],
  channel: { agentId: null, id: 'channel-current', projectId: null, title: 'local-replica' },
};

describe('ChannelMessagingService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentRun.mockResolvedValue(run());
    directory.mockResolvedValue([current, lobehub]);
    send.mockResolvedValue({ id: 'message-sent' });
  });
  const service = () =>
    new ChannelMessagingService(db as never, 'user-1', 'op-current', 'workspace-1');

  it('lists where Agents can be reached, marking the current Channel and filtering', async () => {
    expect(await service().listChannels()).toEqual({
      channels: [
        expect.objectContaining({ current: true, id: 'channel-current' }),
        {
          agents: [
            {
              agentId: 'agent-lobehub',
              description: 'Owns the LobeHub repo',
              name: 'LobeHub Agent',
            },
            { agentId: 'agent-docs', description: '', name: 'Docs' },
          ],
          current: false,
          id: 'channel-lobehub',
          kind: 'group',
          projectId: 'project-lobehub',
          title: 'General',
        },
      ],
      hasMore: false,
    });
    expect(
      (await service().listChannels({ agentId: 'agent-lobehub' })).channels.map(({ id }) => id),
    ).toEqual(['channel-lobehub']);
    expect((await service().listChannels({ query: 'lobehub agent' })).channels).toHaveLength(1);
    expect(await service().listChannels({ limit: 1 })).toMatchObject({ hasMore: true });
    await expect(service().listChannels({ limit: 21 })).rejects.toThrow('limit');
  });

  it('asks one Agent in the conversation between the two Agents, even when named in a group', async () => {
    directory.mockResolvedValue([current, lobehub, otherDirect]);
    openAgentPair.mockResolvedValue({
      agents: [
        { agentId: 'agent-self', id: 'pair-self', name: 'Project Agent' },
        { agentId: 'agent-lobehub', id: 'pair-lobehub', name: 'LobeHub' },
      ],
      channel: { id: 'channel-pair', projectId: null, title: 'Project Agent · LobeHub' },
    });

    const sent = await service().sendMessage(
      { agentIds: ['agent-lobehub'], channelId: 'channel-lobehub', content: 'Is T-1 fixed?' },
      'call-1',
    );
    // The environment comes from the Agent's own conversation, not the group it was named in.
    expect(openAgentPair.mock.calls[0][0].agents[1]).toMatchObject({
      agentId: 'agent-lobehub',
      name: 'LobeHub',
    });
    expect(send).toHaveBeenCalledWith('channel-pair', {
      authorAgentMemberId: 'pair-self',
      content: '@LobeHub Is T-1 fixed?',
      mentions: ['pair-lobehub'],
      metadata: {
        exchange: { hops: 1, origin: { channelId: 'channel-current', threadId: null } },
      },
      requestKey: 'agent-ask:op-current:call-1',
    });
    expect(sent).toMatchObject({ channelId: 'channel-pair', messageId: 'message-sent' });

    // No channelId at all: found through listChannels' directory.
    await service().sendMessage({ agentIds: ['agent-lobehub'], content: 'And T-2?' }, 'call-2');
    expect(send.mock.calls[1][0]).toBe('channel-pair');
  });

  it('asks one Agent per call and refuses requests that would loop or miss the Agent', async () => {
    const message = { agentIds: ['agent-lobehub'], content: 'Hi' };
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-lobehub', 'agent-docs'] }, 'call'),
    ).rejects.toThrow('one Agent per call');
    currentRun.mockResolvedValueOnce(run({ requestVia: { agentId: 'agent-other', name: 'W' } }));
    await expect(service().sendMessage(message, 'call')).rejects.toThrow('W posted this request');
    currentRun.mockResolvedValueOnce(run({ requestByAgent: true }));
    await expect(service().sendMessage(message, 'call')).rejects.toThrow('asking further');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-self'] }, 'call'),
    ).rejects.toThrow('yourself');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-missing'] }, 'call'),
    ).rejects.toThrow('listChannels');
    await expect(service().sendMessage({ ...message, content: '  ' }, 'call')).rejects.toThrow(
      'content',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('stops an exchange between Agents after its last ask', async () => {
    currentRun.mockResolvedValue(
      run({ exchange: { hops: 3, origin: { channelId: 'channel-current', threadId: null } } }),
    );
    directory.mockResolvedValue([
      current,
      {
        agents: [{ agentId: 'agent-other', description: '', memberId: 'm-other', name: 'Other' }],
        channel: { agentId: 'agent-other', id: 'channel-direct', projectId: null, title: 'Other' },
      },
    ]);

    await expect(
      service().sendMessage(
        { agentIds: ['agent-other'], channelId: 'channel-direct', content: 'Again?' },
        'call-4',
      ),
    ).rejects.toThrow(/asked 3 times/);
    expect(send).not.toHaveBeenCalled();
  });
});
