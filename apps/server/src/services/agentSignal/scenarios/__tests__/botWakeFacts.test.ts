// @vitest-environment node
import {
  hasConversationLog,
  isEmptyOrEmojiOnly,
  judgeExplicitMention,
  parseDiscordMentions,
  resolveChannelKeys,
  resolveConversationLogKeys,
  wakeStateKeys,
} from '../botWake/facts';

const BOT = '111';

describe('parseDiscordMentions', () => {
  it.each([
    {
      expected: { botMentioned: true, everyone: false, here: false, otherUserIds: [], roleIds: [] },
      name: 'bot mention',
      text: `<@${BOT}> hi`,
    },
    {
      expected: { botMentioned: true, everyone: false, here: false, otherUserIds: [], roleIds: [] },
      name: 'bot nickname mention',
      text: `<@!${BOT}> hi`,
    },
    {
      expected: { botMentioned: false, everyone: true, here: false, otherUserIds: [], roleIds: [] },
      name: '@everyone',
      text: '@everyone standup now',
    },
    {
      expected: { botMentioned: false, everyone: false, here: true, otherUserIds: [], roleIds: [] },
      name: '@here',
      text: 'ping @here please',
    },
    {
      expected: {
        botMentioned: false,
        everyone: false,
        here: false,
        otherUserIds: [],
        roleIds: ['9'],
      },
      name: 'role only',
      text: '<@&9> review please',
    },
    {
      expected: {
        botMentioned: false,
        everyone: false,
        here: false,
        otherUserIds: ['222'],
        roleIds: [],
      },
      name: 'someone else',
      text: '<@222> can you look?',
    },
    {
      expected: {
        botMentioned: true,
        everyone: true,
        here: false,
        otherUserIds: ['222'],
        roleIds: [],
      },
      name: 'bot + everyone + other',
      text: `@everyone <@${BOT}> <@222>`,
    },
    {
      expected: {
        botMentioned: false,
        everyone: false,
        here: false,
        otherUserIds: [],
        roleIds: [],
      },
      name: 'an email address is not @here',
      text: 'mail me at x@here.com',
    },
  ])('$name', ({ expected, text }) => {
    expect(parseDiscordMentions(text, BOT)).toEqual(expected);
  });
});

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

describe('resolveChannelKeys', () => {
  it('files a Discord channel message under the channel only', () => {
    const keys = resolveChannelKeys('discord', 'app', 'discord:g1:c1');

    expect(keys).toEqual({ channelKey: 'discord:app:g1:c1', ids: ['c1'] });
    expect(wakeStateKeys(keys)).toEqual(['discord:app:g1:c1']);
  });

  it('files a Discord thread message under both the channel and the thread', () => {
    const keys = resolveChannelKeys('discord', 'app', 'discord:g1:c1:t1');

    expect(keys).toEqual({
      channelKey: 'discord:app:g1:c1',
      ids: ['c1', 't1'],
      threadKey: 'discord:app:g1:c1:t1',
    });
    expect(wakeStateKeys(keys)).toEqual(['discord:app:g1:c1', 'discord:app:g1:c1:t1']);
  });

  it('uses the whole conversation id on other platforms, matchable by its parts too', () => {
    expect(resolveChannelKeys('telegram', 'app', 'telegram:-100')).toEqual({
      channelKey: 'telegram:app:telegram:-100',
      ids: ['telegram:-100', '-100'],
    });
    expect(resolveChannelKeys('slack', 'app', 'slack:C123:1700.1').ids).toEqual([
      'slack:C123:1700.1',
      'C123',
      '1700.1',
    ]);
  });

  it('matches a Feishu / Lark chat by its chat id, not by its chat type', () => {
    expect(resolveChannelKeys('feishu', 'app', 'feishu:group:oc_1').ids).toEqual([
      'feishu:group:oc_1',
      'oc_1',
    ]);
    expect(resolveChannelKeys('lark', 'app', 'lark:oc_1').ids).toEqual(['lark:oc_1', 'oc_1']);
  });

  it('keeps two bots in one channel apart', () => {
    expect(resolveChannelKeys('discord', 'a', 'discord:g:c').channelKey).not.toBe(
      resolveChannelKeys('discord', 'b', 'discord:g:c').channelKey,
    );
  });
});

describe('hasConversationLog', () => {
  it.each([
    ['discord', 'discord:g1:c1', true],
    ['discord', 'discord:g1:c1:t1', true],
    ['discord', 'discord:@me:dm1', false],
    ['feishu', 'feishu:group:oc_1', true],
    ['lark', 'lark:group:oc_1', true],
    ['feishu', 'feishu:p2p:oc_1', false],
    // A legacy id cannot tell a group from a direct message.
    ['feishu', 'feishu:oc_1', false],
    ['telegram', 'telegram:-100', false],
  ])('%s %s -> %s', (platform, threadId, expected) => {
    expect(hasConversationLog(platform, threadId)).toBe(expected);
  });

  it('files a Feishu group message under the group', () => {
    expect(resolveConversationLogKeys('feishu', 'feishu:group:oc_1')).toEqual([
      'feishu:group:oc_1',
    ]);
  });
});
