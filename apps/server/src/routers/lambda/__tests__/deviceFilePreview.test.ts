// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  findByDeviceId: vi.fn(),
  findWorkspaceDeviceById: vi.fn(),
  getLocalFilePreview: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: class {
    findByDeviceId = mocks.findByDeviceId;
    findWorkspaceDeviceById = mocks.findWorkspaceDeviceById;
  },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: { getLocalFilePreview: mocks.getLocalFilePreview },
}));

describe('device file preview workspace authorization', () => {
  const input = {
    deviceId: 'shared-device',
    path: '/shared/project/index.html',
    workingDirectory: '/shared/project',
  };
  const preview = {
    preview: { content: '<h1>Shared preview</h1>', contentType: 'text/html', type: 'text' },
    success: true,
  };
  const workspaceCaller = deviceRouter.createCaller({
    userId: 'member',
    workspaceId: 'workspace',
    workspaceRole: 'member',
  } as never);
  const personalCaller = deviceRouter.createCaller({ userId: 'member' } as never);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findWorkspaceDeviceById.mockResolvedValue({
      deviceId: input.deviceId,
      userId: 'another-member',
      workingDirs: [{ path: '/shared/project' }],
      workspaceId: 'workspace',
    });
    mocks.getLocalFilePreview.mockResolvedValue(preview);
  });

  it('previews an HTML file on a public device enrolled by another member', async () => {
    await expect(workspaceCaller.getLocalFilePreview(input)).resolves.toEqual(preview);
  });

  it.each([
    { defaultCwd: '/shared/project', workingDirs: [] },
    { workingDirs: [{ path: '/shared' }] },
    { workingDirs: [{ git: { activeWorktree: '/shared/project' }, path: '/repo' }] },
  ])('accepts approved workspace directories from %j', async (roots) => {
    mocks.findWorkspaceDeviceById.mockResolvedValue({ userId: 'another-member', ...roots });
    await expect(workspaceCaller.getLocalFilePreview(input)).resolves.toEqual(preview);
  });

  it.each(['/', '/shared/project-other', '/shared/project/../private'])(
    'rejects an unapproved workspace directory %s even if the personal device permits it',
    async (workingDirectory) => {
      mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/' }] });
      await expect(
        workspaceCaller.getLocalFilePreview({ ...input, workingDirectory }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.getLocalFilePreview).not.toHaveBeenCalled();
    },
  );

  it('rejects an invisible workspace device even if a personal device permits the path', async () => {
    mocks.findWorkspaceDeviceById.mockResolvedValue(undefined);
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/shared/project' }] });
    await expect(workspaceCaller.getLocalFilePreview(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('does not borrow workspace authorization for a personal request', async () => {
    await expect(personalCaller.getLocalFilePreview(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('preserves previews on an approved personal device', async () => {
    mocks.findByDeviceId.mockResolvedValue({ workingDirs: [{ path: '/shared/project' }] });
    await expect(personalCaller.getLocalFilePreview(input)).resolves.toEqual(preview);
  });
});
