// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  wake: vi.fn(),
  notify: vi.fn(),
  notifyMentions: vi.fn(),
  resolveCard: vi.fn(),
}));
vi.mock('@/database/models/contact', () => ({
  ContactModel: class {
    resolveCard = mocks.resolveCard;
  },
  parseContactHandle: vi.fn(),
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelRepository: class {
    send = mocks.send;
    retryRouting = mocks.retry;
  },
  ChannelError: class extends Error {},
}));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agent', () => ({ AgentService: class {} }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./mention', () => ({ notifyChannelMentions: mocks.notifyMentions }));
vi.mock('./directMessage', () => ({ notifyChannelDirectMessages: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: mocks.notify }));
vi.mock('./queue', () => ({ wakeChannel: mocks.wake }));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: mocks.config }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.send.mockResolvedValue({ id: 'message' });
});
describe('Channel routing ingress', () => {
  const service = () => new ChannelService({} as never, 'sender', 'workspace');
  const input = { content: 'Help with code', requestKey: 'key' };
  it('enqueues unmentioned messages for the decision model when configured', async () => {
    mocks.config.mockResolvedValue({ model: 'jev-1.14.0', provider: 'typesafe' });
    await service().send('channel', input);
    expect(mocks.send).toHaveBeenCalledWith('channel', { ...input, routing: 'decision' });
    expect(mocks.wake).toHaveBeenCalledWith('channel');
  });
  it('preserves the existing fallback when not configured', async () => {
    await service().send('channel', input);
    expect(mocks.send).toHaveBeenCalledWith('channel', { ...input, routing: 'fallback' });
  });
  it('retains explicit mentions for the repository to route directly', async () => {
    mocks.config.mockResolvedValue({ model: 'jev-1.14.0', provider: 'typesafe' });
    await service().send('channel', { ...input, mentions: ['coder'] });
    expect(mocks.send).toHaveBeenCalledWith(
      'channel',
      expect.objectContaining({ mentions: ['coder'] }),
    );
    // A mentioned message is directed, so its routing settings are never needed.
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.wake).toHaveBeenCalledWith('channel');
  });
  it('schedules a retried attempt only after the permission-checked repository write', async () => {
    mocks.retry.mockResolvedValue({ routingAttempt: 2 });
    await expect(service().retryRouting('channel', 'message')).resolves.toEqual({
      routingAttempt: 2,
    });
    expect(mocks.retry).toHaveBeenCalledWith('channel', 'message');
    expect(mocks.wake).toHaveBeenCalledWith('channel');
    mocks.wake.mockClear();
    mocks.retry.mockRejectedValue(new Error('Forbidden'));
    await expect(service().retryRouting('channel', 'message')).rejects.toThrow('Forbidden');
    expect(mocks.wake).not.toHaveBeenCalled();
  });
});

describe('sharing a contact card', () => {
  const service = () => new ChannelService({} as never, 'sender', 'workspace');
  const card = { avatar: null, name: 'Max', type: 'user', userId: 'max', username: 'max' };

  it('stores the server snapshot and writes the text fallback itself', async () => {
    mocks.resolveCard.mockResolvedValue(card);
    await service().send('channel', {
      card: { type: 'user', userId: 'max' },
      content: 'forged',
      requestKey: 'key',
    });
    expect(mocks.resolveCard).toHaveBeenCalledWith({ type: 'user', userId: 'max' });
    expect(mocks.send).toHaveBeenCalledWith('channel', {
      content: '[Contact card] Max',
      metadata: { card },
      requestKey: 'key',
      routing: 'fallback',
    });
  });

  it('sends nothing when the card is refused', async () => {
    mocks.resolveCard.mockRejectedValue(new Error('Share only your contacts'));
    await expect(
      service().send('channel', {
        card: { type: 'user', userId: 'stranger' },
        content: '',
        requestKey: 'key',
      }),
    ).rejects.toThrow('Share only your contacts');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('refuses attachments on a card', async () => {
    // The mocked ChannelError keeps only its code.
    await expect(
      service().send('channel', {
        card: { agentId: 'agent', type: 'agent' },
        content: '',
        fileIds: ['file'],
        requestKey: 'key',
      }),
    ).rejects.toThrow('BAD_REQUEST');
    expect(mocks.resolveCard).not.toHaveBeenCalled();
  });
});
