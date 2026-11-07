import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { channelOutboxKey } from './outbox';
import { channelOutboxStorage } from './outboxStorage';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { detail: vi.fn(), list: vi.fn(), send: vi.fn() },
}));

const input = {
  attachments: [],
  channelId: 'channel',
  content: 'Hello',
  fileIds: [],
  mentions: [],
};
const key = channelOutboxKey('channel');
const stored = (id: string, sequence: number) =>
  ({ id, sequence, threadId: null }) as ChannelPublicMessage;
const detail = (messages: ChannelPublicMessage[]) =>
  ({
    attachments: [],
    channel: { createdAt: new Date(), id: 'channel', sequence: 1, title: 'Channel' },
    hasMore: false,
    jobs: [],
    members: [],
    messages,
    rootMessage: null,
    threads: [],
  }) as unknown as ChannelDetail;
const outgoing = () => useChannelStore.getState().outbox[key] ?? [];
type SendResult = Awaited<ReturnType<typeof channelService.send>>;
const result = (message: ChannelPublicMessage) => ({ data: message, success: true }) as SendResult;

describe('Channel queued send', () => {
  let scope: string;
  beforeEach(() => {
    scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    vi.mocked(channelService.list).mockResolvedValue([]);
    vi.mocked(channelService.detail).mockResolvedValue(detail([]));
    channelActions.reset();
  });
  afterEach(() => {
    localStorage.clear();
    channelActions.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows the message as sending before the server answers', async () => {
    const gate = Promise.withResolvers<SendResult>();
    vi.mocked(channelService.send).mockReturnValue(gate.promise);
    const pending = channelActions.queueSend(input);
    expect(outgoing()).toMatchObject([{ content: 'Hello', status: 'sending', threadId: null }]);
    gate.resolve(result(stored('message', 2)));
    await pending;
  });

  it('settles the message once the refreshed conversation holds it', async () => {
    vi.mocked(channelService.send).mockResolvedValue(result(stored('message', 2)));
    vi.mocked(channelService.detail).mockResolvedValue(detail([stored('message', 2)]));
    expect(await channelActions.queueSend(input)).toMatchObject({ id: 'message' });
    await vi.waitFor(() => expect(outgoing()).toEqual([]));
  });

  it('keeps a failed message to retry under the same request key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelService.send).mockRejectedValueOnce(new Error('offline'));
    expect(await channelActions.queueSend(input)).toBeUndefined();
    const [failed] = outgoing();
    expect(failed).toMatchObject({ content: 'Hello', status: 'failed' });

    vi.mocked(channelService.send).mockResolvedValueOnce(result(stored('message', 2)));
    expect(await channelActions.retrySend(failed)).toMatchObject({ id: 'message' });
    const requestKeys = vi.mocked(channelService.send).mock.calls.map(([call]) => call.requestKey);
    expect(requestKeys).toEqual([failed.requestKey, failed.requestKey]);
  });

  it('does not send a failed message after it is deleted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelService.send).mockRejectedValueOnce(new Error('offline'));
    await channelActions.queueSend(input);
    const [failed] = outgoing();
    channelActions.discardSend(failed);
    expect(outgoing()).toEqual([]);
    expect(await channelActions.retrySend(failed)).toBeUndefined();
    expect(channelService.send).toHaveBeenCalledTimes(1);
  });

  it('sends one conversation in order, each message after the previous answer', async () => {
    const first = Promise.withResolvers<SendResult>();
    vi.mocked(channelService.send)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(result(stored('second', 3)));
    const sends = [
      channelActions.queueSend(input),
      channelActions.queueSend({ ...input, content: 'World' }),
    ];
    await Promise.resolve();
    expect(channelService.send).toHaveBeenCalledTimes(1);
    expect(outgoing().map((message) => message.content)).toEqual(['Hello', 'World']);
    first.resolve(result(stored('first', 2)));
    await Promise.all(sends);
    const contents = vi.mocked(channelService.send).mock.calls.map(([call]) => call.content);
    expect(contents).toEqual(['Hello', 'World']);
  });

  it('does not send a queued message under an identity that replaced its own', async () => {
    const first = Promise.withResolvers<SendResult>();
    vi.mocked(channelService.send).mockReturnValueOnce(first.promise);
    const sends = [channelActions.queueSend(input), channelActions.queueSend(input)];
    await Promise.resolve();
    expect(channelService.send).toHaveBeenCalledTimes(1);
    scope = crypto.randomUUID();
    first.resolve(result(stored('first', 2)));
    await Promise.all(sends);
    expect(channelService.send).toHaveBeenCalledTimes(1);
    expect(channelService.detail).not.toHaveBeenCalled();
    expect(outgoing().map((message) => message.status)).toEqual(['sent', 'failed']);
  });

  it('keeps an unsent message across a reload until the server confirms it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelService.send).mockRejectedValueOnce(new Error('offline'));
    await channelActions.queueSend(input);
    const [failed] = outgoing();

    // A reload empties memory; the conversation reads the message back.
    channelActions.reset();
    expect(outgoing()).toEqual([]);
    channelActions.restoreOutbox(scope);
    expect(outgoing()).toMatchObject([
      { content: 'Hello', requestKey: failed.requestKey, status: 'failed' },
    ]);

    vi.mocked(channelService.send).mockResolvedValueOnce(result(stored('message', 2)));
    await channelActions.retrySend(outgoing()[0]);
    expect(channelOutboxStorage.load(scope)).toEqual([]);
  });

  it('forgets a deleted message and restores a scope only once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelService.send).mockRejectedValueOnce(new Error('offline'));
    await channelActions.queueSend(input);
    channelActions.restoreOutbox(scope);
    expect(outgoing()).toHaveLength(1);

    channelActions.discardSend(outgoing()[0]);

    expect(channelOutboxStorage.load(scope)).toEqual([]);
  });

  it('marks a message whose send was interrupted by a reload as failed', () => {
    const gate = Promise.withResolvers<SendResult>();
    vi.mocked(channelService.send).mockReturnValue(gate.promise);
    void channelActions.queueSend(input);

    channelActions.reset();
    channelActions.restoreOutbox(scope);

    expect(outgoing()).toMatchObject([{ content: 'Hello', status: 'failed' }]);
  });
});
