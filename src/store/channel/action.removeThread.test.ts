import type {
  ChannelDetail,
  ChannelListItem,
  ChannelPublicMessage,
  ChannelPublicThread,
} from '@lobechat/types';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelDetailResource, channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { detail: vi.fn(), list: vi.fn(), removeThread: vi.fn() },
}));
const channel: ChannelListItem = {
  id: 'channel',
  title: 'Channel',
  archived: false,
  canDelete: true,
  sequence: 0,
  status: 'active',
  createdAt: new Date(),
  workspaceId: null,
};
const removed: ChannelPublicThread = {
  id: 'removed',
  rootMessageId: 'root',
  rootSequence: 1,
  status: 'active',
  followerMemberIds: [],
};
const kept: ChannelPublicThread = { ...removed, id: 'kept', rootMessageId: 'other-root' };
const main = { channelId: channel.id };
const page = { ...main, before: 20 };
const thread = { ...main, threadId: removed.id };
const threadPage = { ...thread, before: 20 };
const sibling = { ...main, threadId: kept.id };
const otherChannel = { channelId: 'other-channel' };
const detail = (params: { channelId: string; threadId?: string | null }): ChannelDetail => ({
  attachments: [],
  channel: { ...channel, id: params.channelId },
  hasMore: false,
  jobs: [],
  members: [],
  messages: [],
  rootMessage: params.threadId
    ? ({
        id: params.threadId === removed.id ? removed.rootMessageId : kept.rootMessageId,
      } as ChannelPublicMessage)
    : null,
  threads: params.channelId === channel.id ? [removed, kept] : [],
});
const read = (params: Parameters<typeof channelViewKey>[0]) =>
  useChannelStore.getState().detailMap[channelViewKey(params)];

