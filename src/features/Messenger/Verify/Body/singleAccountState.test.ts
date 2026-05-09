import { describe, expect, it } from 'vitest';

import { isSingleAccountRebindBlocked, shouldShowSingleAccountSuccess } from './singleAccountState';

describe('singleAccountState', () => {
  it('treats the same platform account as already linked', () => {
    const existingLink = { platform: 'telegram', platformUserId: 'tg-1' };
    const tokenData = { platform: 'telegram' as const, platformUserId: 'tg-1' };

    expect(isSingleAccountRebindBlocked(existingLink, tokenData)).toBe(false);
    expect(shouldShowSingleAccountSuccess(existingLink, tokenData, false)).toBe(true);
  });

  it('blocks relinking when the current user is already bound to another platform account', () => {
    const existingLink = {
      platform: 'discord',
      platformUserId: 'dc-old',
      platformUsername: '@old',
    };
    const tokenData = { platform: 'discord' as const, platformUserId: 'dc-new' };

    expect(isSingleAccountRebindBlocked(existingLink, tokenData)).toBe(true);
    expect(shouldShowSingleAccountSuccess(existingLink, tokenData, false)).toBe(false);
  });

  it('keeps the refresh success fallback when the token is already gone', () => {
    const existingLink = { platform: 'telegram', platformUserId: 'tg-1' };

    expect(shouldShowSingleAccountSuccess(existingLink, null, false)).toBe(true);
  });
});
