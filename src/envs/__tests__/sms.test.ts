// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getSMSConfig', () => {
  it('reads phone auto-register flag from SMS_AUTO_REGISTER_ON_PHONE_LOGIN', async () => {
    delete process.env.AUTO_REGISTER_ON_PHONE_LOGIN;
    process.env.SMS_AUTO_REGISTER_ON_PHONE_LOGIN = '1';

    const { getSMSConfig } = await import('../sms');

    expect(getSMSConfig().AUTO_REGISTER_ON_PHONE_LOGIN).toBe(true);
  });

  it('prefers AUTO_REGISTER_ON_PHONE_LOGIN when both env names exist', async () => {
    process.env.AUTO_REGISTER_ON_PHONE_LOGIN = '0';
    process.env.SMS_AUTO_REGISTER_ON_PHONE_LOGIN = '1';

    const { getSMSConfig } = await import('../sms');

    expect(getSMSConfig().AUTO_REGISTER_ON_PHONE_LOGIN).toBe(false);
  });
});
