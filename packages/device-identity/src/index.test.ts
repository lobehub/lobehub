import { describe, expect, it } from 'vitest';

import { deriveDeviceId } from './index';

const FIXED_MACHINE = 'AAAA-BBBB-CCCC-DDDD';
const readMachineId = () => FIXED_MACHINE;

describe('deriveDeviceId', () => {
  it('is deterministic for the same machine + user', () => {
    const a = deriveDeviceId('user-1', { readMachineId });
    const b = deriveDeviceId('user-1', { readMachineId });

    expect(a.identitySource).toBe('machine-id');
    expect(a.deviceId).toBe(b.deviceId);
    expect(a.deviceId).toHaveLength(32);
  });

  it('differs for different users on the same machine', () => {
    const a = deriveDeviceId('user-1', { readMachineId });
    const b = deriveDeviceId('user-2', { readMachineId });

    expect(a.deviceId).not.toBe(b.deviceId);
  });

  it('falls back to the provided id when machine id is unavailable', () => {
    const result = deriveDeviceId('user-1', {
      fallbackId: 'stored-uuid',
      readMachineId: () => {
        throw new Error('no /etc/machine-id');
      },
    });

    expect(result).toEqual({ deviceId: 'stored-uuid', identitySource: 'fallback' });
  });

  it('falls back when machine id is empty', () => {
    const result = deriveDeviceId('user-1', { fallbackId: 'stored-uuid', readMachineId: () => '' });

    expect(result).toEqual({ deviceId: 'stored-uuid', identitySource: 'fallback' });
  });

  it('generates a random uuid fallback when no fallbackId is given', () => {
    const result = deriveDeviceId('user-1', {
      readMachineId: () => {
        throw new Error('unavailable');
      },
    });

    expect(result.identitySource).toBe('fallback');
    expect(result.deviceId).toMatch(/^[\da-f-]{36}$/);
  });
});
