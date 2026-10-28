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
  taskFindById: vi.fn(),
  taskResolve: vi.fn(),
  taskWithdrawCompletionRequest: vi.fn(),
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
      findById: mocks.taskFindById,
      resolve: mocks.taskResolve,
      withdrawCompletionRequest: mocks.taskWithdrawCompletionRequest,
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
    // The row read back after the completion write.
    mocks.taskFindById.mockResolvedValue({ id: 'task_1', status: 'completed' });
    mocks.taskServiceUpdateStatus.mockResolvedValue({});
    mocks.taskWithdrawCompletionRequest.mockResolvedValue(true);
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

    it('hands the publishing run to the completion so the task does not interrupt it', async () => {
      // An agent ingesting acceptance for the task it is running: interrupting
      // that run mid-command surfaced as a refused tool call and stopped it.
      mocks.listByAcceptance.mockResolvedValue([
        {
          id: 'run-1',
          metadata: { origin: { operationId: 'op-self' } },
          roundIndex: 1,
          status: null,
        },
      ]);
      mocks.taskServiceUpdateStatus.mockResolvedValue({ completionDeferred: true });
      mocks.taskFindById.mockResolvedValue({ id: 'task_1', status: 'running' });

      await expect(service().recomputeStatus('acc-1')).resolves.toBe('delivered');
      expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledWith({
        id: 'task_1',
        operationId: 'op-self',
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

    it('leaves an already completed task alone when the status did not change', async () => {
      stored.status = 'delivered';
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        id: 'task_1',
        status: 'completed',
      });

      await service().recomputeStatus('acc-1');
      expect(mocks.taskServiceUpdateStatus).not.toHaveBeenCalled();
    });

    it('retries a completion that failed on the delivering recompute', async () => {
      // First recompute delivers, but completing the task fails and it stays open.
      mocks.taskServiceUpdateStatus.mockRejectedValueOnce(new Error('interrupt failed'));
      mocks.taskFindById.mockResolvedValueOnce({ id: 'task_1', status: 'running' });
      await service().recomputeStatus('acc-1');
      expect(stored.status).toBe('delivered');

      // A later recompute (status unchanged) completes it.
      await service().recomputeStatus('acc-1');
      expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledTimes(2);
      expect(mocks.taskServiceUpdateStatus).toHaveBeenLastCalledWith({
        id: 'task_1',
        status: 'completed',
      });
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

    it('withdraws a deferred completion when the reject lands while it is being deferred', async () => {
      // The reject read the task before the marker existed, so it had nothing to withdraw.
      const deferredTask = {
        automationMode: null,
        context: { completion: { requestedByOperationId: 'op-self' } },
        id: 'task_1',
        status: 'running',
      };
      mocks.taskResolve
        .mockResolvedValueOnce({ automationMode: null, id: 'task_1', status: 'running' })
        .mockResolvedValueOnce({ automationMode: null, id: 'task_1', status: 'running' })
        .mockResolvedValue(deferredTask);
      mocks.taskServiceUpdateStatus.mockImplementationOnce(async () => {
        stored.status = 'rejected';
        return { completionDeferred: true };
      });
      mocks.taskFindById.mockResolvedValueOnce(deferredTask);

      await expect(service().completeTaskForDelivery('acc-1', 'task_1', 'op-self')).resolves.toBe(
        'rejected',
      );
      expect(mocks.taskWithdrawCompletionRequest).toHaveBeenCalledWith('task_1', 'op-self');
    });

    it('reports the completion as skipped when the task could not be completed', async () => {
      // completeTaskSubject swallows the failure; the row still reads running.
      mocks.taskServiceUpdateStatus.mockRejectedValueOnce(new Error('interrupt failed'));
      mocks.taskFindById.mockResolvedValueOnce({ id: 'task_1', status: 'running' });

      await expect(service().completeTaskForDelivery('acc-1', 'task_1')).resolves.toBe('skipped');
    });

    it('completes the task when no reject intervenes', async () => {
      await expect(service().completeTaskForDelivery('acc-1', 'task_1')).resolves.toBe('completed');
      expect(mocks.taskUpdateStatusIfCurrent).not.toHaveBeenCalled();
    });
  });

  describe('accepted while the delivering run is still going', () => {
    beforeEach(() => {
      mocks.findById.mockResolvedValue(taskAcceptance('delivered'));
      mocks.listByAcceptance.mockResolvedValue([{ id: 'run-1', roundIndex: 1 }]);
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        context: { completion: { requestedByOperationId: 'op-self' } },
        id: 'task_1',
        status: 'running',
      });
    });

    it('keeps waiting for that run on accept instead of interrupting it', async () => {
      await service().accept('acc-1');

      expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledWith({
        id: 'task_1',
        operationId: 'op-self',
        status: 'completed',
      });
    });

    it('keeps waiting for that run when a merged pull request accepts it', async () => {
      await service().acceptFromScmMerge('acc-1', {
        number: 1,
        repoFullName: 'lobehub/lobehub',
      } as any);

      expect(mocks.taskServiceUpdateStatus).toHaveBeenCalledWith({
        id: 'task_1',
        operationId: 'op-self',
        status: 'completed',
      });
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
      expect(mocks.taskWithdrawCompletionRequest).not.toHaveBeenCalled();
    });

    it('withdraws a completion still waiting for the delivering run to end', async () => {
      // Otherwise onTopicComplete would complete a task whose delivery was rejected.
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        context: { completion: { requestedByOperationId: 'op-self' } },
        id: 'task_1',
        status: 'running',
      });

      await service().reject('acc-1', 'Fix the header');
      expect(mocks.taskWithdrawCompletionRequest).toHaveBeenCalledWith('task_1', 'op-self');
      expect(mocks.taskUpdateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('reopens the task when the delivering run completed it before the withdrawal', async () => {
      mocks.taskResolve.mockResolvedValue({
        automationMode: null,
        context: { completion: { requestedByOperationId: 'op-self' } },
        id: 'task_1',
        status: 'running',
      });
      mocks.taskWithdrawCompletionRequest.mockResolvedValue(false);
      mocks.taskFindById.mockResolvedValue({ id: 'task_1', status: 'completed' });

      await service().reject('acc-1', 'Fix the header');
      expect(mocks.taskUpdateStatusIfCurrent).toHaveBeenCalledWith(
        'task_1',
        'completed',
        'paused',
        { completedAt: null },
      );
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
