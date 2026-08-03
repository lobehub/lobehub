import { afterEach, describe, expect, it, vi } from 'vitest';

describe('createSmsServiceImpl production fail-closed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws in production without KAVENEGAR_API_KEY', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KAVENEGAR_API_KEY', '');
    const { createSmsServiceImpl } = await import('./impls/index');
    expect(() => createSmsServiceImpl()).toThrow(/KAVENEGAR_API_KEY/);
  });

  it('refuses Debug impl in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KAVENEGAR_API_KEY', 'test-key');
    const { createSmsServiceImpl, SmsImplType } = await import('./impls/index');
    expect(() => createSmsServiceImpl(SmsImplType.Debug)).toThrow(/SMS_DEBUG_FORBIDDEN/);
  });
});
