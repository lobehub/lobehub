import { describe, expect, it } from 'vitest';

import { toAicoSessionUser } from './session-user';

describe('toAicoSessionUser', () => {
  it('returns null for missing user', () => {
    expect(toAicoSessionUser(null)).toBeNull();
    expect(toAicoSessionUser(undefined)).toBeNull();
  });

  it('maps Better Auth session user onto the Aico contract', () => {
    expect(
      toAicoSessionUser({
        email: 'a@b.com',
        emailVerified: true,
        id: 'user_1',
        image: 'https://cdn/x.png',
        name: 'Ali',
        phoneNumber: '+989121234567',
        phoneNumberVerified: true,
      }),
    ).toEqual({
      email: 'a@b.com',
      emailVerified: true,
      id: 'user_1',
      image: 'https://cdn/x.png',
      name: 'Ali',
      phoneNumber: '+989121234567',
      phoneNumberVerified: true,
    });
  });

  it('coerces missing optional fields to null / false', () => {
    expect(toAicoSessionUser({ id: 'user_1' })).toEqual({
      email: null,
      emailVerified: false,
      id: 'user_1',
      image: null,
      name: null,
      phoneNumber: null,
      phoneNumberVerified: false,
    });
  });

  it('normalizes empty / whitespace name from phone OTP temp signup to null', () => {
    expect(toAicoSessionUser({ id: 'user_1', name: '' })?.name).toBeNull();
    expect(toAicoSessionUser({ id: 'user_1', name: '   ' })?.name).toBeNull();
  });
});
