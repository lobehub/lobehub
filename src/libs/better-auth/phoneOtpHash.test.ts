import { describe, expect, it } from 'vitest';

import {
  hashPhoneOtp,
  hashPhoneOtpVerificationValue,
  isPlainPhoneOtpValue,
  phoneOtpEquals,
} from './phoneOtpHash';

describe('phoneOtpHash (DATA-001)', () => {
  it('detects plain digit OTP values with optional attempts', () => {
    expect(isPlainPhoneOtpValue('123456')).toBe(true);
    expect(isPlainPhoneOtpValue('123456:0')).toBe(true);
    expect(isPlainPhoneOtpValue('123456:2')).toBe(true);
    expect(isPlainPhoneOtpValue('not-an-otp')).toBe(false);
    expect(isPlainPhoneOtpValue(hashPhoneOtp('123456'))).toBe(false);
  });

  it('hashes OTP while preserving attempt counters', () => {
    const hashed = hashPhoneOtpVerificationValue('654321:1');
    expect(hashed.endsWith(':1')).toBe(true);
    expect(hashed.startsWith('654321')).toBe(false);
    expect(phoneOtpEquals('654321', hashed.slice(0, hashed.lastIndexOf(':')))).toBe(true);
    expect(phoneOtpEquals('000000', hashed.slice(0, hashed.lastIndexOf(':')))).toBe(false);
  });

  it('is idempotent for already-hashed values', () => {
    const once = hashPhoneOtpVerificationValue('111222:0');
    expect(hashPhoneOtpVerificationValue(once)).toBe(once);
  });
});
