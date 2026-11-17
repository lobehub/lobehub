// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDeviceRequesterCredential, SCM_CREDENTIAL_DEVICE_TOOL } from './deviceCredential';

const mocks = vi.hoisted(() => ({
  findIdentity: vi.fn(),
  getPolicy: vi.fn(),
  resolveRequester: vi.fn(),
}));

vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return { getScmRequesterCredential: mocks.getPolicy };
  }),
}));
vi.mock('@/database/models/scm', () => ({
  ScmIdentityModel: { findByUser: mocks.findIdentity },
}));
vi.mock('./resolveRunRequester', () => ({
  resolveRunRequester: mocks.resolveRequester,
}));

const sharedNode = {
  identitySource: 'machine-id',
  sharedFromDeviceId: null,
  visibility: 'public',
  workspaceId: 'ws-1',
};
const readSystemInfo = vi.fn();
const resign = vi.fn();

const resolve = (device: Record<string, unknown> | undefined) =>
  resolveDeviceRequesterCredential({
    db: {} as any,
    device,
    deviceId: 'device-jp-1',
    readSystemInfo,
    requesterInput: { ownerUserId: 'user-owner', trigger: 'chat' },
    resign,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPolicy.mockResolvedValue(true);
  mocks.resolveRequester.mockResolvedValue('user-requester');
  mocks.findIdentity.mockResolvedValue({
    externalLogin: 'arvinxx',
    externalUserId: '42',
    metadata: { name: 'Arvin Xu' },
  });
  readSystemInfo.mockResolvedValue({
    ok: true,
    systemInfo: { supportedTools: [SCM_CREDENTIAL_DEVICE_TOOL] },
  });
  resign.mockResolvedValue('jwt-with-requester');
});

describe('resolveDeviceRequesterCredential', () => {
  it('re-signs the run token for the requester and names their git identity', async () => {
    await expect(resolve(sharedNode)).resolves.toEqual({
      jwt: 'jwt-with-requester',
      kind: 'issue',
      requesterLine:
        'This run was requested by Arvin Xu (@arvinxx). Git commits and pushes on this device use their GitHub identity.',
      scmCredential: { gitEmail: '42+arvinxx@users.noreply.github.com', gitName: 'Arvin Xu' },
    });
    expect(resign).toHaveBeenCalledWith({
      deviceId: 'device-jp-1',
      requesterUserId: 'user-requester',
    });
    expect(mocks.getPolicy).toHaveBeenCalledWith('ws-1');
    expect(readSystemInfo).toHaveBeenCalledWith(['cli']);
  });

  it('still issues the scoped token when the requester has not connected GitHub yet', async () => {
    mocks.findIdentity.mockResolvedValue(null);

    await expect(resolve(sharedNode)).resolves.toMatchObject({
      jwt: 'jwt-with-requester',
      kind: 'issue',
      scmCredential: {},
    });
  });

  it('leaves devices outside the policy alone', async () => {
    await expect(resolve({ ...sharedNode, visibility: 'private' })).resolves.toEqual({
      kind: 'off',
    });
    await expect(resolve(undefined)).resolves.toEqual({ kind: 'off' });
    expect(mocks.getPolicy).not.toHaveBeenCalled();
    expect(resign).not.toHaveBeenCalled();
  });

  it('leaves the run alone while the workspace has the policy off', async () => {
    mocks.getPolicy.mockResolvedValue(false);

    await expect(resolve(sharedNode)).resolves.toEqual({ kind: 'off' });
    expect(resign).not.toHaveBeenCalled();
  });

  it('refuses a run without a human requester', async () => {
    mocks.resolveRequester.mockResolvedValue(undefined);

    await expect(resolve(sharedNode)).resolves.toMatchObject({
      kind: 'refuse',
      reason: 'no_requester',
    });
    expect(resign).not.toHaveBeenCalled();
  });

  it('refuses a device whose CLI cannot hand out requester credentials', async () => {
    readSystemInfo.mockResolvedValue({ ok: true, systemInfo: { supportedTools: [] } });

    await expect(resolve(sharedNode)).resolves.toMatchObject({
      kind: 'refuse',
      reason: 'cli_too_old',
    });
    expect(resign).not.toHaveBeenCalled();
  });

  it('asks to retry, rather than to upgrade, when the device does not answer', async () => {
    readSystemInfo.mockResolvedValue({ ok: false, reason: 'offline' });

    await expect(resolve(sharedNode)).resolves.toMatchObject({
      kind: 'refuse',
      reason: 'device_unreachable',
    });
  });
});
