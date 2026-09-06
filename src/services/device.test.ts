import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from './device';

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(),
  statPath: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    device: {
      listDir: { query: mocks.listDir },
      statPath: { query: mocks.statPath },
    },
  },
}));

describe('deviceService remote folder calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the personal device scope when listing a directory', async () => {
    mocks.listDir.mockResolvedValue({ success: true });

    await deviceService.listDir('device-1', 'personal', '/home/user');

    expect(mocks.listDir).toHaveBeenCalledWith({
      deviceId: 'device-1',
      path: '/home/user',
      scope: 'personal',
    });
  });

  it('forwards the workspace device scope when validating a path', async () => {
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: true, path: '/repo' });

    await deviceService.statPath('device-2', 'workspace', '/repo');

    expect(mocks.statPath).toHaveBeenCalledWith({
      deviceId: 'device-2',
      path: '/repo',
      scope: 'workspace',
    });
  });
});
