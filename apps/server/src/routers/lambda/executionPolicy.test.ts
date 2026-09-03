// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executionPolicyRouter } from './executionPolicy';

const mocks = vi.hoisted(() => ({
  getUserExecutionPolicy: vi.fn(),
  logCommandExecution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/server/services/governance', () => ({
  getUserExecutionPolicy: mocks.getUserExecutionPolicy,
  logCommandExecution: mocks.logCommandExecution,
}));

const caller = () => executionPolicyRouter.createCaller({ userId: 'user-1' } as any);

describe('executionPolicyRouter', () => {
  beforeEach(() => {
    mocks.getUserExecutionPolicy.mockReset();
    mocks.logCommandExecution.mockReset().mockResolvedValue(undefined);
  });

  describe('get', () => {
    it('resolves the policy for the calling user', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce({ commandMode: 'sandbox' });

      const result = await caller().get();

      expect(result).toEqual({ commandMode: 'sandbox' });
      expect(mocks.getUserExecutionPolicy).toHaveBeenCalledWith('user-1', expect.anything());
    });

    it('resolves null when the user has no policy configured', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce(null);

      const result = await caller().get();

      expect(result).toBeNull();
    });
  });

  describe('logFileAccess', () => {
    it('persists a blocked-file-access row scoped to the calling user and local target', async () => {
      await caller().logFileAccess({
        apiName: 'writeFile',
        matchedField: 'deniedWriteRoots',
        path: '/Users/alice/.ssh/config',
      });

      expect(mocks.logCommandExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'writeFile',
          executionTarget: 'local',
          path: '/Users/alice/.ssh/config',
          toolIdentifier: 'lobe-local-system',
          userId: 'user-1',
        }),
        { blocked: true, matchedField: 'deniedWriteRoots' },
        expect.anything(),
      );
    });

    it('rejects an invalid matchedField before ever calling logCommandExecution', async () => {
      await expect(
        caller().logFileAccess({
          apiName: 'writeFile',
          matchedField: 'somethingElse' as any,
          path: '/Users/alice/.ssh/config',
        }),
      ).rejects.toThrow();

      expect(mocks.logCommandExecution).not.toHaveBeenCalled();
    });

    it('rejects an empty path', async () => {
      await expect(
        caller().logFileAccess({
          apiName: 'writeFile',
          matchedField: 'deniedWriteRoots',
          path: '',
        }),
      ).rejects.toThrow();
    });
  });
});
