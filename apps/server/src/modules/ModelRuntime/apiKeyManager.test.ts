// @vitest-environment node
import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeyManager } from './apiKeyManager';

function generateKeys(count: number = 1) {
  return Array.from({ length: count })
    .fill('')
    .map(() => {
      return `sk-${nanoid()}`;
    })
    .join(',');
}

// Stub the global process object to safely mock environment variables
vi.stubGlobal('process', {
  ...process, // Preserve the original process object
  env: { ...process.env }, // Clone the environment variables object for modification
});

describe('apiKeyManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('API Key unset or empty', () => {
    it('should return an empty string when API_KEY_SELECT_MODE is unset', () => {
      const apiKeyManager = new ApiKeyManager();

      expect(apiKeyManager.pick('')).toBe('');
      expect(apiKeyManager.pick()).toBe('');
    });

    it('should return an empty string when API_KEY_SELECT_MODE is "random"', () => {
      process.env.API_KEY_SELECT_MODE = 'random';
      const apiKeyManager = new ApiKeyManager();

      expect(apiKeyManager.pick('')).toBe('');
      expect(apiKeyManager.pick()).toBe('');
    });

    it('should return an empty string when API_KEY_SELECT_MODE is "turn"', () => {
      process.env.API_KEY_SELECT_MODE = 'turn';
      const apiKeyManager = new ApiKeyManager();

      expect(apiKeyManager.pick('')).toBe('');
      expect(apiKeyManager.pick()).toBe('');
    });
  });

  describe('single API Key', () => {
    it('should return the only API Key when API_KEY_SELECT_MODE is unset', () => {
      const apiKeyManager = new ApiKeyManager();
      const apiKeyStr = generateKeys(1);

      expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeyStr);
    });

    it('should return the only API when API_KEY_SELECT_MODE is "random"', () => {
      process.env.API_KEY_SELECT_MODE = 'random';
      const apiKeyStr = generateKeys(1);
      const apiKeyManager = new ApiKeyManager();

      expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeyStr);
      // multiple
      expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeyStr);
      expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeyStr);
    });

    it('should return the only API when API_KEY_SELECT_MODE is "turn"', () => {
      process.env.API_KEY_SELECT_MODE = 'turn';
      const apiKeyStr = generateKeys(1);
      const apiKeyManager = new ApiKeyManager();

      expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeyStr);
      // multiple
      expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeyStr);
    });
  });

  describe('multiple API Keys', () => {
    it('should return a random API Key when API_KEY_SELECT_MODE is unset', () => {
      const apiKeyStr = generateKeys(5);
      const apiKeys = apiKeyStr.split(',');
      const apiKeyManager = new ApiKeyManager();
      const keyLen = apiKeys.length * 2; // multiple round

      for (let i = 0; i < keyLen; i++) {
        expect(apiKeys).toContain(apiKeyManager.pick(apiKeyStr));
      }
    });

    it('should return a random API Key when environment variable of API_KEY_SELECT_MODE is "random"', () => {
      process.env.API_KEY_SELECT_MODE = 'random';
      const apiKeyStr = generateKeys(5);
      const apiKeys = apiKeyStr.split(',');
      const apiKeyManager = new ApiKeyManager();
      const keyLen = apiKeys.length * 2; // multiple round

      for (let i = 0; i < keyLen; i++) {
        expect(apiKeys).toContain(apiKeyManager.pick(apiKeyStr));
      }
    });

    it('should return API Keys sequentially when environment variable of API_KEY_SELECT_MODE is "turn"', () => {
      process.env.API_KEY_SELECT_MODE = 'turn';
      const apiKeyStr = generateKeys(5);
      const apiKeys = apiKeyStr.split(',');
      const apiKeyManager = new ApiKeyManager();

      const total = apiKeys.length;
      const rounds = total * 2;
      for (let i = 0; i < total; i++) {
        expect(apiKeyManager.pick(apiKeyStr)).toBe(apiKeys[i % total]);
      }
    });

    it('should return a random API Key when API_KEY_SELECT_MODE is anything other than "random" or "turn"', () => {
      process.env.API_KEY_SELECT_MODE = nanoid();
      const apiKeyStr = generateKeys(5);
      const apiKeys = apiKeyStr.split(',');
      const apiKeyManager = new ApiKeyManager();
      const keyLen = apiKeys.length * 2; // multiple round

      for (let i = 0; i < keyLen; i++) {
        expect(apiKeys).toContain(apiKeyManager.pick(apiKeyStr));
      }
    });
  });
});
