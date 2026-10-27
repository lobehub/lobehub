import type { ChannelDetail, ChannelListItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { detail: vi.fn(), list: vi.fn(), rename: vi.fn() },
}));

const channel: ChannelListItem = {
  canDelete: true,
  createdAt: new Date(),
  id: 'chn_000000000001',
  sequence: 0,
  status: 'active',
  title: 'Old name',
  workspaceId: null,
};
const detail = (item: ChannelListItem): ChannelDetail => ({
  attachments: [],
  channel: item,
  hasMore: false,
  jobs: [],
  members: [],
  messages: [],
  rootMessage: null,
  threads: [],
});
const view = { channelId: channel.id };
const titles = () => ({
  detail: useChannelStore.getState().detailMap[channelViewKey(view)]?.channel.title,
  list: useChannelStore.getState().listMap.all?.map((item) => item.title),
});

describe('renaming a Channel', () => {
  beforeEach(async () => {
    const scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    vi.mocked(channelService.list).mockResolvedValue([channel]);
    vi.mocked(channelService.detail).mockResolvedValue(detail(channel));
    channelActions.reset();
    await channelActions.refreshList();
    await channelActions.refreshDetail(view);
  });
  afterEach(() => {
    channelActions.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows the new name in the sidebar and the open Channel before the server confirms', async () => {
    const request = Promise.withResolvers<never>();
    vi.mocked(channelService.rename).mockReturnValue(request.promise);

    const renaming = channelActions.rename(channel.id, 'New name');
    expect(titles()).toEqual({ detail: 'New name', list: ['New name'] });

    request.resolve({ data: { ...channel, title: 'New name' }, success: true } as never);
    await renaming;
    expect(channelService.rename).toHaveBeenCalledWith(channel.id, 'New name');
    expect(titles()).toEqual({ detail: 'New name', list: ['New name'] });
  });

  it('restores the previous name when the rename fails', async () => {
    vi.mocked(channelService.rename).mockRejectedValue(new Error('Forbidden'));

    await expect(channelActions.rename(channel.id, 'New name')).rejects.toThrow('Forbidden');
    expect(titles()).toEqual({ detail: 'Old name', list: ['Old name'] });
  });
});
