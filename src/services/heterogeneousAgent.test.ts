import { beforeEach, describe, expect, it, vi } from 'vitest';

import { heterogeneousAgentCatalogService } from './heterogeneousAgent';

const mocks = vi.hoisted(() => ({
  electronListModels: vi.fn(),
  remoteListModels: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    device: {
      listHeterogeneousAgentModels: { query: mocks.remoteListModels },
    },
  },
}));

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: { listModels: mocks.electronListModels },
}));

describe('heterogeneousAgentCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Electron IPC for the current Desktop', async () => {
    const catalog = { models: [], status: 'success', updatedAt: 1 };
    mocks.electronListModels.mockResolvedValue(catalog);
    const params = { cwd: '/repo', type: 'opencode' as const };

    await expect(heterogeneousAgentCatalogService.listModels(params)).resolves.toEqual(catalog);
    expect(mocks.electronListModels).toHaveBeenCalledWith(params);
    expect(mocks.remoteListModels).not.toHaveBeenCalled();
  });

  it('uses the device RPC for a bound execution target', async () => {
    const catalog = { models: [], status: 'success', updatedAt: 1 };
    mocks.remoteListModels.mockResolvedValue(catalog);

    await expect(
      heterogeneousAgentCatalogService.listModels({
        cwd: '/repo',
        deviceId: 'device-1',
        type: 'opencode',
      }),
    ).resolves.toEqual(catalog);
    expect(mocks.remoteListModels).toHaveBeenCalledWith({
      cwd: '/repo',
      deviceId: 'device-1',
      type: 'opencode',
    });
    expect(mocks.electronListModels).not.toHaveBeenCalled();
  });
});
