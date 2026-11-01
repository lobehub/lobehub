import type { ChannelDetail, ChannelListItem, ChannelPublicThread } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: {
    archive: vi.fn(),
    archiveThread: vi.fn(),
    detail: vi.fn(),
    list: vi.fn(),
    unarchive: vi.fn(),
    unarchiveThread: vi.fn(),
  },
}));

const channel: ChannelListItem = {
  canDelete: true,
  createdAt: new Date(),
  id: 'chn_000000000001',
  sequence: 1,
  status: 'active',
  title: 'Launch',
  workspaceId: null,
};
const thread: ChannelPublicThread = {
  followerMemberIds: [],
  id: 'cht_000000000001',
  rootMessageId: 'root',
  rootSequence: 1,
  status: 'active',
};
const detail = (item: ChannelListItem, threads = [thread]): ChannelDetail => ({
  attachments: [],
  channel: item,
  hasMore: false,
  jobs: [],
  members: [],
  messages: [],
  rootMessage: null,
  threads,
});
const view = { channelId: channel.id };
const state = () => {
  const { detailMap, listMap } = useChannelStore.getState();
  const main = detailMap[channelViewKey(view)];
  return {
    detail: main?.channel.status,
    list: listMap.all?.map((item) => item.status),
    thread: main?.threads.map((item) => item.status),
  };
};

describe('archiving a Channel', () => {
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

  it('moves the sidebar row and the open view before the server confirms', async () => {
    const request = Promise.withResolvers<never>();
    vi.mocked(channelService.archive).mockReturnValue(request.promise);
    const archived = { ...channel, status: 'archived' as const };
    vi.mocked(channelService.list).mockResolvedValue([archived]);
    vi.mocked(channelService.detail).mockResolvedValue(detail(archived));

    const archiving = channelActions.setArchived(channel.id, true);
    expect(state()).toMatchObject({ detail: 'archived', list: ['archived'] });

    request.resolve({ success: true } as never);
    await archiving;
    expect(channelService.archive).toHaveBeenCalledWith(channel.id);
    expect(state()).toMatchObject({ detail: 'archived', list: ['archived'] });
  });

  it('switches back when the server refuses', async () => {
    vi.mocked(channelService.unarchive).mockRejectedValue(new Error('Forbidden'));
    vi.mocked(channelService.archive).mockRejectedValue(new Error('Forbidden'));

    await expect(channelActions.setArchived(channel.id, true)).rejects.toThrow('Forbidden');
    expect(state()).toMatchObject({ detail: 'active', list: ['active'] });
  });

  it('archives and unarchives a thread in every view that lists it', async () => {
    vi.mocked(channelService.archiveThread).mockResolvedValue({ success: true } as never);
    vi.mocked(channelService.detail).mockResolvedValue(
      detail(channel, [{ ...thread, status: 'archived' }]),
    );
    await channelActions.setThreadArchived(channel.id, thread.id, true);
    expect(channelService.archiveThread).toHaveBeenCalledWith(channel.id, thread.id);
    expect(state().thread).toEqual(['archived']);

    vi.mocked(channelService.unarchiveThread).mockRejectedValue(new Error('Conflict'));
    await expect(channelActions.setThreadArchived(channel.id, thread.id, false)).rejects.toThrow(
      'Conflict',
    );
    expect(state().thread).toEqual(['archived']);
  });
});
