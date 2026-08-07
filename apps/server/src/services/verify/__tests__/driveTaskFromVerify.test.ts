// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { driveTaskFromVerify, finalizeVerifyRun } from '../settle';

vi.mock('../repairService', () => ({
  maybeAutoRepair: vi.fn(),
}));
vi.mock('../reporter', () => ({
  VerifyReporterService: vi.fn(() => ({ generateReport: vi.fn() })),
}));

const {
  runFindByOperation,
  runClaimTaskDrive,
  runSetMetadata,
  opFindById,
  taskFindById,
  taskGetGoalConfig,
  taskUpdateStatus,
  briefCreate,
  serviceUpdateStatus,
  statusRecompute,
  deliverMock,
  goalContinueMock,
  goalSyncMock,
} = vi.hoisted(() => ({
  briefCreate: vi.fn(),
  deliverMock: vi.fn(),
  goalContinueMock: vi.fn(),
  goalSyncMock: vi.fn(),
  opFindById: vi.fn(),
  runFindByOperation: vi.fn(),
  runClaimTaskDrive: vi.fn().mockResolvedValue(true),
  runSetMetadata: vi.fn(),
  serviceUpdateStatus: vi.fn(),
  statusRecompute: vi.fn(),
  taskFindById: vi.fn(),
  taskGetGoalConfig: vi.fn(),
  taskUpdateStatus: vi.fn(),
}));

vi.mock('../goalLoop', () => ({
  goalExhaustedBriefCopy: (task: any, outcome: string) => ({
    summary: `budget exhausted (${outcome})`,
    title: `${task.identifier} goal paused`,
  }),
  goalReadyForReviewBriefCopy: (task: any, acceptanceId?: string) => ({
    actions: acceptanceId
      ? [{ key: 'review', type: 'link', url: `/acceptance/${acceptanceId}` }]
      : [],
    summary: 'ready for your sign-off',
    title: `${task.identifier} goal delivered`,
  }),
  maybeContinueGoalLoop: goalContinueMock,
  resolveGoalRoundBudget: (goal: any) =>
    goal.maxIterations === null ? Number.POSITIVE_INFINITY : (goal.maxIterations ?? 3),
  syncGoalToolState: goalSyncMock,
}));

vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(() => ({ recompute: statusRecompute })),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    claimTaskDrive: runClaimTaskDrive,
    findByOperation: runFindByOperation,
    setMetadata: runSetMetadata,
  })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: opFindById })),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    findById: taskFindById,
    getGoalConfig: taskGetGoalConfig,
    updateStatus: taskUpdateStatus,
  })),
}));
vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(() => ({ create: briefCreate })),
}));
// Resolved via dynamic import inside driveTaskFromVerify (cycle break).
vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(() => ({ updateStatus: serviceUpdateStatus })),
}));
// The deferred creator callback, also resolved via dynamic import.
vi.mock('@/server/services/taskResultBridge', () => ({
  TaskResultBridgeService: vi.fn(() => ({ deliver: deliverMock })),
}));

const db = {} as any;

