import { describe, expect, it } from 'vitest';

import { isRequesterCredentialDevice } from './deviceScope';

const sharedNode = {
  identitySource: 'machine-id',
  sharedFromDeviceId: null,
  visibility: 'public',
  workspaceId: 'ws-1',
};

describe('isRequesterCredentialDevice', () => {
  it('covers a public device enrolled into the workspace', () => {
    expect(isRequesterCredentialDevice(sharedNode)).toBe(true);
  });

  it('covers a public workspace device enrolled with a fallback identity', () => {
    expect(isRequesterCredentialDevice({ ...sharedNode, identitySource: 'fallback' })).toBe(true);
  });

  it('leaves out personal devices', () => {
    expect(isRequesterCredentialDevice({ ...sharedNode, workspaceId: null })).toBe(false);
  });

  it('leaves out private workspace devices', () => {
    expect(isRequesterCredentialDevice({ ...sharedNode, visibility: 'private' })).toBe(false);
  });

  it('leaves out devices shared from a personal device list', () => {
    expect(isRequesterCredentialDevice({ ...sharedNode, sharedFromDeviceId: 'personal-1' })).toBe(
      false,
    );
  });

  it('leaves out managed cloud devices', () => {
    expect(
      isRequesterCredentialDevice({ ...sharedNode, identitySource: 'managed-cloud-device' }),
    ).toBe(false);
  });
});
