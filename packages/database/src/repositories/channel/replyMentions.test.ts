import { describe, expect, it } from 'vitest';

import { findTextMentions, replyMentionHops } from './replyMentions';

const members = [
  { id: 'arvin', name: 'Arvin Xu' },
  { id: 'pi', name: 'Pi' },
  { id: 'pilot', name: 'Pilot' },
];

describe('findTextMentions', () => {
  it('matches names that end at a space, punctuation or the end', () => {
    expect(findTextMentions('@Arvin Xu 拉到了', members)).toEqual(['arvin']);
    expect(findTextMentions('问下 @Pi，再看 @Pilot', members)).toEqual(['pi', 'pilot']);
    expect(findTextMentions('@Arvin Xu', members)).toEqual(['arvin']);
  });

  it('never matches a name inside a longer word', () => {
    expect(findTextMentions('@Pix', members)).toEqual([]);
  });

  it('ignores code', () => {
    expect(findTextMentions('`@Pi` and\n```\n@Pilot\n```', members)).toEqual([]);
  });

  it('lists each member once, in order of appearance', () => {
    expect(findTextMentions('@Pilot @Arvin Xu @Pilot', members)).toEqual(['pilot', 'arvin']);
  });

  it('skips a name two members share', () => {
    expect(
      findTextMentions('@Sam', [
        { id: 'a', name: 'Sam' },
        { id: 'b', name: 'Sam' },
      ]),
    ).toEqual([]);
  });
});

describe('replyMentionHops', () => {
  it('reads positive integers only', () => {
    expect(replyMentionHops({ mentionHops: 2 })).toBe(2);
    expect(replyMentionHops({ mentionHops: 'x' })).toBe(0);
    expect(replyMentionHops(null)).toBe(0);
  });
});
