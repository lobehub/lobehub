import { describe, expect, it, vi } from 'vitest';

import { runFtsSearchReindexCommand } from '../preparation';

describe('runFtsSearchReindexCommand', () => {
  it('does not install capture infrastructure for the status command', async () => {
    const installCaptureInfrastructure = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const runWithLockRetry = vi.fn<(operation: () => Promise<void>) => Promise<void>>();
    const readStatus = vi.fn<() => Promise<string>>().mockResolvedValue('status');

    await expect(
      runFtsSearchReindexCommand({
        command: 'status',
        installCaptureInfrastructure,
        runWithLockRetry,
        run: readStatus,
      }),
    ).resolves.toBe('status');

    expect(readStatus).toHaveBeenCalledOnce();
    expect(installCaptureInfrastructure).not.toHaveBeenCalled();
    expect(runWithLockRetry).not.toHaveBeenCalled();
  });

  it('installs capture through lock retry before creating the reindex checkpoint', async () => {
    const events: string[] = [];
    const installCaptureInfrastructure = vi
      .fn<() => Promise<void>>()
      .mockImplementation(async () => {
        events.push('install');
      });
    const runWithLockRetry = vi
      .fn<(operation: () => Promise<void>) => Promise<void>>()
      .mockImplementation(async (operation) => operation());
    const createOrResume = vi.fn<() => Promise<string>>().mockImplementation(async () => {
      events.push('create-or-resume');
      return 'prepared';
    });

    await expect(
      runFtsSearchReindexCommand({
        command: 'apply',
        installCaptureInfrastructure,
        runWithLockRetry,
        run: createOrResume,
      }),
    ).resolves.toBe('prepared');

    expect(runWithLockRetry).toHaveBeenCalledOnce();
    expect(runWithLockRetry).toHaveBeenCalledWith(installCaptureInfrastructure);
    expect(events).toEqual(['install', 'create-or-resume']);
  });

  it('stops before the checkpoint when capture installation fails', async () => {
    const error = new Error('capture install failed');
    const installCaptureInfrastructure = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const runWithLockRetry = vi
      .fn<(operation: () => Promise<void>) => Promise<void>>()
      .mockImplementation(async (operation) => operation());
    const createOrResume = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      runFtsSearchReindexCommand({
        command: 'apply',
        installCaptureInfrastructure,
        runWithLockRetry,
        run: createOrResume,
      }),
    ).rejects.toBe(error);

    expect(installCaptureInfrastructure).toHaveBeenCalledOnce();
    expect(createOrResume).not.toHaveBeenCalled();
  });
});
