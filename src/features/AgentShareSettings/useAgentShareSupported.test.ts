import { describe, expect, it } from 'vitest';

import { resolveLinkToggleState } from './useAgentShareSupported';

describe('resolveLinkToggleState', () => {
  it('allows publishing when the account has the capability', () => {
    expect(resolveLinkToggleState({ isShared: false, publishable: true })).toEqual({
      canPublish: true,
      disabled: false,
      offHintKey: 'share.settings.link.offHint',
    });
  });

  it('blocks publishing and explains why when the account may not publish', () => {
    expect(resolveLinkToggleState({ isShared: false, publishable: false })).toEqual({
      canPublish: false,
      disabled: true,
      offHintKey: 'share.settings.link.publishDisabled',
    });
  });

  // The regression this gate exists for: an owner rolled back out of the
  // rollout must still be able to revoke a share they already published, which
  // is why the server keeps `agentShare.disable` open while the flag is off.
  it('keeps an already published share togglable when publishing is blocked', () => {
    const state = resolveLinkToggleState({ isShared: true, publishable: false });

    expect(state.disabled).toBe(false);
    expect(state.canPublish).toBe(true);
  });
});
