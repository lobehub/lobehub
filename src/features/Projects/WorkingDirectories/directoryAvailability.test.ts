import { describe, expect, it } from 'vitest';

import { directoryUnavailableReason, isMissingDirectoryError } from './directoryAvailability';

const base = { canManage: true, enabled: false, online: true, presenceUnknown: false };

describe('directoryUnavailableReason', () => {
  it('says nothing for a folder that is enabled, or still being enabled', () => {
    expect(directoryUnavailableReason({ ...base, enabled: true, online: false })).toBeUndefined();
    expect(directoryUnavailableReason({ ...base, attempt: 'pending' })).toBeUndefined();
  });

  it('enables an online folder on sight for someone who may, so there is nothing to show', () => {
    expect(directoryUnavailableReason(base)).toBeUndefined();
  });

  it('waits for the device to come online', () => {
    expect(directoryUnavailableReason({ ...base, online: false })).toBe('offline');
  });

  it('says why an enable failed', () => {
    expect(directoryUnavailableReason({ ...base, attempt: 'missing' })).toBe('missing');
    expect(directoryUnavailableReason({ ...base, attempt: 'failed' })).toBe('failed');
  });

  it('leaves it to someone who may change the project', () => {
    expect(directoryUnavailableReason({ ...base, canManage: false })).toBe('needsManager');
  });

  it('holds back until presence is known', () => {
    expect(
      directoryUnavailableReason({ ...base, online: false, presenceUnknown: true }),
    ).toBeUndefined();
  });
});

describe('isMissingDirectoryError', () => {
  it('reads the server refusal for a folder that is not on the device', () => {
    expect(
      isMissingDirectoryError(new Error('Working directory does not exist on this device')),
    ).toBe(true);
    expect(isMissingDirectoryError(new Error('Project not found or access denied'))).toBe(false);
    expect(isMissingDirectoryError(new Error('Environment instance is disabled'))).toBe(false);
  });
});
