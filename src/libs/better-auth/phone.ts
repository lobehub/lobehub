/**
 * Iranian mobile helpers for Better Auth phoneNumber plugin.
 * Stored / exchanged as E.164 (`+989xxxxxxxxx`).
 *
 * Phone verify is used for **trial activation**, not as a login gate.
 * Redirect users here when they try to claim trial credits.
 */

const IR_MOBILE_E164 = /^\+989\d{9}$/;
const IR_MOBILE_LOCAL = /^0?9\d{9}$/;

/** Strip spaces / dashes / invisible chars. */
export const stripPhoneNoise = (value: string): string => value.replaceAll(/[\s\-()]/g, '').trim();

/**
 * Normalize Iranian mobiles to E.164. Returns null when the number is not a
 * plausible IR mobile (rejects landlines / foreign numbers for Phase 1).
 */
export const normalizeIranianPhoneNumber = (raw: string): string | null => {
  const cleaned = stripPhoneNoise(raw);
  if (!cleaned) return null;

  if (IR_MOBILE_E164.test(cleaned)) return cleaned;

  // +98 9xxxxxxxxx (with optional spaces already stripped)
  if (/^\+98/.test(cleaned)) {
    const digits = cleaned.slice(1);
    if (/^989\d{9}$/.test(digits)) return `+${digits}`;
    return null;
  }

  // 09xxxxxxxxx or 9xxxxxxxxx
  const digits = cleaned.replaceAll(/\D/g, '');
  if (IR_MOBILE_LOCAL.test(digits)) {
    const national = digits.startsWith('0') ? digits.slice(1) : digits;
    return `+98${national}`;
  }

  return null;
};

export const isValidIranianPhoneNumber = (raw: string): boolean =>
  normalizeIranianPhoneNumber(raw) !== null;

/**
 * True when a stored display name is just a phone number (legacy phone-signup
 * temp names). Used so onboarding does not prefill "What's your name?" with it.
 */
export const isPhoneLikeDisplayName = (value: string | null | undefined): boolean => {
  if (!value?.trim()) return false;
  if (normalizeIranianPhoneNumber(value) !== null) return true;
  // Broader digit-only / E.164 shapes from older or non-IR temp names
  const digits = stripPhoneNoise(value).replaceAll(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s\-()]+$/.test(value.trim());
};

/** Seed for onboarding name input — empty when the stored name is phone-like. */
export const resolveOnboardingFullNameSeed = (existing: string | null | undefined): string =>
  existing && !isPhoneLikeDisplayName(existing) ? existing : '';

/**
 * URL for the trial phone-verify step. Call this when the user tries to
 * activate trial credits — not after every login.
 */
export const buildPhoneVerifyRedirectUrl = (callbackUrl?: string | null): string => {
  const target =
    callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//') ? callbackUrl : '/';
  if (target.startsWith('/verify-phone')) return target;
  return `/verify-phone?callbackUrl=${encodeURIComponent(target)}`;
};

/** Alias — makes call sites for trial activation explicit. */
export const buildTrialPhoneVerifyUrl = buildPhoneVerifyRedirectUrl;
