/**
 * Iranian mobile helpers for Better Auth phoneNumber plugin.
 * Stored / exchanged as E.164 (`+989xxxxxxxxx`).
 *
 * UI should collect local form `09121234567` (no country selector).
 * Server accepts Persian/Arabic-Indic digits, `09…`, `+989…`, and bare `989…`.
 */

const IR_MOBILE_E164 = /^\+989\d{9}$/;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Map Eastern digits → ASCII 0-9. */
export const toAsciiDigits = (value: string): string =>
  value.replaceAll(/[\u06F0-\u06F9\u0660-\u0669]/g, (ch) => {
    const persian = PERSIAN_DIGITS.indexOf(ch);
    if (persian >= 0) return String(persian);
    const arabic = ARABIC_INDIC_DIGITS.indexOf(ch);
    return arabic >= 0 ? String(arabic) : ch;
  });

/** Strip spaces / dashes / invisible chars after digit transliteration. */
export const stripPhoneNoise = (value: string): string =>
  toAsciiDigits(value)
    .replaceAll(/[\s\-()]/g, '')
    .trim();

/**
 * Normalize Iranian mobiles to E.164. Returns null when the number is not a
 * plausible IR mobile (rejects landlines / foreign numbers).
 */
export const normalizeIranianPhoneNumber = (raw: string): string | null => {
  const cleaned = stripPhoneNoise(raw);
  if (!cleaned) return null;

  if (IR_MOBILE_E164.test(cleaned)) return cleaned;

  // +98 9xxxxxxxxx
  if (/^\+98/.test(cleaned)) {
    const digits = cleaned.slice(1);
    if (/^989\d{9}$/.test(digits)) return `+${digits}`;
    return null;
  }

  // bare country-code without plus: 989xxxxxxxxx
  if (/^989\d{9}$/.test(cleaned)) return `+${cleaned}`;

  // 09xxxxxxxxx or 9xxxxxxxxx
  const digits = cleaned.replaceAll(/\D/g, '');
  if (/^0?9\d{9}$/.test(digits)) {
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
  const digits = stripPhoneNoise(value).replaceAll(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s\-()]+$/.test(value.trim());
};

/** Seed for onboarding name input — empty when the stored name is phone-like. */
export const resolveOnboardingFullNameSeed = (existing: string | null | undefined): string =>
  existing && !isPhoneLikeDisplayName(existing) ? existing : '';

export const buildPhoneVerifyRedirectUrl = (callbackUrl?: string | null): string => {
  const target =
    callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//') ? callbackUrl : '/';
  if (target.startsWith('/verify-phone')) return target;
  return `/verify-phone?callbackUrl=${encodeURIComponent(target)}`;
};

export const buildTrialPhoneVerifyUrl = buildPhoneVerifyRedirectUrl;

/** Display E.164 Iranian mobiles as local `09…` form in UI copy. */
export const formatIranianPhoneForDisplay = (e164: string | null | undefined): string => {
  if (!e164) return '';
  const normalized = normalizeIranianPhoneNumber(e164);
  if (!normalized) return e164;
  return `0${normalized.slice(3)}`;
};
