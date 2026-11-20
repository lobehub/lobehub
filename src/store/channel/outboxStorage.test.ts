import { afterEach, describe, expect, it } from 'vitest';

import type { ChannelOutgoingMessage } from './outbox';
import { CHANNEL_OUTBOX_STORAGE_KEY, channelOutboxStorage } from './outboxStorage';

const message = (patch: Partial<ChannelOutgoingMessage> = {}): ChannelOutgoingMessage => ({
  attachments: [],
  channelId: 'channel',
  content: 'Hello',
  createdAt: new Date('2026-11-05T10:00:00Z'),
  fileIds: [],
  mentions: [],
  requestKey: 'request',
  scope: 'scope',
  status: 'sending',
  threadId: null,
  ...patch,
});

describe('channelOutboxStorage', () => {
  afterEach(() => localStorage.clear());

  it('brings an interrupted send back as failed, keeping its request key', () => {
    channelOutboxStorage.save(message());

    expect(channelOutboxStorage.load('scope')).toEqual([{ ...message(), status: 'failed' }]);
  });

  it('reads only the requested identity scope, oldest first', () => {
    channelOutboxStorage.save(
      message({ createdAt: new Date('2026-11-05T10:02:00Z'), requestKey: 'later' }),
    );
    channelOutboxStorage.save(message({ requestKey: 'other', scope: 'other' }));
    channelOutboxStorage.save(message({ requestKey: 'earlier' }));

    expect(channelOutboxStorage.load('scope').map((entry) => entry.requestKey)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('forgets a confirmed or deleted message and keeps one copy per request key', () => {
    channelOutboxStorage.save(message());
    channelOutboxStorage.save(message({ status: 'failed' }));
    expect(channelOutboxStorage.load('scope')).toHaveLength(1);

    channelOutboxStorage.forget(message());

    expect(channelOutboxStorage.load('scope')).toEqual([]);
    expect(localStorage.getItem(CHANNEL_OUTBOX_STORAGE_KEY)).toBeNull();
  });

  it('ignores a corrupt or foreign value', () => {
    localStorage.setItem(CHANNEL_OUTBOX_STORAGE_KEY, '{not json');
    expect(channelOutboxStorage.load('scope')).toEqual([]);

    localStorage.setItem(CHANNEL_OUTBOX_STORAGE_KEY, JSON.stringify([{ scope: 'scope' }]));
    expect(channelOutboxStorage.load('scope')).toEqual([]);
  });
});
