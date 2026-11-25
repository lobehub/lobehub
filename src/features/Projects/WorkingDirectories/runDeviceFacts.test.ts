import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { runDeviceFacts } from './runDeviceFacts';

const enroller = (userId: string, fullName: string | null = null) => ({
  avatar: null,
  fullName,
  userId,
  username: `${userId}-name`,
});

describe('runDeviceFacts', () => {
  it('says nothing about a device the list does not know', () => {
    expect(runDeviceFacts(undefined, 'me')).toEqual({ managed: false });
  });

  it('marks a managed cloud device', () => {
    expect(
      runDeviceFacts(
        {
          enroller: enroller('me'),
          identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
          scope: 'personal',
        },
        'me',
      ),
    ).toEqual({ managed: true });
  });

  it('names who shared a workspace device someone else enrolled', () => {
    expect(
      runDeviceFacts(
        { enroller: enroller('them', 'Ada'), identitySource: 'machine-id', scope: 'workspace' },
        'me',
      ),
    ).toEqual({ managed: false, sharedBy: 'Ada' });
    expect(
      runDeviceFacts(
        { enroller: enroller('them'), identitySource: 'machine-id', scope: 'workspace' },
        'me',
      ).sharedBy,
    ).toBe('them-name');
  });

  it('does not call the viewer’s own machines shared', () => {
    expect(
      runDeviceFacts(
        { enroller: enroller('me'), identitySource: 'machine-id', scope: 'workspace' },
        'me',
      ),
    ).toEqual({ managed: false });
    expect(
      runDeviceFacts(
        { enroller: enroller('me'), identitySource: 'machine-id', scope: 'personal' },
        'me',
      ),
    ).toEqual({ managed: false });
  });
});
