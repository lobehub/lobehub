// @vitest-environment node
import { isEmptyOrEmojiOnly, judgeExplicitMention } from '../facts';

describe('judgeExplicitMention', () => {
  const none = { botMentioned: false, everyone: false, here: false, otherUserIds: [], roleIds: [] };

  it.each([
    {
      adapter: true,
      expected: true,
      mentions: undefined,
      name: 'no mentions parsed: trust the adapter',
    },
    {
      adapter: false,
      expected: false,
      mentions: undefined,
      name: 'no mentions parsed, adapter false',
    },
    {
      adapter: true,
      expected: false,
      mentions: { ...none, everyone: true },
      name: 'adapter counted @everyone',
    },
    {
      adapter: true,
      expected: false,
      mentions: { ...none, roleIds: ['9'] },
      name: 'adapter counted a role ping',
    },
    { adapter: true, expected: true, mentions: { ...none, botMentioned: true }, name: 'real @bot' },
    {
      adapter: false,
      expected: true,
      mentions: { ...none, botMentioned: true },
      name: 'real @bot the adapter missed',
    },
  ])('$name', ({ adapter, expected, mentions }) => {
    expect(judgeExplicitMention(adapter, mentions)).toBe(expected);
  });
});

describe('isEmptyOrEmojiOnly', () => {
  it.each([
    ['', false, true],
    ['   \n ', false, true],
    ['👍', false, true],
    ['👍🏽 🎉', false, true],
    ['👨‍👩‍👧', false, true],
    ['<:pepe:12345>', false, true],
    ['<a:dance:12345> :smile:', false, true],
    ['...', false, true],
    ['？！', false, true],
    ['', true, false],
    ['👍', true, false],
    ['ok', false, false],
    ['好的', false, false],
    ['👍 thanks', false, false],
    ['42', false, false],
  ])('%j (attachments=%s) -> %s', (text, attachments, expected) => {
    expect(isEmptyOrEmojiOnly(text, attachments)).toBe(expected);
  });
});
