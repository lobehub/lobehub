import { describe, expect, it, vi } from 'vitest';

import {
  type FtsSearchSyncCaptureRepository,
  installFtsSearchSyncCapture,
  runFtsSearchSyncCaptureCli,
} from './index';

const createRepository = (): FtsSearchSyncCaptureRepository => ({
  installCaptureInfrastructure: vi.fn().mockResolvedValue(undefined),
});

describe('installFtsSearchSyncCapture', () => {
  it('loads the repository only after DATABASE_URL is available and installs capture', async () => {
    const repository = createRepository();
    const loadRepository = vi.fn().mockResolvedValue(repository);
    const runWithLockRetry = vi.fn(async (operation: () => Promise<void>) => operation());

    await expect(
      installFtsSearchSyncCapture({
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

    await expect(installFtsSearchSyncCapture({ env: {}, loadRepository })).rejects.toThrow(
      'DATABASE_URL is required',
    );

    expect(loadRepository).not.toHaveBeenCalled();
  });
});

describe('runFtsSearchSyncCaptureCli', () => {
  it('returns success and logs only after capture installation succeeds', async () => {
    const logError = vi.fn();
    const logSuccess = vi.fn();
    const repository = createRepository();

    await expect(
      runFtsSearchSyncCaptureCli({
        env: { DATABASE_URL: 'postgres://test' },
        loadRepository: vi.fn().mockResolvedValue(repository),
        logError,
        logSuccess,
        runWithLockRetry: vi.fn(async (operation: () => Promise<void>) => operation()),
      }),
    ).resolves.toBe(0);

    expect(logSuccess).toHaveBeenCalledWith(
      '✅ full-text search sync capture infrastructure installed',
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('returns failure and does not report success when capture installation fails', async () => {
    const error = new Error(
      'capture installation failed at https://operator:private@database.example.com/app?query=private token=private-token',
    );
    const logError = vi.fn();
    const logSuccess = vi.fn();
    const runWithLockRetry = vi.fn(async (operation: () => Promise<void>) => operation());
    const repository: FtsSearchSyncCaptureRepository = {
      installCaptureInfrastructure: vi.fn().mockRejectedValue(error),
    };

    await expect(
      runFtsSearchSyncCaptureCli({
        env: { DATABASE_URL: 'postgres://test' },
        loadRepository: vi.fn().mockResolvedValue(repository),
        logError,
        logSuccess,
        runWithLockRetry,
      }),
    ).resolves.toBe(1);

    expect(logError).toHaveBeenCalledWith(
      '❌ Full-text search sync capture installation failed:',
      'capture installation failed at [redacted-url] token=[redacted]',
    );
    expect(logSuccess).not.toHaveBeenCalled();
  });
});
