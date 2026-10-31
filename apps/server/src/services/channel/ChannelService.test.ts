// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelService } from './ChannelService';

const { remove, removeThread, wake, notify, send, routing } = vi.hoisted(() => ({
  remove: vi.fn(),
  send: vi.fn(),
  routing: vi.fn(),
  removeThread: vi.fn(),
  wake: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    remove = remove;
    send = send;
    removeThread = removeThread;
  },
}));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agent', () => ({ AgentService: class {} }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: notify }));
vi.mock('./routingConfig', () => ({ resolveChannelRoutingConfig: routing }));
vi.mock('./queue', () => ({ wakeChannel: wake }));

describe('Channel deletion scheduling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    remove.mockResolvedValue([]);
    removeThread.mockResolvedValue(undefined);
    wake.mockResolvedValue(undefined);
    notify.mockResolvedValue(undefined);
  });
  const service = () => new ChannelService({} as never, 'owner', 'workspace');

  it('schedules thread cancellation only after the scoped archive succeeds, and lets queue failures retry', async () => {
    removeThread.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(service().removeThread('channel', 'thread')).rejects.toThrow('Forbidden');
    expect(wake).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    wake.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(service().removeThread('channel', 'thread')).rejects.toThrow('queue unavailable');
    await expect(service().removeThread('channel', 'thread')).resolves.toBeUndefined();
    expect(removeThread).toHaveBeenLastCalledWith('channel', 'thread');
    expect(wake).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('schedules physical cancellation and invalidates all members after the archive commits', async () => {
    await service().remove('channel');
    expect(remove).toHaveBeenCalledWith('channel');
    expect(wake).toHaveBeenCalledWith('channel');
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'channel');
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(wake.mock.invocationCallOrder[0]);
  });

  it('does not stop or invalidate anything after a permission failure', async () => {
    remove.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(service().remove('channel')).rejects.toThrow('Forbidden');
    expect(wake).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('surfaces a scheduling failure so repeating the idempotent deletion can schedule recovery', async () => {
    wake.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(service().remove('channel')).rejects.toThrow('queue unavailable');
    await expect(service().remove('channel')).resolves.toBeUndefined();
    expect(wake).toHaveBeenCalledTimes(2);
  });
});

describe('Channel reply dispatch', () => {
  beforeEach(() => vi.resetAllMocks());
  const input = { content: 'A follow-up', replyToId: 'quoted', requestKey: 'retry' };
  const service = () => new ChannelService({} as never, 'owner', 'workspace');

  it('refreshes the human quote in the public feed without scheduling a routing task', async () => {
    send.mockResolvedValue({ replyToId: 'quoted', routingStatus: 'skipped' });
    await service().send('channel', { ...input, mentions: ['agent'] });
    expect(routing).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'channel');
  });

  it('starts explicit Agent reply jobs and surfaces queue failure for a safe retry', async () => {
    send.mockResolvedValue({ replyToId: 'quoted', routingStatus: 'directed', threadId: 'thread' });
    wake.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(service().send('channel', input)).rejects.toThrow('queue unavailable');
    await expect(service().send('channel', input)).resolves.toMatchObject({ threadId: 'thread' });
    expect(routing).not.toHaveBeenCalled();
    expect(wake).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'channel', { ...input, routing: 'fallback' });
  });
});
