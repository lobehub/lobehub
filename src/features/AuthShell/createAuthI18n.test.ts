import { describe, expect, it } from 'vitest';

import { createAuthI18n } from './createAuthI18n';

describe('createAuthI18n', () => {
  it.each([
    [
      'en-US',
      'This email is still in the account deletion cooldown period. You can sign up again in about 4 days.',
    ],
    ['zh-CN', '该邮箱仍在账号注销冷却期，预计 4 天后可重新注册。'],
  ])('loads the deleted-account retry copy for %s', async (locale, expected) => {
    const { init, instance } = createAuthI18n(locale);

    await init({ initAsync: false });
    await instance.loadNamespaces('authError');

    expect(
      instance.t('codes.DELETED_ACCOUNT_EMAIL_WITH_RETRY_AFTER_DAYS', {
        count: 4,
        ns: 'authError',
      }),
    ).toBe(expected);
  });
});
