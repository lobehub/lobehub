// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { resolveCard, send } = vi.hoisted(() => ({ resolveCard: vi.fn(), send: vi.fn() }));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    send = send;
  },
}));
vi.mock('@/database/models/contact', async (original) => ({
  ...(await original<object>()),
  ContactModel: class {
    resolveCard = resolveCard;
  },
}));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agent', () => ({ AgentService: class {} }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./mention', () => ({ notifyChannelMentions: vi.fn() }));
vi.mock('./directMessage', () => ({ notifyChannelDirectMessages: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: vi.fn() }));
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));

const card = {
  type: 'user' as const,
  user: { avatar: null, fullName: 'Max', id: 'max', username: 'max' },
};

describe('ChannelService.send with a contact card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ id: 'message', routingStatus: 'pending' });
  });
  const service = () => new ChannelService({} as never, 'owner', 'workspace');

  it('sends the resolved card alone, described in the content', async () => {
    resolveCard.mockResolvedValue(card);
    await service().send('channel', {
      contactCard: { type: 'user', userId: 'max' },
      content: 'ignored',
      fileIds: ['file'],
      requestKey: 'key',
    });
    expect(resolveCard).toHaveBeenCalledWith({ type: 'user', userId: 'max' });
    expect(send).toHaveBeenCalledWith('channel', {
      content: '[Contact card] Max (@max)',
      fileIds: undefined,
      metadata: { contactCard: card },
      requestKey: 'key',
      routing: 'fallback',
    });
  });

  it('sends nothing when the card may not be shared', async () => {
    resolveCard.mockRejectedValue(new Error('AGENT_NOT_SHARED'));
    await expect(
      service().send('channel', {
        contactCard: { agentId: 'agt', type: 'agent' },
        content: '',
        requestKey: 'key',
      }),
    ).rejects.toThrow('AGENT_NOT_SHARED');
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves an ordinary message as it is', async () => {
    await service().send('channel', { content: 'hi', requestKey: 'key' });
    expect(resolveCard).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('channel', {
      content: 'hi',
      requestKey: 'key',
      routing: 'fallback',
    });
  });
});
