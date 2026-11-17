// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelMessagingService } from './ChannelMessagingService';

const { directory, relaySource, send } = vi.hoisted(() => ({
  relaySource: vi.fn(),
  directory: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelHistoryRepository: class {
    relaySource = relaySource;
  },
  ChannelRepository: class {
    directory = directory;
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
const run = (requestVia?: { agentId: string; name: string }) => ({
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
  ],
  channel: { agentId: null, id: 'channel-lobehub', projectId: 'project-lobehub', title: 'General' },
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
    new ChannelMessagingService({} as never, 'user-1', 'op-current', 'workspace-1');

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

  it("posts the requester's message @mentioning the Agents, marked as relayed, once per call", async () => {
    const sent = await service().sendMessage(
      { agentIds: ['agent-lobehub'], channelId: 'channel-lobehub', content: 'Please fix T-1' },
      'call-1',
    );
    expect(send).toHaveBeenCalledWith('channel-lobehub', {
      content: '@LobeHub Agent Please fix T-1',
      mentions: ['member-lobehub'],
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
      agents: [{ agentId: 'agent-lobehub', name: 'LobeHub Agent' }],
      channelId: 'channel-lobehub',
      channelTitle: 'General',
      messageId: 'message-sent',
      url: 'https://app.example.com/lobehub/project/project-lobehub/channels/channel-lobehub',
    });

    await service().sendMessage(
      { agentIds: ['agent-lobehub'], channelId: 'channel-lobehub', content: '@LobeHub Agent hi' },
      'call-2',
    );
    expect(send.mock.calls[1][1].content).toBe('@LobeHub Agent hi');
  });

  it('refuses relays that would loop, target the current Channel or miss the Agent', async () => {
    const message = { agentIds: ['agent-lobehub'], channelId: 'channel-lobehub', content: 'Hi' };
    relaySource.mockResolvedValueOnce(run({ agentId: 'agent-other', name: 'Other Agent' }));
    await expect(service().sendMessage(message, 'call')).rejects.toThrow('relayed by Other Agent');
    await expect(
      service().sendMessage({ ...message, channelId: 'channel-current' }, 'call'),
    ).rejects.toThrow('answering in');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-self'] }, 'call'),
    ).rejects.toThrow('yourself');
    await expect(
      service().sendMessage({ ...message, agentIds: ['agent-missing'] }, 'call'),
    ).rejects.toThrow('Not an Agent member of "General": agent-missing');
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
});
