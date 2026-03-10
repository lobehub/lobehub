import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked module
import { authEnv } from '@/envs/auth';

import { isEmailAllowed } from './email-whitelist';

// Mock authEnv
vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_ALLOWED_EMAILS: undefined as string | undefined,
  },
}));

describe('isEmailAllowed', () => {
  beforeEach(() => {
    // Reset to undefined before each test
    (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS = undefined;
  });

  describe('when whitelist is empty', () => {
    it('should allow all emails when AUTH_ALLOWED_EMAILS is undefined', () => {
      expect(isEmailAllowed('anyone@example.com')).toBe(true);
    });

    it('should allow all emails when AUTH_ALLOWED_EMAILS is empty string', () => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS = '';
      expect(isEmailAllowed('anyone@example.com')).toBe(true);
    });
  });

  describe('domain matching', () => {
    beforeEach(() => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS =
        'example.com,company.org';
    });

    it('should allow email from whitelisted domain', () => {
      expect(isEmailAllowed('user@example.com')).toBe(true);
      expect(isEmailAllowed('admin@company.org')).toBe(true);
    });

    it('should reject email from non-whitelisted domain', () => {
      expect(isEmailAllowed('user@other.com')).toBe(false);
    });

    it('should be case-sensitive for domain', () => {
      expect(isEmailAllowed('user@Example.com')).toBe(false);
      expect(isEmailAllowed('user@EXAMPLE.COM')).toBe(false);
    });
  });

  describe('exact email matching', () => {
    beforeEach(() => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS =
        'admin@special.com,vip@other.com';
    });

    it('should allow exact email match', () => {
      expect(isEmailAllowed('admin@special.com')).toBe(true);
      expect(isEmailAllowed('vip@other.com')).toBe(true);
    });

    it('should reject different email at same domain', () => {
      expect(isEmailAllowed('user@special.com')).toBe(false);
    });

    it('should be case-sensitive for email', () => {
      expect(isEmailAllowed('Admin@special.com')).toBe(false);
    });
  });

  describe('mixed domain and email matching', () => {
    beforeEach(() => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS =
        'example.com,admin@other.com';
    });

    it('should allow any email from whitelisted domain', () => {
      expect(isEmailAllowed('anyone@example.com')).toBe(true);
    });

    it('should allow specific whitelisted email', () => {
      expect(isEmailAllowed('admin@other.com')).toBe(true);
    });

    it('should reject non-whitelisted email from non-whitelisted domain', () => {
      expect(isEmailAllowed('user@other.com')).toBe(false);
    });
  });

  describe('whitespace handling', () => {
    it('should trim whitespace from whitelist entries', () => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS =
        ' example.com , admin@other.com ';
      expect(isEmailAllowed('user@example.com')).toBe(true);
      expect(isEmailAllowed('admin@other.com')).toBe(true);
    });

    it('should filter empty entries', () => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS =
        'example.com,,other.com';
      expect(isEmailAllowed('user@example.com')).toBe(true);
      expect(isEmailAllowed('user@other.com')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should reject malformed email without @', () => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS = 'example.com';
      expect(isEmailAllowed('invalid-email')).toBe(false);
    });

    it('should handle email with multiple @ symbols', () => {
      (authEnv as { AUTH_ALLOWED_EMAILS: string | undefined }).AUTH_ALLOWED_EMAILS = 'example.com';
      // split('@')[1] returns 'middle@example.com', which won't match 'example.com'
      expect(isEmailAllowed('user@middle@example.com')).toBe(false);
    });
  });
});
