// @vitest-environment node
import {
  ACCEPTANCE_REVIEW_ERRORED_ERROR,
  VERIFICATION_ERRORED_ERROR,
  VERIFICATION_UNJUDGEABLE_ERROR,
} from '@lobechat/const/goal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { reviewGoalDelivery } from '../goalReview';
import { maybeAutoRepair } from '../repairService';
import { driveTaskFromVerify, finalizeVerifyRun } from '../settle';
import { attachTaskRunToAcceptance, resolveTaskAcceptance } from '../taskAcceptance';

vi.mock('../goalReview', () => ({ reviewGoalDelivery: vi.fn() }));
vi.mock('../taskAcceptance', () => ({
  attachTaskRunToAcceptance: vi.fn(),
  resolveTaskAcceptance: vi.fn(),
}));

vi.mock('../repairService', () => ({
  maybeAutoRepair: vi.fn(),
}));
vi.mock('../reporter', () => ({
  VerifyReporterService: vi.fn(function () {
    return { generateReport: vi.fn() };
  }),
}));

const {
  goalFindByTask,
  runFindByOperation,
  runClaimTaskDrive,
  runSetMetadata,
  opFindById,
  taskFindById,
  taskUpdateStatus,
  briefModelConstruct,
  briefCreate,
  serviceUpdateStatus,
  statusRecompute,
  deliverMock,
} = vi.hoisted(() => ({
  goalFindByTask: vi.fn(),
  briefCreate: vi.fn(),
  briefModelConstruct: vi.fn(),
  deliverMock: vi.fn(),
  opFindById: vi.fn(),
  runFindByOperation: vi.fn(),
  runClaimTaskDrive: vi.fn().mockResolvedValue(true),
  runSetMetadata: vi.fn(),
  serviceUpdateStatus: vi.fn(),
  statusRecompute: vi.fn(),
  taskFindById: vi.fn(),
  taskUpdateStatus: vi.fn(),
}));

vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { recompute: statusRecompute };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      claimTaskDrive: runClaimTaskDrive,
      findByOperation: runFindByOperation,
      setMetadata: runSetMetadata,
    };
  }),
}));
const { checkResultsListByRun } = vi.hoisted(() => ({
  checkResultsListByRun: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: checkResultsListByRun };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: opFindById };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return {
      findById: taskFindById,
      updateStatus: taskUpdateStatus,
    };
  }),
}));
vi.mock('@/database/models/brief', () => ({
  BriefModel: briefModelConstruct,
}));
// Resolved via dynamic import inside driveTaskFromVerify (cycle break).
vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(function () {
    return { updateStatus: serviceUpdateStatus };
  }),
}));
// The deferred creator callback, also resolved via dynamic import.
vi.mock('@/server/services/taskResultBridge', () => ({
  TaskResultBridgeService: vi.fn(function () {
    return { deliver: deliverMock };
  }),
}));

const db = {} as any;

