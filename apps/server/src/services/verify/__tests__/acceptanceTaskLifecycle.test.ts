// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

/**
 * A task acceptance carries its task through the lifecycle: when the delivery
 * lands (`delivered`) the task completes, and a reject reopens it. Goal graph
 * tasks and recurring tasks are driven elsewhere and stay out of it.
 */
const mocks = vi.hoisted(() => ({
  distilRejections: vi.fn(),
  findById: vi.fn(),
  findPolicyById: vi.fn(),
  findReportByRun: vi.fn(),
  goalFindByGraphTask: vi.fn(),
  listByAcceptance: vi.fn(),
  setDecision: vi.fn(),
  taskResolve: vi.fn(),
  taskServiceUpdateStatus: vi.fn(),
  taskUpdateStatusIfCurrent: vi.fn(),
  updatePolicyStatus: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(function () {
    return {
      findById: mocks.findById,
      findPolicyById: mocks.findPolicyById,
      updatePolicyStatus: mocks.updatePolicyStatus,
      updateStatus: mocks.updateStatus,
    };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { listByAcceptance: mocks.listByAcceptance, setDecision: mocks.setDecision };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({ VerifyCheckResultModel: vi.fn() }));
vi.mock('@/database/models/verifyEvidence', () => ({ VerifyEvidenceModel: vi.fn() }));
vi.mock('@/database/models/verifyReport', () => ({
  VerifyReportModel: vi.fn(function () {
    return { findByRun: mocks.findReportByRun };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return {
      resolve: mocks.taskResolve,
      updateStatusIfCurrent: mocks.taskUpdateStatusIfCurrent,
    };
  }),
}));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask: mocks.goalFindByGraphTask };
  }),
}));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/server/services/task', () => ({
  TaskService: vi.fn(function () {
    return { updateStatus: mocks.taskServiceUpdateStatus };
  }),
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: mocks.distilRejections },
}));

const service = () => new AcceptanceService({} as any, 'user-1');

const taskAcceptance = (status: string) => ({
  id: 'acc-1',
  status,
  subjectId: 'task_1',
  subjectType: 'task',
});

