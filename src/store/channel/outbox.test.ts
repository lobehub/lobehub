import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { addOutgoing, channelOutboxKey, type ChannelOutgoingMessage, settleOutbox } from './outbox';

const outgoing = (patch: Partial<ChannelOutgoingMessage> = {}): ChannelOutgoingMessage => ({
  attachments: [],
  channelId: 'channel',
  content: 'Hello',
  createdAt: new Date(),
  fileIds: [],
  mentions: [],
  requestKey: 'request',
  scope: 'scope',
  status: 'sent',
  threadId: null,
  ...patch,
});
const stored = (id: string, sequence: number) => ({ id, sequence }) as ChannelPublicMessage;
const page = (messages: ChannelPublicMessage[]) => ({ messages }) as ChannelDetail;
const main = { channelId: 'channel' };
const key = channelOutboxKey('channel');

describe('settleOutbox', () => {
  const sent = outgoing({ sent: { id: 'message', sequence: 5, threadId: null } });

  it('drops a sent message once the latest page holds it', () => {
    const outbox = addOutgoing({}, sent);
    expect(settleOutbox(outbox, main, page([stored('message', 5)]), 'scope')).toEqual({});
  });

  it('drops a sent message when the page already holds a later message', () => {
    const outbox = addOutgoing({}, sent);
    expect(settleOutbox(outbox, main, page([stored('later', 6)]), 'scope')).toEqual({});
  });

  it('keeps a sent message that a page read before the write does not hold', () => {
    const outbox = addOutgoing({}, sent);
    expect(settleOutbox(outbox, main, page([stored('earlier', 4)]), 'scope')).toBe(outbox);
  });

  it('drops a reply the server moved into a thread from the main conversation', () => {
    const moved = outgoing({ sent: { id: 'message', sequence: 5, threadId: 'thread' } });
    expect(settleOutbox(addOutgoing({}, moved), main, page([]), 'scope')).toEqual({});
  });

  it('keeps messages still sending or failed, older pages and other scopes', () => {
    const outbox = [
      outgoing({ requestKey: 'sending', status: 'sending' }),
      outgoing({ requestKey: 'failed', status: 'failed' }),
      { ...sent, requestKey: 'other-scope', scope: 'other' },
    ].reduce(addOutgoing, {});
    const later = page([stored('later', 9)]);
    expect(settleOutbox(outbox, main, later, 'scope')[key]).toHaveLength(3);
    const settledSent = addOutgoing({}, sent);
    expect(settleOutbox(settledSent, { ...main, before: 10 }, later, 'scope')).toBe(settledSent);
  });
});
