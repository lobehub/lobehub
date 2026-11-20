import { TRANSIENT_FAILED_RUN_STATUS } from '@lobechat/const/goal';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ORPHANED_RUN_GRACE_MS } from '@/server/services/taskLifecycle/reconcile';

import { clearBlockingRun } from './runConflict';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  findById: vi.fn(),
  findByTopicId: vi.fn(),
  findLiveByTopic: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.findById, findLiveByTopic: mocks.findLiveByTopic };
  }),
}));
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn().mockImplementation(function () {
    return { findByTopicId: mocks.findByTopicId };
  }),
}));
vi.mock('@/database/repositories/taskRunClaim', () => ({
  TaskRunClaimRepo: vi.fn().mockImplementation(function () {
    return { claim: mocks.claim };
  }),
}));
vi.mock('@/server/services/taskLifecycle', () => ({ TaskLifecycleService: vi.fn() }));

const NOW = Date.parse('2026-11-18T02:00:00.000Z');
const LONG_AGO = new Date(NOW - 6 * 60 * 60 * 1000);
const JUST_NOW = new Date(NOW - 60 * 1000);

const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    operationId: 'op_old',
    status: 'running',
    taskId: 'task-1',
    topicId: 'tpc_stale',
    ...overrides,
  }) as any;

const operation = (overrides: Record<string, unknown> = {}) => ({
  completedAt: LONG_AGO,
  completionReason: 'done',
  error: null,
  id: 'op_old',
  status: 'done',
  updatedAt: LONG_AGO,
  ...overrides,
});

describe('clearBlockingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findLiveByTopic.mockResolvedValue([]);
    mocks.claim.mockResolvedValue(true);
  });

  describe('leftover runs', () => {
    it('settles a run whose operation finished hours ago, so the new run can start', async () => {
      mocks.findById.mockResolvedValue(operation());

      await expect(
        clearBlockingRun(ctx, row(), { continuing: false, now: NOW }),
      ).resolves.toBeUndefined();

      expect(mocks.claim).toHaveBeenCalledWith('tpc_stale', 'op_old', 'completed');
    });

    it('settles an interrupted run the way a Stop would', async () => {
      mocks.findById.mockResolvedValue(
        operation({ completionReason: 'interrupted', status: 'interrupted' }),
      );

      await clearBlockingRun(ctx, row(), { continuing: true, now: NOW });

      expect(mocks.claim).toHaveBeenCalledWith('tpc_stale', 'op_old', 'canceled');
    });

    it('settles an abandoned run with no recorded error as failed, like the sweep', async () => {
      mocks.findById.mockResolvedValue(
        operation({ completionReason: 'lease_expired', status: 'abandoned' }),
      );

      await clearBlockingRun(ctx, row(), { continuing: false, now: NOW });

      expect(mocks.claim).toHaveBeenCalledWith('tpc_stale', 'op_old', 'failed');
    });

    it('keeps a transient provider failure retryable', async () => {
      mocks.findById.mockResolvedValue(
        operation({
          completionReason: 'error',
          error: { message: 'fetch failed' },
          status: 'error',
        }),
      );

      await clearBlockingRun(ctx, row(), { continuing: false, now: NOW });

      expect(mocks.claim).toHaveBeenCalledWith('tpc_stale', 'op_old', TRANSIENT_FAILED_RUN_STATUS);
    });

    it('settles a run that recorded a plain failure as failed', async () => {
      mocks.findById.mockResolvedValue(
        operation({
          completionReason: 'error',
          error: { message: 'Tool call failed: invalid arguments' },
          status: 'error',
        }),
      );

      await clearBlockingRun(ctx, row(), { continuing: false, now: NOW });

      expect(mocks.claim).toHaveBeenCalledWith('tpc_stale', 'op_old', 'failed');
    });

    it('goes ahead when another writer settled the row first', async () => {
      mocks.findById.mockResolvedValue(operation());
      mocks.claim.mockResolvedValue(false);
      mocks.findByTopicId.mockResolvedValue(row({ status: 'completed' }));

      await expect(
        clearBlockingRun(ctx, row(), { continuing: false, now: NOW }),
      ).resolves.toBeUndefined();
    });

    it('refuses when a newer run took the row over in the meantime', async () => {
      mocks.findById
        .mockResolvedValueOnce(operation())
        .mockResolvedValueOnce(
          operation({ completedAt: null, id: 'op_new', status: 'running', updatedAt: JUST_NOW }),
        );
      mocks.claim.mockResolvedValue(false);
      mocks.findByTopicId.mockResolvedValue(row({ operationId: 'op_new' }));

      await expect(
        clearBlockingRun(ctx, row(), { continuing: false, now: NOW }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('operation op_new is running'),
      });
    });
  });

  describe('real conflicts', () => {
    it('names the live operation, its status and how to stop it', async () => {
      mocks.findById.mockResolvedValue(
        operation({ completedAt: null, status: 'waiting_for_client', updatedAt: JUST_NOW }),
      );

      const error = await clearBlockingRun(ctx, row(), { continuing: false, now: NOW }).catch(
        (e) => e,
      );

      expect(error).toMatchObject({ code: 'CONFLICT' });
      expect(error.message).toBe(
        `Task already has a running topic (tpc_stale): operation op_old is waiting_for_client (last update ${JUST_NOW.toISOString()}). Wait for it to finish, or stop it first with \`lh task topic cancel tpc_stale\` (this pauses the task; resume it afterwards).`,
      );
      expect(mocks.claim).not.toHaveBeenCalled();
    });

    it('treats a topic with another operation in flight as live', async () => {
      mocks.findById.mockResolvedValue(operation());
      mocks.findLiveByTopic.mockResolvedValue([
        operation({ completedAt: null, id: 'op_followup', status: 'running', updatedAt: JUST_NOW }),
      ]);

      await expect(
        clearBlockingRun(ctx, row(), { continuing: true, now: NOW }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringMatching(
          /^Topic tpc_stale is already running: operation op_followup is running/,
        ),
      });
      expect(mocks.claim).not.toHaveBeenCalled();
    });

    it('leaves a run that just ended to its own completion hook', async () => {
      mocks.findById.mockResolvedValue(operation({ completedAt: JUST_NOW, status: 'error' }));

      const error = await clearBlockingRun(ctx, row(), { continuing: false, now: NOW }).catch(
        (e) => e,
      );

      expect(error).toMatchObject({ code: 'CONFLICT' });
      expect(error.message).toContain(
        `ended (error) at ${JUST_NOW.toISOString()} and its result is still being recorded`,
      );
      expect(error.message).toContain(
        `Retry after ${new Date(JUST_NOW.getTime() + ORPHANED_RUN_GRACE_MS).toISOString()}`,
      );
      expect(mocks.claim).not.toHaveBeenCalled();
    });

    it('does not guess when the operation cannot be found', async () => {
      mocks.findById.mockResolvedValue(undefined);

      await expect(
        clearBlockingRun(ctx, row(), { continuing: false, now: NOW }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('no operation can be found for it'),
      });
      expect(mocks.claim).not.toHaveBeenCalled();
    });

    it('does not guess when the row names no operation', async () => {
      await expect(
        clearBlockingRun(ctx, row({ operationId: null }), { continuing: false, now: NOW }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(mocks.findById).not.toHaveBeenCalled();
    });
  });
});
