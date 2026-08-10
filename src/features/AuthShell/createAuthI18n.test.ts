import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthI18n, loadAuthNamespace } from './createAuthI18n';

describe('loadAuthNamespace', () => {
  it('loads Persian auth copy instead of English fallback', async () => {
    const resources = await loadAuthNamespace('fa-IR', 'auth');

    expect(resources['betterAuth.signin.phone.title']).toBe('ورود با موبایل');
    expect(resources['betterAuth.signin.continueWithPhone']).toBe('ادامه با موبایل');
    expect(resources['betterAuth.verifyPhone.otp.submit']).toBe('تأیید');
  });

  it('still loads Chinese auth copy', async () => {
    const resources = await loadAuthNamespace('zh-CN', 'auth');

    expect(resources['betterAuth.signin.submit']).toBeTruthy();
    expect(resources['betterAuth.signin.submit']).not.toBe('Sign in');
  });

  it('loads French auth copy for visible fr-FR locale', async () => {
    const resources = await loadAuthNamespace('fr-FR', 'auth');

    expect(resources['betterAuth.signin.submit']).toBeTruthy();
    expect(resources['betterAuth.signin.submit']).not.toBe('Sign in');
  });
});

describe('createAuthI18n', () => {
  beforeEach(() => {
    // each test gets a fresh instance via createAuthI18n
  });

  it('switches login phone strings to Persian after changeLanguage without manual reload', async () => {
    const { init, instance } = createAuthI18n('en-US');
    await init({ initAsync: false });

    // languageChanged reload for en-US is async — wait for English store
    await vi.waitFor(() => {
      expect(instance.t('betterAuth.signin.phone.title', { ns: 'auth' })).toBe(
        'Sign in with phone',
      );
    });

    await instance.changeLanguage('fa-IR');

    await vi.waitFor(() => {
      expect(instance.t('betterAuth.signin.phone.title', { ns: 'auth' })).toBe('ورود با موبایل');
    });
    expect(instance.t('betterAuth.signin.phone.sendCode', { ns: 'auth' })).toBe('ارسال کد');
  });

  it('boots with Persian when document lang is already fa-IR', async () => {
    const { init, instance } = createAuthI18n('fa-IR');
    await init({ initAsync: false });

    expect(instance.t('betterAuth.verifyPhone.title', { ns: 'auth' })).toBe(
      'فعال‌سازی دوره آزمایشی — تأیید موبایل',
    );
  });

  it('normalizes bare fa to fa-IR on boot', async () => {
    const { init, instance } = createAuthI18n('fa');
    await init({ initAsync: false });

    expect(instance.language).toBe('fa-IR');
    expect(instance.t('betterAuth.signin.phone.title', { ns: 'auth' })).toBe('ورود با موبایل');
  });
});
