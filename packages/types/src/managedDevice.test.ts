import { describe, expect, it } from 'vitest';

import {
  isManagedCloudDevice,
  MANAGED_CLOUD_CLUSTER_PROVIDER_V1,
  MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
} from './managedDevice';

describe('managed cloud device contract', () => {
  it('keeps the stored identifiers stable', () => {
    expect(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE).toBe('managed-cloud-device');
    expect(MANAGED_CLOUD_CLUSTER_PROVIDER_V1).toBe('managed-cloud-cluster-v1');
  });

  it('fits the identity source in the devices.identity_source column', () => {
    expect(MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE.length).toBeLessThanOrEqual(20);
  });

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
