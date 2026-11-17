// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelMessagingService } from './ChannelMessagingService';

const { directory, openAgentPair, relaySource, send } = vi.hoisted(() => ({
  directory: vi.fn(),
  openAgentPair: vi.fn(),
  relaySource: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelHistoryRepository: class {
    relaySource = relaySource;
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
const run = (
  requestVia?: { agentId: string; name: string },
  channelRun: Record<string, unknown> = {},
) => ({
  channelRun: {
    channelId: 'channel-current',
    manifest: { self, threadId: null },
    requestVia,
    ...channelRun,
  },
  origin: { channelId: 'channel-current', threadId: null },
  requestVia,
  self: { agentId: self.agentId, name: self.name },
});
/** An owner's bot run: no Channel of its own. */
const botRun = { self: { agentId: self.agentId, name: self.name } };
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
    relaySource.mockResolvedValue(run());
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

  it("posts the requester's message @mentioning several Agents in a group, marked as relayed", async () => {
    const sent = await service().sendMessage(
      {
        agentIds: ['agent-lobehub', 'agent-docs'],
        channelId: 'channel-lobehub',
        content: 'Please fix T-1',
      },
      'call-1',
    );
    expect(send).toHaveBeenCalledWith('channel-lobehub', {
      content: '@LobeHub Agent @Docs Please fix T-1',
      mentions: ['member-lobehub', 'member-docs'],
      metadata: {
        via: {
          agentId: 'agent-self',
          name: 'Project Agent',
          operationId: 'op-current',
          origin: { channelId: 'channel-current', threadId: null },
        },
      },
      requestKey: 'agent-relay:op-current:call-1',
    });
    expect(sent).toEqual({
      agents: [
        { agentId: 'agent-lobehub', name: 'LobeHub Agent' },
        { agentId: 'agent-docs', name: 'Docs' },
      ],
      channelId: 'channel-lobehub',
      channelTitle: 'General',
      messageId: 'message-sent',
      url: 'https://app.example.com/lobehub/project/project-lobehub/channels/channel-lobehub',
    });
    await expect(
      service().sendMessage(
        { agentIds: ['agent-lobehub', 'agent-docs'], content: 'Please fix T-1' },
        'call-2',
      ),
    ).rejects.toThrow('channelId');
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

  it('refuses relays that would loop, target the current Channel or miss the Agent', async () => {
    const message = {
      agentIds: ['agent-lobehub', 'agent-docs'],
      channelId: 'channel-lobehub',
      content: 'Hi',
    };
    relaySource.mockResolvedValueOnce(run({ agentId: 'agent-other', name: 'Other Agent' }));
    await expect(service().sendMessage(message, 'call')).rejects.toThrow('relayed by Other Agent');
    relaySource.mockResolvedValueOnce(run(undefined, { requestByAgent: true }));
    await expect(service().sendMessage(message, 'call')).rejects.toThrow('asking further');
    await expect(
      service().sendMessage({ ...message, channelId: 'channel-current' }, 'call'),
    ).rejects.toThrow('answering in');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-self'] }, 'call'),
    ).rejects.toThrow('yourself');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-lobehub', 'agent-missing'] }, 'call'),
    ).rejects.toThrow('Not an Agent member of "General": agent-missing');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-missing'] }, 'call'),
    ).rejects.toThrow('listChannels');
    await expect(
      service().sendMessage({ ...message, channelId: 'channel-unknown' }, 'call'),
    ).rejects.toThrow('listChannels');
    await expect(service().sendMessage({ ...message, content: '  ' }, 'call')).rejects.toThrow(
      'content',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('only lets the token-checked route relay from a bot run', async () => {
    await service().listChannels();
    expect(relaySource).toHaveBeenLastCalledWith('op-current', {});
    const fromBot = new ChannelMessagingService({} as never, 'user-1', 'op-current', undefined, {
      allowBotRun: true,
    });
    await fromBot.listChannels();
    expect(relaySource).toHaveBeenLastCalledWith('op-current', { allowBotRun: true });
  });

  it("relays an owner's bot request with no current Channel and no receipt origin", async () => {
    relaySource.mockResolvedValue(botRun);
    expect((await service().listChannels()).channels.map(({ current }) => current)).toEqual([
      false,
      false,
    ]);

    await service().sendMessage(
      { agentIds: ['agent-lobehub'], channelId: 'channel-lobehub', content: 'Please fix T-1' },
      'call-1',
    );
    expect(send.mock.calls[0][1].metadata).toEqual({
      via: { agentId: 'agent-self', name: 'Project Agent', operationId: 'op-current' },
    });
    await expect(
      service().sendMessage(
        { agentIds: ['agent-self'], channelId: 'channel-current', content: 'Hi' },
        'call-2',
      ),
    ).rejects.toThrow('yourself');
  });

  it('stops an exchange between Agents after its last ask', async () => {
    relaySource.mockResolvedValue(
      run(undefined, {
        exchange: { hops: 3, origin: { channelId: 'channel-current', threadId: null } },
      }),
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
