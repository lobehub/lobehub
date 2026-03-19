import { describe, expect, it } from 'vitest';

import { generateApiKey, isApiKeyExpired, validateApiKeyFormat } from './apiKey';

describe('apiKey', () => {
  describe('generateApiKey', () => {
    it('should generate API key with correct format', () => {
      const apiKey = generateApiKey();
      expect(apiKey).toMatch(/^sk-lh-[\da-z]{16}$/);
    });

    it('should generate API key with correct length', () => {
      const apiKey = generateApiKey();
      expect(apiKey).toHaveLength(22); // 'sk-lh-' (6) + 16 characters
    });

    it('should generate unique API keys', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      // All 100 keys should be unique
      expect(keys.size).toBe(100);
    });

    it('should start with lb- prefix', () => {
      const apiKey = generateApiKey();
      expect(apiKey.startsWith('sk-lh-')).toBe(true);
    });

    it('should only contain lowercase alphanumeric characters after prefix', () => {
      const apiKey = generateApiKey();
      const randomPart = apiKey.slice(6); // Remove 'sk-lh-' prefix
      expect(randomPart).toMatch(/^[\da-z]+$/);
    });
  });

  describe('isApiKeyExpired', () => {
    it('should return false when expiresAt is null', () => {
      expect(isApiKeyExpired(null)).toBe(false);
    });

    it('should return false when expiration date is in the future', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1); // 1 year from now
      expect(isApiKeyExpired(futureDate)).toBe(false);
    });

    it('should return true when expiration date is in the past', () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1); // 1 year ago
      expect(isApiKeyExpired(pastDate)).toBe(true);
    });

    it('should return true when expiration date is exactly now or just passed', () => {
      const now = new Date();
      now.setSeconds(now.getSeconds() - 1); // 1 second ago
      expect(isApiKeyExpired(now)).toBe(true);
    });

    it('should handle edge case of expiration date being very close to now', () => {
      const almostNow = new Date();
      almostNow.setMilliseconds(almostNow.getMilliseconds() - 1); // 1ms ago
      expect(isApiKeyExpired(almostNow)).toBe(true);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should validate correct API key format', () => {
      const validKey = 'sk-lh-1234567890abcdef';
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should accept keys with only numbers', () => {
      const validKey = 'sk-lh-1234567890123456';
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should accept keys with only lowercase letters', () => {
      const validKey = 'sk-lh-abcdefabcdefabcd';
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should accept keys with mixed alphanumeric characters', () => {
      const validKey = 'sk-lh-abc123def456789a';
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should reject keys without sk-lh- prefix', () => {
      const invalidKey = '1234567890abcdef';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with wrong prefix', () => {
      const invalidKey = 'lb-1234567890abcdef';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys that are too short', () => {
      const invalidKey = 'sk-lh-123456789abcde';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys that are too long', () => {
      const invalidKey = 'sk-lh-1234567890abcdef0';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with uppercase letters', () => {
      const invalidKey = 'sk-lh-1234567890ABCDEF';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with special characters', () => {
      const invalidKey = 'sk-lh-1234567890abcd-f';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateApiKeyFormat('')).toBe(false);
    });

    it('should reject keys with spaces', () => {
      const invalidKey = 'sk-lh-1234567890abcd f';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should validate generated keys', () => {
      const generatedKey = generateApiKey();
      expect(validateApiKeyFormat(generatedKey)).toBe(true);
    });
  });
});
