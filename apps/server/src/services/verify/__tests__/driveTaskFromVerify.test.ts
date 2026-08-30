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
  taskUpdateStatus,
  briefModelConstruct,
  briefCreate,
  serviceUpdateStatus,
  statusRecompute,
  deliverMock,
} = vi.hoisted(() => ({
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
    updateStatus: taskUpdateStatus,
  })),
}));
vi.mock('@/database/models/brief', () => ({
  BriefModel: briefModelConstruct,
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
    briefModelConstruct.mockImplementation(() => ({ create: briefCreate }));
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
