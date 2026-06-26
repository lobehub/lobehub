// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { driveTaskFromVerify } from '../settle';

const {
  runFindByOperation,
  runSetMetadata,
  opFindById,
  taskFindById,
  taskUpdateStatus,
  briefCreate,
  serviceUpdateStatus,
  deliverMock,
} = vi.hoisted(() => ({
  briefCreate: vi.fn(),
  deliverMock: vi.fn(),
  opFindById: vi.fn(),
  runFindByOperation: vi.fn(),
  runSetMetadata: vi.fn(),
  serviceUpdateStatus: vi.fn(),
  taskFindById: vi.fn(),
  taskUpdateStatus: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    findByOperation: runFindByOperation,
    setMetadata: runSetMetadata,
  })),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: opFindById })),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({ findById: taskFindById, updateStatus: taskUpdateStatus })),
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

describe('driveTaskFromVerify (LOBE-10624)', () => {
  beforeEach(() => {
    [
      runFindByOperation,
      runSetMetadata,
      opFindById,
      taskFindById,
      taskUpdateStatus,
      briefCreate,
      serviceUpdateStatus,
      deliverMock,
    ].forEach((m) => m.mockReset());
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
    expect(runSetMetadata).toHaveBeenCalled();
  });

  it('failed → urgent brief + pauses, delivers a failure creator callback', async () => {
    runFindByOperation.mockResolvedValue({ id: 'run-1', metadata: null, status: 'failed' });
    await driveTaskFromVerify(db, 'u1', 'op-1');
    expect(briefCreate).toHaveBeenCalled();
    expect(taskUpdateStatus).toHaveBeenCalledWith('task-1', 'paused', { error: null });
    expect(serviceUpdateStatus).not.toHaveBeenCalled();
    // Creator is told it failed verification (reason 'error'), not a passed result.
    expect(deliverMock.mock.calls[0][0]).toMatchObject({ reason: 'error', taskId: 'task-1' });
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
});
