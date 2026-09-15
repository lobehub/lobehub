import { describe, expect, it } from 'vitest';

import { API_KEY_PREFIX, generateApiKey, isApiKeyExpired, validateApiKeyFormat } from './apiKey';

describe('apiKey', () => {
  describe('generateApiKey', () => {
    it('should generate API key with correct format', () => {
      const apiKey = generateApiKey();
      expect(apiKey.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(apiKey.slice(API_KEY_PREFIX.length)).toMatch(/^[\da-z]{16}$/);
    });

    it('should generate API key with correct length', () => {
      const apiKey = generateApiKey();
      expect(apiKey).toHaveLength(API_KEY_PREFIX.length + 16);
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
      expect(apiKey.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it('should only contain lowercase alphanumeric characters after prefix', () => {
      const apiKey = generateApiKey();
      const randomPart = apiKey.slice(API_KEY_PREFIX.length);
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
      const validKey = `${API_KEY_PREFIX}1234567890abcdef`;
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should accept keys with only numbers', () => {
      const validKey = `${API_KEY_PREFIX}1234567890123456`;
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should accept keys with only lowercase letters', () => {
      const validKey = `${API_KEY_PREFIX}abcdefabcdefabcd`;
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should accept keys with mixed alphanumeric characters', () => {
      const validKey = `${API_KEY_PREFIX}abc123def456789a`;
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should reject keys without the configured prefix', () => {
      const invalidKey = '1234567890abcdef';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with wrong prefix', () => {
      const invalidKey = 'lb-1234567890abcdef';
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys that are too short', () => {
      const invalidKey = `${API_KEY_PREFIX}123456789abcde`;
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys that are too long', () => {
      const invalidKey = `${API_KEY_PREFIX}1234567890abcdef0`;
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with uppercase letters', () => {
      const invalidKey = `${API_KEY_PREFIX}1234567890ABCDEF`;
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject keys with special characters', () => {
      const invalidKey = `${API_KEY_PREFIX}1234567890abcd-f`;
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateApiKeyFormat('')).toBe(false);
    });

    it('should reject keys with spaces', () => {
      const invalidKey = `${API_KEY_PREFIX}1234567890abcd f`;
      expect(validateApiKeyFormat(invalidKey)).toBe(false);
    });

    it('should validate generated keys', () => {
      const generatedKey = generateApiKey();
      expect(validateApiKeyFormat(generatedKey)).toBe(true);
    });
  });
});
