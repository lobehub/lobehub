import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Hash a phone OTP the same way Better Auth hashes email OTPs (SHA-256 → base64url).
 * Phone plugin has no `storeOTP` option, so we hash at rest ourselves (DATA-001).
 */
export const hashPhoneOtp = (otp: string): string =>
  createHash('sha256').update(otp, 'utf8').digest('base64url');

export const phoneOtpEquals = (plainOtp: string, storedHash: string): boolean => {
  const hashed = Buffer.from(hashPhoneOtp(plainOtp), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (hashed.length !== stored.length) return false;
  return timingSafeEqual(hashed, stored);
};

/** Plain digit OTP optionally followed by `:attempts` (Better Auth phone format). */
export const isPlainPhoneOtpValue = (value: string): boolean => /^\d{4,10}(?::\d+)?$/.test(value);

/**
 * Rewrite a phone verification `value` so the OTP digits are hashed.
 * Leaves already-hashed / non-OTP values unchanged.
 */
export const hashPhoneOtpVerificationValue = (value: string): string => {
  if (!isPlainPhoneOtpValue(value)) return value;
  const colon = value.lastIndexOf(':');
  if (colon === -1) return hashPhoneOtp(value);
  const otp = value.slice(0, colon);
  const attempts = value.slice(colon + 1);
  return `${hashPhoneOtp(otp)}:${attempts}`;
};
