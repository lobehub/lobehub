import { describe, expect, it } from 'vitest';

import { quotaExhaustion, resolveAgentAvailability } from './resolve';

const now = 1_000_000;
const benched = { enabled: true, rateLimitedUntil: now + 60_000 };
const fresh = { enabled: true, sessionUtil: 20, weeklyUtil: 30 };

describe('quotaExhaustion', () => {
  it('does not judge an agent without enabled accounts', () => {
    expect(quotaExhaustion([], now)).toEqual({ exhausted: false });
    expect(quotaExhaustion([{ ...benched, enabled: false }], now)).toEqual({ exhausted: false });
  });

  it('keeps an agent on duty while one account has headroom', () => {
    expect(quotaExhaustion([benched, fresh], now)).toEqual({ exhausted: false });
  });

  it('returns the earliest reset when every account is benched by a session limit', () => {
    const later = { enabled: true, rateLimitedUntil: now + 120_000 };
    expect(quotaExhaustion([later, benched], now)).toEqual({
      exhausted: true,
      resetsAt: now + 60_000,
    });
  });

  it('promises no reset when a weekly limit benches an account', () => {
    expect(quotaExhaustion([benched, { enabled: true, weeklyUtil: 100 }], now)).toEqual({
      exhausted: true,
    });
  });

  it('ignores a rate limit that already lifted', () => {
    expect(quotaExhaustion([{ enabled: true, rateLimitedUntil: now - 1 }], now)).toEqual({
      exhausted: false,
    });
  });
});

describe('resolveAgentAvailability', () => {
  const base = { activeJobs: 0, loads: [], now };

  it('reads a cloud agent with nothing running as online', () => {
    expect(resolveAgentAvailability(base)).toEqual({ activeJobs: 0, status: 'online' });
  });

  it('reads a connected device with nothing running as idle', () => {
    expect(
      resolveAgentAvailability({ ...base, device: { online: true }, deviceId: 'd1' }).status,
    ).toBe('idle');
  });

  it.each([
    [undefined, 'offline'],
    ['failed', 'offline'],
    ['suspended', 'sleeping'],
    ['suspending', 'sleeping'],
    ['waking', 'waking'],
    ['pending', 'waking'],
  ] as const)('reads a disconnected device in phase %s as %s', (managedPhase, status) => {
    expect(
      resolveAgentAvailability({
        ...base,
        device: { managedPhase, online: false },
        deviceId: 'd1',
      }).status,
    ).toBe(status);
  });

  it('reads a device missing from the pool as offline', () => {
    expect(resolveAgentAvailability({ ...base, deviceId: 'd1' }).status).toBe('offline');
  });

  it('reads an agent with queued or running replies as working', () => {
    expect(resolveAgentAvailability({ ...base, activeJobs: 2, loads: [fresh] })).toEqual({
      activeJobs: 2,
      status: 'working',
    });
  });

  it('reads an agent out of quota as off duty, even while a run finishes', () => {
    expect(resolveAgentAvailability({ ...base, activeJobs: 1, loads: [benched] })).toEqual({
      activeJobs: 1,
      resetsAt: now + 60_000,
      status: 'offDuty',
    });
  });

  it('lets an offline device hide the quota', () => {
    expect(resolveAgentAvailability({ ...base, deviceId: 'd1', loads: [benched] }).status).toBe(
      'offline',
    );
  });
});
