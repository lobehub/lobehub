import { describe, expect, it, vi } from 'vitest';

import {
  installSearchSyncCapture,
  runSearchSyncCaptureCli,
  type SearchSyncCaptureRepository,
} from './index';

const createRepository = (): SearchSyncCaptureRepository => ({
  installCaptureInfrastructure: vi.fn().mockResolvedValue(undefined),
});

describe('installSearchSyncCapture', () => {
  it('loads the repository only after DATABASE_URL is available and installs capture', async () => {
    const repository = createRepository();
    const loadRepository = vi.fn().mockResolvedValue(repository);
    const runWithLockRetry = vi.fn(async (operation: () => Promise<void>) => operation());

    await expect(
      installSearchSyncCapture({
        env: { DATABASE_URL: 'postgres://test' },
        loadRepository,
        runWithLockRetry,
      }),
    ).resolves.toBeUndefined();

    expect(loadRepository).toHaveBeenCalledOnce();
    expect(runWithLockRetry).toHaveBeenCalledOnce();
    expect(repository.installCaptureInfrastructure).toHaveBeenCalledOnce();
  });

  it('fails before loading the repository when DATABASE_URL is missing', async () => {
    const loadRepository = vi.fn();

    await expect(installSearchSyncCapture({ env: {}, loadRepository })).rejects.toThrow(
      'DATABASE_URL is required',
    );

    expect(loadRepository).not.toHaveBeenCalled();
  });
});

describe('runSearchSyncCaptureCli', () => {
  it('returns success and logs only after capture installation succeeds', async () => {
    const logError = vi.fn();
    const logSuccess = vi.fn();
    const repository = createRepository();

    await expect(
      runSearchSyncCaptureCli({
        env: { DATABASE_URL: 'postgres://test' },
        loadRepository: vi.fn().mockResolvedValue(repository),
        logError,
        logSuccess,
        runWithLockRetry: vi.fn(async (operation: () => Promise<void>) => operation()),
      }),
    ).resolves.toBe(0);

    expect(logSuccess).toHaveBeenCalledWith('✅ search sync capture infrastructure installed');
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns failure and does not report success when capture installation fails', async () => {
    const error = new Error('capture installation failed');
    const logError = vi.fn();
    const logSuccess = vi.fn();
    const runWithLockRetry = vi.fn(async (operation: () => Promise<void>) => operation());
    const repository: SearchSyncCaptureRepository = {
      installCaptureInfrastructure: vi.fn().mockRejectedValue(error),
    };

    await expect(
      runSearchSyncCaptureCli({
        env: { DATABASE_URL: 'postgres://test' },
        loadRepository: vi.fn().mockResolvedValue(repository),
        logError,
        logSuccess,
        runWithLockRetry,
      }),
    ).resolves.toBe(1);

    expect(logError).toHaveBeenCalledWith('❌ Search sync capture installation failed:', error);
    expect(logSuccess).not.toHaveBeenCalled();
  });
});
