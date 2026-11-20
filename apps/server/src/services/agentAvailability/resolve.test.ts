import { describe, expect, it } from 'vitest';

import { resolveAgentAvailability } from './resolve';

const spent = { exhausted: true, resetsAt: 1_060_000 };
const fresh = { exhausted: false };

describe('resolveAgentAvailability', () => {
  const base = { activeJobs: 0 };

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
    expect(resolveAgentAvailability({ ...base, activeJobs: 2, quota: fresh })).toEqual({
      activeJobs: 2,
      status: 'working',
    });
  });

  it('reads an agent out of quota as off duty, even while a run finishes', () => {
    expect(resolveAgentAvailability({ ...base, activeJobs: 1, quota: spent })).toEqual({
      activeJobs: 1,
      resetsAt: 1_060_000,
      status: 'offDuty',
    });
  });

  it('does not rule off duty in when the quota could not be read', () => {
    expect(resolveAgentAvailability(base).status).toBe('online');
  });

  it('lets an offline device hide the quota', () => {
    expect(resolveAgentAvailability({ ...base, deviceId: 'd1', quota: spent }).status).toBe(
      'offline',
    );
  });
});
