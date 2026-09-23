import { describe, expect, it } from 'vitest';

import { SOURCE_MESSAGES_FIELD } from '../../mergeMessages';
import {
  collectDiscordMentionNames,
  resolveDiscordMentions,
  sanitizeDiscordUserInput,
  stripLeadingBotMention,
} from './mentions';

const ME = '2000';
const SHADOW = '1476493634470940794';

const makeMessage = (raw: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: 'msg-1', raw, text: '', ...extra }) as any;

const mentionsRaw = {
  mentions: [
    { global_name: 'Shadow Arvin', id: SHADOW, username: 'shadow_arvin' },
    { bot: true, global_name: null, id: ME, username: 'Lobo' },
  ],
};

describe('collectDiscordMentionNames', () => {
  it('prefers guild nick, then global_name, then username', () => {
    const names = collectDiscordMentionNames(
      makeMessage({
        mentions: [
          { global_name: 'Global', id: '1', member: { nick: 'Nick' }, username: 'user1' },
          { global_name: 'Global2', id: '2', username: 'user2' },
          { global_name: null, id: '3', username: 'user3' },
        ],
      }),
    );
    expect(names.get('1')).toBe('Nick');
    expect(names.get('2')).toBe('Global2');
    expect(names.get('3')).toBe('user3');
  });

  it('also collects mentions from the referenced message and every merged source', () => {
    const earlier = makeMessage({ mentions: [{ id: '10', username: 'early' }] });
    const latest = makeMessage(
      {
        mentions: [{ id: '11', username: 'late' }],
        referenced_message: { mentions: [{ id: '12', username: 'quoted' }] },
      },
      { [SOURCE_MESSAGES_FIELD]: [earlier] },
    );
    // The merged message's own raw is the latest one; sources are read too.
    (latest as any)[SOURCE_MESSAGES_FIELD] = [earlier, latest];
    const names = collectDiscordMentionNames(latest);
    expect([...names.keys()].sort()).toEqual(['10', '11', '12']);
  });

  it('returns an empty map for missing raw or malformed mentions', () => {
    expect(collectDiscordMentionNames(undefined).size).toBe(0);
    expect(collectDiscordMentionNames(makeMessage({})).size).toBe(0);
    expect(collectDiscordMentionNames(makeMessage({ mentions: 'nope' })).size).toBe(0);
    expect(collectDiscordMentionNames(makeMessage({ mentions: [{ id: 1 }, null] })).size).toBe(0);
  });
});

describe('resolveDiscordMentions', () => {
  const names = new Map([[SHADOW, 'Shadow Arvin']]);

  it('replaces <@id> and <@!id> with @name', () => {
    expect(resolveDiscordMentions(`<@${SHADOW}> hi <@!${SHADOW}>`, names)).toBe(
      '@Shadow Arvin hi @Shadow Arvin',
    );
  });

  it('leaves unknown ids, role mentions and channel mentions untouched', () => {
    expect(resolveDiscordMentions('<@999> <@&123> <#456>', names)).toBe('<@999> <@&123> <#456>');
  });
});

describe('stripLeadingBotMention', () => {
  it('strips one or more leading self mentions only', () => {
    expect(stripLeadingBotMention(`<@${ME}> hello`, ME)).toBe('hello');
    expect(stripLeadingBotMention(`<@!${ME}> <@${ME}> /new`, ME)).toBe('/new');
    expect(stripLeadingBotMention(`hello <@${ME}>`, ME)).toBe(`hello <@${ME}>`);
    expect(stripLeadingBotMention(`<@${SHADOW}> hello`, ME)).toBe(`<@${SHADOW}> hello`);
  });
});

describe('sanitizeDiscordUserInput', () => {
  it('keeps the other bot and the self mention mid-sentence readable (LOBE-14154)', () => {
    const text = `<@${SHADOW}> 我搞了个 <@${ME}> 来抢你的活，你怎么说`;
    expect(sanitizeDiscordUserInput(text, ME, makeMessage(mentionsRaw))).toBe(
      '@Shadow Arvin 我搞了个 @Lobo 来抢你的活，你怎么说',
    );
  });

  it('still strips a leading self mention so command dispatch keeps working', () => {
    expect(sanitizeDiscordUserInput(`<@${ME}> /new`, ME, makeMessage(mentionsRaw))).toBe('/new');
    expect(sanitizeDiscordUserInput(`<@!${ME}> hello world`, ME, makeMessage(mentionsRaw))).toBe(
      'hello world',
    );
  });

  it('falls back to dropping unresolvable self mentions when no mention payload exists', () => {
    expect(sanitizeDiscordUserInput(`hello <@${ME}>`, ME)).toBe('hello');
    expect(sanitizeDiscordUserInput(`hello <@${ME}> there`, ME)).toBe('hello there');
  });

  it('leaves other unresolvable mentions in place instead of dropping them', () => {
    expect(sanitizeDiscordUserInput(`<@${ME}> ping <@${SHADOW}>`, ME)).toBe(`ping <@${SHADOW}>`);
  });
});
