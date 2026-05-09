import { describe, expect, it } from 'vitest';

import { isTelegramRebindBlocked, shouldShowTelegramSuccess } from './telegramState';

describe('telegramState', () => {
  it('treats the same Telegram account as already linked', () => {
    const existingLink = { platform: 'telegram', platformUserId: 'tg-1' };
    const tokenData = { platform: 'telegram' as const, platformUserId: 'tg-1' };

    expect(isTelegramRebindBlocked(existingLink, tokenData)).toBe(false);
    expect(shouldShowTelegramSuccess(existingLink, tokenData, false)).toBe(true);
  });

  it('blocks relinking when the current user is already bound to another Telegram account', () => {
    const existingLink = {
      platform: 'telegram',
      platformUserId: 'tg-old',
      platformUsername: '@old',
    };
    const tokenData = { platform: 'telegram' as const, platformUserId: 'tg-new' };

    expect(isTelegramRebindBlocked(existingLink, tokenData)).toBe(true);
    expect(shouldShowTelegramSuccess(existingLink, tokenData, false)).toBe(false);
  });

  it('keeps the refresh success fallback when the token is already gone', () => {
    const existingLink = { platform: 'telegram', platformUserId: 'tg-1' };

    expect(shouldShowTelegramSuccess(existingLink, null, false)).toBe(true);
  });
});