describe('driveTaskFromVerify', () => {
  beforeEach(() => {
    [
      runClaimTaskDrive,
      runFindByOperation,
      runSetMetadata,
      opFindById,
      taskFindById,
      taskGetGoalConfig,
      taskUpdateStatus,
      briefCreate,
      serviceUpdateStatus,
      statusRecompute,
      deliverMock,
      goalContinueMock,
      goalSyncMock,
    ].forEach((m) => m.mockReset());
    // The drive is claimed before any side effect; unclaimed means "someone
    // else is driving this run", which every test here is not.
    runClaimTaskDrive.mockResolvedValue(true);
    opFindById.mockResolvedValue({ taskId: 'task-1', topicId: 'topic-done' });
    taskFindById.mockResolvedValue({
      assigneeAgentId: 'a1',
      id: 'task-1',
      identifier: 'T-1',
      status: 'running',
    });
    taskGetGoalConfig.mockReturnValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('passed → completes the task (with cascade), delivers the creator callback, marks done', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'passed' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
    // Deferred creator callback fires here (not in onTopicComplete), reason 'done'.
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(deliverMock.mock.calls[0][0]).toMatchObject({
      reason: 'done',
      taskId: 'task-1',
      taskIdentifier: 'T-1',
      topicId: 'topic-done',
    });
    expect(runClaimTaskDrive).toHaveBeenCalledWith('run-1');
  });

  it('passed → keeps a recurring task scheduled', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'passed' });
    taskFindById.mockResolvedValue({
      assigneeAgentId: 'a1',
      automationMode: 'heartbeat',
      id: 'task-1',
      identifier: 'T-1',
      status: 'scheduled',
    });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).not.toHaveBeenCalled();
    expect(deliverMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'done', taskId: 'task-1' }),
    );
    expect(runClaimTaskDrive).toHaveBeenCalledWith('run-1');
  });

  it('settles the owning task when the passing verify run belongs to a repair child', async () => {
    runFindByOperation.mockResolvedValue({ id: 'repair-run', metadata: null, status: 'passed' });
    opFindById.mockImplementation(async (id: string) =>
      id === 'repair-op'
        ? { parentOperationId: 'root-op', taskId: null, topicId: 'topic-repair' }
        : { parentOperationId: null, taskId: 'task-1', topicId: 'topic-original' },
    );

    await driveTaskFromVerify(db, 'u1', 'repair-op');

    expect(serviceUpdateStatus).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
    expect(deliverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'repair-op',
        taskId: 'task-1',
        topicId: 'topic-repair',
      }),
    );
  });

  it('collapses every ancestor round out of repairing when a multi-repair child settles', async () => {
    runFindByOperation.mockResolvedValue({ id: 'repair-run', metadata: null, status: 'passed' });
    opFindById.mockImplementation(async (id: string) =>
      id === 'repair-op-2'
        ? { parentOperationId: 'repair-op-1', taskId: null, topicId: 'topic-repair' }
        : id === 'repair-op-1'
          ? { parentOperationId: 'root-op', taskId: null, topicId: 'topic-repair' }
          : { parentOperationId: null, taskId: 'task-1', topicId: 'topic-original' },
    );

    await finalizeVerifyRun(db, 'u1', 'repair-op-2', {});

    expect(statusRecompute.mock.calls).toEqual([['repair-op-1'], ['root-op']]);
  });

  it('failed → urgent brief + pauses with the reason on the task row', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'failed' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(briefCreate).toHaveBeenCalled();
    // The reason must live on the task row, not only in a brief: the task
    // detail feed deliberately excludes briefs, so a brief-only explanation is
    // unreachable from the task page.
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Delivery did not pass verification.',
    });
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    // Creator is told it failed verification (reason 'error'), not a passed result.
    expect(deliverMock.mock.calls[0][0]).toMatchObject({ reason: 'error', taskId: 'task-1' });
  });

  it('errored → pauses with a non-accusatory brief; never claims the delivery "did not pass"', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'errored' });
    await driveTaskFromVerify(db, 'u1', 'op-1');

    // Paused for a human, but NOT completed — the delivery was never evaluated.
    expect(taskUpdateStatus).toHaveBeenCalledWith(
      'task-1',
      'paused',
      expect.objectContaining({ error: expect.stringContaining('could not run') }),
    );
    expect(serviceUpdateStatus).not.toHaveBeenCalled();

    // The brief frames it as an internal verification error, not a rejected delivery.
    const briefArg = briefCreate.mock.calls[0][0];
    expect(briefArg.summary).not.toContain('did not pass');
    expect(briefArg.summary.toLowerCase()).toContain('could not run');

    // The creator callback is an error, but the message must NOT accuse the
    // delivery of failing verification.
    const deliverArg = deliverMock.mock.calls[0][0];
    expect(deliverArg.reason).toBe('error');
    expect(deliverArg.errorMessage).not.toBe('Delivery did not pass verification.');
    expect(deliverArg.errorMessage.toLowerCase()).toContain('internal error');
  });

  it('skips when the run has not terminally settled (verifying/repairing)', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'verifying' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).not.toHaveBeenCalled();
  });

  it('skips a non-task-bound run', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'passed' });
    opFindById.mockResolvedValue({ taskId: null });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
  });

  it('is idempotent — does not re-drive once taskDrivenAt is set', async () => {
    runFindByOperation.mockResolvedValue({
      id: 'run-1',
      metadata: { taskDrivenAt: '2026-01-01' },
      status: 'passed',
    });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
  });

  it('skips when the task is already terminal', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'passed' });
    taskFindById.mockResolvedValue({ id: 'task-1', status: 'completed' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
  });

  describe('goal outer loop', () => {
    const goalTask = {
      assigneeAgentId: 'a1',
      id: 'task-1',
      identifier: 'T-1',
      status: 'running',
      totalTopics: 1,
    };
    const goal = { maxIterations: 3, maxTotalCost: null, originTopicId: 'origin-t' };

    beforeEach(() => {
      taskFindById.mockResolvedValue(goalTask);
      taskGetGoalConfig.mockReturnValue(goal);
    });

    it('failed + budget left → spawns the next round silently (no brief, no pause, no callback)', async () => {
      runFindByOperation.mockResolvedValue({
        id: 'run-1',
        metadata: { maxRepairRounds: 2 },
        status: 'failed',
      });
      goalContinueMock.mockResolvedValue('continued');

      await driveTaskFromVerify(db, 'u1', 'op-1');

      expect(goalContinueMock).toHaveBeenCalledWith(
        expect.objectContaining({ goal, task: goalTask }),
      );
      expect(briefCreate).not.toHaveBeenCalled();
      expect(taskUpdateStatus).not.toHaveBeenCalled();
      expect(deliverMock).not.toHaveBeenCalled();
      // The claim both stamps the marker and proves we own this drive.
      expect(runClaimTaskDrive).toHaveBeenCalledWith('run-1');
      expect(goalSyncMock).toHaveBeenCalledWith(
        expect.objectContaining({ state: expect.objectContaining({ phase: 'running' }) }),
      );
    });

    it('does nothing when another callback already claimed the drive', async () => {
      // Two verifier callbacks can settle together; only the claim winner acts.
      runClaimTaskDrive.mockResolvedValue(false);

      await driveTaskFromVerify({} as never, 'user-1', 'op-1');

      expect(goalContinueMock).not.toHaveBeenCalled();
      expect(taskUpdateStatus).not.toHaveBeenCalled();
      expect(serviceUpdateStatus).not.toHaveBeenCalled();
      expect(briefCreate).not.toHaveBeenCalled();
    });

    it('failed + budget exhausted → pauses with budget-specific brief copy', async () => {
      runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'failed' });
      goalContinueMock.mockResolvedValue('exhausted-rounds');

      await driveTaskFromVerify(db, 'u1', 'op-1');

      // Reason on the row, not only in the brief — see the failed-branch test.
      expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
        error: 'budget exhausted (exhausted-rounds)',
      });
      const briefArg = briefCreate.mock.calls[0][0];
      expect(briefArg.summary).toContain('budget exhausted (exhausted-rounds)');
      expect(goalSyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({ pausedReason: 'exhausted-rounds', phase: 'paused' }),
        }),
      );
    });

    it('failed + spawn failure → falls back to the regular pause + brief path', async () => {
      runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'failed' });
      goalContinueMock.mockResolvedValue('spawn-failed');

      await driveTaskFromVerify(db, 'u1', 'op-1');

      expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
        error: 'Delivery did not pass verification.',
      });
      expect(briefCreate.mock.calls[0][0].summary).toContain('did not pass');
    });

    it('errored → never loops (verification did not run), pauses like a non-goal task', async () => {
      runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'errored' });

      await driveTaskFromVerify(db, 'u1', 'op-1');

      expect(goalContinueMock).not.toHaveBeenCalled();
      expect(taskUpdateStatus).toHaveBeenCalledWith(
        'task-1',
        'paused',
        expect.objectContaining({ error: expect.stringContaining('could not run') }),
      );
    });

    it('passed → parks for sign-off instead of completing (the verifier only recommends)', async () => {
      runFindByOperation.mockResolvedValue({
        acceptanceId: 'acc-9',
        id: 'run-1',
        metadata: null,
        status: 'passed',
      });

      await driveTaskFromVerify(db, 'u1', 'op-1');

      // The agent saying "done" is not the business fact — the human sign-off is.
      expect(serviceUpdateStatus).not.toHaveBeenCalled();
      // A converged goal and a goal that gave up both land on `paused`; only the
      // reason on the row tells them apart in the UI.
      expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
        error: 'ready for your sign-off',
      });
      expect(goalSyncMock).toHaveBeenCalledWith(
        expect.objectContaining({ state: expect.objectContaining({ phase: 'review' }) }),
      );
    });

    it('passed → raises exactly one decision brief that links to the acceptance', async () => {
      runFindByOperation.mockResolvedValue({
        acceptanceId: 'acc-9',
        id: 'run-1',
        metadata: null,
        status: 'passed',
      });

      await driveTaskFromVerify(db, 'u1', 'op-1');

      expect(briefCreate).toHaveBeenCalledTimes(1);
      const brief = briefCreate.mock.calls[0][0];
      // `result` would be filed under "news" and its approve completes the task,
      // bypassing the sign-off this branch exists to require.
      expect(brief.type).toBe('decision');
      expect(brief.actions).toEqual([
        expect.objectContaining({ type: 'link', url: '/acceptance/acc-9' }),
      ]);
    });
  });

  it('non-goal task still completes on a passing verify (contract unchanged)', async () => {
    taskGetGoalConfig.mockReturnValue(undefined);
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'passed' });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(serviceUpdateStatus).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
    expect(briefCreate).not.toHaveBeenCalled();
  });
});