describe('Thread removal cache lifecycle', () => {
  let scope: string;
  beforeEach(async () => {
    scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    vi.mocked(channelService.list).mockResolvedValue([channel]);
    vi.mocked(channelService.detail).mockImplementation(async (params) => detail(params));
    vi.mocked(channelService.removeThread).mockResolvedValue({ success: true });
    channelActions.reset();
    await channelActions.refreshList();
    await Promise.all(
      [main, page, thread, threadPage, sibling, otherChannel].map(channelActions.refreshDetail),
    );
  });
  afterEach(() => {
    channelActions.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('hides references while pending, then removes only the deleted branch and all its cached pages', async () => {
    const gate = Promise.withResolvers<{ success: boolean }>();
    vi.mocked(channelService.removeThread).mockReturnValue(gate.promise);
    const pending = channelActions.removeThread(channel.id, removed.id);
    expect(read(main)?.threads).toEqual([kept]);
    expect(read(thread)).toBeDefined();
    gate.resolve({ success: true });
    await pending;
    expect(read(thread)).toBeUndefined();
    expect(read(threadPage)).toBeUndefined();
    expect(read(page)?.threads).toEqual([kept]);
    expect(read(sibling)?.threads).toEqual([kept]);
    expect(read(otherChannel)).toBeDefined();
    expect(useChannelStore.getState().listMap.all).toEqual([channel]);
    await waitFor(async () => {
      expect(
        await channelDetailResource.storage!.get({ queryKey: channelViewKey(threadPage), scope }),
      ).toBeUndefined();
      expect(
        (await channelDetailResource.storage!.get({ queryKey: channelViewKey(main), scope }))?.data
          .threads,
      ).toEqual([kept]);
    });
  });

  it('rolls references back and keeps the thread usable when the write fails', async () => {
    vi.mocked(channelService.removeThread).mockRejectedValue(new Error('Denied'));
    await expect(channelActions.removeThread(channel.id, removed.id)).rejects.toThrow('Denied');
    expect(read(main)?.threads).toEqual([removed, kept]);
    expect(read(thread)).toBeDefined();
  });

  it.each([main, thread])(
    'does not restore deleted content from an older response (%j)',
    async (params) => {
      const gate = Promise.withResolvers<ChannelDetail>();
      vi.mocked(channelService.detail).mockReturnValueOnce(gate.promise);
      const fetching = channelActions.refreshDetail(params);
      await channelActions.removeThread(channel.id, removed.id);
      gate.resolve(detail(params));
      await fetching;
      expect(read(thread)).toBeUndefined();
      expect(read(main)?.threads).toEqual([kept]);
    },
  );

  it('a thread NOT_FOUND removes that branch, not the channel or sibling conversation', async () => {
    vi.mocked(channelService.detail).mockRejectedValueOnce({ data: { code: 'NOT_FOUND' } });
    await expect(channelActions.refreshDetail(thread)).rejects.toBeDefined();
    expect(read(threadPage)).toBeUndefined();
    expect(read(main)?.threads).toEqual([kept]);
    expect(read(sibling)).toBeDefined();
    expect(useChannelStore.getState().listMap.all).toEqual([channel]);
  });

  it('does not hide a real thread when a URL pairs its ID with a different channel', async () => {
    vi.mocked(channelService.detail).mockRejectedValueOnce({ data: { code: 'NOT_FOUND' } });
    await expect(
      channelActions.refreshDetail({ ...otherChannel, threadId: removed.id }),
    ).rejects.toBeDefined();
    expect(read(thread)).toBeDefined();
    expect(read(main)?.threads).toEqual([removed, kept]);
    await channelActions.refreshDetail(thread);
    expect(read(thread)).toBeDefined();
  });

  it('shows a thread again once the recycle bin restores it', async () => {
    await channelActions.removeThread(channel.id, removed.id);
    await channelActions.refreshDetail(main);
    expect(read(main)?.threads).toEqual([kept]);

    channelActions.forgetThreadRemovals([removed.id]);
    await Promise.all([main, thread].map(channelActions.refreshDetail));
    expect(read(main)?.threads).toEqual([removed, kept]);
    expect(read(thread)).toBeDefined();
  });

  it('retains content on a transient thread read failure', async () => {
    vi.mocked(channelService.detail).mockRejectedValueOnce(new Error('offline'));
    await expect(channelActions.refreshDetail(thread)).rejects.toThrow('offline');
    expect(read(thread)).toBeDefined();
    expect(read(main)?.threads).toEqual([removed, kept]);
  });

  it('also purges persisted pages that are not currently loaded', async () => {
    await waitFor(async () => {
      expect(
        await channelDetailResource.storage!.get({ queryKey: channelViewKey(threadPage), scope }),
      ).toBeDefined();
    });
    channelActions.reset();
    await channelActions.refreshDetail(main);
    await channelActions.removeThread(channel.id, removed.id);
    await waitFor(async () => {
      expect(
        await channelDetailResource.storage!.get({ queryKey: channelViewKey(threadPage), scope }),
      ).toBeUndefined();
    });
  });

  it('rejects a stale first load even when the removed branch was never in memory', async () => {
    channelActions.reset();
    const gate = Promise.withResolvers<ChannelDetail>();
    vi.mocked(channelService.detail).mockReturnValueOnce(gate.promise);
    const fetching = channelActions.refreshDetail(threadPage);
    await channelActions.removeThread(channel.id, removed.id);
    gate.resolve(detail(threadPage));
    await fetching;
    expect(read(threadPage)).toBeUndefined();
  });

  it('does not touch the new identity when an old deletion completes', async () => {
    const gate = Promise.withResolvers<{ success: boolean }>();
    vi.mocked(channelService.removeThread).mockReturnValue(gate.promise);
    const pending = channelActions.removeThread(channel.id, removed.id);
    scope = crypto.randomUUID();
    await Promise.all([main, thread].map(channelActions.refreshDetail));
    gate.resolve({ success: true });
    await pending;
    expect(read(main)?.threads).toEqual([removed, kept]);
    expect(read(thread)).toBeDefined();
  });
});
