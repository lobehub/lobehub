import { describe, expect, it } from 'vitest';

import { createAuthI18n } from './createAuthI18n';

describe('createAuthI18n', () => {
  it.each([
    [
      'en-US',
      'This email belongs to a recently deleted account and can be used again in about 4 days. To sign up now, use a different email.',
    ],
    ['zh-CN', '该邮箱属于刚注销的账号，约 4 天后才能再次使用。如需现在注册，请换一个邮箱。'],
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
