import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  type StoredCredentials,
} from './credentials';

// Use a fixed temp path to avoid hoisting issues with vi.mock
const tmpDir = path.join(os.tmpdir(), 'lobehub-cli-test-creds');
const credentialsDir = path.join(tmpDir, '.lobehub');
const credentialsFile = path.join(credentialsDir, 'credentials.json');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual['default'],
      homedir: () => path.join(os.tmpdir(), 'lobehub-cli-test-creds'),
    },
  };
});

describe('credentials', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  const testCredentials: StoredCredentials = {
    accessToken: 'test-access-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshToken: 'test-refresh-token',
  };

  describe('saveCredentials + loadCredentials', () => {
    it('should save and load credentials successfully', () => {
      saveCredentials(testCredentials);

      const loaded = loadCredentials();

      expect(loaded).toEqual(testCredentials);
    });

    it('should create directory with correct permissions', () => {
      saveCredentials(testCredentials);

      expect(fs.existsSync(credentialsDir)).toBe(true);
    });

    it('should encrypt the credentials file', () => {
      saveCredentials(testCredentials);

      const raw = fs.readFileSync(credentialsFile, 'utf8');

      // Should not be plain JSON
      expect(() => JSON.parse(raw)).toThrow();

      // Should be base64
      expect(Buffer.from(raw, 'base64').length).toBeGreaterThan(0);
    });

    it('should handle credentials without optional fields', () => {
      const minimal: StoredCredentials = {
        accessToken: 'tok',
      };

      saveCredentials(minimal);
      const loaded = loadCredentials();

      expect(loaded).toEqual(minimal);
    });
  });

  describe('loadCredentials', () => {
    it('should return null when no credentials file exists', () => {
      const result = loadCredentials();

      expect(result).toBeNull();
    });

    it('should handle legacy plaintext JSON and re-encrypt', () => {
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(credentialsFile, JSON.stringify(testCredentials));

      const loaded = loadCredentials();

      expect(loaded).toEqual(testCredentials);

      // Should have been re-encrypted
      const raw = fs.readFileSync(credentialsFile, 'utf8');
      expect(() => JSON.parse(raw)).toThrow();
    });

    it('should return null for corrupted file', () => {
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(credentialsFile, 'not-valid-base64-or-json!!!');

      const result = loadCredentials();

      expect(result).toBeNull();
    });
  });

  describe('clearCredentials', () => {
    it('should remove credentials file and return true', () => {
      saveCredentials(testCredentials);

      const result = clearCredentials();

      expect(result).toBe(true);
      expect(fs.existsSync(credentialsFile)).toBe(false);
    });

    it('should return false when no file exists', () => {
      const result = clearCredentials();

      expect(result).toBe(false);
    });
  });
});
