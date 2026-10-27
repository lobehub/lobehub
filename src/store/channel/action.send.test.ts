import type { ChannelDetail } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { detail: vi.fn(), list: vi.fn(), send: vi.fn() },
}));
const input = {
  channelId: 'channel',
  content: 'Hello',
  mentions: [],
  requestKey: 'request',
  rootMessageId: 'root',
};
const main = { channelId: input.channelId };
const thread = { ...main, threadId: 'thread' };
const data = {
  attachments: [],
  channel: {
    createdAt: new Date(),
    id: 'channel',
    sequence: 1,
    title: 'Channel',
    workspaceId: null,
  },
  hasMore: false,
  jobs: [],
  members: [],
  messages: [],
  rootMessage: null,
  threads: [{ id: 'thread', rootMessageId: 'root', rootSequence: 1, followerMemberIds: [] }],
} satisfies ChannelDetail;

describe('Channel first-send cache refresh', () => {
  let scope: string;
  beforeEach(() => {
    scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    vi.mocked(channelService.list).mockResolvedValue([data.channel]);
    vi.mocked(channelService.detail).mockResolvedValue(data);
    channelActions.reset();
  });
  afterEach(() => {
    channelActions.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('refreshes the main/sidebar thread list and the returned thread view after saving', async () => {
    vi.mocked(channelService.send).mockResolvedValue({
      data: { threadId: 'thread' },
      success: true,
    } as never);
    expect(await channelActions.send(input)).toMatchObject({ threadId: 'thread' });
    const state = useChannelStore.getState();
    expect(state.detailMap[channelViewKey(main)]?.threads).toEqual(data.threads);
    expect(state.detailMap[channelViewKey(thread)]).toEqual(data);
    expect(state.listMap.all).toEqual([data.channel]);
  });

  it('does not introduce a thread into the cache when the write fails', async () => {
    vi.mocked(channelService.send).mockRejectedValue(new Error('offline'));
    await expect(channelActions.send(input)).rejects.toThrow('offline');
    expect(useChannelStore.getState().detailMap).toEqual({});
    expect(channelService.detail).not.toHaveBeenCalled();
  });

  it('does not fetch old-channel data in a new identity scope after a delayed send', async () => {
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof channelService.send>>>();
    vi.mocked(channelService.send).mockReturnValue(gate.promise);
    const pending = channelActions.send(input);
    scope = crypto.randomUUID();
    gate.resolve({ data: { threadId: 'thread' }, success: true } as never);
    await pending;
    expect(channelService.detail).not.toHaveBeenCalled();
    expect(channelService.list).not.toHaveBeenCalled();
  });
});