describe('AcceptanceService task lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPolicyById.mockImplementation((...args: unknown[]) => mocks.findById(...args));
    mocks.goalFindByGraphTask.mockResolvedValue(undefined);
    mocks.taskResolve.mockResolvedValue({ automationMode: null, id: 'task_1', status: 'running' });
  });

  describe('delivered → task completed', () => {
    // The stored acceptance row: the rollup writes to it, later reads see it.
    let stored: ReturnType<typeof taskAcceptance>;

    beforeEach(() => {
      stored = taskAcceptance('verifying');
      mocks.findById.mockImplementation(async () => ({ ...stored }));
      mocks.updatePolicyStatus.mockImplementation(async (_id: string, status: string) => {
        stored.status = status;
      });
      // An ingested round: no verify pipeline status, settled by its report.
      mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1', roundIndex: 1, status: null }]);
      mocks.findReportByRun.mockResolvedValue({ id: 'report-1' });
    });

    it('completes the task when an ingested round delivers', async () => {
      await expect(service().recomputeStatus('acc-1')).resolves.toBe('delivered');

      expect(mocks.updatePolicyStatus).toHaveBeenCalledWith('acc-1', 'delivered');
      expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledWith({
        id: 'task_1',
        status: 'completed',
      });
    });

    it('leaves a server-verified round to driveTaskFromVerify', async () => {
      // A failed round may still be auto-repaired; settle drives the task once.
      mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1', roundIndex: 1, status: 'failed' }]);

      await expect(service().recomputeStatus('acc-1')).resolves.toBe('delivered');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('completes the task when an acceptance flow delivers its round', async () => {
      // `AcceptanceFlowModel.complete()` stamps the round `delivered` itself.
      mocks.listByAcceptance.mockResolvedValue([
        { id: 'run-1', roundIndex: 1, status: 'delivered' },
      ]);

      await expect(service().recomputeStatus('acc-1')).resolves.toBe('delivered');
      expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledWith({
        id: 'task_1',
        status: 'completed',
      });
    });

    it('does nothing when the status did not change', async () => {
      stored.status = 'delivered';

      await service().recomputeStatus('acc-1');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('leaves a Goal graph task to its coordinator', async () => {
      mocks.goalFindByGraphTask.mockResolvedValue({ id: 'goal-1' });

      await service().recomputeStatus('acc-1');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('leaves a recurring task on its schedule', async () => {
      mocks.taskResolve.mockResolvedValue({
        automationMode: 'schedule',
        id: 'task_1',
        status: 'scheduled',
      });

      await service().recomputeStatus('acc-1');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('does not touch an already completed task', async () => {
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        id: 'task_1',
        status: 'completed',
      });

      await service().recomputeStatus('acc-1');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('still settles the acceptance when completing the task fails', async () => {
      mocks.taskServiceUpdateStatus.mockRejectedValueOnce(new Error('cascade failed'));

      await expect(service().recomputeStatus('acc-1')).resolves.toBe('delivered');
      expect(mocks.updatePolicyStatus).toHaveBeenCalledWith('acc-1', 'delivered');
    });
  });

  describe('a reject racing the completion', () => {
    let stored: ReturnType<typeof taskAcceptance>;

    beforeEach(() => {
      stored = taskAcceptance('delivered');
      mocks.findById.mockImplementation(async () => ({ ...stored }));
    });

    it('leaves the task open when the reject already landed', async () => {
      stored.status = 'rejected';

      await expect(service().completeTaskForDelivery('acc-1', 'task_1')).resolves.toBe('rejected');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('reopens the task when the reject lands while it is being completed', async () => {
      // The reject saw an unfinished task, so it had nothing to reopen.
      mocks.taskResolve
        .mockResolvedValueOnce({ automationMode: null, id: 'task_1', status: 'running' })
        .mockResolvedValueOnce({ automationMode: null, id: 'task_1', status: 'running' })
        .mockResolvedValue({ automationMode: null, id: 'task_1', status: 'completed' });
      mocks.taskServiceUpdateStatus.mockImplementationOnce(async () => {
        stored.status = 'rejected';
      });

      await expect(service().completeTaskForDelivery('acc-1', 'task_1')).resolves.toBe('rejected');
      expect(mocks.taskUpdateStatusIfCurrent).toHaveBeenCalledWith(
        'task_1',
        'completed',
        'paused',
        { completedAt: null },
      );
    });

    it('completes the task when no reject intervenes', async () => {
      await expect(service().completeTaskForDelivery('acc-1', 'task_1')).resolves.toBe('completed');
      expect(mocks.taskUpdateStatusIfCurrent).not.toHaveBeenCalled();
    });
  });

  describe('rejected → task reopened', () => {
    beforeEach(() => {
      mocks.findById.mockResolvedValue(taskAcceptance('delivered'));
      mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1', roundIndex: 1 }]);
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        id: 'task_1',
        status: 'completed',
      });
    });

    it('moves the completed task back to paused', async () => {
      await service().reject('acc-1', 'Fix the header');

      expect(mocks.updateStatus).toHaveBeenCalledWith('acc-1', 'rejected');
      expect(mocks.taskUpdateStatusIfCurrent).toHaveBeenCalledWith(
        'task_1',
        'completed',
        'paused',
        {
          completedAt: null,
        },
      );
    });

    it('keeps a task the user already moved elsewhere', async () => {
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        id: 'task_1',
        status: 'running',
      });

      await service().reject('acc-1', 'Fix the header');
      expect(mocks.taskUpdateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('leaves a Goal graph task to its coordinator', async () => {
      mocks.goalFindByGraphTask.mockResolvedValue({ id: 'goal-1' });

      await service().reject('acc-1', 'Fix the header');
      expect(mocks.taskUpdateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('ignores non-task subjects', async () => {
      mocks.findById.mockResolvedValue({ ...taskAcceptance('delivered'), subjectType: 'topic' });

      await service().reject('acc-1', 'Fix the header');
      expect(mocks.taskResolve).not.toHaveBeenCalled();
    });
  });
});
