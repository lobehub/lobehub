import { describe, expect, it } from 'vitest';

import { extractReplyEmojis, MAX_REPLY_STYLE_LENGTH, resolveReplyStyle } from './replyStyle';

describe('resolveReplyStyle', () => {
  const settings = {
    channelReplyStyles: [
      { channelId: 'c1', style: '  正式一点  ' },
      { channelId: 't1', style: '这个子区随便聊' },
      { channelId: 'c1', style: 'ignored duplicate' },
      { channelId: 'c2', style: '   ' },
    ],
    replyStyle: '  像同事一样随意  ',
  };

  it('uses the style written for the thread, then its channel, then the default', () => {
    expect(resolveReplyStyle(settings, ['c1', 't1'])).toBe('这个子区随便聊');
    expect(resolveReplyStyle(settings, ['c1', 't9'])).toBe('正式一点');
    expect(resolveReplyStyle(settings, ['c9'])).toBe('像同事一样随意');
    // A blank channel style is no style: the default applies.
    expect(resolveReplyStyle(settings, ['c2'])).toBe('像同事一样随意');
  });

  it('is undefined without a style, and cuts an over-long one', () => {
    expect(resolveReplyStyle({}, ['c1'])).toBeUndefined();
    expect(resolveReplyStyle(null, [])).toBeUndefined();
    expect(resolveReplyStyle({ replyStyle: 'x'.repeat(5000) }, [])).toHaveLength(
      MAX_REPLY_STYLE_LENGTH,
    );
  });
});

describe('extractReplyEmojis', () => {
  it('keeps the owner order, dedupes by emoji and drops blanks', () => {
    expect(
      extractReplyEmojis({
        replyEmojis: [
          { emoji: ' <:doge:123> ' },
          { emoji: '<:doge:123>', usage: '调侃的时候' },
          { emoji: '🎉', usage: '有人发布新功能' },
          { emoji: '  ' },
          '👍',
          42,
        ],
      }),
    ).toEqual([
      { emoji: '<:doge:123>', usage: '调侃的时候' },
      { emoji: '🎉', usage: '有人发布新功能' },
      { emoji: '👍' },
    ]);
    expect(extractReplyEmojis({ replyEmojis: 'not a list' })).toEqual([]);
  });
});
