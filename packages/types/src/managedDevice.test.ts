import { describe, expect, it } from 'vitest';

import {
  isManagedCloudDevice,
  isWakeableManagedDevice,
  MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
} from './managedDevice';

describe('isManagedCloudDevice', () => {
  it('recognises only the managed identity source', () => {
    expect(isManagedCloudDevice({ identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE })).toBe(
      true,
    );
    expect(isManagedCloudDevice({ identitySource: 'machine-id' })).toBe(false);
    expect(isManagedCloudDevice({ identitySource: 'fallback' })).toBe(false);
    expect(isManagedCloudDevice({ identitySource: null })).toBe(false);
    expect(isManagedCloudDevice({})).toBe(false);
  });
});

describe('isWakeableManagedDevice', () => {
  const managed = { identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, online: false };

  it('accepts an offline managed device that sleeps, starts, or has no known phase', () => {
    expect(isWakeableManagedDevice({ ...managed, managedPhase: 'suspended' })).toBe(true);
    expect(isWakeableManagedDevice({ ...managed, managedPhase: 'suspending' })).toBe(true);
    expect(isWakeableManagedDevice({ ...managed, managedPhase: 'waking' })).toBe(true);
    expect(isWakeableManagedDevice(managed)).toBe(true);
  });

  it('refuses a managed device that failed or is being deleted', () => {
    expect(isWakeableManagedDevice({ ...managed, managedPhase: 'failed' })).toBe(false);
    expect(isWakeableManagedDevice({ ...managed, managedPhase: 'deleting' })).toBe(false);
  });

  it('refuses an online managed device and every ordinary device', () => {
    expect(isWakeableManagedDevice({ ...managed, online: true })).toBe(false);
    expect(isWakeableManagedDevice({ identitySource: 'machine-id', online: false })).toBe(false);
  });
});
