// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  findByDeviceId: vi.fn(),
  runGitPullRequestAction: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findByDeviceId = mocks.findByDeviceId;
    findWorkspaceDeviceById = async () => ({ deviceId: 'device' });
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: { runGitPullRequestAction: mocks.runGitPullRequestAction },
}));

describe('PR mutation workspace boundary', () => {
  const caller = deviceRouter.createCaller({ userId: 'member', workspaceId: 'workspace' } as never);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/approved' }] });
    mocks.runGitPullRequestAction.mockResolvedValue({ success: true });
  });

  it('rejects another repository before sending any command to the device', async () => {
    await expect(
      caller.runGitPullRequestAction({
        action: { type: 'close' },
        deviceId: 'device',
        number: 42,
        path: '/other',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.runGitPullRequestAction).not.toHaveBeenCalled();
  });

  it('allows a repository inside the approved root', async () => {
    await expect(
      caller.runGitPullRequestAction({
        action: { type: 'close' },
        deviceId: 'device',
        number: 42,
        path: '/approved/repo',
      }),
    ).resolves.toEqual({ success: true });
  });

  it('rejects a merge without the displayed head commit', async () => {
    await expect(
      caller.runGitPullRequestAction({
        // @ts-expect-error Old clients must fail closed instead of merging an unseen head.
        action: { method: 'squash', type: 'merge' },
        deviceId: 'device',
        number: 42,
        path: '/approved',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.runGitPullRequestAction).not.toHaveBeenCalled();
  });
});
