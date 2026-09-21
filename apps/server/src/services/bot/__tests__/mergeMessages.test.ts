import { Message } from 'chat';
import { describe, expect, it } from 'vitest';

import { buildReplayMessages, getSourceMessages, mergeBotMessages } from '../mergeMessages';

const makeMessage = (id: string, text: string, raw: unknown, attachments: unknown[] = []) =>
  new Message({
    attachments: attachments as any,
    author: { fullName: 'u', isBot: false, isMe: false, userId: 'u', userName: 'u' },
    formatted: [] as any,
    id,
    metadata: { dateSent: new Date('2026-09-09T00:00:00Z'), edited: false },
    raw,
    text,
    threadId: 'wechat:single:u',
  });

describe('mergeBotMessages', () => {
  it('returns the message untouched when there is nothing to merge', () => {
    const message = makeMessage('1', 'hi', { a: 1 });

    expect(mergeBotMessages(message, undefined)).toBe(message);
    expect(mergeBotMessages(message, [])).toBe(message);
    expect(getSourceMessages(message)).toEqual([message]);
  });

  it('joins text, concatenates attachments and records every source', () => {
    const image = makeMessage('1', '', { item: 'image' }, [{ type: 'image' }]);
    const text = makeMessage('2', 'describe this', { item: 'text' });

    const merged = mergeBotMessages(text, [image]);

    expect(merged.text).toBe('describe this');
    expect(merged.attachments).toEqual([{ type: 'image' }]);
    // The last message's raw wins on the merged message itself…
    expect(merged.raw).toEqual({ item: 'text' });
    // …but every original raw stays reachable for extractFiles.
    expect(getSourceMessages(merged).map((m) => m.raw)).toEqual([
      { item: 'image' },
      { item: 'text' },
    ]);
    expect(merged).toBeInstanceOf(Message);
  });
});

describe('buildReplayMessages', () => {
  it('returns an empty list for no entries', () => {
    expect(buildReplayMessages([])).toEqual([]);
  });

  it('keeps each original raw through the SDK JSON round-trip before merging', () => {
    const image = makeMessage('10', '', { item: 'image' }, [{ type: 'image', url: '' }]);
    const text = makeMessage('11', '参考这个风格', { item: 'text' });
    const entries = [image.toJSON(), text.toJSON()];

    const replays = buildReplayMessages(entries);
    expect(replays).toHaveLength(2);
    const restored = replays.map((message) =>
      // JSON wire serialization intentionally calls Message.toJSON.
      // eslint-disable-next-line unicorn/prefer-structured-clone
      Message.fromJSON(JSON.parse(JSON.stringify(message))),
    );
    const replay = mergeBotMessages(restored[1], [restored[0]]);

    expect(replay).toBeInstanceOf(Message);
    expect(replay.id).toMatch(/^11:replay:\d+:1$/);
    expect(replay.text).toBe('参考这个风格');
    expect(replay.threadId).toBe('wechat:single:u');
    expect(replay.attachments).toHaveLength(1);
    expect(getSourceMessages(replay).map((m) => m.raw)).toEqual([
      { item: 'image' },
      { item: 'text' },
    ]);
  });
});

describe('sender isolation', () => {
  it('does not merge another author or bot into the authenticated sender turn', () => {
    const owner = makeMessage('owner', 'owner followup', { item: 'text' });
    const attacker = makeMessage('attacker', 'untrusted instruction', { item: 'image' }, [
      { type: 'image' },
    ]);
    attacker.author = { ...attacker.author, userId: 'someone-else' };
    const bot = makeMessage('bot', 'bot instruction', {});
    bot.author = { ...bot.author, isBot: true };

    const merged = mergeBotMessages(owner, [attacker, bot]);

    expect(merged).toBe(owner);
    expect(getSourceMessages(merged)).toEqual([owner]);
    expect(merged.attachments).toEqual([]);
  });
});
