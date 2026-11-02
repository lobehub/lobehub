import type { ChannelPublicMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { showsReplyQuote } from './replyQuote';

describe('Channel reply quote', () => {
  const original = {
    author: { avatar: null, id: 'user-1', name: 'Ada', type: 'user' as const },
    content: 'who is codex',
    id: 'request',
    sequence: 1,
    threadId: null,
  };
  const message = (patch: Partial<ChannelPublicMessage>) =>
    ({
      replyTo: null,
      replyToId: null,
      routingStatus: 'skipped',
      ...patch,
    }) as ChannelPublicMessage;

  it('does not treat the request an Agent reply answers as a quote', () => {
    expect(
      showsReplyQuote(message({ replyTo: original, replyToId: 'request', routingStatus: 'reply' })),
    ).toBe(false);
    expect(
      showsReplyQuote(message({ replyTo: null, replyToId: 'request', routingStatus: 'reply' })),
    ).toBe(false);
  });

  it("quotes a person's reply, including when its original is gone", () => {
    expect(showsReplyQuote(message({ replyTo: original, replyToId: 'request' }))).toBe(true);
    expect(showsReplyQuote(message({ replyTo: null, replyToId: 'request' }))).toBe(true);
  });

  it('shows nothing when the view does not carry the quote', () => {
    expect(showsReplyQuote(message({ replyTo: undefined, replyToId: 'request' }))).toBe(false);
    expect(showsReplyQuote(message({ replyToId: null }))).toBe(false);
  });
});
