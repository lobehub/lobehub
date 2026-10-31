import type { ChannelDetail, ChannelListItem } from '@lobechat/types';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelDetailResource, channelListResource, channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { detail: vi.fn(), list: vi.fn(), remove: vi.fn() },
}));

const channel = (id: string): ChannelListItem => ({
  canDelete: true,
  createdAt: new Date(),
  id,
  sequence: 0,
  status: 'active',
  title: id,
  workspaceId: null,
});
const removed = channel('chn_removed');
const kept = channel('chn_kept');
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
const main = { channelId: removed.id };
const thread = { channelId: removed.id, threadId: 'thread', before: 20 };
const keptView = { channelId: kept.id };

describe('Channel removal replicas', () => {
  let scope: string;
  beforeEach(async () => {
    scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    vi.mocked(channelService.list).mockResolvedValue([removed, kept]);
    vi.mocked(channelService.detail).mockImplementation(async ({ channelId }) =>
      detail(channel(channelId)),
    );
    channelActions.reset();
    await channelActions.refreshList();
    await Promise.all([main, thread, keptView].map(channelActions.refreshDetail));
  });
  afterEach(() => {
    channelActions.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('hides the row while pending, then purges all deleted-channel views but keeps other channels', async () => {
    const request = Promise.withResolvers<{ success: boolean }>();
    vi.spyOn(channelService, 'remove').mockReturnValue(request.promise);
    const deleting = channelActions.remove(removed.id);
    expect(useChannelStore.getState().listMap.all).toEqual([kept]);
    expect(useChannelStore.getState().detailMap[channelViewKey(main)]).toBeDefined();
    request.resolve({ success: true });
    await deleting;

    expect(useChannelStore.getState().detailMap[channelViewKey(main)]).toBeUndefined();
    expect(useChannelStore.getState().detailMap[channelViewKey(thread)]).toBeUndefined();
    expect(useChannelStore.getState().detailMap[channelViewKey(keptView)]).toBeDefined();
    await waitFor(async () => {
      expect((await channelListResource.storage!.get({ queryKey: 'all', scope }))?.data).toEqual([
        kept,
      ]);
      expect(
        await channelDetailResource.storage!.get({ queryKey: channelViewKey(thread), scope }),
      ).toBeUndefined();
    });
  });

  it('rolls back the row and keeps the conversation when the server rejects deletion', async () => {
    const error = new Error('Permission revoked');
    vi.spyOn(channelService, 'remove').mockRejectedValue(error);
    await expect(channelActions.remove(removed.id)).rejects.toBe(error);
    expect(useChannelStore.getState().listMap.all).toEqual([removed, kept]);
    expect(useChannelStore.getState().detailMap[channelViewKey(main)]).toBeDefined();
    expect(useChannelStore.getState().detailMap[channelViewKey(thread)]).toBeDefined();
  });

  it('does not resurrect a removed channel from an older detail request', async () => {
    const request = Promise.withResolvers<ChannelDetail>();
    vi.mocked(channelService.detail).mockReturnValueOnce(request.promise);
    const refreshing = channelActions.refreshDetail(main);
    vi.spyOn(channelService, 'remove').mockResolvedValue({ success: true });
    await channelActions.remove(removed.id);
    request.resolve(detail(removed));
    await refreshing;
    expect(useChannelStore.getState().detailMap[channelViewKey(main)]).toBeUndefined();
  });

  it('purges cached views after another client deletes the channel', async () => {
    vi.mocked(channelService.detail).mockRejectedValueOnce({ data: { code: 'NOT_FOUND' } });
    await expect(channelActions.refreshDetail(main)).rejects.toBeDefined();
    expect(useChannelStore.getState().listMap.all).toEqual([kept]);
    expect(useChannelStore.getState().detailMap[channelViewKey(thread)]).toBeUndefined();
  });

  it('keeps cached content when refresh fails transiently', async () => {
    vi.mocked(channelService.detail).mockRejectedValueOnce(new Error('network'));
    await expect(channelActions.refreshDetail(main)).rejects.toThrow('network');
    expect(useChannelStore.getState().listMap.all).toEqual([removed, kept]);
    expect(useChannelStore.getState().detailMap[channelViewKey(main)]).toBeDefined();
  });

  it('does not remove the new scope’s data when an old-scope delete finishes', async () => {
    const request = Promise.withResolvers<{ success: boolean }>();
    vi.spyOn(channelService, 'remove').mockReturnValue(request.promise);
    const deleting = channelActions.remove(removed.id);
    scope = crypto.randomUUID();
    await channelActions.refreshList();
    await channelActions.refreshDetail(main);
    request.resolve({ success: true });
    await deleting;
    expect(useChannelStore.getState().listMap.all).toEqual([removed, kept]);
    expect(useChannelStore.getState().detailMap[channelViewKey(main)]).toBeDefined();
  });
});