describe('driveTaskFromVerify', () => {
  it('does not overwrite a fast-failed repair when the parent finalizer resumes', async () => {
    runFindByOperation.mockImplementation(async (id: string) => ({
      id: id === 'repair-op' ? 'repair-run' : 'parent-run',
      status: id === 'repair-op' ? 'errored' : 'failed',
    }));
    vi.mocked(maybeAutoRepair).mockImplementationOnce(async () => {
      await driveTaskFromVerify(db, 'u1', 'repair-op');
      return { repairOperationId: 'repair-op' };
    });
    await finalizeVerifyRun(db, 'u1', 'parent-op', {});
    expect(taskUpdateStatus).toHaveBeenCalledTimes(1);
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: VERIFICATION_ERRORED_ERROR,
    });
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(runClaimTaskDrive).toHaveBeenCalledWith('repair-run');
    expect(runClaimTaskDrive).not.toHaveBeenCalledWith('parent-run');
  });

  it('automatically sends a Goal delivery back when Acceptance review rejects a Verify pass', async () => {
    runFindByOperation.mockResolvedValue({
      id: 'run-1',
      acceptanceId: 'acceptance-1',
      status: 'passed',
    });
    goalFindByTask.mockResolvedValue({ id: 'goal-1' });
    vi.mocked(reviewGoalDelivery).mockResolvedValueOnce({
      status: 'rejected',
      feedback: 'Fix the table',
      predictionIds: ['p1'],
    });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Delivery did not pass verification.',
    });
    expect(deliverMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'error' }));
    expect(scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1', trigger: 'settle' }),
    );
  });

  /**
   * Regression: an undecidable criterion paused the Task with the "did not pass"
   * contract string, which the coordinator routes to another attempt. The
   * builder re-delivered the same artifacts against the same criterion twice and
   * the attempt budget ran out. This string has no recovery branch, so the Goal
   * stops on a person instead.
   */
  /**
   * Regression: a rejected delivery reached the dispatching agent as the bare
   * "Delivery did not pass verification.", so it could not tell a real
   * shortfall from a gate misfire and re-verified by hand.
   */
  it('tells the dispatcher which checks failed and why', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    checkResultsListByRun.mockResolvedValueOnce([
      {
        checkItemTitle: 'Optional style polish',
        required: false,
        status: 'failed',
        suggestion: 'Tighten the intro.',
        toulmin: null,
        verdict: 'failed',
      },
      {
        checkItemTitle: 'Each chapter has at least 2500 characters',
        required: true,
        status: 'failed',
        suggestion: null,
        toulmin: { reasoning: 'Chapters 1-5 are 2030-2353 characters, all below 2500.' },
        verdict: 'failed',
      },
      {
        checkItemTitle: 'Report is in Markdown',
        required: true,
        status: 'passed',
        suggestion: null,
        toulmin: { reasoning: 'It is.' },
        verdict: 'passed',
      },
      {
        checkItemTitle: 'Sources are cited',
        required: true,
        status: 'errored',
        suggestion: null,
        toulmin: null,
        verdict: null,
      },
    ]);

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(checkResultsListByRun).toHaveBeenCalledWith('run-1');
    expect(deliverMock.mock.calls[0][0].errorMessage).toBe(
      [
        'Delivery did not pass verification.',
        'Failed checks:',
        '- Each chapter has at least 2500 characters: Chapters 1-5 are 2030-2353 characters, all below 2500.',
      ].join('\n'),
    );
  });

  it('explains a failure from stored evidence when the verifier gave no reasoning', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    checkResultsListByRun.mockResolvedValueOnce([
      {
        checkItemTitle: 'Screenshot shows the saved report',
        required: true,
        status: 'failed',
        suggestion: null,
        toulmin: { evidence: 'The screenshot shows an empty editor.' },
        verdict: 'failed',
      },
    ]);

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(deliverMock.mock.calls[0][0].errorMessage).toContain(
      '- Screenshot shows the saved report: The screenshot shows an empty editor.',
    );
  });

  it('lists no optional checks when the Acceptance review is what rejected the delivery', async () => {
    runFindByOperation.mockResolvedValue({ acceptanceId: 'a-1', id: 'run-1', status: 'passed' });
    vi.mocked(reviewGoalDelivery).mockResolvedValueOnce({
      feedback: 'The table is missing the totals row.',
      predictionIds: [],
      status: 'rejected',
    });
    checkResultsListByRun.mockResolvedValueOnce([
      {
        checkItemTitle: 'Optional style polish',
        required: false,
        status: 'failed',
        suggestion: 'Tighten the intro.',
        toulmin: null,
        verdict: 'failed',
      },
    ]);

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(deliverMock.mock.calls[0][0].errorMessage).toBe(
      [
        'Delivery did not pass verification.',
        'Acceptance review: The table is missing the totals row.',
      ].join('\n'),
    );
  });

  it('still sends the bare verdict when the failure details cannot be read', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', status: 'failed' });
    checkResultsListByRun.mockRejectedValueOnce(new Error('connection reset'));

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(deliverMock.mock.calls[0][0].errorMessage).toBe('Delivery did not pass verification.');
  });

  it('parks an undecidable Goal delivery on a person instead of another attempt', async () => {
    runFindByOperation.mockResolvedValue({
      id: 'run-1',
      acceptanceId: 'acceptance-1',
      status: 'passed',
    });
    goalFindByTask.mockResolvedValue({ id: 'goal-1' });
    vi.mocked(reviewGoalDelivery).mockResolvedValueOnce({
      status: 'unjudgeable',
      feedback: 'The check asks the reviewer to rerun the scripts.',
      predictionIds: ['p1'],
    });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: VERIFICATION_UNJUDGEABLE_ERROR,
    });
    expect(taskUpdateStatus).not.toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Delivery did not pass verification.',
    });
  });

  /**
   * Regression: a review that could not run paused the Task with the errored
   * contract string, which the coordinator recovers by starting another builder
   * attempt. A review that failed the same way every time — its model could not
   * download a screenshot — re-delivered the same work until the attempt budget
   * ran out, without the delivery ever being judged.
   */
  it('parks a review that keeps failing on a person instead of another attempt', async () => {
    runFindByOperation.mockResolvedValue({
      id: 'run-1',
      acceptanceId: 'acceptance-1',
      status: 'passed',
    });
    vi.mocked(reviewGoalDelivery).mockResolvedValue({
      status: 'errored',
      feedback: 'Error while downloading file. Upstream status code: 407.',
      predictionIds: [],
    });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    // The review retries its own errored checks; the settle path must not rerun
    // the whole review, which would re-ask checks that already rejected.
    expect(reviewGoalDelivery).toHaveBeenCalledTimes(1);
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: ACCEPTANCE_REVIEW_ERRORED_ERROR,
    });
    // The creator still hears the delivery was not evaluated, not that it failed.
    expect(deliverMock.mock.calls[0][0].errorMessage.toLowerCase()).toContain('internal error');
  });

  /**
   * Regression: a builder that planned its own round left `acceptanceId` null, so
   * the review could not reach the delivery and errored with "no Acceptance" — a
   * failure class with no recovery branch, which parked a passing delivery on a
   * person. The link is repaired here, before the review reads it.
   */
  it('binds an orphaned passing round to the task acceptance before reviewing it', async () => {
    const orphan = { acceptanceId: null, id: 'run-1', status: 'passed' };
    runFindByOperation.mockResolvedValue(orphan);
    vi.mocked(resolveTaskAcceptance).mockResolvedValue({
      acceptance: { id: 'acceptance-1' } as any,
      config: {},
    });
    vi.mocked(reviewGoalDelivery).mockResolvedValue({
      feedback: '',
      predictionIds: [],
      status: 'passed',
    });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(attachTaskRunToAcceptance).toHaveBeenCalledWith(
      db,
      'u1',
      { acceptanceId: 'acceptance-1', run: orphan },
      undefined,
    );
    expect(vi.mocked(attachTaskRunToAcceptance).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reviewGoalDelivery).mock.invocationCallOrder[0],
    );
    expect(serviceUpdateStatus).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
  });

  /**
   * Regression: a failed Acceptance resolution was swallowed after the drive claim
   * was stamped. The unattached round was reviewed into the non-retryable
   * "review could not run" gate, and every later finalizer call stopped at the
   * stamped claim — a transient error became a permanent human escalation.
   */
  it('leaves the drive unclaimed when the acceptance cannot be resolved', async () => {
    runFindByOperation.mockResolvedValue({ acceptanceId: null, id: 'run-1', status: 'passed' });
    vi.mocked(resolveTaskAcceptance).mockRejectedValue(new Error('connection terminated'));

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(runClaimTaskDrive).not.toHaveBeenCalled();
    expect(reviewGoalDelivery).not.toHaveBeenCalled();
    expect(taskUpdateStatus).not.toHaveBeenCalled();
  });

  it('leaves an already attached round alone', async () => {
    runFindByOperation.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      id: 'run-1',
      status: 'passed',
    });
    vi.mocked(reviewGoalDelivery).mockResolvedValue({
      feedback: '',
      predictionIds: [],
      status: 'passed',
    });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(resolveTaskAcceptance).not.toHaveBeenCalled();
    expect(attachTaskRunToAcceptance).not.toHaveBeenCalled();
  });

  it('does not launch a duplicate review when task drive is already claimed', async () => {
    runFindByOperation.mockResolvedValue({
      id: 'run-1',
      acceptanceId: 'acceptance-1',
      status: 'passed',
    });
    runClaimTaskDrive.mockResolvedValue(false);
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(reviewGoalDelivery).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.mocked(reviewGoalDelivery).mockReset();
    vi.mocked(resolveTaskAcceptance).mockReset().mockResolvedValue(undefined);
    vi.mocked(attachTaskRunToAcceptance)
      .mockReset()
      .mockImplementation(async (_db, _userId, params) => params.run);
    vi.mocked(scheduleGoalAdvance).mockClear();
    goalFindByTask.mockReset();
    [
      runClaimTaskDrive,
      runFindByOperation,
      runSetMetadata,
      opFindById,
      taskFindById,
      taskUpdateStatus,
      briefModelConstruct,
      briefCreate,
      serviceUpdateStatus,
      statusRecompute,
      deliverMock,
    ].forEach((m) => m.mockReset());
    // The drive is claimed before any side effect; unclaimed means "someone
    // else is driving this run", which every test here is not.
    runClaimTaskDrive.mockResolvedValue(true);
    briefModelConstruct.mockImplementation(function () {
      return { create: briefCreate };
    });
    opFindById.mockResolvedValue({ taskId: 'task-1', topicId: 'topic-done' });
    taskFindById.mockResolvedValue({
      assigneeAgentId: 'a1',
      id: 'task-1',
      identifier: 'T-1',
      status: 'running',
    });
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

  it('failed → keeps a recurring task scheduled instead of pausing (disarming) it', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'failed' });
    taskFindById.mockResolvedValue({
      assigneeAgentId: 'a1',
      automationMode: 'schedule',
      id: 'task-1',
      identifier: 'T-1',
      status: 'scheduled',
    });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    // Pausing would permanently disarm the cron — the schedule query never
    // picks `paused` tasks up again. The verdict stays on the run.
    expect(taskUpdateStatus).not.toHaveBeenCalled();
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    // The tick's rejection still reaches the creator callback.
    expect(deliverMock.mock.calls[0][0]).toMatchObject({ reason: 'error', taskId: 'task-1' });
  });

  it('errored → keeps a recurring task scheduled', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'errored' });
    taskFindById.mockResolvedValue({
      assigneeAgentId: 'a1',
      automationMode: 'heartbeat',
      id: 'task-1',
      identifier: 'T-1',
      status: 'scheduled',
    });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(taskUpdateStatus).not.toHaveBeenCalled();
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
  });

  it('failed → pauses with the reason on the task row without creating an inbox brief', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'failed' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(briefModelConstruct).not.toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Delivery did not pass verification.',
    });
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    // Creator is told it failed verification (reason 'error'), not a passed result.
    expect(deliverMock.mock.calls[0][0]).toMatchObject({ reason: 'error', taskId: 'task-1' });
  });

  it('failed with an Acceptance → completes the task, since the Acceptance is now delivered', async () => {
    runFindByOperation.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      id: 'run-1',
      metadata: null,
      status: 'failed',
    });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
    expect(taskUpdateStatus).not.toHaveBeenCalled();
    // The creator still hears the verdict: the round did not pass.
    expect(deliverMock.mock.calls[0][0]).toMatchObject({ reason: 'error', taskId: 'task-1' });
  });

  it('failed Goal task with an Acceptance → still pauses so the coordinator retries', async () => {
    runFindByOperation.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      id: 'run-1',
      metadata: null,
      status: 'failed',
    });
    goalFindByTask.mockResolvedValue({ id: 'goal-1' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Delivery did not pass verification.',
    });
  });

  it('failed with an Acceptance → pauses when the Goal lookup fails', async () => {
    runFindByOperation.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      id: 'run-1',
      metadata: null,
      status: 'failed',
    });
    goalFindByTask.mockRejectedValue(new Error('db down'));
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', {
      error: 'Delivery did not pass verification.',
    });
  });

  it('errored → pauses without an inbox brief; never claims the delivery "did not pass"', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'errored' });
    await driveTaskFromVerify(db, 'u1', 'op-1');

    // Paused for a human, but NOT completed — the delivery was never evaluated.
    expect(taskUpdateStatus).toHaveBeenCalledWith(
      'task-1',
      'paused',
      expect.objectContaining({ error: expect.stringContaining('could not run') }),
    );
    expect(serviceUpdateStatus).not.toHaveBeenCalled();

    expect(briefModelConstruct).not.toHaveBeenCalled();

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

  it('completes the task on a passing verify', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'passed' });

    await driveTaskFromVerify(db, 'u1', 'op-1');

    expect(serviceUpdateStatus).toHaveBeenCalledWith({ id: 'task-1', status: 'completed' });
    expect(briefCreate).not.toHaveBeenCalled();
  });
});

vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask: goalFindByTask };
  }),
}));
