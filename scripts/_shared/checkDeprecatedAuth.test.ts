import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Store original env
const originalEnv = { ...process.env };

// Mock process.exit to prevent actual exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock console methods
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('checkDeprecatedAuth', () => {
  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    // Clear module cache to ensure fresh import
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('should not exit when no deprecated env vars are set', async () => {
    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with code 1 when NextAuth env vars are detected', async () => {
    process.env.NEXT_AUTH_SECRET = 'test-secret';

    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it('should exit with code 1 when NEXTAUTH env vars are detected', async () => {
    process.env.NEXTAUTH_SECRET = 'test-secret';

    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 when Clerk env vars are detected', async () => {
    process.env.CLERK_SECRET_KEY = 'test-key';

    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 when ACCESS_CODE is set', async () => {
    process.env.ACCESS_CODE = 'test-code';

    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 when APP_URL has trailing slash', async () => {
    process.env.APP_URL = 'https://example.com/';

    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should not exit when APP_URL has no trailing slash', async () => {
    process.env.APP_URL = 'https://example.com';

    const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
    checkDeprecatedAuth();

    expect(mockExit).not.toHaveBeenCalled();
  });

  describe('webhook warnings (non-blocking)', () => {
    it('should warn but not exit when Casdoor webhook is missing', async () => {
      process.env.AUTH_SSO_PROVIDERS = 'casdoor';
      // CASDOOR_WEBHOOK_SECRET is not set

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    it('should warn but not exit when Logto webhook is missing', async () => {
      process.env.AUTH_SSO_PROVIDERS = 'logto';
      // LOGTO_WEBHOOK_SIGNING_KEY is not set

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsoleWarn).toHaveBeenCalled();
    });

    it('should not warn when Casdoor webhook is configured', async () => {
      process.env.AUTH_SSO_PROVIDERS = 'casdoor';
      process.env.CASDOOR_WEBHOOK_SECRET = 'test-secret';

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should not warn when Logto webhook is configured', async () => {
      process.env.AUTH_SSO_PROVIDERS = 'logto';
      process.env.LOGTO_WEBHOOK_SIGNING_KEY = 'test-key';

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should not warn when provider is not casdoor or logto', async () => {
      process.env.AUTH_SSO_PROVIDERS = 'google';

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });
  });

  describe('mixed errors and warnings', () => {
    it('should exit when there are errors even if there are also warnings', async () => {
      process.env.AUTH_SSO_PROVIDERS = 'logto'; // warning
      process.env.ACCESS_CODE = 'test-code'; // error

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockConsoleWarn).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalled();
    });
  });

  describe('action parameter', () => {
    it('should use "redeploy" as default action', async () => {
      process.env.ACCESS_CODE = 'test-code';

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth();

      const calls = mockConsoleError.mock.calls.flat().join(' ');
      expect(calls).toContain('redeploy');
    });

    it('should use custom action when provided', async () => {
      process.env.ACCESS_CODE = 'test-code';

      const { checkDeprecatedAuth } = await import('./checkDeprecatedAuth.js');
      checkDeprecatedAuth({ action: 'restart' });

      const calls = mockConsoleError.mock.calls.flat().join(' ');
      expect(calls).toContain('restart');
    });
  });
});
