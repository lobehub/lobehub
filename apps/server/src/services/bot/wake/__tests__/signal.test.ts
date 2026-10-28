// @vitest-environment node
import { buildWakeSignal } from '../signal';

const build = (message: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
  buildWakeSignal({
    agentId: 'agt',
    applicationId: '555',
    message: { id: 'm1', text: 'hello', ...message },
    operatorUserId: 'owner',
    platform: 'discord',
    platformThreadId: 'discord:g1:c1:t1',
    timestamp: 42,
    ...overrides,
  });

describe('buildWakeSignal', () => {
  it.each([
    {
      expected: { isBot: true, isMe: false, isOwner: false },
      name: 'a bot',
      author: { isBot: true, userId: 'b' },
    },
    {
      expected: { isBot: false, isMe: true, isOwner: false },
      name: 'itself',
      author: { isMe: true, userId: '555' },
    },
    {
      expected: { isBot: false, isMe: false, isOwner: true },
      name: 'the owner',
      author: { userId: 'owner' },
    },
    {
      expected: { isBot: false, isMe: false, isOwner: false },
      name: 'a person',
      author: { userId: 'u' },
    },
    {
      expected: { isBot: false, isMe: false, isOwner: false },
      name: "an 'unknown' bot flag",
      author: { isBot: 'unknown', userId: 'u' },
    },
  ])('author is $name', ({ author, expected }) => {
    expect(build({ author }).author).toMatchObject(expected);
  });

  it('never calls anyone the owner when no owner is configured', () => {
    expect(
      build({ author: { userId: 'owner' } }, { operatorUserId: undefined }).author?.isOwner,
    ).toBe(false);
  });

  it.each([
    { expected: false, raw: { type: 0 } },
    { expected: false, raw: { type: 19 } },
    { expected: false, raw: { content: 'x' } },
    { expected: true, raw: { type: 7 } },
    { expected: true, raw: { type: 6 } },
    { expected: false, raw: undefined },
  ])('discord raw $raw -> system=$expected', ({ expected, raw }) => {
    expect(build({ raw }).author?.isSystem).toBe(expected);
  });

  it('does not call a non-Discord raw type a system message', () => {
    expect(
      build({ raw: { type: 7 } }, { platform: 'slack', platformThreadId: 'slack:c:1' }).author
        ?.isSystem,
    ).toBe(false);
  });

  it('parses mentions on Discord only, so other platforms keep the adapter flag', () => {
    expect(build({ text: '<@555> hi' }).mentions).toMatchObject({ botMentioned: true });
    expect(
      build({ text: '<@U1> hi' }, { platform: 'slack', platformThreadId: 'slack:c:1' }).mentions,
    ).toBeUndefined();
  });

  it('reads the name a Discord reply author shows: display name first, then username', () => {
    const reply = (author: Record<string, unknown>) =>
      build({ raw: { referenced_message: { author }, type: 19 } });

    expect(reply({ global_name: 'Innei', id: 'i1', username: 'innei_' })).toMatchObject({
      replyToAuthorId: 'i1',
      replyToAuthorName: 'Innei',
    });
    expect(reply({ global_name: null, id: 'i1', username: 'innei_' }).replyToAuthorName).toBe(
      'innei_',
    );
    expect(reply({ id: 'i1' }).replyToAuthorName).toBeUndefined();
  });

  it('reads who a Discord reply points at, and nothing elsewhere', () => {
    const raw = { referenced_message: { author: { id: 'teammate' } }, type: 19 };

    expect(build({ raw }).replyToAuthorId).toBe('teammate');
    expect(build({ raw: { referenced_message: null, type: 0 } }).replyToAuthorId).toBeUndefined();
    expect(
      build({ raw }, { platform: 'slack', platformThreadId: 'slack:c:1' }).replyToAuthorId,
    ).toBeUndefined();
  });

  it('carries channel keys, attachments and the clock', () => {
    const signal = build({ attachments: [{}] });

    expect(signal).toMatchObject({
      channelKeys: {
        channelKey: 'discord:555:g1:c1',
        ids: ['c1', 't1'],
        threadKey: 'discord:555:g1:c1:t1',
      },
      hasAttachments: true,
      timestamp: 42,
    });
  });
});
