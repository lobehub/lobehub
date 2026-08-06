import {
  buildPhoneVerifyRedirectUrl,
  formatIranianPhoneForDisplay,
  isPhoneLikeDisplayName,
  isValidIranianPhoneNumber,
  normalizeIranianPhoneNumber,
  resolveOnboardingFullNameSeed,
} from './phone';

describe('normalizeIranianPhoneNumber', () => {
  it('accepts E.164 +989…', () => {
    expect(normalizeIranianPhoneNumber('+989121234567')).toBe('+989121234567');
  });

  it('normalizes local 09… and 9…', () => {
    expect(normalizeIranianPhoneNumber('09121234567')).toBe('+989121234567');
    expect(normalizeIranianPhoneNumber('9121234567')).toBe('+989121234567');
  });

  it('strips spaces and dashes', () => {
    expect(normalizeIranianPhoneNumber('0912 123-4567')).toBe('+989121234567');
  });

  it('rejects landlines and foreign numbers', () => {
    expect(normalizeIranianPhoneNumber('02112345678')).toBeNull();
    expect(normalizeIranianPhoneNumber('+14155552671')).toBeNull();
    expect(normalizeIranianPhoneNumber('')).toBeNull();
  });
});

describe('isValidIranianPhoneNumber', () => {
  it('mirrors normalize success', () => {
    expect(isValidIranianPhoneNumber('09121234567')).toBe(true);
    expect(isValidIranianPhoneNumber('abc')).toBe(false);
  });
});

describe('isPhoneLikeDisplayName / resolveOnboardingFullNameSeed', () => {
  it('treats IR mobiles as phone-like so the name step stays empty', () => {
    expect(isPhoneLikeDisplayName('+989121234567')).toBe(true);
    expect(isPhoneLikeDisplayName('09121234567')).toBe(true);
    expect(resolveOnboardingFullNameSeed('+989121234567')).toBe('');
  });

  it('keeps real names', () => {
    expect(isPhoneLikeDisplayName('Sara')).toBe(false);
    expect(resolveOnboardingFullNameSeed('Sara')).toBe('Sara');
  });

  it('treats empty as empty seed', () => {
    expect(resolveOnboardingFullNameSeed('')).toBe('');
    expect(resolveOnboardingFullNameSeed(undefined)).toBe('');
  });
});

describe('buildPhoneVerifyRedirectUrl', () => {
  it('threads a safe callbackUrl', () => {
    expect(buildPhoneVerifyRedirectUrl('/onboarding')).toBe(
      '/verify-phone?callbackUrl=%2Fonboarding',
    );
  });

  it('falls back to / for unsafe targets', () => {
    expect(buildPhoneVerifyRedirectUrl('https://evil.com')).toBe('/verify-phone?callbackUrl=%2F');
  });

  it('is idempotent when already on verify-phone', () => {
    expect(buildPhoneVerifyRedirectUrl('/verify-phone?callbackUrl=%2F')).toBe(
      '/verify-phone?callbackUrl=%2F',
    );
  });
});

describe('formatIranianPhoneForDisplay', () => {
  it('converts E.164 to local 09… form', () => {
    expect(formatIranianPhoneForDisplay('+989121234567')).toBe('09121234567');
  });

  it('returns empty for missing input', () => {
    expect(formatIranianPhoneForDisplay(null)).toBe('');
    expect(formatIranianPhoneForDisplay(undefined)).toBe('');
  });
});
