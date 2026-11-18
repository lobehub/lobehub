import type { ChannelListItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { channelActions } from './action';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { list: vi.fn(), markRead: vi.fn(), openDirect: vi.fn() },
}));

const { channelService } = await import('@/services/channel');

const direct = (patch: Partial<ChannelListItem>) =>
  ({ agentId: 'agt_nasa', id: 'chn_000000000001', projectId: null, ...patch }) as ChannelListItem;

describe('channelActions.openDirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    channelActions.reset();
    vi.mocked(channelService.list).mockResolvedValue([]);
  });

  it('reuses the listed direct Channel without asking the server', async () => {
    useChannelStore.setState({
      listMap: { all: [direct({ agentId: null, id: 'chn_group00000001' }), direct({})] },
    });

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBe('chn_000000000001');
    expect(channelService.openDirect).not.toHaveBeenCalled();
  });

  it('ignores a project Channel bound to the same Agent', async () => {
    useChannelStore.setState({ listMap: { all: [direct({ projectId: 'pro_1' })] } });
    vi.mocked(channelService.openDirect).mockResolvedValue('chn_000000000002');

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBe('chn_000000000002');
  });

  it('opens one for an Agent made before direct Channels, then refreshes the list', async () => {
    vi.mocked(channelService.openDirect).mockResolvedValue('chn_000000000002');

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBe('chn_000000000002');
    expect(channelService.openDirect).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agt_nasa',
      localDeviceId: undefined,
    });
    expect(channelService.list).toHaveBeenCalled();
  });

  it('reports no Channel when the Agent cannot answer in one', async () => {
    vi.mocked(channelService.openDirect).mockResolvedValue(null);

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBeUndefined();
    expect(channelService.list).not.toHaveBeenCalled();
  });
});

describe('channelActions.markRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelActions.reset();
  });

  // The row kept its badge for up to a minute after the Channel was read.
  it('clears the listed unread count as soon as the Channel is read', async () => {
    useChannelStore.setState({
      listMap: { all: [direct({ sequence: 5, unreadCount: 3 } as Partial<ChannelListItem>)] },
    });
    vi.mocked(channelService.markRead).mockResolvedValue(5 as never);

    await channelActions.markRead('chn_000000000001', 5);

    expect(useChannelStore.getState().listMap.all?.[0].unreadCount).toBe(0);
    expect(channelService.markRead).toHaveBeenCalledExactlyOnceWith('chn_000000000001', 5);
  });

  // The mention badge reappeared after switching away, until the next list poll.
  it('clears the listed mention count when the read reaches the known sequence', async () => {
    useChannelStore.setState({
      listMap: {
        all: [direct({ mentionCount: 3, sequence: 5, unreadCount: 3 } as Partial<ChannelListItem>)],
      },
    });
    vi.mocked(channelService.markRead).mockResolvedValue(5 as never);

    await channelActions.markRead('chn_000000000001', 5);

    expect(useChannelStore.getState().listMap.all?.[0].mentionCount).toBe(0);
  });

  // A partial read leaves later mentions unread; the cache cannot split the count.
  it('keeps the mention count for a partial read', async () => {
    useChannelStore.setState({
      listMap: {
        all: [direct({ mentionCount: 2, sequence: 9, unreadCount: 4 } as Partial<ChannelListItem>)],
      },
    });
    vi.mocked(channelService.markRead).mockResolvedValue(5 as never);

    await channelActions.markRead('chn_000000000001', 5);

    expect(useChannelStore.getState().listMap.all?.[0]).toMatchObject({
      mentionCount: 2,
      unreadCount: 4,
    });
  });

  it('restores the count when the write fails', async () => {
    useChannelStore.setState({
      listMap: { all: [direct({ sequence: 5, unreadCount: 3 } as Partial<ChannelListItem>)] },
    });
    vi.mocked(channelService.markRead).mockRejectedValue(new Error('offline'));

    await expect(channelActions.markRead('chn_000000000001', 5)).rejects.toThrow('offline');

    expect(useChannelStore.getState().listMap.all?.[0].unreadCount).toBe(3);
  });
});
