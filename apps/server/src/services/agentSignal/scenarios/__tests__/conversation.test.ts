// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CONVERSATION_LINE_MAX_CHARS,
  describeLine,
  discordMessageTime,
  matchesBotName,
  parseLine,
  serializeLine,
  toConversationLine,
} from '../botWake/conversation';
import { resolveConversationLogKey } from '../botWake/facts';

describe('conversation lines', () => {
  const base = { at: 1_000, authorId: 'u1', authorName: 'Alice', id: 'm1', isBot: false };

  it('keeps the text short so a channel log stays small', () => {
    const line = toConversationLine({
      ...base,
      text: 'x'.repeat(CONVERSATION_LINE_MAX_CHARS + 50),
    });

    expect(line.text).toHaveLength(CONVERSATION_LINE_MAX_CHARS + 1);
    expect(line.text.endsWith('…')).toBe(true);
  });

  it('marks a message that is only an attachment instead of keeping an empty line', () => {
    expect(toConversationLine({ ...base, hasAttachments: true, text: '  ' }).text).toBe(
      '[attachment]',
    );
  });

  it('serializes the same message identically for every bot that saw it, so the log dedupes it', () => {
    const a = serializeLine(toConversationLine({ ...base, text: 'hello' }));
    const b = serializeLine(
      toConversationLine({
        text: 'hello',
        isBot: false,
        id: 'm1',
        authorName: 'Alice',
        authorId: 'u1',
        at: 1_000,
      }),
    );

    expect(a).toBe(b);
  });

  it('reads back what it wrote and drops what is not a line', () => {
    const line = toConversationLine({ ...base, text: 'hello' });

    expect(parseLine(serializeLine(line))).toEqual(line);
    for (const junk of ['', 'nope', '{}', '{"id":1}', '[]', 'null'])
      expect(parseLine(junk)).toBeUndefined();
  });

  it('dates a Discord message from its id', () => {
    // 1564248423568380028 was posted on 2026-10-26 (taken from a real decision row).
    const at = discordMessageTime('1564248423568380028')!;

    expect(new Date(at).toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(discordMessageTime('not-a-snowflake')).toBeUndefined();
  });

  it('labels the bot as the assistant and everyone else by name', () => {
    const mine = toConversationLine({
      ...base,
      authorId: 'bot-1',
      authorName: 'Shadow Arvin',
      isBot: true,
      text: 'on it',
    });
    const theirs = toConversationLine({ ...base, text: 'thanks' });

    expect(describeLine(mine, 'bot-1')).toBe('Assistant: on it');
    expect(describeLine(theirs, 'bot-1')).toBe('Alice: thanks');
    expect(describeLine({ ...theirs, authorName: undefined }, 'bot-1')).toBe('someone: thanks');
  });

  it('marks the bot’s owner, so their name is not read as just another person', () => {
    const owner = toConversationLine({
      ...base,
      authorId: 'owner-1',
      authorName: 'arvin',
      text: 'ok',
    });

    expect(describeLine(owner, 'bot-1', 'owner-1')).toBe('arvin (owner): ok');
    expect(describeLine(owner, 'bot-1', 'someone-else')).toBe('arvin: ok');
    expect(describeLine(owner, 'bot-1')).toBe('arvin: ok');
  });
});

describe('matchesBotName', () => {
  it('finds the name the way a person would write it', () => {
    expect(matchesBotName('Shadow Arvin 听得到吗', ['Shadow Arvin'])).toBe(true);
    expect(matchesBotName('hey shadow arvin, are you there', ['Shadow Arvin'])).toBe(true);
    expect(matchesBotName('小助手，在吗', ['小助手'])).toBe(true);
  });

  it('does not fire inside another word, or on a name too short to mean anything', () => {
    expect(matchesBotName('arvinson is here', ['Arvin'])).toBe(false);
    expect(matchesBotName('a quick note', ['a'])).toBe(false);
    expect(matchesBotName('hello', [])).toBe(false);
    expect(matchesBotName('', ['Arvin'])).toBe(false);
  });

  it('treats the name as text, not as a pattern', () => {
    expect(matchesBotName('what is a+b', ['a+b'])).toBe(true);
    expect(matchesBotName('anything (x', ['(x'])).toBe(true);
    expect(matchesBotName('hello', ['.*'])).toBe(false);
  });
});

describe('resolveConversationLogKey', () => {
  it('is shared by every bot in a channel and keeps a thread apart from its channel', () => {
    expect(resolveConversationLogKey('discord', 'discord:g1:c1')).toBe('discord:g1:c1');
    expect(resolveConversationLogKey('discord', 'discord:g1:c1:t1')).toBe('discord:g1:c1:t1');
    expect(resolveConversationLogKey('telegram', 'telegram:-100123')).toBe('telegram:-100123');
  });
});
