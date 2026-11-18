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

  it('ignores fenced blocks opened with tildes or a longer run', () => {
    expect(findTextMentions('~~~\n@Pi\n~~~', members)).toEqual([]);
    expect(findTextMentions('````md\n```\n@Pi\n```\n````', members)).toEqual([]);
  });

  it('ignores indented code blocks', () => {
    expect(findTextMentions('示例：\n\n    @Pi\n    @Pilot', members)).toEqual([]);
    expect(findTextMentions('\t@Pi', members)).toEqual([]);
  });

  it('still reads an indented line that continues a paragraph', () => {
    expect(findTextMentions('@Pi 接着写\n    这一行还是同一段', members)).toEqual(['pi']);
  });

  it('ignores code spans of any backtick length, including multiline ones', () => {
    expect(findTextMentions('``a ` @Pi``', members)).toEqual([]);
    expect(findTextMentions('`@Pi\n@Pilot`', members)).toEqual([]);
  });

  it('reads a mention after an unmatched backtick run', () => {
    expect(findTextMentions('`` @Pi', members)).toEqual(['pi']);
  });

  it('ignores link and image destinations but reads link text', () => {
    expect(findTextMentions('[profile](https://example.com/@Pi)', members)).toEqual([]);
    expect(findTextMentions('![@Pi](https://example.com/@Pilot.png)', members)).toEqual([]);
    expect(findTextMentions('[ask @Pi](https://example.com)', members)).toEqual(['pi']);
    expect(findTextMentions('[x][ref]\n\n[ref]: https://example.com/@Pi', members)).toEqual([]);
  });

  it('ignores the address of a bare or bracketed link', () => {
    expect(findTextMentions('见 https://example.com/@Pi 的主页', members)).toEqual([]);
    expect(findTextMentions('<https://example.com/@Pilot>', members)).toEqual([]);
    expect(findTextMentions('www.example.com/@Pi', members)).toEqual([]);
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
