import {
  ABANDONED_OPERATION_ERROR_PREFIX,
  DEVICE_OFFLINE_RUN_STATUS,
  LEASE_EXPIRED_ERROR,
} from '@lobechat/const/goal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrphanedRunningTopic } from '@/database/models/task';

import { isRunAlreadySettled, ORPHANED_RUN_GRACE_MS, reconcileOrphanedTaskRuns } from './reconcile';

const {
  findOrphanedRunningTopics,
  findRunByTopicId,
  findTaskById,
  claimRun,
  onTopicComplete,
  releaseRun,
} = vi.hoisted(() => ({
  findOrphanedRunningTopics: vi.fn(),
  findRunByTopicId: vi.fn(),
  findTaskById: vi.fn(),
  claimRun: vi.fn(),
  onTopicComplete: vi.fn(),
  releaseRun: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: Object.assign(
    vi.fn(function () {
      return { findById: findTaskById };
    }),
    {
      findOrphanedRunningTopics: (...args: unknown[]) => findOrphanedRunningTopics(...args),
    },
  ),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return { findByTopicId: findRunByTopicId };
  }),
}));

vi.mock('@/database/repositories/taskRunClaim', () => ({
  TaskRunClaimRepo: vi.fn(function () {
    return { claim: claimRun, release: releaseRun };
  }),
}));

vi.mock('./index', () => ({
  TaskLifecycleService: vi.fn(function () {
    return { onTopicComplete };
  }),
}));

const orphanedRun = (overrides: Partial<OrphanedRunningTopic> = {}): OrphanedRunningTopic => ({
  completionReason: 'lease_expired',
  operationError: null,
  operationId: 'op-1',
  operationStatus: 'abandoned',
  taskId: 'task-1',
  taskIdentifier: 'T-1',
  topicId: 'tpc-1',
  trigger: 'goal',
  userId: 'user-1',
  workspaceId: null,
  ...overrides,
});

const db = {} as never;

describe('reconcileOrphanedTaskRuns', () => {
  beforeEach(() => {
    findOrphanedRunningTopics.mockReset().mockResolvedValue([]);
    claimRun.mockReset().mockResolvedValue(true);
    onTopicComplete.mockReset().mockResolvedValue(undefined);
    releaseRun.mockReset().mockResolvedValue(true);
    findTaskById.mockReset().mockResolvedValue({ id: 'task-1', status: 'running' });
    findRunByTopicId.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles a run whose operation ended without reaching its Task', async () => {
    findOrphanedRunningTopics.mockResolvedValue([orphanedRun()]);

    const result = await reconcileOrphanedTaskRuns(db);

    // The claim is what makes the settle single-owner, and it must name the
    // operation so a newer run on the same Task can never be the one settled.
    expect(claimRun).toHaveBeenCalledWith('tpc-1', 'op-1', 'failed');
    // The Task is settled by driving the ordinary lifecycle — not by a second
    // implementation of it — so every Task kind keeps the behaviour the lost
    // hook would have produced.
    expect(onTopicComplete).toHaveBeenCalledWith({
      errorCode: undefined,
      errorMessage: `${ABANDONED_OPERATION_ERROR_PREFIX} lease_expired`,
      operationId: 'op-1',
      reason: 'error',
      runTrigger: 'goal',
      taskId: 'task-1',
      taskIdentifier: 'T-1',
      topicId: 'tpc-1',
    });
    expect(result).toMatchObject({ checked: 1, converged: ['tpc-1'], failed: [], skipped: [] });
  });

  it('prefers the failure the operation recorded, so its classification survives', async () => {
    findOrphanedRunningTopics.mockResolvedValue([
      orphanedRun({
        completionReason: 'error',
        operationError: { message: 'DEVICE_OFFLINE' },
        operationStatus: 'error',
      }),
    ]);

    await reconcileOrphanedTaskRuns(db);

    // `resolveFailedRunStatus` reads the message, so a device-offline run stays
    // an offline run — worth-not-charging-to-the-attempt-budget behaviour that
    // the goal recovery keys on, rather than being flattened into a plain
    // failure.
    expect(claimRun).toHaveBeenCalledWith('tpc-1', 'op-1', DEVICE_OFFLINE_RUN_STATUS);
    expect(onTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'DEVICE_OFFLINE' }),
    );
  });

  it('reads a provider failure nested in the raw runtime error payload', async () => {
    // Regression: `agent_operations.error` stores the raw `state.error`, whose
    // message sits under `error`. Reading only the top-level `message` turned a
    // real quota failure into a lost run — retried by the Goal coordinator as if
    // nothing had judged it, and briefed without its "Upgrade plan" remedy.
    findOrphanedRunningTopics.mockResolvedValue([
      orphanedRun({
        completionReason: 'error',
        operationError: {
          error: { message: 'You exceeded your current quota' },
          errorType: 'InsufficientBudgetForModel',
          provider: 'openai',
        },
        operationStatus: 'error',
      }),
    ]);

    await reconcileOrphanedTaskRuns(db);

    expect(onTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'InsufficientBudgetForModel',
        errorMessage: 'You exceeded your current quota',
      }),
    );
  });

  it('settles a silent end as a lost run, not as a judged failure', async () => {
    findOrphanedRunningTopics.mockResolvedValue([
      orphanedRun({ completionReason: null, operationStatus: 'error' }),
    ]);

    await reconcileOrphanedTaskRuns(db);

    // Nothing judged the work, so the recovery is another attempt — the goal
    // coordinator reads `lease expired` as exactly that. A made-up failure text
    // here would open a decision gate on a human instead.
    expect(onTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: LEASE_EXPIRED_ERROR }),
    );
    expect(claimRun).toHaveBeenCalledWith('tpc-1', 'op-1', 'failed');
  });

  it('leaves a row another writer already claimed alone', async () => {
    findOrphanedRunningTopics.mockResolvedValue([orphanedRun()]);
    claimRun.mockResolvedValue(false);

    const result = await reconcileOrphanedTaskRuns(db);

    expect(onTopicComplete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, converged: [], skipped: ['tpc-1'] });
  });

  it('hands the row back when the settle fails, so the next pass retries it', async () => {
    findOrphanedRunningTopics.mockResolvedValue([orphanedRun()]);
    onTopicComplete.mockRejectedValue(new Error('lifecycle exploded'));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await reconcileOrphanedTaskRuns(db);

    // A claimed-but-unsettled row is the very shape this reconciliation exists
    // to remove, so it must not be left terminal with its Task still `running`.
    expect(releaseRun).toHaveBeenCalledWith('tpc-1', 'op-1', 'failed');
    expect(result).toMatchObject({ checked: 1, converged: [], failed: ['tpc-1'] });
    expect(consoleError).toHaveBeenCalled();
  });

  it('keeps the run settled when the settle failed after the Task moved on', async () => {
    // Regression: the lifecycle can throw after it already parked the Task
    // (`paused` / `scheduled`). Re-opening the run then would strand it — the
    // finder only picks runs whose Task is still `running`, so a `running` run
    // under a paused Task would never be retried.
    findOrphanedRunningTopics.mockResolvedValue([orphanedRun()]);
    onTopicComplete.mockRejectedValue(new Error('final findById failed'));
    findTaskById.mockResolvedValue({ id: 'task-1', status: 'paused' });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await reconcileOrphanedTaskRuns(db);

    expect(releaseRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, converged: [], failed: ['tpc-1'] });
    expect(consoleError).toHaveBeenCalled();
  });

  it('scopes the scan to runs that have been over for the grace window', async () => {
    await reconcileOrphanedTaskRuns(db);

    const [, options] = findOrphanedRunningTopics.mock.calls[0];
    expect(options.staleBefore.getTime()).toBeCloseTo(Date.now() - ORPHANED_RUN_GRACE_MS, -4);
  });

  it('passes an explicit window and limit through, for a bounded catch-up pass', async () => {
    const staleBefore = new Date('2026-07-01T00:00:00Z');

    await reconcileOrphanedTaskRuns(db, { limit: 5, staleBefore });

    expect(findOrphanedRunningTopics).toHaveBeenCalledWith(db, { limit: 5, staleBefore });
  });
});

