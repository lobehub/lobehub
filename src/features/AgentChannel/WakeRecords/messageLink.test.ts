import { describe, expect, it } from 'vitest';

import { platformMessageUrl } from './messageLink';

describe('platformMessageUrl', () => {
  it('links a Discord channel message', () => {
    expect(
      platformMessageUrl({
        messageId: '333',
        platform: 'discord',
        platformThreadId: 'discord:111:222',
      }),
    ).toBe('https://discord.com/channels/111/222/333');
  });

  it('opens a message in a thread inside the thread', () => {
    expect(
      platformMessageUrl({
        messageId: '444',
        platform: 'discord',
        platformThreadId: 'discord:111:222:333',
      }),
    ).toBe('https://discord.com/channels/111/333/444');
  });

  it('links a direct message under @me', () => {
    expect(
      platformMessageUrl({
        messageId: '9',
        platform: 'discord',
        platformThreadId: 'discord:@me:555',
      }),
    ).toBe('https://discord.com/channels/@me/555/9');
  });

  it.each([
    ['another platform', { messageId: '1', platform: 'telegram', platformThreadId: 'telegram:42' }],
    ['no message id', { platform: 'discord', platformThreadId: 'discord:111:222' }],
    ['a short thread id', { messageId: '1', platform: 'discord', platformThreadId: 'discord:111' }],
  ])('has no link for %s', (_case, address) => {
    expect(platformMessageUrl(address as Record<string, string>)).toBeUndefined();
  });

  it('has no link without an address', () => {
    expect(platformMessageUrl(null)).toBeUndefined();
  });
});
