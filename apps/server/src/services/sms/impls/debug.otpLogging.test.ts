import { afterEach, describe, expect, it, vi } from 'vitest';

describe('DebugSmsService — no OTP in console (MON-001)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not console.info OTP codes', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { DebugSmsService } = await import('./debug');
    await new DebugSmsService().sendSms({
      code: '123456',
      message: 'کد تایید شما: 123456',
      to: '+989121234567',
    });
    expect(info).not.toHaveBeenCalled();
  });
});

describe('SmsService AUTH_SMS_DEBUG_OTP production gate (MON-001)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('ignores AUTH_SMS_DEBUG_OTP in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KAVENEGAR_API_KEY', 'test-key');
    vi.stubEnv('AUTH_SMS_DEBUG_OTP', '1');
    const { SmsService } = await import('../index');
    const service = new SmsService();
    expect((service as { debugMirror: unknown }).debugMirror).toBeNull();
  });
});