describe('isRunAlreadySettled', () => {
  const callback = {
    operationId: 'op-1',
    reason: 'error',
    taskId: 'task-1',
    topicId: 'tpc-1',
  };

  beforeEach(() => {
    findOrphanedRunningTopics.mockReset().mockResolvedValue([]);
    claimRun.mockReset().mockResolvedValue(true);
    onTopicComplete.mockReset().mockResolvedValue(undefined);
    findRunByTopicId.mockReset();
    findTaskById.mockReset();
  });

  it('fences a delayed failure callback that lands after the sweep settled the run', async () => {
    // Regression: the sweep's claim only excluded competing sweeps. A QStash
    // delivery delayed past the grace window then drove the same lifecycle a
    // second time — a duplicate urgent error brief, the fuse counted twice.
    const run = { operationId: 'op-1', status: 'running', taskId: 'task-1', topicId: 'tpc-1' };
    const task = { id: 'task-1', status: 'running' };
    findRunByTopicId.mockImplementation(async () => run);
    findTaskById.mockImplementation(async () => task);
    findOrphanedRunningTopics.mockResolvedValue([orphanedRun()]);
    claimRun.mockImplementation(async (_topicId, _opId, status) => {
      run.status = status;
      return true;
    });
    onTopicComplete.mockImplementation(async () => {
      task.status = 'paused';
    });

    // Before the sweep, the callback is the one settling the run.
    expect(await isRunAlreadySettled(db, 'user-1', undefined, callback)).toBe(false);

    await reconcileOrphanedTaskRuns(db);

    expect(await isRunAlreadySettled(db, 'user-1', undefined, callback)).toBe(true);
  });

  it('lets a retry through when an earlier settle broke before moving the Task on', async () => {
    findRunByTopicId.mockResolvedValue({
      operationId: 'op-1',
      status: 'failed',
      taskId: 'task-1',
      topicId: 'tpc-1',
    });
    findTaskById.mockResolvedValue({ id: 'task-1', status: 'running' });

    expect(await isRunAlreadySettled(db, 'user-1', undefined, callback)).toBe(false);
  });

  it('never fences a run row a newer operation now owns', async () => {
    findRunByTopicId.mockResolvedValue({
      operationId: 'op-2',
      status: 'failed',
      taskId: 'task-1',
      topicId: 'tpc-1',
    });
    findTaskById.mockResolvedValue({ id: 'task-1', status: 'paused' });

    expect(await isRunAlreadySettled(db, 'user-1', undefined, callback)).toBe(false);
  });

  it('leaves successful and interrupted deliveries alone', async () => {
    findRunByTopicId.mockResolvedValue({
      operationId: 'op-1',
      status: 'canceled',
      taskId: 'task-1',
      topicId: 'tpc-1',
    });
    findTaskById.mockResolvedValue({ id: 'task-1', status: 'paused' });

    expect(
      await isRunAlreadySettled(db, 'user-1', undefined, { ...callback, reason: 'done' }),
    ).toBe(false);
    expect(
      await isRunAlreadySettled(db, 'user-1', undefined, { ...callback, reason: 'interrupted' }),
    ).toBe(false);
    expect(findRunByTopicId).not.toHaveBeenCalled();
  });
});
