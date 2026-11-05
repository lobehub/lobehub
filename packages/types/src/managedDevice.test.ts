import { describe, expect, it } from 'vitest';

import { isManagedCloudDevice, MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from './managedDevice';

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
