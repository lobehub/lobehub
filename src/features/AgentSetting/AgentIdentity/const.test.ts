import { describe, expect, it } from 'vitest';

import { IDENTITY_CHANNELS, isChannelAccount } from './const';

const mailChannel = IDENTITY_CHANNELS.find((channel) => channel.provider === 'agent-mail')!;

describe('isChannelAccount', () => {
  it('claims an Agent Mail account for the Agent Mail channel', () => {
    expect(isChannelAccount({ kind: 'mail', provider: 'agent-mail' }, mailChannel)).toBe(true);
  });

  it('does not treat a mailbox mounted through another provider as Agent Mail', () => {
    expect(isChannelAccount({ kind: 'mail', provider: 'user' }, mailChannel)).toBe(false);
  });
});
