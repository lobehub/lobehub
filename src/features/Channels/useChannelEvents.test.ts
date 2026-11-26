import { beforeEach, describe, expect, it, vi } from 'vitest';

import { channelActions } from '@/store/channel';

import { queueChannelRefresh } from './useChannelEvents';

vi.mock('@/store/channel', () => ({
  channelActions: { refreshDetail: vi.fn(async () => {}), refreshList: vi.fn(async () => {}) },
}));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('queueChannelRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: one `channel_changed` reached the sidebar, the main conversation and the
  // thread panel, and each refreshed the list itself: three list reads per notify.
  it('merges the refreshes every subscriber asks for in the same tick', async () => {
    const main = { channelId: 'channel', threadId: null };
    const thread = { channelId: 'channel', threadId: 'thread' };
    queueChannelRefresh();
    queueChannelRefresh(main);
    queueChannelRefresh({ ...main, before: undefined });
    queueChannelRefresh(thread);
    await flush();

    expect(channelActions.refreshList).toHaveBeenCalledTimes(1);
    expect(vi.mocked(channelActions.refreshDetail).mock.calls).toEqual([[main], [thread]]);
  });

  it('refreshes again for an event in a later tick', async () => {
    queueChannelRefresh();
    await flush();
    queueChannelRefresh();
    await flush();

    expect(channelActions.refreshList).toHaveBeenCalledTimes(2);
  });
});
