import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  canOfferDeviceShare,
  canToggleDeviceVisibility,
  removeConfirmDescKey,
  shownDeviceVisibility,
} from './deviceCardActions';

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

describe('canToggleDeviceVisibility', () => {
  const enrolled = {
    enroller: { avatar: null, fullName: null, userId: 'user_a', username: null },
    registered: true,
    scope: 'workspace' as const,
  };

  it('lets the member who enrolled a workspace device publish it or make it private', () => {
    expect(canToggleDeviceVisibility(enrolled, 'user_a')).toBe(true);
  });

  // Moving another member's device between pools would appropriate it.
  it('never lets anyone else, an owner included, change it', () => {
    expect(canToggleDeviceVisibility(enrolled, 'user_b')).toBe(false);
    expect(canToggleDeviceVisibility(enrolled, undefined)).toBe(false);
  });

  it('never offers it for a personal or unregistered row', () => {
    expect(canToggleDeviceVisibility({ ...enrolled, scope: 'personal' }, 'user_a')).toBe(false);
    expect(canToggleDeviceVisibility({ ...enrolled, registered: false }, 'user_a')).toBe(false);
  });
});

describe('shownDeviceVisibility', () => {
  it('shows who can use a registered workspace device', () => {
    const row = { registered: true, scope: 'workspace' as const };
    expect(shownDeviceVisibility({ ...row, visibility: 'private' })).toBe('private');
    expect(shownDeviceVisibility({ ...row, visibility: 'public' })).toBe('public');
  });

  it('shows nothing for a personal device or a ghost row', () => {
    expect(shownDeviceVisibility({ registered: true, scope: 'personal', visibility: null })).toBe(
      null,
    );
    expect(
      shownDeviceVisibility({ registered: false, scope: 'workspace', visibility: 'private' }),
    ).toBe(null);
  });
});
