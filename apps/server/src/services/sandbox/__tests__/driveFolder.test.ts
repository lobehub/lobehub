import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { driveFolderCacheSize, driveFolderExists, forgetDriveFolders } from '../driveFolder';

const listFiles = vi.fn();

vi.mock('@/server/services/market', () => ({
  // `function`, not an arrow: the service is constructed with `new`.
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getSandboxStorageClient: () => ({ listFiles }),
    };
  }),
}));

const claim = { key: 'ws-public-ws1', quotaBytes: 1024 };

const check = (path: string, key = claim.key) =>
  driveFolderExists({ claim: { ...claim, key }, path, userId: 'u1', workspaceId: 'ws1' });

beforeEach(() => {
  vi.useFakeTimers();
  listFiles.mockReset().mockResolvedValue({ entries: [] });
});

afterEach(() => {
  forgetDriveFolders(claim.key);
  for (let i = 0; i < 2000; i++) forgetDriveFolders(`k${i}`);
  vi.useRealTimers();
});

describe('driveFolderExists', () => {
  it('should answer a recently seen folder from the cache', async () => {
    await expect(check('reports')).resolves.toBe(true);
    await expect(check('reports')).resolves.toBe(true);

    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it('should ask again once the entry has expired', async () => {
    await check('reports');
    vi.advanceTimersByTime(15_000);
    await check('reports');

    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it('should drop expired entries when remembering a new folder', async () => {
    await check('a', 'k0');
    await check('b', 'k1');
    vi.advanceTimersByTime(15_000);
    await check('c', 'k2');

    expect(driveFolderCacheSize()).toBe(1);
  });

  it('should not remember more folders than its cap', async () => {
    for (let i = 0; i < 1100; i++) await check('folder', `k${i}`);

    expect(driveFolderCacheSize()).toBe(1000);
  });
});
