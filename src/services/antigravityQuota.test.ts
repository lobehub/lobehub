import { beforeEach, describe, expect, it, vi } from 'vitest';

import { antigravityQuotaService } from './antigravityQuota';

const mocks = vi.hoisted(() => ({ local: vi.fn(), remote: vi.fn() }));
vi.mock('./electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: { getAntigravityQuota: mocks.local },
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { device: { getAntigravityQuota: { query: mocks.remote } } },
}));

describe('Antigravity quota transport', () => {
  beforeEach(() => vi.clearAllMocks());
  it('queries the local Desktop with the configured command, environment and refresh flag', async () => {
    const snapshot = { status: 'ok', groups: [] };
    mocks.local.mockResolvedValue(snapshot);
    const params = { command: '/custom/agy', env: { HTTP_PROXY: 'proxy' }, force: true };
    expect(await antigravityQuotaService.getQuota(params)).toBe(snapshot);
    expect(mocks.local).toHaveBeenCalledWith(params);
    expect(mocks.remote).not.toHaveBeenCalled();
  });
  it('queries the bound device and treats an offline or outdated device as an error', async () => {
    const params = { deviceId: 'device-1', command: 'agy', force: true };
    mocks.remote.mockResolvedValue({ status: 'ok', groups: [] });
    await antigravityQuotaService.getQuota(params);
    expect(mocks.remote).toHaveBeenCalledWith(params);
    expect(mocks.local).not.toHaveBeenCalled();
    mocks.remote.mockResolvedValue(null);
    await expect(antigravityQuotaService.getQuota(params)).rejects.toThrow('unavailable');
  });
});
