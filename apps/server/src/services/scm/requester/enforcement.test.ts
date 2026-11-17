// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isRequesterCredentialEnforced } from './enforcement';

const mocks = vi.hoisted(() => ({ findWorkspaceDeviceById: vi.fn(), getPolicy: vi.fn() }));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return { findWorkspaceDeviceById: mocks.findWorkspaceDeviceById };
  }),
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return { getScmRequesterCredential: mocks.getPolicy };
  }),
}));

const check = (workspaceId?: string) =>
  isRequesterCredentialEnforced({} as any, {
    deviceId: 'device-1',
    ownerUserId: 'user-1',
    workspaceId,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findWorkspaceDeviceById.mockResolvedValue({ visibility: 'public', workspaceId: 'ws-1' });
  mocks.getPolicy.mockResolvedValue(true);
});

describe('isRequesterCredentialEnforced', () => {
  it('holds for a shared node of a workspace with the policy on', async () => {
    await expect(check('ws-1')).resolves.toBe(true);
    expect(mocks.getPolicy).toHaveBeenCalledWith('ws-1');
  });

  it('does not hold while the policy is off', async () => {
    mocks.getPolicy.mockResolvedValue(false);
    await expect(check('ws-1')).resolves.toBe(false);
  });

  it('does not hold for a private device or a personal run', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue({ visibility: 'private', workspaceId: 'ws-1' });
    await expect(check('ws-1')).resolves.toBe(false);
    await expect(check(undefined)).resolves.toBe(false);
  });
});
