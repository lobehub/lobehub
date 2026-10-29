// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  wake: vi.fn(),
  notify: vi.fn(),
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
