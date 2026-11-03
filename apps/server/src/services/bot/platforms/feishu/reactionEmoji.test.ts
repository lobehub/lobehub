import { supportedFeishuEmojiTypes, toFeishuEmojiType } from '@lobechat/chat-adapter-feishu';
import { describe, expect, it } from 'vitest';

import { RECEIVED_REACTION_EMOJI, THINKING_REACTION_EMOJI, WORKING_REACTION_EMOJI } from '../const';

describe('toFeishuEmojiType', () => {
  // The bug this module exists for: the bridge fires these three on every run,
  // and passing them through as unicode is a guaranteed `231001`.
  it.each([
    ['received', RECEIVED_REACTION_EMOJI],
    ['thinking', THINKING_REACTION_EMOJI],
    ['working', WORKING_REACTION_EMOJI],
  ])('maps the bridge %s emoji to a documented emoji_type', (_label, emoji) => {
    const emojiType = toFeishuEmojiType(emoji);
    expect(emojiType).toBeDefined();
    expect(supportedFeishuEmojiTypes()).toContain(emojiType);
  });

  it('maps each bridge state to a code that reads as that state', () => {
    // A wrong-but-valid code is invisible to the API and very visible to the
    // user: '\u{1F914}' once mapped to MUSCLE, which renders in Lark as 「加油」 —
    // the bot looked like it was cheering, not thinking.
    expect(toFeishuEmojiType(RECEIVED_REACTION_EMOJI)).toBe('OK');
    expect(toFeishuEmojiType(THINKING_REACTION_EMOJI)).toBe('THINKING');
    expect(toFeishuEmojiType(WORKING_REACTION_EMOJI)).toBe('OnIt');
  });

  it('maps common unicode an agent would pass to reactToMessage', () => {
    expect(toFeishuEmojiType('👍')).toBe('THUMBSUP');
    expect(toFeishuEmojiType('👎')).toBe('ThumbsDown');
    expect(toFeishuEmojiType('✅')).toBe('CheckMark');
    expect(toFeishuEmojiType('❤️')).toBe('HEART');
  });

  it('accepts an emoji_type name directly, in any casing, and canonicalizes it', () => {
    expect(toFeishuEmojiType('THUMBSUP')).toBe('THUMBSUP');
    // Feishu's own casing is inconsistent — a caller that lowercases must
    // still land on the exact string the API expects.
    expect(toFeishuEmojiType('thumbsdown')).toBe('ThumbsDown');
    expect(toFeishuEmojiType('checkmark')).toBe('CheckMark');
  });

  it('returns undefined for anything without a documented equivalent', () => {
    expect(toFeishuEmojiType('🦄')).toBeUndefined();
    expect(toFeishuEmojiType('NOT_A_REAL_TYPE')).toBeUndefined();
    expect(toFeishuEmojiType('')).toBeUndefined();
    expect(toFeishuEmojiType('   ')).toBeUndefined();
    expect(toFeishuEmojiType(null)).toBeUndefined();
    expect(toFeishuEmojiType(undefined)).toBeUndefined();
  });
});
