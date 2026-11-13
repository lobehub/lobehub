// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelMessagingService } from './ChannelMessagingService';

const { currentRun, directory, send } = vi.hoisted(() => ({
  currentRun: vi.fn(),
  directory: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelHistoryRepository: class {
    currentRun = currentRun;
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
  channelId: 'channel-current',
  manifest: { self, threadId: null },
  requestVia,
});
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
    currentRun.mockResolvedValue(run());
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
    currentRun.mockResolvedValueOnce(run({ agentId: 'agent-other', name: 'Other Agent' }));
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
});
