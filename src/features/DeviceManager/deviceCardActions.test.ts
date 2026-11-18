import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { canOfferDeviceShare, removeConfirmDescKey } from './deviceCardActions';

const connected = {
  identitySource: 'machine-id',
  registered: true,
  scope: 'personal' as const,
};
const managed = { ...connected, identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE };

describe('canOfferDeviceShare', () => {
  it('offers sharing for a registered personal device the user connected', () => {
    expect(canOfferDeviceShare(connected)).toBe(true);
  });

  // Regression: the card offered "Share to Workspace" on a managed cloud
  // device, which the server always refuses.
  it('never offers sharing for a managed cloud device', () => {
    expect(canOfferDeviceShare(managed)).toBe(false);
  });

  it('never offers sharing for a workspace or unregistered row', () => {
    expect(canOfferDeviceShare({ ...connected, scope: 'workspace' })).toBe(false);
    expect(canOfferDeviceShare({ ...connected, registered: false })).toBe(false);
  });
});

describe('removeConfirmDescKey', () => {
  // Regression: removing a managed cloud device said it could register again,
  // but the removal deletes it.
  it('warns that removing a managed cloud device deletes it', () => {
    expect(removeConfirmDescKey(managed)).toBe('devices.managed.remove.confirmDesc');
  });

  it('keeps the reconnect wording for a connected device', () => {
    expect(removeConfirmDescKey(connected)).toBe('devices.remove.confirmDesc');
  });
});
