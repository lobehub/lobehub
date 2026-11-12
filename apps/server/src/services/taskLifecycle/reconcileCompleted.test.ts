import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskRunClaimRepo } from '@/database/repositories/taskRunClaim';

import { ORPHANED_RUN_GRACE_MS } from './constants';
import { reconcileCompletedTaskRuns } from './reconcileCompleted';

const { findCompletedRunningTopics, claim } = vi.hoisted(() => ({
  findCompletedRunningTopics: vi.fn(),
  claim: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: { findCompletedRunningTopics },
}));
vi.mock('@/database/repositories/taskRunClaim', () => ({
  TaskRunClaimRepo: vi.fn(function () {
    return { claim };
  }),
}));

const db = {} as never;
const row = (topicId = 'tpc-1') => ({
  operationId: `op-${topicId}`,
  topicId,
  userId: 'user-1',
  workspaceId: null,
});

describe('reconcileCompletedTaskRuns', () => {
  beforeEach(() => {
    findCompletedRunningTopics.mockReset().mockResolvedValue([]);
    claim.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('settles only the owned run as completed', async () => {
    findCompletedRunningTopics.mockResolvedValue([row()]);
    expect(await reconcileCompletedTaskRuns(db)).toEqual({
      checked: 1,
      converged: ['tpc-1'],
      failed: [],
      skipped: [],
    });
    expect(claim).toHaveBeenCalledWith('tpc-1', 'op-tpc-1', 'completed');
  });

  it.each([null, 'workspace-1'])(
    'uses the row workspace scope %s for the atomic claim',
    async (workspaceId) => {
      findCompletedRunningTopics.mockResolvedValue([{ ...row(), workspaceId }]);
      await reconcileCompletedTaskRuns(db);
      expect(TaskRunClaimRepo).toHaveBeenCalledWith(db, 'user-1', workspaceId ?? undefined);
    },
  );

  it('skips a run another writer already took over', async () => {
    findCompletedRunningTopics.mockResolvedValue([row()]);
    claim.mockResolvedValue(false);
    expect(await reconcileCompletedTaskRuns(db)).toEqual({
      checked: 1,
      converged: [],
      failed: [],
      skipped: ['tpc-1'],
    });
  });

  it('continues settling other runs when one atomic claim fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    findCompletedRunningTopics.mockResolvedValue([row(), row('tpc-2')]);
    claim.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await reconcileCompletedTaskRuns(db)).toEqual({
      checked: 2,
      converged: ['tpc-2'],
      failed: ['tpc-1'],
      skipped: [],
    });
  });

  it('waits the shared grace window before discovering completions', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-02T15:00:00Z');
    vi.setSystemTime(now);
    await reconcileCompletedTaskRuns(db);
    expect(findCompletedRunningTopics).toHaveBeenCalledWith(db, {
      limit: undefined,
      staleBefore: new Date(now.getTime() - ORPHANED_RUN_GRACE_MS),
    });
  });

  it('passes an explicit window and limit through', async () => {
    const staleBefore = new Date('2026-10-02T15:00:00Z');
    await reconcileCompletedTaskRuns(db, { limit: 3, staleBefore });
    expect(findCompletedRunningTopics).toHaveBeenCalledWith(db, { limit: 3, staleBefore });
  });
});
