import type { ChannelDetail } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { answerAsk: vi.fn(), detail: vi.fn(), list: vi.fn() },
}));

const main = { channelId: 'channel' };
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
  threads: [],
} satisfies ChannelDetail;

const answer = {
  answers: [{ selected: ['Approve'] }],
  channelId: 'channel',
  messageId: 'message',
  requestKey: 'ask-answer:message',
  threadId: null,
};

describe('Channel ask answer refresh', () => {
  beforeEach(() => {
    const scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    vi.mocked(channelService.list).mockResolvedValue([data.channel]);
    vi.mocked(channelService.detail).mockResolvedValue(data);
    vi.mocked(channelService.answerAsk).mockResolvedValue({ success: true } as never);
    channelActions.reset();
  });
  afterEach(() => {
    channelActions.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('refreshes the conversation and the sidebar after the answer is saved', async () => {
    await channelActions.answerAsk(answer);

    expect(channelService.answerAsk).toHaveBeenCalledWith({
      answers: answer.answers,
      channelId: answer.channelId,
      messageId: answer.messageId,
      requestKey: answer.requestKey,
    });
    const state = useChannelStore.getState();
    expect(state.detailMap[channelViewKey(main)]).toEqual(data);
    expect(state.listMap.all).toEqual([data.channel]);
  });

  // The answer is committed once the write returns: an offline refresh must not read back as a
  // failed answer, or the card stays actionable and the same question can be answered twice.
  it('keeps the saved answer when the refreshes fail', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelService.detail).mockRejectedValue(new Error('offline'));
    vi.mocked(channelService.list).mockRejectedValue(new Error('offline'));

    await expect(channelActions.answerAsk(answer)).resolves.toBeUndefined();

    expect(channelService.answerAsk).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalled();
  });
});
