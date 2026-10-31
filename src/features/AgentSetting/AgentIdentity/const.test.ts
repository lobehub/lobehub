import { AGENT_ACCOUNT_PERSISTED_KINDS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { IDENTITY_CHANNELS, isChannelAccount, isUnchanneledAccount,KIND_ICONS } from './const';

const mailChannel = IDENTITY_CHANNELS.find((channel) => channel.provider === 'agent-mail')!;

describe('isChannelAccount', () => {
  it('claims an Agent Mail account for the Agent Mail channel', () => {
    expect(isChannelAccount({ kind: 'mail', provider: 'agent-mail' }, mailChannel)).toBe(true);
  });

  it('does not treat a mailbox mounted through another provider as Agent Mail', () => {
    expect(isChannelAccount({ kind: 'mail', provider: 'user' }, mailChannel)).toBe(false);
  });
});

describe('KIND_ICONS', () => {
  it('covers every persisted kind, retired ones included', () => {
    // An unfiltered list still returns retired-kind rows so their owner can
    // release them; a missing entry would hand `undefined` to `Icon`'s
    // required prop and blank the row out.
    expect(Object.keys(KIND_ICONS).sort()).toEqual([...AGENT_ACCOUNT_PERSISTED_KINDS].sort());
    expect(KIND_ICONS.phone).toBeDefined();
  });
});

describe('isUnchanneledAccount', () => {
  it('leaves a retired-kind account unchanneled instead of claiming a channel', () => {
    expect(isUnchanneledAccount({ kind: 'phone', provider: 'linq' })).toBe(true);
  });
});
