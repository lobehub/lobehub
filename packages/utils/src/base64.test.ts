import { describe, expect, it, vi } from 'vitest';

import { createBasicAuthCredentials, decodeFromBase64, encodeToBase64 } from './base64';

describe('base64 utilities', () => {
  describe('encodeToBase64', () => {
    it('should encode string to base64 in browser environment', () => {
      // Mock browser environment
      global.btoa = vi
        .fn()
        .mockImplementation((input) => Buffer.from(input, 'utf8').toString('base64'));

      const result = encodeToBase64('test');

      expect(global.btoa).toHaveBeenCalledWith('test');
      expect(result).toBe('dGVzdA==');
    });

    it('should encode string to base64 in Node.js environment', () => {
      // Mock Node.js environment by removing btoa
      const originalBtoa = global.btoa;
      // @ts-ignore
      delete global.btoa;

      const result = encodeToBase64('test');

      expect(result).toBe('dGVzdA==');

      // Restore btoa
      global.btoa = originalBtoa;
    });

    it('should handle special characters', () => {
      const input = 'test@123:password';
      const result = encodeToBase64(input);

      // Expected base64 for 'test@123:password' is 'dGVzdEAxMjM6cGFzc3dvcmQ='
      expect(result).toBe(Buffer.from(input, 'utf8').toString('base64'));
    });
  });

  describe('decodeFromBase64', () => {
    it('should decode base64 string in browser environment', () => {
      // Mock browser environment
      global.atob = vi
        .fn()
        .mockImplementation((input) => Buffer.from(input, 'base64').toString('utf8'));

      const result = decodeFromBase64('dGVzdA==');

      expect(global.atob).toHaveBeenCalledWith('dGVzdA==');
      expect(result).toBe('test');
    });

    it('should decode base64 string in Node.js environment', () => {
      // Mock Node.js environment by removing atob
      const originalAtob = global.atob;
      // @ts-ignore
      delete global.atob;

      const result = decodeFromBase64('dGVzdA==');

      expect(result).toBe('test');

      // Restore atob
      global.atob = originalAtob;
    });
  });

  describe('createBasicAuthCredentials', () => {
    it('should create basic auth credentials', () => {
      const username = 'testuser';
      const password = 'testpass';

      const result = createBasicAuthCredentials(username, password);

      // Expected base64 for 'testuser:testpass' is 'dGVzdHVzZXI6dGVzdHBhc3M='
      expect(result).toBe('dGVzdHVzZXI6dGVzdHBhc3M=');
    });

    it('should handle special characters in credentials', () => {
      const username = 'user@domain.com';
      const password = 'p@ss:w0rd!';

      const result = createBasicAuthCredentials(username, password);
      const decoded = decodeFromBase64(result);

      expect(decoded).toBe('user@domain.com:p@ss:w0rd!');
    });

    it('should handle empty credentials', () => {
      const result = createBasicAuthCredentials('', '');
      const decoded = decodeFromBase64(result);

      expect(decoded).toBe(':');
    });
  });

  describe('round-trip encoding/decoding', () => {
    it('should preserve data through encode/decode cycle', () => {
      const testStrings = [
        'simple text',
        'test@123:password',
        '中文测试',
        'user:pass',
        'special!@#$%^&*()chars',
        '',
      ];

      testStrings.forEach((input) => {
        const encoded = encodeToBase64(input);
        const decoded = decodeFromBase64(encoded);
        expect(decoded).toBe(input);
      });
    });
  });
});
