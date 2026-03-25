import { describe, expect, it } from 'vitest';

import { buildPhoneTempEmail, isValidCnPhoneNumber, normalizeCnPhoneNumber } from './phone';

describe('phone utils', () => {
  describe('normalizeCnPhoneNumber', () => {
    it('normalizes mainland phone numbers to +86 format', () => {
      expect(normalizeCnPhoneNumber('13800138000')).toBe('+8613800138000');
      expect(normalizeCnPhoneNumber('+86 138 0013 8000')).toBe('+8613800138000');
      expect(normalizeCnPhoneNumber('  138-0013-8000  ')).toBe('+8613800138000');
    });

    it('returns null for invalid mainland phone numbers', () => {
      expect(normalizeCnPhoneNumber('12345')).toBeNull();
      expect(normalizeCnPhoneNumber('+85251234567')).toBeNull();
    });
  });

  describe('isValidCnPhoneNumber', () => {
    it('returns true only for valid mainland phone numbers', () => {
      expect(isValidCnPhoneNumber('13800138000')).toBe(true);
      expect(isValidCnPhoneNumber('+8613800138000')).toBe(true);
      expect(isValidCnPhoneNumber('10086')).toBe(false);
    });
  });

  describe('buildPhoneTempEmail', () => {
    it('builds a stable temp email from normalized phone number', () => {
      expect(buildPhoneTempEmail('+8613800138000')).toBe('phone-8613800138000@phone.local');
    });
  });
});
