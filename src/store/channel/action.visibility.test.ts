import type { ChannelDetail, ChannelJoinableItem, ChannelListItem } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelViewKey } from './projection';
import { channelSelectors } from './selectors';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: {
    detail: vi.fn(),
    join: vi.fn(),
    list: vi.fn(),
    listJoinable: vi.fn(),
    updateVisibility: vi.fn(),
  },
}));

const channel: ChannelListItem = {
  canDelete: true,
  createdAt: new Date(),
  id: 'chn_000000000001',
  projectId: null,
  sequence: 0,
  status: 'active',
  title: 'Announcements',
  visibility: 'private',
  workspaceId: 'ws_1',
};
const joinable: ChannelJoinableItem = {
  createdAt: new Date(),
  id: 'chn_000000000002',
  memberCount: 3,
  projectId: null,
  title: 'Launch',
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
const visibilities = () => ({
  detail: useChannelStore.getState().detailMap[channelViewKey(view)]?.channel.visibility,
  list: useChannelStore.getState().listMap.all?.map((item) => item.visibility),
});

describe('Channel visibility and joining', () => {
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

  it('shows the new visibility before the server confirms', async () => {
    const request = Promise.withResolvers<never>();
    vi.mocked(channelService.updateVisibility).mockReturnValue(request.promise);

    const changing = channelActions.setVisibility(channel.id, 'public');
    expect(visibilities()).toEqual({ detail: 'public', list: ['public'] });

    request.resolve({ data: { ...channel, visibility: 'public' }, success: true } as never);
    await changing;
    expect(channelService.updateVisibility).toHaveBeenCalledWith(channel.id, 'public');
    expect(visibilities()).toEqual({ detail: 'public', list: ['public'] });
  });

  it('switches back when the server refuses', async () => {
    vi.mocked(channelService.updateVisibility).mockRejectedValue(new Error('Forbidden'));

    await expect(channelActions.setVisibility(channel.id, 'public')).rejects.toThrow('Forbidden');
    expect(visibilities()).toEqual({ detail: 'private', list: ['private'] });
  });

  it('moves a joined Channel from the browse list into the sidebar', async () => {
    vi.mocked(channelService.join).mockResolvedValue({ data: joinable, success: true } as never);
    const joined = { ...channel, id: joinable.id, title: joinable.title };
    vi.mocked(channelService.list).mockResolvedValue([channel, joined]);
    vi.mocked(channelService.listJoinable).mockResolvedValue([]);

    await channelActions.join(joinable.id, 'lau');

    expect(channelService.join).toHaveBeenLastCalledWith(joinable.id);
    expect(channelService.listJoinable).toHaveBeenLastCalledWith('lau');
    expect(channelSelectors.joinable('lau')(useChannelStore.getState())).toEqual([]);
    expect(channelSelectors.list(useChannelStore.getState())?.map((item) => item.id)).toEqual([
      channel.id,
      joinable.id,
    ]);
  });
});
