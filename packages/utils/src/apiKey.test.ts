import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  API_KEY_LENGTH,
  API_KEY_PREFIX,
  generateApiKey,
  isApiKeyExpired,
  validateApiKeyFormat,
} from './apiKey';

describe('apiKey', () => {
  describe('generateApiKey', () => {
    it('should generate a 64-character API key with correct format', () => {
      const apiKey = generateApiKey();
      expect(API_KEY_LENGTH).toBe(64);
      expect(apiKey).toHaveLength(64);
      expect(apiKey.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(apiKey.slice(API_KEY_PREFIX.length)).toMatch(/^[\da-z]+$/);
    });
    it('should generate unique API keys', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      // All 100 keys should be unique
      expect(keys.size).toBe(100);
    });

    describe('with a customized prefix', () => {
      const loadWithPrefix = async (prefix: string) => {
        vi.resetModules();
        vi.doMock('@lobechat/business-const', () => ({ API_KEY_PREFIX: prefix }));
        return import('./apiKey');
      };

      afterEach(() => {
        vi.doUnmock('@lobechat/business-const');
        vi.resetModules();
      });

      it('should keep the 64-character total while 32 random characters still fit', async () => {
        const prefix = 'p'.repeat(32);
        const { generateApiKey, validateApiKeyFormat } = await loadWithPrefix(prefix);

        const apiKey = generateApiKey();

        expect(apiKey).toHaveLength(64);
        expect(validateApiKeyFormat(apiKey)).toBe(true);
      });

      it.each([33, 63, 64, 67])(
        'should keep 32 random characters with a %i-character prefix',
        async (prefixLength) => {
          const prefix = 'p'.repeat(prefixLength);
          const { generateApiKey, validateApiKeyFormat } = await loadWithPrefix(prefix);

          const apiKey = generateApiKey();

          expect(apiKey.startsWith(prefix)).toBe(true);
          expect(apiKey.slice(prefix.length)).toMatch(/^[\da-z]{32}$/);
          expect(validateApiKeyFormat(apiKey)).toBe(true);
        },
      );

      it.each([68, 100])(
        'should refuse to issue a key that cannot be stored with a %i-character prefix',
        async (prefixLength) => {
          const { generateApiKey } = await loadWithPrefix('p'.repeat(prefixLength));

          expect(() => generateApiKey()).toThrow(/API_KEY_PREFIX.*at most 67/);
        },
      );

      it.each([
        { prefixCharacters: 18, suffixLength: 45 },
        { prefixCharacters: 22, suffixLength: 33 },
      ])(
        'should fit the storage budget with a $prefixCharacters-character multibyte prefix',
        async ({ prefixCharacters, suffixLength }) => {
          const prefix = '界'.repeat(prefixCharacters);
          const { generateApiKey, validateApiKeyFormat } = await loadWithPrefix(prefix);

          const apiKey = generateApiKey();

          expect(apiKey.slice(prefix.length)).toHaveLength(suffixLength);
          expect(new TextEncoder().encode(apiKey).length).toBeLessThanOrEqual(99);
          expect(validateApiKeyFormat(apiKey)).toBe(true);
        },
      );

      it('should measure the prefix limit in UTF-8 bytes', async () => {
        const { generateApiKey } = await loadWithPrefix('界'.repeat(23));

        expect(() => generateApiKey()).toThrow(/API_KEY_PREFIX.*at most 67 UTF-8 bytes, got 69/);
      });
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
    it('should return true when expiration date is exactly now or just passed', () => {
      const now = new Date();
      now.setSeconds(now.getSeconds() - 1); // 1 second ago
      expect(isApiKeyExpired(now)).toBe(true);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should accept keys with mixed alphanumeric characters', () => {
      const validKey = `${API_KEY_PREFIX}abc123def456789a`;
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });
    it('should keep accepting legacy keys with a 16-character suffix', () => {
      expect(validateApiKeyFormat(`${API_KEY_PREFIX}abc123def456789a`)).toBe(true);
    });
    it('should reject lengths between the legacy and current formats', () => {
      const suffix = 'a'.repeat(API_KEY_LENGTH - API_KEY_PREFIX.length - 1);
      expect(validateApiKeyFormat(`${API_KEY_PREFIX}${suffix}`)).toBe(false);
    });
    it('should reject keys longer than the current format', () => {
      const suffix = 'a'.repeat(API_KEY_LENGTH - API_KEY_PREFIX.length + 1);
      expect(validateApiKeyFormat(`${API_KEY_PREFIX}${suffix}`)).toBe(false);
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
    it('should validate generated keys', () => {
      const generatedKey = generateApiKey();
      expect(validateApiKeyFormat(generatedKey)).toBe(true);
    });
  });
});
